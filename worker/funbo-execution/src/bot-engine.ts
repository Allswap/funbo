import { ethers } from 'ethers';
import { goplusScanTokenSafety, BlockscoutClient, isWellKnownTokenWithConfig } from './api-providers';
import { getWorkingProvider } from './rpc-pool';
import { getPolPriceUsd } from '../../shared/pol-prices';
import { isFeeToken, getKyberQuote, buildKyberSwapData, KYBER_ROUTER, isPolToken, POL_NATIVE, POL_WRAPPED } from '../../shared/aggregator';

export async function writeR2Log(env: Env, bucket: string, key: string, data: any): Promise<void> {
  try {
    const r2 = env.FUNBO_R2;
    if (r2) {
      await r2.put(bucket + '/' + key, JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error('[R2] write failed:', e);
  }
}

export async function logScanResult(env: Env, chainId: number, scanType: string, opportunities: any[]): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `scans/${chainId}/${scanType}/${timestamp}.json`;
  await writeR2Log(env, 'funbo-execution-data', key, {
    chainId,
    scanType,
    timestamp,
    opportunityCount: opportunities.length,
    opportunities: opportunities.map(o => ({
      id: o.id,
      routerA: o.router_a,
      routerB: o.router_b,
      tokenA: o.token_a,
      tokenB: o.token_b,
      profitPct: o.profit_pct,
      status: o.status
    }))
  });
}

export async function logTradeReceipt(env: Env, trade: any): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `trades/${trade.chainId}/${trade.strategy}/${trade.txHash || 'pending'}_${Date.now()}.json`;
  await writeR2Log(env, 'funbo-execution-data', key, trade);
}

const decimalCache = new Map<string, number>();

export async function waitTx(tx: ethers.TransactionResponse, confirmations: number = 1, timeoutMs: number = 30000): Promise<ethers.TransactionReceipt | null> {
  try {
    return await Promise.race([
      tx.wait(confirmations),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error(`tx.wait timeout after ${timeoutMs}ms`)), timeoutMs))
    ]);
  } catch (err: any) {
    console.warn(`[waitTx] timeout/error: ${err.message} tx=${tx.hash?.slice(0,10)}`);
    return null;
  }
}

async function getTokenDecimals(provider: ethers.Provider, token: string, chainId?: number): Promise<number> {
  const key = chainId ? `${chainId}:${token.toLowerCase()}` : token.toLowerCase();
  const cached = decimalCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const contract = new ethers.Contract(token, ERC20_ABI, provider);
    const dec = await contract.decimals() as number;
    decimalCache.set(key, dec);
    return dec;
  } catch {
    return 18;
  }
}

interface RouterConfig {
  id: number;
  name: string;
  address: string;
  chain_id: number;
  is_active: number;
  version?: string;
  quoter_address?: string | null;
  fee_tiers?: string | null;
}

interface NetworkConfig {
  chain_id: number;
  rpc_url: string;
  explorer_url: string;
  rpc_urls?: string[];
  mev_protected_rpc?: string;
}

function getMevProtectedProvider(_env: Env, network: NetworkConfig): ethers.JsonRpcProvider {
  if (network.mev_protected_rpc) {
    return new ethers.JsonRpcProvider(network.mev_protected_rpc);
  }
  return new ethers.JsonRpcProvider(network.rpc_url);
}

/**
 * Live on-chain gas pricing. Polygon EIP-1559: uses the mempool's maxFeePerGas /
 * maxPriorityFeePerGas. On legacy-only chains falls back to gasPrice. Keeps the old
 * static 35/90 gwei values only as a last-resort fallback (never a hardcap).
 */
export async function getGasOverrides(provider: ethers.Provider): Promise<Record<string, bigint>> {
  try {
    const feeData = await provider.getFeeData();
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas && feeData.maxFeePerGas > 0n) {
      return { maxPriorityFeePerGas: feeData.maxPriorityFeePerGas, maxFeePerGas: feeData.maxFeePerGas };
    }
    if (feeData.gasPrice && feeData.gasPrice > 0n) return { gasPrice: feeData.gasPrice };
  } catch {}
  return { maxPriorityFeePerGas: ethers.parseUnits('35', 'gwei'), maxFeePerGas: ethers.parseUnits('90', 'gwei') };
}

/** On-chain block timestamp based deadline (avoids CF wall-clock drift → EXPIRED). */
async function getBlockchainDeadline(provider: ethers.Provider, ttlSec: number = 600): Promise<number> {
  try {
    const block = await provider.getBlock('latest');
    if (block && block.timestamp) return block.timestamp + ttlSec;
  } catch {}
  return Math.floor(Date.now() / 1000) + ttlSec;
}

export interface TradeResult {
  success: boolean;
  strategy: string;
  tokenA: string;
  tokenB: string;
  amountIn: string;
  amountOut: string;
  profitPct: number;
  status: 'success' | 'failed' | 'skipped' | 'stopped';
  txHash: string | null;
  errorMsg: string | null;
  gasSpent?: string;
  netProfit?: string;
}

export interface BotTransaction {
  chainId: number;
  strategy: string;
  opportunityId?: number;
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut?: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  txHash: string;
  txStatus: 'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
  gasUsed?: number;
  gasPriceGwei?: number;
  gasCostNative?: string;
  gasCostUsd?: string;
  logsJson?: string;
  errorMsg?: string;
}

async function recordBotTransaction(env: Env, tx: BotTransaction): Promise<number | null> {
  const DB = env['funbo-db'];
  try {
    const result = await DB.prepare(`
      INSERT INTO bot_transactions (
        chain_id, strategy, opportunity_id, wallet_address, token_in, token_out,
        amount_in, amount_out, amount_in_usd, amount_out_usd, tx_hash, tx_status,
        block_number, gas_used, gas_price_gwei, gas_cost_native, gas_cost_usd,
        logs_json, error_msg, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tx.chainId, tx.strategy, tx.opportunityId || null, tx.walletAddress, tx.tokenIn, tx.tokenOut,
      tx.amountIn, tx.amountOut || null, tx.amountInUsd || null, tx.amountOutUsd || null,
      tx.txHash, tx.txStatus, tx.blockNumber || null, tx.gasUsed || null, tx.gasPriceGwei || null,
      tx.gasCostNative || null, tx.gasCostUsd || null, tx.logsJson || null,
      tx.errorMsg || null, tx.txStatus === 'confirmed' ? new Date().toISOString() : null
    ).run();
    return result.meta.last_row_id;
  } catch (e) {
    console.error('[tx] failed to record transaction:', e);
    return null;
  }
}

async function updateBotTransaction(env: Env, id: number, updates: Partial<BotTransaction>): Promise<void> {
  const DB = env['funbo-db'];
  const sets: string[] = [];
  const binds: any[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) {
      const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      sets.push(`${col} = ?`);
      binds.push(v);
    }
  }
  if (sets.length === 0) return;
  binds.push(id);
  await DB.prepare(`UPDATE bot_transactions SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
}

async function executeAndRecordTransaction(
  env: Env,
  network: NetworkConfig,
  wallet: ethers.Wallet,
  provider: ethers.Provider,
  strategy: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  executeFn: (wallet: ethers.Wallet) => Promise<ethers.TransactionResponse>,
  opportunityId?: number,
  amountInUsd?: string,
  amountOutUsd?: string
): Promise<{ txHash: string; success: boolean; receipt: ethers.TransactionReceipt | null; errorMsg?: string }> {
  const DB = env['funbo-db'];
  let txHash = '';
  let receipt: ethers.TransactionReceipt | null = null;
  let errorMsg: string | undefined;

  try {
    const mevProviderUrl = network.mev_protected_rpc || network.rpc_urls?.[0];
    const mevWallet = mevProviderUrl ? new ethers.Wallet(env.PRIVATE_KEY!, new ethers.JsonRpcProvider(mevProviderUrl)) : wallet;
    const txResp = await executeFn(mevWallet);
    txHash = txResp.hash;

    await recordBotTransaction(env, {
      chainId: network.chain_id,
      strategy,
      opportunityId,
      walletAddress: wallet.address,
      tokenIn,
      tokenOut,
      amountIn,
      txHash,
      txStatus: 'pending',
    });

    receipt = await waitTx(txResp, 1, 30000);
    if (!receipt) {
      return { txHash, success: false, receipt: null, errorMsg: 'tx.wait timeout or no receipt' };
    }

    const gasUsed = Number(receipt.gasUsed);
    const gasPrice = receipt.gasPrice ? Number(receipt.gasPrice) / 1e9 : 0;
    const gasCostNative = (BigInt(gasUsed) * (receipt.gasPrice || 0n)).toString();
    // Live tx cost in USD (POL spot from CoinGecko, KV-cached 2 min) — estimate survives gecko outage.
    const polUsd = await getPolPriceUsd(env);
    const gasCostUsd = polUsd > 0 ? String((Number(gasCostNative) / 1e18) * polUsd) : undefined;

    const logsJson = JSON.stringify(receipt.logs.map(l => ({
      address: l.address,
      topics: l.topics,
      data: l.data,
    })));

    const db = env['funbo-db'];
    await db.prepare(`
      UPDATE bot_transactions SET
        tx_status = ?, block_number = ?, gas_used = ?, gas_price_gwei = ?,
        gas_cost_native = ?, gas_cost_usd = ?, logs_json = ?, confirmed_at = ?
      WHERE tx_hash = ?
    `).bind(
      'confirmed', receipt.blockNumber, gasUsed, gasPrice,
      gasCostNative, gasCostUsd, logsJson, new Date().toISOString(), txHash
    ).run();

    return { txHash, success: true, receipt, errorMsg: undefined };
  } catch (err: any) {
    errorMsg = err.message;
    if (txHash) {
      await env['funbo-db'].prepare(`
        UPDATE bot_transactions SET tx_status = ?, error_msg = ? WHERE tx_hash = ?
      `).bind('failed', errorMsg, txHash).run();
    }
    return { txHash, success: false, receipt: null, errorMsg };
  }
}

const DEFAULT_MAX_DAILY_LOSS_PCT = 5.0;

const V2_ROUTER_ABI = [
  'function factory() view returns (address)',
  'function getAmountsOut(uint,address[]) view returns (uint[])',
  'function swapExactTokensForTokens(uint,uint,address[],address,uint) returns (uint[])',
  'function swapExactETHForTokens(uint,address[],address,uint) payable returns (uint[])',
  'function swapExactTokensForETH(uint,uint,address[],address,uint) returns (uint[])',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint,uint,address[],address,uint)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint,address[],address,uint) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint,uint,address[],address,uint)',
  'function WETH() view returns (address)',
] as const;

const V2_FACTORY_ABI = [
  'function getPair(address,address) view returns (address)',
] as const;

const V2_PAIR_ABI = [
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
] as const;

const V3_ROUTER_ABI = [
  'struct ExactInputParams { bytes path; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; }',
  'function exactInput(ExactInputParams calldata) payable returns (uint256 amountOut)',
] as const;

const V3_QUOTER_ABI = [
  'function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut)',
] as const;

const BALANCER_VAULT_ABI = [
  'function swap((uint256 kind, address tokenIn, address tokenOut, uint256 amount, bytes32 poolId) swapInput, address recipient, bool fromInternalBalance, bytes outputReference) external payable returns (uint256)',
  'function getPoolTokens(bytes32 poolId) view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)'
] as const;

const UNIVERSAL_ROUTER_ABI = [
  'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) payable returns (bytes memory)'
] as const;

const URCommand = { V2_SWAP: 0x00, V3_SWAP: 0x01 } as const;

async function queryBalancerSwap(
  provider: ethers.Provider,
  vaultAddress: string,
  poolId: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint
): Promise<bigint | null> {
  try {
    const vault = new ethers.Contract(vaultAddress, BALANCER_VAULT_ABI, provider);
    const poolIdBytes = poolId.startsWith('0x') && poolId.length === 66 ? poolId : '0x' + poolId.toLowerCase().padEnd(64, '0');
    const [tokens, balances] = await vault.getPoolTokens.staticCall(poolIdBytes) as [string[], bigint[]];
    const tokenIdxIn = tokens.findIndex((t: string) => t.toLowerCase() === tokenIn.toLowerCase());
    const tokenIdxOut = tokens.findIndex((t: string) => t.toLowerCase() === tokenOut.toLowerCase());
    if (tokenIdxIn === -1 || tokenIdxOut === -1 || balances[tokenIdxIn] === 0n) return null;
    const amountOut = (balances[tokenIdxOut] * amountIn * 997n) / (balances[tokenIdxIn] * 1000n + amountIn * 997n);
    return amountOut;
  } catch {
    return null;
  }
}

const WMATIC_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'.toLowerCase();

const WMATIC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function deposit() payable',
] as const;

export const ARB_EXECUTOR_ABI = [
  'function executeArb(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, bytes calldata dexData) returns (uint256 amountOut)',
  'function owner() view returns (address)',
  'function authorizedTokens(address) view returns (bool)',
  'function approveToken(address token) external',
] as const;

async function ensureWmaticBalance(
  wallet: ethers.Wallet,
  provider: ethers.Provider,
  tokenA: string,
  amountInWei: bigint,
  env?: any
): Promise<void> {
  if (tokenA.toLowerCase() !== WMATIC_ADDRESS) return;

  const wmatic = new ethers.Contract(WMATIC_ADDRESS, WMATIC_ABI, wallet);
  const balance = await wmatic.balanceOf(wallet.address) as bigint;
  const targetBalance = amountInWei * 2n;
  if (balance >= targetBalance) {
    console.log(`[executor] WMATIC balance OK: ${ethers.formatEther(balance)} (target ${ethers.formatEther(targetBalance)})`);
    return;
  }

  const needed = targetBalance - balance;
  const nativeBalance = await provider.getBalance(wallet.address);
  const gasReserve = ethers.parseEther('0.5');
  const wrapAmount = nativeBalance > needed + gasReserve ? needed : (nativeBalance > gasReserve ? nativeBalance - gasReserve : 0n);

  if (wrapAmount <= 0n) {
    console.log(`[executor] skip wrap: MATIC balance ${ethers.formatEther(nativeBalance)} insufficient (need ${ethers.formatEther(needed + gasReserve)})`);
    return;
  }

  console.log(`[executor] wrapping ${ethers.formatEther(wrapAmount)} MATIC → WMATIC (have ${ethers.formatEther(balance)} WMATIC, target ${ethers.formatEther(targetBalance)}, native ${ethers.formatEther(nativeBalance)})`);
  try {
    const tx = await wmatic.deposit({
      value: wrapAmount,
      gasLimit: 100000,
      ...await getGasOverrides(provider),
    });
    const receipt = await waitTx(tx, 1, 30000);
    if (!receipt || receipt.status === 0) {
      console.error(`[executor] WMATIC wrap failed: tx=${tx.hash}`);
    } else {
      const newBalance = await wmatic.balanceOf(wallet.address) as bigint;
      console.log(`[executor] wrapped OK tx=${tx.hash} new WMATIC=${ethers.formatEther(newBalance)}`);
    }
  } catch (err: any) {
    console.error(`[executor] WMATIC wrap error: ${err.message}`);
  }
}

const ERC20_ABI = [
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

function encodeV3Path(tokens: string[], fees: number[]): string {
  let path = '0x';
  for (let i = 0; i < fees.length; i++) {
    path += tokens[i].slice(2) + fees[i].toString(16).padStart(6, '0');
  }
  path += tokens[tokens.length - 1].slice(2);
  return path.toLowerCase();
}

/** Native POL (0x1010) is not an ERC-20 in pools/ABI paths — use wrapped WPOL for path quoting and swaps. */
function toWrappedForPath(addr: string): string {
  return isPolToken(addr) ? POL_WRAPPED : addr.toLowerCase();
}

async function getAmountOut(
  provider: ethers.Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  routerAddress: string
): Promise<bigint | null> {
  try {
    const router = new ethers.Contract(routerAddress, V2_ROUTER_ABI, provider);
    const amounts = await router.getAmountsOut(amountIn, [toWrappedForPath(tokenIn), toWrappedForPath(tokenOut)]);
    return amounts[1] as bigint;
  } catch {
    return null;
  }
}

async function getAmountOutV3(
  provider: ethers.Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  quoterAddress: string,
  feeTiers: number[]
): Promise<{ amountOut: bigint; feeTier: number } | null> {
  try {
    const quoter = new ethers.Contract(quoterAddress, V3_QUOTER_ABI, provider);
    let best = { amountOut: 0n, feeTier: feeTiers[0] || 3000 };
    for (const fee of feeTiers) {
      try {
        const path = encodeV3Path([tokenIn, tokenOut], [fee]);
        const amount = await quoter.quoteExactInput.staticCall(path, amountIn) as bigint;
        if (amount > best.amountOut) {
          best = { amountOut: amount, feeTier: fee };
        }
      } catch { continue; }
    }
    if (best.amountOut === 0n) return null;
    return best;
  } catch {
    return null;
  }
}

interface QuoteResult {
  amountOut: bigint;
  feeTier?: number;
}

async function quoteAmountOut(
  provider: ethers.Provider,
  tokenA: string,
  tokenB: string,
  amountIn: bigint,
  router: RouterConfig,
  defaultFeeTier: number
): Promise<QuoteResult | null> {
  const version = (router.version || 'v2').toLowerCase();

  if (version === 'balancer' || version === 'v2-vault') {
    const poolId = router.fee_tiers || '';
    if (!poolId) return null;
    const result = await queryBalancerSwap(provider, router.address, poolId, tokenA, tokenB, amountIn);
    return result ? { amountOut: result } : null;
  }

  if (version === 'v3') {
    const quoter = (router.quoter_address || '').trim();
    if (!quoter) return null;
    const tiers = [1000, 3000, 500, 10000, 100];
    const result = await getAmountOutV3(provider, tokenA, tokenB, amountIn, quoter, tiers);
    return result ? { amountOut: result.amountOut, feeTier: result.feeTier } : null;
  }

  if (version === 'universal') {
    const path = encodeV3Path([tokenA, tokenB], [defaultFeeTier]);
    try {
      const amountOut = await getAmountOutV3(provider, tokenA, tokenB, amountIn, router.address, [defaultFeeTier]);
      return amountOut ? { amountOut: amountOut.amountOut, feeTier: amountOut.feeTier } : null;
    } catch {
      return null;
    }
  }

  const amountOut = await getAmountOut(provider, tokenA, tokenB, amountIn, router.address);
  return amountOut !== null ? { amountOut } : null;
}

async function estimateGasCost(
  provider: ethers.Provider,
  chainId: number,
  buyRouter: RouterConfig,
  sellRouter: RouterConfig,
  tokenA: string,
  tokenB: string,
  feeTier: number
): Promise<number> {
  try {
    const nativeTokens: Record<number, string> = {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      8453: '0x4200000000000000000000000000000000000006',
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      10: '0x4200000000000000000000000000000000000006',
    };
    const nativeToken = nativeTokens[chainId] || tokenB;

    const buyVersion = (buyRouter.version || 'v2').toLowerCase();
    const sellVersion = (sellRouter.version || 'v2').toLowerCase();

    let estGas = 0n;
    if (buyVersion === 'v3') estGas += 180000n; else estGas += 150000n;
    if (sellVersion === 'v3') estGas += 180000n; else estGas += 150000n;
    estGas += 50000n;

    // Live gas price — Polygon EIP-1559 fee data, fallback to 60 gwei estimate only when unavailable
    const feeData = await provider.getFeeData();
    const liveFee = feeData.maxFeePerGas && feeData.maxFeePerGas > 0n
      ? feeData.maxFeePerGas
      : (feeData.gasPrice && feeData.gasPrice > 0n ? feeData.gasPrice : ethers.parseUnits('60', 'gwei'));
    const gasCostNative = estGas * liveFee;

    const tradeAmountWei = ethers.parseEther('0.1');
    const quoteResult = await quoteAmountOut(provider, nativeToken, tokenB, gasCostNative, buyRouter, feeTier);
    if (quoteResult && quoteResult.amountOut > 0n) {
      const tokenBDecimals = await getTokenDecimals(provider, tokenB);
      const gasCostTokenB = quoteResult.amountOut;
      const tradeOutResult = await quoteAmountOut(provider, tokenA, tokenB, tradeAmountWei, buyRouter, feeTier);
      if (tradeOutResult && tradeOutResult.amountOut > 0n) {
        const gasCostPct = Number(gasCostTokenB * 10000n / tradeOutResult.amountOut) / 100;
        return Math.min(gasCostPct, 2.0);
      }
    }
    return 0.5;
  } catch {
    return 0.5;
  }
}

async function scanArbOpportunity(
  provider: ethers.Provider,
  tokenA: string,
  tokenB: string,
  tradeAmountWei: bigint,
  minProfitPct: number,
  maxProfitPct: number,
  routerA: RouterConfig,
  routerB: RouterConfig,
  defaultFeeTier: number
): Promise<{
  amountOutA: bigint;
  amountOutB: bigint;
  profitPct: number;
  routerA: string;
  routerB: string;
  feeTierA?: number;
  feeTierB?: number;
} | null> {
  try {
    const quoteA = await quoteAmountOut(provider, tokenA, tokenB, tradeAmountWei, routerA, defaultFeeTier);
    const quoteB = await quoteAmountOut(provider, tokenA, tokenB, tradeAmountWei, routerB, defaultFeeTier);

    if (quoteA === null || quoteB === null) return null;
    if (quoteA.amountOut === 0n || quoteB.amountOut === 0n) return null;

    const amountOutA = quoteA.amountOut;
    const amountOutB = quoteB.amountOut;
    const difference = amountOutA > amountOutB ? amountOutA - amountOutB : amountOutB - amountOutA;
    const profitPct = Number((difference * 10000n) / (amountOutA < amountOutB ? amountOutA : amountOutB)) / 100;

    if (profitPct < minProfitPct || profitPct > maxProfitPct) return null;

    return { amountOutA, amountOutB, profitPct, routerA: routerA.address, routerB: routerB.address, feeTierA: quoteA.feeTier, feeTierB: quoteB.feeTier };
  } catch {
    return null;
  }
}

async function scanSameDexOpportunity(
  provider: ethers.Provider,
  tokenA: string,
  tokenB: string,
  tradeAmountWei: bigint,
  minProfitPct: number,
  router: RouterConfig,
  defaultFeeTier: number
): Promise<{
  amountOut: bigint;
  profitPct: number;
  feeTierBest: number;
  feeTierWorst: number;
} | null> {
  const version = (router.version || 'v2').toLowerCase();
  
  if (version !== 'v3') return null;
  
  const quoter = (router.quoter_address || '').trim();
  if (!quoter) return null;
  
  const allTiers = [100, 500, 3000, 10000];
  const tiers = router.fee_tiers
    ? router.fee_tiers.split(',').map(s => {
        const val = parseFloat(s.trim());
        return val < 10 ? Math.round(val * 10000) : Math.round(val);
      }).filter(n => !isNaN(n) && n > 0)
    : allTiers;
  
  const quotes: { amountOut: bigint; feeTier: number }[] = [];
  
  for (const fee of tiers) {
    try {
      const result = await getAmountOutV3(provider, tokenA, tokenB, tradeAmountWei, quoter, [fee]);
      if (result && result.amountOut > 0n) {
        quotes.push(result);
      }
    } catch {}
  }
  
  if (quotes.length < 2) return null;
  
  quotes.sort((a, b) => Number(b.amountOut) - Number(a.amountOut));
  
  const best = quotes[0];
  const worst = quotes[quotes.length - 1];
  
  const difference = best.amountOut - worst.amountOut;
  const profitPct = Number((difference * 10000n) / worst.amountOut) / 100;
  
  if (profitPct < minProfitPct) return null;
  
  return { amountOut: worst.amountOut, profitPct, feeTierBest: best.feeTier, feeTierWorst: worst.feeTier };
}



function truncateDecimals(value: string, decimals: number): string {
  const parts = value.split('.');
  if (parts.length !== 2) return value;
  return parts[0] + '.' + parts[1].slice(0, decimals);
}

async function checkRiskRules(
  provider: ethers.Provider,
  walletAddress: string,
  _chainId: number,
  tradeAmount: string,
  minBalancePct: number,
  maxBalancePct: number,
  minBalanceAmount: string | null,
  tokenAddress?: string,
  tokenDecimals?: number
): Promise<{ valid: boolean; reason: string }> {
  const nativeBalance = await provider.getBalance(walletAddress);
  const tokenDec = tokenDecimals ?? (tokenAddress && tokenAddress !== ethers.ZeroAddress ? await getTokenDecimals(provider, tokenAddress, _chainId) : 18);
  const tradeAmountWei = ethers.parseUnits(tradeAmount, tokenDec);

  let relevantBalance = nativeBalance;

  if (tokenAddress && tokenAddress !== ethers.ZeroAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const tokenBal = await tokenContract.balanceOf(walletAddress) as bigint;
      if (tokenBal > 0n) relevantBalance = tokenBal;
    } catch {
      return { valid: false, reason: "Failed to check token balance" };
    }
    const maxTradeWei = relevantBalance * BigInt(Math.floor(maxBalancePct * 100)) / 10000n;
    if (tradeAmountWei > maxTradeWei) {
      return { valid: false, reason: `Trade amount exceeds max percentage (${maxBalancePct}%) of token balance.` };
    }
  } else {
    const maxTradeWei = relevantBalance * BigInt(Math.floor(maxBalancePct * 100)) / 10000n;
    if (tradeAmountWei > maxTradeWei) {
      return { valid: false, reason: `Trade amount exceeds max percentage (${maxBalancePct}%) of native balance.` };
    }
  }

  if (minBalanceAmount) {
    const minBalanceWei = ethers.parseEther(minBalanceAmount);
    if (nativeBalance - tradeAmountWei < minBalanceWei) {
      return { valid: false, reason: `Native balance below min fixed amount (${minBalanceAmount}) after trade.` };
    }
  }

  const minBalanceWeiPct = nativeBalance * BigInt(Math.floor(minBalancePct * 100)) / 10000n;
  if (nativeBalance - tradeAmountWei < minBalanceWeiPct) {
    return { valid: false, reason: `Native balance below min percentage (${minBalancePct}%) after trade.` };
  }

  return { valid: true, reason: "OK" };
}


async function checkMempoolRisk(): Promise<{ risk: 'low' | 'sandwich' | 'front_run' }> {
  return { risk: 'low' };
}

async function verifyRouterSafety(
  provider: ethers.Provider,
  routerAddress: string
): Promise<{ safe: boolean; reason: string }> {
  try {
    const code = await provider.getCode(routerAddress);
    if (code === '0x' || code === '0x0') {
      return { safe: false, reason: "No contract code at router address" };
    }
    return { safe: true, reason: "OK" };
  } catch (error: any) {
    return { safe: false, reason: `Router check failed: ${error.message}` };
  }
}

/**
 * Live on-chain slippage = measured price impact + LP fee + fixed buffer (default 1%).
 * price impact & reserves come straight from the pair contract at execution time,
 * LP fee from the DEX version/fee tier, and the buffer is a global config safety margin.
 */
async function calculateOptimalSlippage(
  provider: ethers.Provider,
  routerAddress: string,
  amountInWei: bigint,
  tokenA: string,
  tokenB: string,
  minSlippagePct: number,
  opts?: { bufferPct?: number; lpFeePct?: number }
): Promise<{ optimal: number; priceImpact: number; liquidityFeePct: number; bufferPct: number } | null> {
  const bufferPct = opts?.bufferPct ?? 1.0;
  const lpFeePct = opts?.lpFeePct ?? 0.3;
  try {
    const router = new ethers.Contract(routerAddress, V2_ROUTER_ABI, provider);
    const factoryAddr = await router.factory();
    const factory = new ethers.Contract(factoryAddr as string, V2_FACTORY_ABI, provider);
    const pairAddr = await factory.getPair(tokenA, tokenB);

    if (!pairAddr || pairAddr === ethers.ZeroAddress) {
      return { optimal: Math.min(Math.max(minSlippagePct, lpFeePct + bufferPct), 10), priceImpact: 0, liquidityFeePct: lpFeePct, bufferPct };
    }

    const pair = new ethers.Contract(pairAddr as string, V2_PAIR_ABI, provider);
    const [reserve0, reserve1] = await pair.getReserves();
    const token0Addr = await pair.token0();

    const isToken0 = (token0Addr as string).toLowerCase() === tokenA.toLowerCase();
    const reserveIn = isToken0 ? (reserve0 as bigint) : (reserve1 as bigint);

    if (reserveIn === 0n) {
      return { optimal: Math.min(Math.max(minSlippagePct, lpFeePct + bufferPct), 10), priceImpact: 0, liquidityFeePct: lpFeePct, bufferPct };
    }

    const priceImpact = Number((amountInWei * 10000n) / reserveIn) / 100;

    if (priceImpact > 10) {
      return null;
    }

    // live slippage = price impact + LP fee + fixed buffer, clamped to min floor
    const optimal = Math.min(Math.max(priceImpact + lpFeePct + bufferPct, minSlippagePct), 10);

    return { optimal, priceImpact, liquidityFeePct: lpFeePct, bufferPct };
  } catch (error: any) {
    console.error("Slippage calc failed:", error);
    return { optimal: Math.min(Math.max(minSlippagePct, lpFeePct + bufferPct), 10), priceImpact: 0, liquidityFeePct: lpFeePct, bufferPct };
  }
}

async function ensureAllowance(
  provider: ethers.Provider,
  tokenContract: ethers.Contract,
  owner: string,
  spender: string,
  amount: bigint
): Promise<boolean> {
  try {
    const currentAllowance = await tokenContract.allowance(owner, spender);
    if ((currentAllowance as bigint) >= amount) return true;

    console.log(`[allowance] approving ${spender.slice(0,10)} for ${await tokenContract.symbol?.().catch(() => 'token')} amount=${amount.toString()}`);
    const tx = await tokenContract.approve(spender, ethers.MaxUint256, {
      gasLimit: 100000,
      ...await getGasOverrides(provider),
    });
    const receipt = await waitTx(tx, 1, 30000);
    if (!receipt || receipt.status === 0) {
      console.error(`[allowance] approve tx failed: ${tx.hash}`);
      return false;
    }
    console.log(`[allowance] approved: ${tx.hash}`);
    return true;
  } catch (err: any) {
    console.error(`[allowance] error: ${err.message}`);
    return false;
  }
}

async function executeSwap(
  env: Env,
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  tokenA: string,
  tokenB: string,
  amountIn: string,
  slippagePct: number,
  routerAddress: string,
  _chainId: number,
  tokenInDecimals: number = 18
): Promise<ethers.TransactionResponse> {
  const amountInWei = ethers.parseUnits(amountIn, tokenInDecimals);
  // Native POL is the main swap token; WPOL is used only in the pool path.
  const tokenInIsNative = isPolToken(tokenA) && tokenA === POL_NATIVE;
  const tokenOutIsNative = isPolToken(tokenB) && tokenB === POL_NATIVE;
  const amountOut = await getAmountOut(provider, tokenA, tokenB, amountInWei, routerAddress);

  if (!amountOut || amountOut === 0n) {
    throw new Error("Zero output — swap not profitable");
  }

  const amountOutMin = amountOut * BigInt(Math.floor((100 - slippagePct) * 100)) / 10000n;

  const router = new ethers.Contract(routerAddress, V2_ROUTER_ABI, wallet);
  const deadline = await getBlockchainDeadline(provider);
  const gas = { gasLimit: tokenInIsNative || tokenOutIsNative ? 450000 : 500000, ...await getGasOverrides(provider) };
  const path = [toWrappedForPath(tokenA), toWrappedForPath(tokenB)];
  const isFee = isFeeToken(tokenA) || isFeeToken(tokenB);

  // -- Native POL in → token out (no allowance needed, value sent) --
  if (tokenInIsNative) {
    if (isFee) {
      return (await router.swapExactETHForTokensSupportingFeeOnTransferTokens(amountOutMin, path, wallet.address, deadline, { ...gas, value: amountInWei })) as ethers.TransactionResponse;
    }
    return (await router.swapExactETHForTokens(amountOutMin, path, wallet.address, deadline, { ...gas, value: amountInWei })) as ethers.TransactionResponse;
  }

  // -- Token in → native POL out --
  if (tokenOutIsNative) {
    const tokenContract = new ethers.Contract(tokenA, ERC20_ABI, wallet);
    const ok = await ensureAllowance(provider, tokenContract, wallet.address, routerAddress, amountInWei);
    if (!ok) throw new Error("Failed to set token allowance");
    const tx = isFee
      ? await router.swapExactTokensForETHSupportingFeeOnTransferTokens(amountInWei, amountOutMin, path, wallet.address, deadline, gas)
      : await router.swapExactTokensForETH(amountInWei, amountOutMin, path, wallet.address, deadline, gas);
    return tx as ethers.TransactionResponse;
  }

  // -- Token → token (any supported-fee pair) --
  const tokenContract = new ethers.Contract(tokenA, ERC20_ABI, wallet);
  const ok = await ensureAllowance(provider, tokenContract, wallet.address, routerAddress, amountInWei);
  if (!ok) throw new Error("Failed to set token allowance");

  if (isFee) {
    // BRT 8% fee: must use SupportingFeeOnTransferTokens, amountOutMin is enforced on received amount
    return (await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(amountInWei, amountOutMin, path, wallet.address, deadline, gas)) as ethers.TransactionResponse;
  }
  return (await router.swapExactTokensForTokens(amountInWei, amountOutMin, path, wallet.address, deadline, gas)) as ethers.TransactionResponse;
}

// Multi-aggregator execution for BRT (Kyber -> 0x -> ParaSwap -> Odos -> OpenOcean, skip 1inch)
async function executeKyberSwap(
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippagePct: number,
  tokenInDecimals: number = 18
): Promise<ethers.TransactionResponse> {
  const amountInWei = ethers.parseUnits(amountIn, tokenInDecimals);
  const { buildBestAggregatorSwap } = await import('../../shared/aggregator');
  const best = await buildBestAggregatorSwap(tokenIn, tokenOut, amountInWei, wallet.address, slippagePct, (provider as any)._env || {});
  if (best) {
    const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
    const ok = await ensureAllowance(provider, tokenContract, wallet.address, best.router, amountInWei);
    if (!ok) throw new Error(`${best.source} allowance failed`);
    const tx = await wallet.sendTransaction({ to: best.router, data: best.data, gasLimit: 650000, ...await getGasOverrides(provider) });
    console.log(`[aggregator] BRT via ${best.source} router ${best.router.slice(0,10)}`);
    return tx as ethers.TransactionResponse;
  }
  // Fallback: Kyber direct encode
  const kyberData = await buildKyberSwapData(tokenIn, tokenOut, amountInWei, slippagePct, wallet.address);
  if (!kyberData) throw new Error('All aggregators encode failed for BRT (Kyber/0x/ParaSwap)');
  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const ok = await ensureAllowance(provider, tokenContract, wallet.address, kyberData.router, amountInWei);
  if (!ok) throw new Error('Kyber allowance failed');
  const tx = await wallet.sendTransaction({ to: kyberData.router, data: kyberData.data, gasLimit: 600000, ...await getGasOverrides(provider) });
  return tx as ethers.TransactionResponse;
}

async function executeSwapV3(
  env: Env,
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  slippagePct: number,
  routerAddress: string,
  quoterAddress: string,
  feeTier: number,
  tokenInDecimals: number = 18
): Promise<ethers.TransactionResponse> {
  const amountInWei = ethers.parseUnits(amountIn, tokenInDecimals);

  const quoter = new ethers.Contract(quoterAddress, V3_QUOTER_ABI, provider);
  const path = encodeV3Path([tokenIn, tokenOut], [feeTier]);
  const quotedAmountOut = await quoter.quoteExactInput.staticCall(path, amountInWei) as bigint;

  if (quotedAmountOut === 0n) {
    throw new Error("Zero output from V3 quoter");
  }

  const amountOutMin = quotedAmountOut * BigInt(Math.floor((100 - slippagePct) * 100)) / 10000n;

  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const ok = await ensureAllowance(provider, tokenContract, wallet.address, routerAddress, amountInWei);
  if (!ok) {
    throw new Error("Failed to set token allowance");
  }

  const v3Router = new ethers.Contract(routerAddress, V3_ROUTER_ABI, wallet);
  const deadline = await getBlockchainDeadline(provider);

  const tx = await v3Router.exactInput({
    path,
    recipient: wallet.address,
    deadline,
    amountIn: amountInWei,
    amountOutMinimum: amountOutMin,
  }, { gasLimit: 500000, ...await getGasOverrides(provider) }) as ethers.TransactionResponse;

  return tx;
}

async function executeSwapBalancer(
  env: Env,
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  routerAddress: string,
  poolId: string,
  slippagePct: number,
  tokenInDecimals: number = 18
): Promise<ethers.TransactionResponse> {
  const amountInWei = ethers.parseUnits(amountIn, tokenInDecimals);

  const quotedAmountOut = await queryBalancerSwap(provider, routerAddress, poolId, tokenIn, tokenOut, amountInWei);
  if (!quotedAmountOut || quotedAmountOut === 0n) {
    throw new Error("Balancer swap quote failed or zero output");
  }

  const amountOutMin = quotedAmountOut * BigInt(Math.floor((100 - slippagePct) * 100)) / 10000n;

  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const ok = await ensureAllowance(provider, tokenContract, wallet.address, routerAddress, amountInWei);
  if (!ok) {
    throw new Error("Failed to set token allowance");
  }

  const vault = new ethers.Contract(routerAddress, BALANCER_VAULT_ABI, wallet);
  const poolIdBytes = poolId.startsWith('0x') && poolId.length === 66 ? poolId : '0x' + poolId.toLowerCase().padEnd(64, '0');

  const tx = await vault.swap(
    {
      kind: 0,
      tokenIn,
      tokenOut,
      amount: amountInWei,
      poolId: poolIdBytes
    },
    wallet.address,
    false,
    '0x',
    { gasLimit: 500000, ...await getGasOverrides(provider) }
  ) as ethers.TransactionResponse;

  return tx;
}

async function executeSwapUniversal(
  env: Env,
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  routerAddress: string,
  slippagePct: number,
  tokenInDecimals: number = 18
): Promise<ethers.TransactionResponse> {
  const amountInWei = ethers.parseUnits(amountIn, tokenInDecimals);

  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const ok = await ensureAllowance(provider, tokenContract, wallet.address, routerAddress, amountInWei);
  if (!ok) {
    throw new Error("Failed to set token allowance");
  }

  const deadline = await getBlockchainDeadline(provider);
  const path = encodeV3Path([tokenIn, tokenOut], [3000]); // Default 0.3% fee tier
  const amountOutMin = amountInWei; // Will be updated with quote
  const swapData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'uint256', 'bytes', 'bool'],
    [wallet.address, amountInWei, amountOutMin, path, false]
  );

  const router = new ethers.Contract(routerAddress, UNIVERSAL_ROUTER_ABI, wallet);
  const tx = await router.execute('0x01', [swapData], deadline, { // V3 swap command
    value: 0,
    gasLimit: 500000,
    ...await getGasOverrides(provider)
  }) as ethers.TransactionResponse;

  return tx;
}

interface WalletState {
  tokenInBalance: bigint;
  tokenOutBalance: bigint;
  nativeGasBalance: bigint;
}

async function getWalletState(
  provider: ethers.Provider,
  walletAddress: string,
  tokenIn: string,
  tokenOut: string
): Promise<WalletState> {
  const [balIn, balOut, nativeGas] = await Promise.all([
    new ethers.Contract(tokenIn, ERC20_ABI, provider).balanceOf(walletAddress),
    new ethers.Contract(tokenOut, ERC20_ABI, provider).balanceOf(walletAddress),
    provider.getBalance(walletAddress),
  ]);
  return {
    tokenInBalance: balIn as bigint,
    tokenOutBalance: balOut as bigint,
    nativeGasBalance: nativeGas,
  };
}

async function checkCircuitBreaker(
  db: any,
  dailyLossLimit: number
): Promise<{ active: boolean; currentLoss: number }> {
  const today = new Date().toISOString().split('T')[0];
  const row = await db.prepare('SELECT total_loss_pct FROM daily_pnl WHERE date = ?').bind(today).first();
  const currentLoss = row ? parseFloat(row.total_loss_pct) : 0.0;

  if (currentLoss >= dailyLossLimit) {
    return { active: true, currentLoss };
  }
  return { active: false, currentLoss };
}

async function updateDailyPnL(db: any, profitPct: number, status: string) {
  const today = new Date().toISOString().split('T')[0];

  if (status === 'success') {
    await db.prepare(`
      INSERT INTO daily_pnl (date, total_profit_pct, trade_count) VALUES (?, ?, 1)
      ON CONFLICT(date) DO UPDATE SET total_profit_pct = total_profit_pct + ?, trade_count = trade_count + 1
    `).bind(today, profitPct, profitPct).run();
  } else if (status === 'failed' || status === 'skipped') {
    const loss = 0.1;
    await db.prepare(`
      INSERT INTO daily_pnl (date, total_loss_pct) VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET total_loss_pct = total_loss_pct + ?
    `).bind(today, loss, loss).run();
  }
}

interface StrategyConfig {
  key: string;
  name: string;
  description?: string;
  params?: string;
  is_active?: boolean;
}

interface TokenPairConfig {
  id: number;
  chain_id: number;
  token_a: string;
  token_b: string;
  label?: string;
  is_active?: boolean;
}

export async function executeOpportunity(
  env: Env,
  network: NetworkConfig,
  opp: any,
  walletAddress: string,
  db?: any,
  defaultFeeTier?: number
): Promise<TradeResult> {
  const DB = env['funbo-db'];
  const defaultRpcPool = '';
  const cfg = await DB.prepare('SELECT key, value FROM config WHERE key IN ("min_profit_pct","max_profit_pct","min_balance_pct","max_balance_pct","min_balance_amount","min_slippage","max_decimals","min_net_profit_pct","min_net_profit_pct_cross_dex","min_net_profit_pct_triangular","min_net_profit_pct_solo_spot","min_net_profit_pct_mm","min_net_profit_pct_spot_swing","slippage_buffer_pct","lp_fee_pct","active_strategies")').all() as { results: { key: string; value: string }[] };
  const cfgMap = Object.fromEntries(cfg.results.map((r: any) => [r.key, r.value]));
  const minProfitPct = parseFloat(cfgMap.min_profit_pct || '0.1');
  const maxProfitPct = parseFloat(cfgMap.max_profit_pct || '50');
  const minBalancePct = parseInt(cfgMap.min_balance_pct || '10');
  const maxBalancePct = parseInt(cfgMap.max_balance_pct || '50');
  const minBalanceAmount = cfgMap.min_balance_amount || '0';
  const minSlippagePct = parseFloat(cfgMap.min_slippage || '0.5');
  const maxDecimals = parseInt(cfgMap.max_decimals || '3');
  const feeTier = defaultFeeTier || 3000;
  
  // Per-strategy net profit thresholds
  const strategy = opp.router_b === 'solo_spot' ? 'solo_spot' :
                   opp.router_b === 'mm_rebalance' ? 'mm' :
                   opp.router_a === opp.router_b ? 'triangular' :
                   opp.router_b === 'spot_buy' || opp.router_b === 'spot_sell' ? 'spot_swing' :
                   'cross_dex';
  
  const minNetProfitPct = parseFloat(cfgMap[`min_net_profit_pct_${strategy}`] || cfgMap.min_net_profit_pct || '0.1');

  const { provider } = await getWorkingProvider(env, network.rpc_url, defaultRpcPool, db, network.chain_id);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY!, getMevProtectedProvider(env, network));

  const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(network.chain_id).all() as { results: any[] };
  const routerA = routers.results.find((r: any) => r.address.toLowerCase() === opp.router_a.toLowerCase());
  const routerB = routers.results.find((r: any) => r.address.toLowerCase() === opp.router_b.toLowerCase());
  if (!routerA || !routerB) {
    const err = 'Router missing';
    console.log(`[executor] opp #${opp.id} skip: ${err}`);
    return { success: false, strategy: 'arb', tokenA: opp.token_a, tokenB: opp.token_b, amountIn: '0', amountOut: '0', profitPct: opp.profit_pct || 0, status: 'skipped', txHash: null, errorMsg: err };
  }

  const tradeAmountRes = await DB.prepare('SELECT value FROM config WHERE key = "trade_amount"').first() as { value: string } | null;
  const tradeAmount = truncateDecimals(tradeAmountRes?.value || '0.1', maxDecimals);

  const tokenA = opp.token_a;
  const tokenB = opp.token_b;

  await ensureWmaticBalance(wallet, provider, tokenA, ethers.parseEther(tradeAmount));

  const tokenABalance = await (new ethers.Contract(tokenA, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(wallet.address) as bigint;
  if (tokenABalance === 0n) {
    console.log(`[executor] opp #${opp.id} skip: zero ${tokenA.slice(0,10)} balance`);
    return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: opp.profit_pct || 0, status: 'skipped', txHash: null, errorMsg: `Zero input token balance` };
  }

  const dailyLossLimitRes = await DB.prepare('SELECT value FROM config WHERE key = "daily_loss_limit"').first() as { value: string } | null;
  const dailyLossLimit = dailyLossLimitRes ? parseFloat(dailyLossLimitRes.value) : 5.0;
  const breaker = await checkCircuitBreaker(DB, dailyLossLimit);
  if (breaker.active) {
    console.log(`[executor] opp #${opp.id} skip: circuit breaker ${breaker.currentLoss}%`);
    return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: 0, status: 'stopped', txHash: null, errorMsg: `Circuit Breaker: Daily loss ${breaker.currentLoss}%` };
  }

  const bothWellKnown = await isWellKnownTokenWithConfig(tokenA, network.chain_id, env) && await isWellKnownTokenWithConfig(tokenB, network.chain_id, env);
  if (!bothWellKnown) {
    const tokenASafety = await goplusScanTokenSafety(env, tokenA, network.chain_id);
    if (!tokenASafety.safe) {
      console.log(`[executor] opp #${opp.id} skip: token A unsafe ${tokenASafety.reason}`);
      return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: opp.profit_pct || 0, status: 'skipped', txHash: null, errorMsg: `Token A Unsafe: ${tokenASafety.reason}` };
    }
    const tokenBSafety = await goplusScanTokenSafety(env, tokenB, network.chain_id);
    if (!tokenBSafety.safe) {
      console.log(`[executor] opp #${opp.id} skip: token B unsafe ${tokenBSafety.reason}`);
      return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: opp.profit_pct || 0, status: 'skipped', txHash: null, errorMsg: `Token B Unsafe: ${tokenBSafety.reason}` };
    }


    if (env.AI) {
      const { scoreTrade } = await import('./ai-execution');
      const tradeScore = await scoreTrade(DB, env.AI, {
        type: 'arb', tokenA, tokenB,
        router: routerA.address, amountIn: tradeAmount, profitPct: opp.profit_pct || 0,
        chainId: network.chain_id,
      });
      if (tradeScore && tradeScore.riskLevel === 'critical') {
        console.log(`[executor] opp #${opp.id} skip: AI critical ${tradeScore.reasons.join('; ')}`);
        return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: tradeAmount, amountOut: '0', profitPct: opp.profit_pct || 0, status: 'skipped', txHash: null, errorMsg: `AI Risk: ${tradeScore.reasons.join('; ')}` };
      }
    }
  }

  const buyRouter = routerA;
  const sellRouter = routerB;
  const buyVersion = (buyRouter.version || 'v2').toLowerCase();
  const sellVersion = (sellRouter.version || 'v2').toLowerCase();

  // Live slippage = on-chain price impact + LP fee + fixed 1% buffer (sandwich/volatility protection)
  const slippageBufferPct = parseFloat(cfgMap.slippage_buffer_pct || '1.0');
  const lpFeePct = parseFloat(cfgMap.lp_fee_pct || '0.3');
  const slippageCalc = await calculateOptimalSlippage(
    provider, buyRouter.address, ethers.parseEther(tradeAmount), tokenA, tokenB,
    minSlippagePct, { bufferPct: slippageBufferPct, lpFeePct }
  );
  if (!slippageCalc) {
    console.log(`[executor] opp #${opp.id} skip: price impact > 10%`);
    return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: opp.profit_pct || 0, status: 'skipped', txHash: null, errorMsg: 'Liquidity too thin (price impact > 10%)' };
  }
  const slippagePct = slippageCalc.optimal;
  console.log(`[executor] opp #${opp.id} live slippage=${slippagePct.toFixed(2)}% impact=${slippageCalc.priceImpact.toFixed(2)}% lp fee=${slippageCalc.liquidityFeePct}% buffer=${slippageCalc.bufferPct}%`);

  const executionMinProfit = Math.max(minNetProfitPct, 0.1);
  const liveArb = await scanArbOpportunity(provider, tokenA, tokenB, ethers.parseEther(tradeAmount), executionMinProfit, maxProfitPct, buyRouter, sellRouter, feeTier);
  if (!liveArb) {
    console.log(`[executor] opp #${opp.id} skip: no arb at execution time (threshold ${executionMinProfit}%)`);
    return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'No arb at execution time' };
  }

  const estGasCost = await estimateGasCost(provider, network.chain_id, buyRouter, sellRouter, tokenA, tokenB, feeTier);
  const grossProfitPct = liveArb.profitPct;
  // Net = gross spread − live gas − slippage (impact + LP fee + buffer). All live/on-chain.
  const netProfitPct = grossProfitPct - estGasCost - slippagePct;
  console.log(`[executor] opp #${opp.id} live arb: gross=${grossProfitPct.toFixed(3)}% estGas=${estGasCost.toFixed(3)}% slippage=${slippagePct.toFixed(2)}% net=${netProfitPct.toFixed(3)}% (threshold ${minNetProfitPct}%)`);
  
  if (netProfitPct < minNetProfitPct) {
    console.log(`[executor] opp #${opp.id} skip: net profit ${netProfitPct.toFixed(3)}% below threshold ${minNetProfitPct}%`);
    return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: grossProfitPct, status: 'skipped', txHash: null, errorMsg: `Net profit ${netProfitPct.toFixed(3)}% < ${minNetProfitPct}%` };
  }

  const executorContractRes = await DB.prepare('SELECT value FROM config WHERE key = "executor_contract_address"').first() as { value: string } | null;
  const executorModeRes = await DB.prepare('SELECT value FROM config WHERE key = "executor_mode"').first() as { value: string } | null;
  const executorContract = executorContractRes?.value || '';
  const executorMode = executorModeRes?.value || 'direct';

const beforeState = await getWalletState(provider, wallet.address, tokenA, tokenB);
   let txHash: string | null = null;

   const dA = await getTokenDecimals(provider, tokenA, network.chain_id);
   const dB = await getTokenDecimals(provider, tokenB, network.chain_id);

  async function executeLegWithMode(
    fromToken: string, toToken: string, amountIn: string, slippage: number,
    router: any, version: string, fromDecimals: number
  ): Promise<ethers.TransactionResponse> {
    const tryContract = (executorMode === 'contract' || executorMode === 'become') && executorContract;
    if (tryContract && (version === 'v2' || version === 'v3')) {
      try {
        const amountInWei = ethers.parseUnits(amountIn, fromDecimals);
        const quote = await quoteAmountOut(provider, fromToken, toToken, amountInWei, router, feeTier);
        const minOut = quote && quote.amountOut > 0n
          ? quote.amountOut * BigInt(Math.floor((100 - slippage) * 100)) / 10000n
          : 0n;
        const v = version === 'v3' ? 1 : 0;
        const dexData = ethers.AbiCoder.defaultAbiCoder().encode(['uint8', 'address'], [v, router.address]);
        const arbContract = new ethers.Contract(executorContract, ARB_EXECUTOR_ABI, wallet);
        const tokenContract = new ethers.Contract(fromToken, ERC20_ABI, wallet);
        const allowance = await tokenContract.allowance(wallet.address, executorContract) as bigint;
        if (allowance < amountInWei) {
          const appTx = await tokenContract.approve(executorContract, ethers.MaxUint256, {
            gasLimit: 100000,
            ...await getGasOverrides(provider),
          });
          const appReceipt = await waitTx(appTx, 1, 30000);
          if (!appReceipt || appReceipt.status === 0) { throw new Error('Failed to set token allowance'); }
        }
        const tx = await arbContract.executeArb(fromToken, toToken, amountInWei, minOut, dexData, {
          gasLimit: 500000,
          ...await getGasOverrides(provider),
        }) as ethers.TransactionResponse;
        return tx;
      } catch (err) {
        if (executorMode === 'become') {
          console.warn('Contract leg failed, falling back to direct:', err);
        } else {
          throw err;
        }
      }
    }
    if (version === 'v3') {
      const quoterAddr = (router.quoter_address || '').trim();
      if (!quoterAddr) throw new Error('V3 router missing quoter');
      return executeSwapV3(env, provider, wallet, fromToken, toToken, amountIn, slippage, router.address, quoterAddr, feeTier, fromDecimals);
    } else if (version === 'balancer') {
      const poolId = router.fee_tiers || '';
      return executeSwapBalancer(env, provider, wallet, fromToken, toToken, amountIn, router.address, poolId, slippage);
    } else if (version === 'universal') {
      return executeSwapUniversal(env, provider, wallet, fromToken, toToken, amountIn, router.address, slippage);
    } else {
      return executeSwap(env, provider, wallet, fromToken, toToken, amountIn, slippage, router.address, network.chain_id, fromDecimals);
    }
  }

  const tradeAmountWei = ethers.parseEther(tradeAmount);

  try {
    const buyResp = await executeLegWithMode(tokenA, tokenB, tradeAmount, slippagePct, buyRouter, buyVersion, dA);
    txHash = buyResp.hash;
    console.log(`[executor] opp #${opp.id} buy OK tx=${buyResp.hash}`);
    await waitTx(buyResp, 1, 30000);

    const tokenBContract = new ethers.Contract(tokenB, ERC20_ABI, wallet);
    const tokenBRecv = await tokenBContract.balanceOf(wallet.address) as bigint;
    if (tokenBRecv > 0n) {
      const sellAmountFormatted = ethers.formatUnits(tokenBRecv, dB);
      console.log(`[executor] opp #${opp.id} sell leg: ${sellAmountFormatted} tokenB → tokenA on ${sellRouter.name}`);
      const sellResp = await executeLegWithMode(tokenB, tokenA, sellAmountFormatted, slippagePct, sellRouter, sellVersion, dB);
      txHash = `${txHash},${sellResp.hash}`;
      console.log(`[executor] opp #${opp.id} sell OK tx=${sellResp.hash}`);
      await waitTx(sellResp, 1, 30000);
    } else {
      console.log(`[executor] opp #${opp.id} no tokenB received from buy`);
    }
  } catch (err: any) {
    return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: tradeAmount, amountOut: '0', profitPct: opp.profit_pct || 0, status: 'failed', txHash: null, errorMsg: err.message };
  }

  if (!txHash) {
    return { success: false, strategy: 'arb', tokenA, tokenB, amountIn: tradeAmount, amountOut: '0', profitPct: opp.profit_pct || 0, status: 'failed', txHash: null, errorMsg: 'No swap executed' };
  }

  const afterState = await getWalletState(provider, wallet.address, tokenA, tokenB);
  const initialTokenA = beforeState.tokenInBalance;
  const finalTokenA = afterState.tokenInBalance;
  const netInSpent = initialTokenA - finalTokenA;
  const netOutReceived = afterState.tokenOutBalance - beforeState.tokenOutBalance;
  const nativeGasSpent = beforeState.nativeGasBalance - afterState.nativeGasBalance;

  const tokenAChange = finalTokenA - initialTokenA; // positive means profit in tokenA
  const realizedProfitPct = initialTokenA > 0n ? Number(tokenAChange * 10000n / initialTokenA) / 100 : 0;

  let gasCostInTokenOut = 0n;
  if (nativeGasSpent > 0n && buyRouter.quoter_address) {
    const nativeTokens: Record<number, string> = {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      8453: '0x4200000000000000000000000000000000000006',
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      10: '0x4200000000000000000000000000000000000006',
    };
    const nativeToken = nativeTokens[network.chain_id] || tokenB;
    try {
      const quoter = new ethers.Contract(buyRouter.quoter_address, V3_QUOTER_ABI, provider);
      const gasPath = encodeV3Path([nativeToken, tokenB], [feeTier]);
      gasCostInTokenOut = await quoter.quoteExactInput.staticCall(gasPath, nativeGasSpent) as bigint;
    } catch {}
  }

  const netProfit = netOutReceived - gasCostInTokenOut;
  const result: TradeResult = {
    success: tokenAChange > 0n, strategy: 'arb', tokenA, tokenB,
    amountIn: ethers.formatEther(netInSpent > 0n ? netInSpent : tradeAmountWei),
    amountOut: ethers.formatEther(netOutReceived > 0n ? netOutReceived : 0n),
    profitPct: realizedProfitPct,
    status: tokenAChange > 0n ? 'success' : 'failed', txHash, errorMsg: tokenAChange > 0n ? null : `Round-trip lost ${Math.abs(realizedProfitPct).toFixed(2)}%`,
    gasSpent: ethers.formatEther(nativeGasSpent),
    netProfit: ethers.formatEther(netProfit > 0n ? netProfit : 0n),
  };
  await updateDailyPnL(DB, result.profitPct, result.status);

  if (result.txHash) {
    try {
      await recordBotTransaction(env, {
        chainId: network.chain_id,
        strategy: 'arb',
        opportunityId: opp.id,
        walletAddress: wallet.address,
        tokenIn: tokenA,
        tokenOut: tokenB,
        amountIn: tradeAmount,
        amountOut: result.amountOut,
        amountInUsd: undefined,
        amountOutUsd: undefined,
        txHash: result.txHash,
        txStatus: result.status === 'success' ? 'confirmed' : 'failed',
        errorMsg: result.errorMsg ?? undefined,
      });
    } catch (e) { console.error('[executor] failed to record arb tx:', e); }
  }

  return result;
}

function findThirdToken(pairs: any[], tA: string, tB: string): string | null {
  const adj = new Map<string, Set<string>>();
  for (const p of pairs) {
    const a = p.token_a.toLowerCase();
    const b = p.token_b.toLowerCase();
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  const neighborsA = adj.get(tA);
  const neighborsB = adj.get(tB);
  if (!neighborsA || !neighborsB) return null;
  for (const c of neighborsA) {
    if (c !== tA && c !== tB && neighborsB.has(c)) return c;
  }
  return null;
}

export async function executeTriangularArb(
  env: Env,
  network: NetworkConfig,
  opp: any,
  _walletAddress: string,
  db: any,
  defaultFeeTier?: number
): Promise<TradeResult> {
  const DB = env['funbo-db'];

  const cfgRes = await DB.prepare('SELECT key, value FROM config WHERE key IN ("min_profit_pct","min_slippage","max_decimals","trade_amount")').all() as { results: { key: string; value: string }[] };
  const cfg = Object.fromEntries(cfgRes.results.map((r: any) => [r.key, r.value]));
  const minSlippagePct = parseFloat(cfg.min_slippage || '0.5');
  const maxDecimals = parseInt(cfg.max_decimals || '3');
  const tradeAmountStr = truncateDecimals(cfg.trade_amount || '0.1', maxDecimals);
  const feeTier = defaultFeeTier || 3000;

  const { provider } = await getWorkingProvider(env, network.rpc_url, '', db, network.chain_id);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY!, getMevProtectedProvider(env, network));

  const tokenA = opp.token_a;
  const tokenB = opp.token_b;

  const pairs = await DB.prepare('SELECT token_a, token_b FROM token_pairs WHERE chain_id = ? AND is_active = 1').bind(network.chain_id).all() as { results: any[] };
  const tA = tokenA.toLowerCase();
  const tB = tokenB.toLowerCase();
  const tokenC = findThirdToken(pairs.results, tA, tB);
  if (!tokenC) {
    return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'No third token C found for triangle A→B→C→A' };
  }

  const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(network.chain_id).all() as { results: any[] };
  const router = routers.results.find((r: any) => r.address.toLowerCase() === opp.router_a.toLowerCase());
  if (!router) {
    return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Router not found in DB' };
  }

  await ensureWmaticBalance(wallet, provider, tokenA, ethers.parseEther(tradeAmountStr));

  const dailyLossLimitRes = await DB.prepare('SELECT value FROM config WHERE key = "daily_loss_limit"').first() as { value: string } | null;
  const dailyLossLimit = dailyLossLimitRes ? parseFloat(dailyLossLimitRes.value) : 5.0;
  const breaker = await checkCircuitBreaker(DB, dailyLossLimit);
  if (breaker.active) {
    return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: tradeAmountStr, amountOut: '0', profitPct: 0, status: 'stopped', txHash: null, errorMsg: `Circuit Breaker: Daily loss ${breaker.currentLoss}% > limit ${dailyLossLimit}%` };
  }


  const version = (router.version || 'v2').toLowerCase();
  const slippagePct = minSlippagePct;

const dA = await getTokenDecimals(provider, tokenA, network.chain_id);
   const dB = await getTokenDecimals(provider, tokenB, network.chain_id);
   const dC = await getTokenDecimals(provider, tokenC, network.chain_id);

  const amountInWei = ethers.parseUnits(tradeAmountStr, dA);

  const qAB = await quoteAmountOut(provider, tokenA, tokenB, amountInWei, router, feeTier);
  if (!qAB || qAB.amountOut === 0n) {
    return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: tradeAmountStr, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'No quote A→B' };
  }
  const qBC = await quoteAmountOut(provider, tokenB, tokenC, qAB.amountOut, router, feeTier);
  if (!qBC || qBC.amountOut === 0n) {
    return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: tradeAmountStr, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'No quote B→C' };
  }
  const qCA = await quoteAmountOut(provider, tokenC, tokenA, qBC.amountOut, router, feeTier);
  if (!qCA || qCA.amountOut === 0n) {
    return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: tradeAmountStr, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'No quote C→A' };
  }

  if (qCA.amountOut <= amountInWei) {
    return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: tradeAmountStr, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Triangle not profitable at execution time' };
  }

  const executorContractRes = await DB.prepare('SELECT value FROM config WHERE key = "executor_contract_address"').first() as { value: string } | null;
  const executorModeRes = await DB.prepare('SELECT value FROM config WHERE key = "executor_mode"').first() as { value: string } | null;
  const executorContract = executorContractRes?.value || '';
  const executorMode = executorModeRes?.value || 'direct';

  async function triExecuteLeg(from: string, to: string, amount: string, decimals: number): Promise<ethers.TransactionResponse> {
    const tryContract = (executorMode === 'contract' || executorMode === 'become') && executorContract;
    if (tryContract) {
      try {
        if (version !== 'v2' && version !== 'v3') {
          throw new Error(`Contract mode does not support version: ${version}`);
        }
        const amountInWei = ethers.parseUnits(amount, decimals);
        const v = version === 'v3' ? 1 : 0;
        const dexData = ethers.AbiCoder.defaultAbiCoder().encode(['uint8', 'address'], [v, router.address]);
        const arbContract = new ethers.Contract(executorContract, ARB_EXECUTOR_ABI, wallet);
        const tokenContract = new ethers.Contract(from, ERC20_ABI, wallet);
        const allowance = await tokenContract.allowance(wallet.address, executorContract) as bigint;
        if (allowance < amountInWei) {
          const appTx = await tokenContract.approve(executorContract, ethers.MaxUint256, {
            gasLimit: 100000,
            ...await getGasOverrides(provider),
          });
          const appReceipt = await waitTx(appTx, 1, 30000);
          if (!appReceipt || appReceipt.status === 0) { throw new Error('Failed to set token allowance'); }
        }
        const quote = await quoteAmountOut(provider, from, to, amountInWei, router, feeTier);
        const minOut = quote && quote.amountOut > 0n
          ? quote.amountOut * BigInt(Math.floor((100 - slippagePct) * 100)) / 10000n
          : 0n;
        const tx = await arbContract.executeArb(from, to, amountInWei, minOut, dexData, {
          gasLimit: 500000,
          ...await getGasOverrides(provider),
        }) as ethers.TransactionResponse;
        return tx;
      } catch (err) {
        if (executorMode === 'become') {
          console.warn('Contract leg failed, falling back to direct:', err);
        } else {
          throw err;
        }
      }
    }
    if (version === 'v3') {
      const quoterAddr = (router.quoter_address || '').trim();
      if (!quoterAddr) throw new Error('V3 router missing quoter');
      const path = encodeV3Path([from, to], [feeTier]);
      const deadline = await getBlockchainDeadline(provider);
      const routerContract = new ethers.Contract(router.address, V3_ROUTER_ABI, wallet);
      const minOut = ethers.parseUnits(amount, decimals) * BigInt(Math.floor((100 - slippagePct) * 100)) / 10000n;
      const tx = await routerContract.exactInput(
        { path, recipient: wallet.address, deadline, amountIn: ethers.parseUnits(amount, decimals), amountOutMinimum: minOut },
        { gasLimit: 500000, ...await getGasOverrides(provider) }
      ) as ethers.TransactionResponse;
      return tx;

    } else if (version === 'balancer') {
      return executeSwapBalancer(env, provider, wallet, from, to, amount, router.address, router.fee_tiers || '', slippagePct);
    } else if (version === 'universal') {
      return executeSwapUniversal(env, provider, wallet, from, to, amount, router.address, slippagePct);
    }
    return executeSwap(env, provider, wallet, from, to, amount, slippagePct, router.address, network.chain_id, decimals);
  }

  const beforeA = await new ethers.Contract(tokenA, ERC20_ABI, provider).balanceOf(wallet.address) as bigint;
  let txHash: string | null = null;

  try {
    const r1 = await triExecuteLeg(tokenA, tokenB, tradeAmountStr, dA);
    txHash = r1.hash;
    console.log(`[tri] leg1 A→B OK tx=${r1.hash}`);
    await waitTx(r1, 1, 30000);

    const bRecv = await new ethers.Contract(tokenB, ERC20_ABI, provider).balanceOf(wallet.address) as bigint;
    if (bRecv <= 0n) {
      return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: tradeAmountStr, amountOut: '0', profitPct: 0, status: 'failed', txHash, errorMsg: 'No B received after leg1' };
    }
    const bAmount = ethers.formatUnits(bRecv, dB);

    const r2 = await triExecuteLeg(tokenB, tokenC, bAmount, dB);
    txHash = `${r1.hash},${r2.hash}`;
    console.log(`[tri] leg2 B→C OK tx=${r2.hash}`);
    await waitTx(r2, 1, 30000);

    const cRecv = await new ethers.Contract(tokenC, ERC20_ABI, provider).balanceOf(wallet.address) as bigint;
    if (cRecv <= 0n) {
      return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: tradeAmountStr, amountOut: '0', profitPct: 0, status: 'failed', txHash, errorMsg: 'No C received after leg2' };
    }
    const cAmount = ethers.formatUnits(cRecv, dC);

    const r3 = await triExecuteLeg(tokenC, tokenA, cAmount, dC);
    txHash = `${r1.hash},${r2.hash},${r3.hash}`;
    console.log(`[tri] leg3 C→A OK tx=${r3.hash}`);
    await waitTx(r3, 1, 30000);

    const afterA = await new ethers.Contract(tokenA, ERC20_ABI, provider).balanceOf(wallet.address) as bigint;
    const aChange = afterA - beforeA;
    const realizedProfitPct = beforeA > 0n ? Number(aChange * 10000n / beforeA) / 100 : 0;

    const result: TradeResult = {
      success: aChange > 0n,
      strategy: 'triangular',
      tokenA, tokenB,
      amountIn: tradeAmountStr,
      amountOut: ethers.formatUnits(afterA, dA),
      profitPct: realizedProfitPct,
      status: aChange > 0n ? 'success' : 'failed',
      txHash,
      errorMsg: aChange > 0n ? null : `Triangle lost ${Math.abs(realizedProfitPct).toFixed(2)}%`,
    };
    await updateDailyPnL(DB, result.profitPct, result.status);

    if (result.txHash) {
      try {
        await recordBotTransaction(env, {
          chainId: network.chain_id,
          strategy: 'triangular',
          opportunityId: opp.id,
          walletAddress: wallet.address,
          tokenIn: tokenA,
          tokenOut: tokenA,
          amountIn: tradeAmountStr,
          amountOut: ethers.formatUnits(afterA, dA),
          txHash: result.txHash,
          txStatus: result.status === 'success' ? 'confirmed' : 'failed',
          errorMsg: result.errorMsg ?? undefined,
        });
      } catch (e) { console.error('[executor] failed to record triangular tx:', e); }
    }

    return result;
  } catch (err: any) {
    return { success: false, strategy: 'triangular', tokenA, tokenB, amountIn: tradeAmountStr, amountOut: '0', profitPct: 0, status: 'failed', txHash, errorMsg: err.message || 'Triangular arb execution error' };
  }
}

export async function runBotStrategy(
  env: Env,
  network: NetworkConfig,
  routers: RouterConfig[],
  _walletAddress: string,
  strategyType: string,
  minProfitPct: number,
  maxProfitPct: number,
  minBalancePct: number,
  maxBalancePct: number,
  minBalanceAmount: string | null,
  minSlippagePct: number,
  maxDecimals: number,
  defaultFeeTier: number,
  defaultRpcPool?: string,
  tokenPairs?: TokenPairConfig[],
  strategies?: StrategyConfig[],
  db?: any,
  chainId?: number
): Promise<TradeResult> {
  const { provider } = await getWorkingProvider(env, network.rpc_url, defaultRpcPool, db, chainId);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY!, getMevProtectedProvider(env, network));
  const DB = env['funbo-db'];

  const tokenARes = await DB.prepare('SELECT value FROM config WHERE key = "trade_token_a"').first() as { value: string } | null;
  const tokenBRes = await DB.prepare('SELECT value FROM config WHERE key = "trade_token_b"').first() as { value: string } | null;
  const tradeAmountRes = await DB.prepare('SELECT value FROM config WHERE key = "trade_amount"').first() as { value: string } | null;

  const tokenA = tokenARes ? tokenARes.value : (tokenPairs && tokenPairs.length > 0 ? tokenPairs[0].token_a : '0xTokenA...');
  const tokenB = tokenBRes ? tokenBRes.value : (tokenPairs && tokenPairs.length > 0 ? tokenPairs[0].token_b : '0xTokenB...');
  const tradeAmount = truncateDecimals(tradeAmountRes ? tradeAmountRes.value : '0.1', maxDecimals);

  const dailyLossLimitRes = await DB.prepare('SELECT value FROM config WHERE key = "daily_loss_limit"').first() as { value: string } | null;
  const dailyLossLimit = dailyLossLimitRes ? parseFloat(dailyLossLimitRes.value) : DEFAULT_MAX_DAILY_LOSS_PCT;
  const breaker = await checkCircuitBreaker(DB, dailyLossLimit);
  if (breaker.active) {
    return { success: false, strategy: strategyType, tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: 0, status: 'stopped', txHash: null, errorMsg: `Circuit Breaker: Daily loss ${breaker.currentLoss}% > limit ${dailyLossLimit}%` };
  }

  const risk = await checkRiskRules(provider, wallet.address, network.chain_id, tradeAmount, minBalancePct, maxBalancePct, minBalanceAmount, tokenA);
  if (!risk.valid) {
    return { success: false, strategy: strategyType, tokenA, tokenB, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: risk.reason };
  }

  if (routers.length < 2) {
    return { success: false, strategy: strategyType, tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: "Need at least 2 DEX routers" };
  }

  const tradeAmountWei = ethers.parseEther(tradeAmount);

  let arb: { profitPct: number; routerA: string; routerB: string; amountOutA: bigint; amountOutB: bigint; feeTierA?: number; feeTierB?: number } | null = null;
  let foundTokenA = tokenA;
  let foundTokenB = tokenB;

  for (const pair of tokenPairs || []) {
    if (arb) break;
    for (let i = 0; i < routers.length; i++) {
      for (let j = i + 1; j < routers.length; j++) {
        arb = await scanArbOpportunity(provider, pair.token_a, pair.token_b, tradeAmountWei, minProfitPct, maxProfitPct, routers[i], routers[j], defaultFeeTier);
        if (arb) {
          foundTokenA = pair.token_a;
          foundTokenB = pair.token_b;
          break;
        }
      }
    }
  }

  if (!arb && tokenA && tokenB) {
    for (let i = 0; i < routers.length; i++) {
      for (let j = i + 1; j < routers.length; j++) {
        arb = await scanArbOpportunity(provider, tokenA, tokenB, tradeAmountWei, minProfitPct, maxProfitPct, routers[i], routers[j], defaultFeeTier);
        if (arb) break;
      }
      if (arb) break;
    }
  }

  if (!arb && tokenA && tokenB) {
    for (const router of routers) {
      const sameDexArb = await scanSameDexOpportunity(provider, tokenA, tokenB, tradeAmountWei, minProfitPct, router, defaultFeeTier);
      if (sameDexArb) {
        arb = {
          amountOutA: sameDexArb.amountOut,
          amountOutB: sameDexArb.amountOut,
          profitPct: sameDexArb.profitPct,
          routerA: router.address,
          routerB: router.address,
          feeTierA: sameDexArb.feeTierBest,
          feeTierB: sameDexArb.feeTierWorst
        };
        break;
      }
    }
  }

  if (!arb) {
    return { success: false, strategy: strategyType, tokenA, tokenB, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: "No opportunity found" };
  }

  const arbBothWellKnown = await isWellKnownTokenWithConfig(foundTokenA, network.chain_id, env) && await isWellKnownTokenWithConfig(foundTokenB, network.chain_id, env);
  let slippageResult: { optimal: number } | null = null;
  if (!arbBothWellKnown) {
    const tokenASafety = await goplusScanTokenSafety(env, foundTokenA, network.chain_id);
    if (!tokenASafety.safe) {
      return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: '0', amountOut: '0', profitPct: arb.profitPct, status: 'skipped', txHash: null, errorMsg: `Token A Unsafe: ${tokenASafety.reason}` };
    }
    const tokenBSafety = await goplusScanTokenSafety(env, foundTokenB, network.chain_id);
    if (!tokenBSafety.safe) {
      return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: '0', amountOut: '0', profitPct: arb.profitPct, status: 'skipped', txHash: null, errorMsg: `Token B Unsafe: ${tokenBSafety.reason}` };
    }

    const blockscout = network.explorer_url ? new BlockscoutClient(network.explorer_url, env.BLOCKSCOUT_API_KEY, network.chain_id) : null;
    if (blockscout) {
      const [taVerified, tbVerified, trVerified] = await Promise.all([
        blockscout.isContractVerified(foundTokenA),
        blockscout.isContractVerified(foundTokenB),
        blockscout.isContractVerified(arb.routerA),
      ]);
      if (taVerified === false) {
        return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: '0', amountOut: '0', profitPct: arb.profitPct, status: 'skipped', txHash: null, errorMsg: "Token A contract not verified on Blockscout" };
      }
      if (tbVerified === false) {
        return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: '0', amountOut: '0', profitPct: arb.profitPct, status: 'skipped', txHash: null, errorMsg: "Token B contract not verified on Blockscout" };
      }
      if (trVerified === false) {
        return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: '0', amountOut: '0', profitPct: arb.profitPct, status: 'skipped', txHash: null, errorMsg: "Router contract not verified on Blockscout" };
      }
    }

    const routerSafe = await verifyRouterSafety(provider, arb.routerA);
    if (!routerSafe.safe) {
      return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: '0', amountOut: '0', profitPct: arb.profitPct, status: 'skipped', txHash: null, errorMsg: `Router Unsafe: ${routerSafe.reason}` };
    }

    const mempoolRisk = await checkMempoolRisk();
    if (mempoolRisk.risk !== 'low') {
      return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: '0', amountOut: '0', profitPct: arb.profitPct, status: 'skipped', txHash: null, errorMsg: `MEV Risk: ${mempoolRisk.risk}` };
    }

    slippageResult = await calculateOptimalSlippage(provider, arb.routerA, tradeAmountWei, foundTokenA, foundTokenB, minSlippagePct);
  } else {
    slippageResult = { optimal: minSlippagePct };
  }
  if (!slippageResult) {
    return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: '0', amountOut: '0', profitPct: arb.profitPct, status: 'skipped', txHash: null, errorMsg: "Slippage calculation failed" };
  }

  const amountOut = arb.amountOutA > arb.amountOutB ? arb.amountOutB : arb.amountOutA;
  const buyRouterAddr = arb.amountOutA > arb.amountOutB ? arb.routerA : arb.routerB;
  const buyRouter = routers.find(r => r.address.toLowerCase() === buyRouterAddr.toLowerCase());

  const executorContractRes = await DB.prepare('SELECT value FROM config WHERE key = "executor_contract_address"').first() as { value: string } | null;
  const executorModeRes = await DB.prepare('SELECT value FROM config WHERE key = "executor_mode"').first() as { value: string } | null;
  const executorContract = executorContractRes?.value || '';
  const executorMode = executorModeRes?.value || 'direct';

  if (env.AI && !arbBothWellKnown) {
    const { scoreTrade } = await import('./ai-execution');
    const tradeScore = await scoreTrade(DB, env.AI, {
      type: strategyType, tokenA: foundTokenA, tokenB: foundTokenB,
      router: arb.routerA, amountIn: tradeAmount, profitPct: arb.profitPct,
      chainId: network.chain_id,
    });
    if (tradeScore && tradeScore.riskLevel === 'critical') {
      return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `AI Risk: ${tradeScore.reasons.join('; ')}` };
    }
  }

  const beforeState = await getWalletState(provider, wallet.address, foundTokenA, foundTokenB);

  let txHash: string | null = null;

  async function soloExecuteLeg(fromToken: string, toToken: string, amountIn: string, router: any, fromDecimals: number): Promise<ethers.TransactionResponse> {
    const version = (router.version || 'v2').toLowerCase();
    const tryContract = (executorMode === 'contract' || executorMode === 'become') && executorContract;
    if (tryContract) {
      try {
        if (version !== 'v2' && version !== 'v3') {
          throw new Error(`Contract mode does not support version: ${version}`);
        }
        const amountInWei = ethers.parseUnits(amountIn, fromDecimals);
        const quote = await quoteAmountOut(provider, fromToken, toToken, amountInWei, router, defaultFeeTier);
        const minOut = quote && quote.amountOut > 0n
          ? quote.amountOut * BigInt(Math.floor((100 - sp.optimal) * 100)) / 10000n
          : 0n;
        const v = version === 'v3' ? 1 : 0;
        const dexData = ethers.AbiCoder.defaultAbiCoder().encode(['uint8', 'address'], [v, router.address]);
        const arbContract = new ethers.Contract(executorContract, ARB_EXECUTOR_ABI, wallet);
        const tokenContract = new ethers.Contract(fromToken, ERC20_ABI, wallet);
        const allowance = await tokenContract.allowance(wallet.address, executorContract) as bigint;
        if (allowance < amountInWei) {
          const appTx = await tokenContract.approve(executorContract, ethers.MaxUint256, {
            gasLimit: 100000,
            ...await getGasOverrides(provider),
          });
          const appReceipt = await waitTx(appTx, 1, 30000);
          if (!appReceipt || appReceipt.status === 0) { throw new Error('Failed to set token allowance'); }
        }
        const tx = await arbContract.executeArb(fromToken, toToken, amountInWei, minOut, dexData, {
          gasLimit: 500000,
          ...await getGasOverrides(provider),
        }) as ethers.TransactionResponse;
        return tx;
      } catch (err) {
        if (executorMode === 'become') {
          console.warn('Contract execution failed, falling back to direct:', err);
        } else {
          throw err;
        }
      }
    }
    if (version === 'v3') {
      const quoterAddr = (router.quoter_address || '').trim();
      if (!quoterAddr) throw new Error("V3 router missing quoter_address");
      const winningFeeTier = arb!.amountOutA > arb!.amountOutB ? arb!.feeTierA : arb!.feeTierB;
      const feeTier = winningFeeTier ?? defaultFeeTier;
      return executeSwapV3(env, provider, wallet, fromToken, toToken, amountIn, sp.optimal, router.address, quoterAddr, feeTier, fromDecimals);
    } else if (version === 'balancer') {
      const poolId = router.fee_tiers || '';
      if (!poolId) throw new Error("Balancer router missing pool_id in fee_tiers");
      return executeSwapBalancer(env, provider, wallet, fromToken, toToken, amountIn, router.address, poolId, sp.optimal);
    } else if (version === 'universal') {
      return executeSwapUniversal(env, provider, wallet, fromToken, toToken, amountIn, router.address, sp.optimal);
    } else {
      return executeSwap(env, provider, wallet, fromToken, toToken, amountIn, sp.optimal, router.address, network.chain_id, fromDecimals);
    }
  }

  const dTokenA = await getTokenDecimals(provider, foundTokenA, chainId);
  const sp = slippageResult!;
  try {
    const legResp = await soloExecuteLeg(foundTokenA, foundTokenB, tradeAmount, buyRouter, dTokenA);
    txHash = legResp.hash;
    await waitTx(legResp, 1, 30000);
  } catch (err: any) {
    return { success: false, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB, amountIn: tradeAmount, amountOut: '0', profitPct: arb.profitPct, status: 'failed', txHash: null, errorMsg: err.message };
  }
  const afterState = await getWalletState(provider, wallet.address, foundTokenA, foundTokenB);
  const netInSpent = beforeState.tokenInBalance - afterState.tokenInBalance;
  const netOutReceived = afterState.tokenOutBalance - beforeState.tokenOutBalance;
  const nativeGasSpent = beforeState.nativeGasBalance - afterState.nativeGasBalance;

  let gasCostInTokenOut = 0n;
  if (nativeGasSpent > 0n && buyRouter?.quoter_address) {
    const nativeTokens: Record<number, string> = {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',    // Ethereum WETH
      137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',  // Polygon WMATIC
      8453: '0x4200000000000000000000000000000000000006',   // Base WETH
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',   // Arbitrum WETH
      10: '0x4200000000000000000000000000000000000006',    // Optimism WETH
    };
    const nativeToken = nativeTokens[network.chain_id] || foundTokenB;
    
    try {
      const quoter = new ethers.Contract(buyRouter.quoter_address, V3_QUOTER_ABI, provider);
      const gasPath = encodeV3Path([nativeToken, foundTokenB], [defaultFeeTier]);
      gasCostInTokenOut = await quoter.quoteExactInput.staticCall(gasPath, nativeGasSpent) as bigint;
    } catch {
      console.warn('Gas cost conversion failed, using raw native');
    }
  }

  const netProfit = netOutReceived - gasCostInTokenOut;

  const result: TradeResult = {
    success: true, strategy: strategyType, tokenA: foundTokenA, tokenB: foundTokenB,
    amountIn: ethers.formatEther(netInSpent > 0n ? netInSpent : tradeAmountWei),
    amountOut: ethers.formatEther(netOutReceived > 0n ? netOutReceived : amountOut),
    profitPct: arb.profitPct,
    status: 'success', txHash, errorMsg: null,
    gasSpent: ethers.formatEther(nativeGasSpent),
    netProfit: ethers.formatEther(netProfit > 0n ? netProfit : 0n)
  };
  await updateDailyPnL(DB, result.profitPct, result.status);

  return result;
}

export async function executeSpotBuy(
  env: Env,
  network: any,
  strat: any,
  walletAddress: string,
  db?: any
): Promise<TradeResult> {
  const DB = env['funbo-db'];
  const spotCfg = await DB.prepare('SELECT key, value FROM config WHERE key IN ("min_balance_pct","max_balance_pct","min_balance_amount","max_decimals","daily_loss_limit")').all() as { results: { key: string; value: string }[] };
  const spotCfgMap = Object.fromEntries(spotCfg.results.map((r: any) => [r.key, r.value]));
  const minBalancePct = parseInt(spotCfgMap.min_balance_pct || '10');
  const maxBalancePct = parseInt(spotCfgMap.max_balance_pct || '50');
  const minBalanceAmount = spotCfgMap.min_balance_amount || '0';
  const maxDecimals = parseInt(spotCfgMap.max_decimals || '3');
  const dailyLossLimit = parseFloat(spotCfgMap.daily_loss_limit || '5');
  const { provider } = await getWorkingProvider(env, network.rpc_url, '', db, network.chain_id);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY!, getMevProtectedProvider(env, network));

  const tradeAmount = strat.trade_amount || '10';
  const [stableDecimals, tokenDecimals] = await Promise.all([
    getTokenDecimals(provider, strat.stablecoin_address, network.chain_id),
    getTokenDecimals(provider, strat.token_address, network.chain_id),
  ]);
  const breaker = await checkCircuitBreaker(DB, dailyLossLimit);
  if (breaker.active) {
    return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'stopped', txHash: null, errorMsg: `Circuit Breaker: Daily loss ${breaker.currentLoss}%` };
  }

  const minSlipRes = await DB.prepare('SELECT value FROM config WHERE key = "min_slippage"').first() as { value: string } | null;
  const minSlippagePct = minSlipRes ? parseFloat(minSlipRes.value) : 0.5;

  const slippageResult = await calculateOptimalSlippage(provider, strat.router_address, ethers.parseUnits(tradeAmount, stableDecimals), strat.stablecoin_address, strat.token_address, minSlippagePct);
  if (!slippageResult) {
    return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Liquidity too thin (price impact > 10%)' };
  }

  const risk = await checkRiskRules(provider, wallet.address, network.chain_id, tradeAmount, minBalancePct, maxBalancePct, minBalanceAmount, strat.stablecoin_address, stableDecimals);
  if (!risk.valid) {
    return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: risk.reason };
  }

  const existingPos = await DB.prepare(
    'SELECT id FROM spot_positions WHERE spot_strategy_id = ? AND status = "open" LIMIT 1'
  ).first() as any;
  if (!existingPos && network.explorer_url) {
    const { checkTokenTradeHistory } = await import('./api-providers');
    const history = await checkTokenTradeHistory(network.explorer_url, env.BLOCKSCOUT_API_KEY, network.chain_id, strat.token_address);
    if (!history.safe) {
      return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `Token history: ${history.reason}` };
    }
  }

  if (!await isWellKnownTokenWithConfig(strat.token_address, network.chain_id, env)) {
    const tokenSafety = await goplusScanTokenSafety(env, strat.token_address, network.chain_id);
    if (!tokenSafety.safe) {
      return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `Token Unsafe: ${tokenSafety.reason}` };
    }

    const blockscout = network.explorer_url ? new BlockscoutClient(network.explorer_url, env.BLOCKSCOUT_API_KEY, network.chain_id) : null;
    if (blockscout) {
      const [tvVerified, trVerified] = await Promise.all([
        blockscout.isContractVerified(strat.token_address),
        blockscout.isContractVerified(strat.router_address),
      ]);
      if (tvVerified === false) {
        return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: "Token contract not verified on Blockscout" };
      }
      if (trVerified === false) {
        return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: "Router contract not verified on Blockscout" };
      }
    }

    const routerSafe = await verifyRouterSafety(provider, strat.router_address);
    if (!routerSafe.safe) {
      return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `Router Unsafe: ${routerSafe.reason}` };
    }
  }

  if (env.AI && !await isWellKnownTokenWithConfig(strat.token_address, network.chain_id, env)) {
    const { scoreTrade } = await import('./ai-execution');
    const tradeScore = await scoreTrade(DB, env.AI, {
      type: 'spot_buy', tokenA: strat.stablecoin_address, tokenB: strat.token_address,
      router: strat.router_address, amountIn: tradeAmount, profitPct: 0,
      chainId: network.chain_id,
    });
    if (tradeScore && tradeScore.riskLevel === 'critical') {
      return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `AI Risk: ${tradeScore.reasons.join('; ')}` };
    }
  }

  let txHash: string | null = null;
  try {
    const swapResp = await executeSwap(env, provider, wallet, strat.stablecoin_address, strat.token_address, tradeAmount, slippageResult.optimal, strat.router_address, network.chain_id, stableDecimals);
    txHash = swapResp.hash;
    await waitTx(swapResp, 1, 30000);
  } catch (err: any) {
    return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'failed', txHash: null, errorMsg: err.message };
  }

  if (!txHash) {
    return { success: false, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'failed', txHash: null, errorMsg: 'No swap executed' };
  }

  const afterState = await getWalletState(provider, wallet.address, strat.stablecoin_address, strat.token_address);
  const amountBought = afterState.tokenOutBalance; // token balance after buy
  const buyPrice = parseFloat(tradeAmount) / Number(ethers.formatUnits(amountBought, tokenDecimals));

  const result: TradeResult = {
    success: true, strategy: 'spot', tokenA: strat.stablecoin_address, tokenB: strat.token_address,
    amountIn: tradeAmount, amountOut: ethers.formatUnits(amountBought, tokenDecimals), profitPct: 0, status: 'success', txHash, errorMsg: null,
  };

  try {
    await DB.prepare(
      'INSERT INTO spot_positions (spot_strategy_id, chain_id, token_address, stablecoin_address, router_address, buy_price, buy_tx_hash, amount_bought, trade_amount_spent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(strat.id, strat.chain_id, strat.token_address, strat.stablecoin_address, strat.router_address, String(buyPrice), txHash, ethers.formatUnits(amountBought, tokenDecimals), tradeAmount).run();
  } catch (e) {
    console.error('[spot] failed to record position:', e);
  }

  if (result.txHash) {
    try {
      await recordBotTransaction(env, {
        chainId: network.chain_id,
        strategy: 'spot_buy',
        opportunityId: strat.id,
        walletAddress: wallet.address,
        tokenIn: strat.stablecoin_address,
        tokenOut: strat.token_address,
        amountIn: tradeAmount,
        amountOut: ethers.formatUnits(amountBought, tokenDecimals),
        txHash: result.txHash,
        txStatus: 'confirmed',
      });
    } catch (e) { console.error('[executor] failed to record spot buy tx:', e); }
    try {
      await logTradeReceipt(env, {
        chainId: network.chain_id,
        strategy: 'spot_buy',
        opportunityId: strat.id,
        walletAddress: wallet.address,
        tokenIn: strat.stablecoin_address,
        tokenOut: strat.token_address,
        amountIn: tradeAmount,
        amountOut: ethers.formatUnits(amountBought, tokenDecimals),
        txHash: result.txHash,
        txStatus: 'confirmed',
        blockNumber: undefined,
        gasUsed: undefined,
        gasPriceGwei: undefined,
        gasCostNative: undefined,
        gasCostUsd: undefined,
        logsJson: undefined,
        errorMsg: null,
      });
    } catch (e) { console.error('[executor] failed to log spot buy receipt:', e); }
  }

  return result;
}

export async function executeSoloSpotFromOpp(
  env: Env,
  network: NetworkConfig,
  opp: any,
  walletAddress: string,
  db: any,
  defaultFeeTier: number
): Promise<TradeResult> {
  const DB = env['funbo-db'];
  const stratId = parseInt(opp.amount_in);
  const strat = await DB.prepare('SELECT * FROM solo_spot_strategies WHERE id = ? AND is_active = 1').bind(stratId).first() as any;
  if (!strat) return { success: false, strategy: 'solo_spot', tokenA: opp.token_a, tokenB: opp.token_b, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Strategy not found or inactive' };

  const minSlipRes = await DB.prepare('SELECT value FROM config WHERE key = "min_slippage"').first() as { value: string } | null;
  const minSlippagePct = minSlipRes ? parseFloat(minSlipRes.value) : 0.5;

  const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(opp.chain_id).all() as { results: RouterConfig[] };
  const validRouters = routers.results.filter((r: RouterConfig) => r.address && (r.version === 'v3' ? !!r.quoter_address : true));
  if (validRouters.length < 2) return { success: false, strategy: 'solo_spot', tokenA: opp.token_a, tokenB: opp.token_b, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Need at least 2 valid routers' };

  const pairToken = opp.token_a;
  const configuredToken = opp.token_b;

  const slotCfg = await DB.prepare('SELECT key, value FROM config WHERE key IN ("min_balance_pct","max_balance_pct","min_balance_amount","max_decimals")').all() as { results: { key: string; value: string }[] };
  const slotCfgMap = Object.fromEntries(slotCfg.results.map((r: any) => [r.key, r.value]));
  const slotMinBalPct = parseInt(slotCfgMap.min_balance_pct || '10');
  const slotMaxBalPct = parseInt(slotCfgMap.max_balance_pct || '50');
  const slotMinBalAmt = slotCfgMap.min_balance_amount || '0';
  const maxDecimals = slotCfgMap.max_decimals ? parseInt(slotCfgMap.max_decimals) : 18;

  const { provider } = await getWorkingProvider(env, network.rpc_url, '', db, opp.chain_id);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY!, getMevProtectedProvider(env, network));

  const [pairTokenDec, configuredTokenDec] = await Promise.all([
    getTokenDecimals(provider, pairToken, opp.chain_id),
    getTokenDecimals(provider, configuredToken, opp.chain_id),
  ]);

  const tradeAmountStr = truncateDecimals(strat.trade_amount || '10', maxDecimals);
  let tradeAmountWei = ethers.parseUnits(tradeAmountStr, pairTokenDec);
  if (strat.min_trade_amount) {
    const minWei = ethers.parseUnits(truncateDecimals(strat.min_trade_amount, maxDecimals), pairTokenDec);
    if (tradeAmountWei < minWei) tradeAmountWei = minWei;
  }
  if (strat.max_trade_amount) {
    const maxWei = ethers.parseUnits(truncateDecimals(strat.max_trade_amount, maxDecimals), pairTokenDec);
    if (tradeAmountWei > maxWei) tradeAmountWei = maxWei;
  }

  const risk = await checkRiskRules(provider, wallet.address, opp.chain_id, tradeAmountStr, slotMinBalPct, slotMaxBalPct, slotMinBalAmt, pairToken, pairTokenDec);
  if (!risk.valid) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: risk.reason };

  const dailyLossLimitRes = await DB.prepare('SELECT value FROM config WHERE key = "daily_loss_limit"').first() as { value: string } | null;
  const dailyLossLimit = dailyLossLimitRes ? parseFloat(dailyLossLimitRes.value) : 5.0;
  const breaker = await checkCircuitBreaker(DB, dailyLossLimit);
  if (breaker.active) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'stopped', txHash: null, errorMsg: `Circuit Breaker: Daily loss ${breaker.currentLoss}%` };

  const slotBothWellKnown = await isWellKnownTokenWithConfig(configuredToken, opp.chain_id, env) && await isWellKnownTokenWithConfig(pairToken, opp.chain_id, env);
  const slotBlockscout = network.explorer_url ? new BlockscoutClient(network.explorer_url, env.BLOCKSCOUT_API_KEY, opp.chain_id) : null;
  if (!slotBothWellKnown) {
    const slotConfigToken = await goplusScanTokenSafety(env, configuredToken, opp.chain_id);
    if (!slotConfigToken.safe) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `Configured token unsafe: ${slotConfigToken.reason}` };

    const slotPairToken = await goplusScanTokenSafety(env, pairToken, opp.chain_id);
    if (!slotPairToken.safe) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `Pair token unsafe: ${slotPairToken.reason}` };

    if (slotBlockscout) {
      const [ctV, ptV] = await Promise.all([
        slotBlockscout.isContractVerified(configuredToken),
        slotBlockscout.isContractVerified(pairToken),
      ]);
      if (ctV === false) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Configured token not verified on Blockscout' };
      if (ptV === false) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Pair token not verified on Blockscout' };
    }
  }

  interface BestOp { buyRouter: RouterConfig; sellRouter: RouterConfig; buyAmount: bigint; sellAmount: bigint; profitPct: number; }
  let best: BestOp | null = null;

  for (const buyRouter of validRouters) {
    const buyQuote = await quoteAmountOut(provider, pairToken, configuredToken, tradeAmountWei, buyRouter, defaultFeeTier);
    if (!buyQuote || buyQuote.amountOut === 0n) continue;
    for (const sellRouter of validRouters) {
      if (sellRouter.address === buyRouter.address) continue;
      const sellQuote = await quoteAmountOut(provider, configuredToken, pairToken, buyQuote.amountOut, sellRouter, defaultFeeTier);
      if (!sellQuote || sellQuote.amountOut === 0n) continue;
      const profitPct = Number((sellQuote.amountOut - tradeAmountWei) * 10000n / tradeAmountWei) / 100;
      if (profitPct <= 0) continue;
      if (!best || profitPct > best.profitPct) {
        best = { buyRouter, sellRouter, buyAmount: buyQuote.amountOut, sellAmount: sellQuote.amountOut, profitPct };
      }
    }
  }

  if (!best) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: ethers.formatUnits(tradeAmountWei, pairTokenDec), amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'No profitable opportunity at execution time' };

  let slippageBuy: { optimal: number; priceImpact: number } | null = null;
  let slippageSell: { optimal: number; priceImpact: number } | null = null;
  const boughtAmount = best.buyAmount;

  if (!slotBothWellKnown) {
    if (slotBlockscout) {
      const [brV, srV] = await Promise.all([
        slotBlockscout.isContractVerified(best.buyRouter.address),
        slotBlockscout.isContractVerified(best.sellRouter.address),
      ]);
      if (brV === false) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Buy router not verified on Blockscout' };
      if (srV === false) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Sell router not verified on Blockscout' };
    }

    const slotBuyRouterSafe = await verifyRouterSafety(provider, best.buyRouter.address);
    if (!slotBuyRouterSafe.safe) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `Buy Router Unsafe: ${slotBuyRouterSafe.reason}` };

    slippageBuy = await calculateOptimalSlippage(provider, best.buyRouter.address, tradeAmountWei, pairToken, configuredToken, minSlippagePct);
    if (!slippageBuy) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Liquidity too thin for buy (price impact > 10%)' };

    slippageSell = await calculateOptimalSlippage(provider, best.sellRouter.address, boughtAmount, configuredToken, pairToken, minSlippagePct);
    if (!slippageSell) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Liquidity too thin for sell (price impact > 10%)' };

    if (env.AI) {
      const { scoreTrade } = await import('./ai-execution');
      const score = await scoreTrade(DB, env.AI, {
        type: 'solo_spot_buy', tokenA: pairToken, tokenB: configuredToken,
        router: best.buyRouter.address, amountIn: strat.trade_amount, profitPct: 0,
        chainId: opp.chain_id,
      });
      if (score && score.riskLevel === 'critical') {
        return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `AI Risk: ${score.reasons.join('; ')}` };
      }
    }
  }

  const beforeState = await getWalletState(provider, wallet.address, pairToken, configuredToken);

  let buyTxHash: string | null = null;
  try {
    const buyResp = await executeSwap(env, provider, wallet, pairToken, configuredToken, ethers.formatUnits(tradeAmountWei, pairTokenDec), (slippageBuy || { optimal: minSlippagePct }).optimal, best.buyRouter.address, opp.chain_id, pairTokenDec);
    buyTxHash = buyResp.hash;
    await waitTx(buyResp, 1, 30000);
  } catch (err: any) { return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: ethers.formatUnits(tradeAmountWei, pairTokenDec), amountOut: '0', profitPct: 0, status: 'failed', txHash: null, errorMsg: `Buy failed: ${err.message}` }; }
  if (!buyTxHash) return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: ethers.formatUnits(tradeAmountWei, pairTokenDec), amountOut: '0', profitPct: 0, status: 'failed', txHash: null, errorMsg: 'Buy tx not submitted' };

  let sellTxHash: string | null = null;
  try {
    const sellResp = await executeSwap(env, provider, wallet, configuredToken, pairToken, ethers.formatUnits(boughtAmount, configuredTokenDec), (slippageSell || { optimal: minSlippagePct }).optimal, best.sellRouter.address, opp.chain_id, configuredTokenDec);
    sellTxHash = sellResp.hash;
    await waitTx(sellResp, 1, 30000);
  } catch (err: any) { return { success: false, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: ethers.formatUnits(tradeAmountWei, pairTokenDec), amountOut: '0', profitPct: 0, status: 'failed', txHash: buyTxHash, errorMsg: `Sell failed: ${err.message}` }; }

  const afterState = await getWalletState(provider, wallet.address, pairToken, configuredToken);
  const netPairToken = afterState.tokenInBalance - beforeState.tokenInBalance;
  const netProfitPct = Number((netPairToken - tradeAmountWei) * 10000n / tradeAmountWei) / 100;

  await DB.prepare(
    'INSERT INTO solo_spot_trades (strategy_id, chain_id, token_address, pair_token_address, buy_dex, sell_dex, buy_price, sell_price, amount_in, amount_out, net_profit_pct, buy_tx_hash, sell_tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(strat.id, opp.chain_id, configuredToken, pairToken, best.buyRouter.address, best.sellRouter.address, ethers.formatUnits(tradeAmountWei, pairTokenDec), ethers.formatUnits(boughtAmount, configuredTokenDec), ethers.formatUnits(tradeAmountWei, pairTokenDec), ethers.formatUnits(netPairToken, pairTokenDec), netProfitPct, buyTxHash, sellTxHash).run();

  if (env.AI) {
    try {
      const { scoreTrade } = await import('./ai-execution');
      await scoreTrade(DB, env.AI, {
        type: 'solo_spot_buy', tokenA: pairToken, tokenB: configuredToken,
        router: best.buyRouter.address, amountIn: strat.trade_amount, profitPct: netProfitPct,
        chainId: opp.chain_id,
      });
      await scoreTrade(DB, env.AI, {
        type: 'solo_spot_sell', tokenA: configuredToken, tokenB: pairToken,
        router: best.sellRouter.address, amountIn: ethers.formatUnits(boughtAmount, configuredTokenDec), profitPct: netProfitPct,
        chainId: opp.chain_id,
      });
    } catch {}
  }

  const soloResult: TradeResult = { success: true, strategy: 'solo_spot', tokenA: pairToken, tokenB: configuredToken, amountIn: ethers.formatUnits(tradeAmountWei, pairTokenDec), amountOut: ethers.formatUnits(netPairToken, pairTokenDec), profitPct: netProfitPct, status: 'success', txHash: buyTxHash, errorMsg: null, gasSpent: undefined, netProfit: ethers.formatUnits(netPairToken, pairTokenDec) };

  if (buyTxHash || sellTxHash) {
    try {
      await recordBotTransaction(env, {
        chainId: opp.chain_id,
        strategy: 'solo-spot',
        opportunityId: opp.id,
        walletAddress: wallet.address,
        tokenIn: pairToken,
        tokenOut: configuredToken,
        amountIn: ethers.formatUnits(tradeAmountWei, pairTokenDec),
        amountOut: ethers.formatUnits(netPairToken, pairTokenDec),
        txHash: sellTxHash ? `${buyTxHash},${sellTxHash}` : (buyTxHash || ''),
        txStatus: 'confirmed',
      });
    } catch (e) { console.error('[executor] failed to record solo-spot tx:', e); }
  }

if (buyTxHash || sellTxHash) {
    try {
      await logTradeReceipt(env, {
        chainId: opp.chain_id,
        strategy: 'solo-spot',
        opportunityId: opp.id,
        walletAddress: wallet.address,
        tokenIn: pairToken,
        tokenOut: configuredToken,
        amountIn: ethers.formatUnits(tradeAmountWei, pairTokenDec),
        amountOut: ethers.formatUnits(netPairToken, pairTokenDec),
        txHash: sellTxHash ? `${buyTxHash},${sellTxHash}` : (buyTxHash || ''),
        txStatus: 'confirmed',
        blockNumber: undefined,
        gasUsed: undefined,
        gasPriceGwei: undefined,
        gasCostNative: undefined,
        gasCostUsd: undefined,
        logsJson: undefined,
        errorMsg: null,
      });
    } catch (e) { console.error('[executor] failed to log solo-spot receipt:', e); }
  }

  return soloResult;
}

export async function executeSpotSell(
  env: Env,
  network: any,
  position: any,
  db?: any
): Promise<TradeResult> {
  const DB = env['funbo-db'];
  const sellCfg = await DB.prepare('SELECT key, value FROM config WHERE key IN ("min_balance_pct","max_balance_pct","min_balance_amount","daily_loss_limit")').all() as { results: { key: string; value: string }[] };
  const sellCfgMap = Object.fromEntries(sellCfg.results.map((r: any) => [r.key, r.value]));
  const minBalancePct = parseInt(sellCfgMap.min_balance_pct || '10');
  const maxBalancePct = parseInt(sellCfgMap.max_balance_pct || '50');
  const minBalanceAmount = sellCfgMap.min_balance_amount || '0';
  const dailyLossLimit = parseFloat(sellCfgMap.daily_loss_limit || '5');
  const { provider } = await getWorkingProvider(env, network.rpc_url, '', db, network.chain_id);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY!, getMevProtectedProvider(env, network));
const tokenDec = await getTokenDecimals(provider, position.token_address, network.chain_id);
   const stableDec = position.stablecoin_address ? await getTokenDecimals(provider, position.stablecoin_address, network.chain_id) : 18;
  const sellAmountWei = ethers.parseUnits(position.amount_bought, tokenDec);
  const sellAmount = ethers.formatUnits(sellAmountWei, tokenDec);

  const minSlipRes = await DB.prepare('SELECT value FROM config WHERE key = "min_slippage"').first() as { value: string } | null;
  const minSlippagePct = minSlipRes ? parseFloat(minSlipRes.value) : 0.5;

  const slippageResult = await calculateOptimalSlippage(provider, position.router_address, ethers.parseUnits(sellAmount, tokenDec), position.token_address, position.stablecoin_address, minSlippagePct);
  if (!slippageResult) {
    return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: sellAmount, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Liquidity too thin (price impact > 10%)' };
  }

  const breaker = await checkCircuitBreaker(DB, dailyLossLimit);
  if (breaker.active) {
    return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'stopped', txHash: null, errorMsg: `Circuit Breaker: Daily loss ${breaker.currentLoss}%` };
  }

  const risk = await checkRiskRules(provider, wallet.address, network.chain_id, sellAmount, minBalancePct, maxBalancePct, minBalanceAmount, position.token_address, tokenDec);
  if (!risk.valid) {
    return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: sellAmount, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: risk.reason };
  }

  if (!await isWellKnownTokenWithConfig(position.token_address, network.chain_id, env)) {
    const tokenSafety = await goplusScanTokenSafety(env, position.token_address, network.chain_id);
    if (!tokenSafety.safe) {
      return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `Token Unsafe: ${tokenSafety.reason}` };
    }

    const blockscout = network.explorer_url ? new BlockscoutClient(network.explorer_url, env.BLOCKSCOUT_API_KEY, network.chain_id) : null;
    if (blockscout) {
      const [tvVerified, trVerified] = await Promise.all([
        blockscout.isContractVerified(position.token_address),
        blockscout.isContractVerified(position.router_address),
      ]);
      if (tvVerified === false) {
        return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: "Token contract not verified on Blockscout" };
      }
      if (trVerified === false) {
        return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: "Router contract not verified on Blockscout" };
      }
    }

    const routerSafe = await verifyRouterSafety(provider, position.router_address);
    if (!routerSafe.safe) {
      return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `Router Unsafe: ${routerSafe.reason}` };
    }
  }

  if (env.AI && !await isWellKnownTokenWithConfig(position.token_address, network.chain_id, env)) {
    const { scoreTrade } = await import('./ai-execution');
    const tradeScore = await scoreTrade(DB, env.AI, {
      type: 'spot_sell', tokenA: position.token_address, tokenB: position.stablecoin_address,
      router: position.router_address, amountIn: sellAmount, profitPct: 0,
      chainId: network.chain_id,
    });
    if (tradeScore && tradeScore.riskLevel === 'critical') {
      return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: `AI Risk: ${tradeScore.reasons.join('; ')}` };
    }
  }

  const beforeState = await getWalletState(provider, wallet.address, position.token_address, position.stablecoin_address);

  let txHash: string | null = null;
  try {
    const swapResp = await executeSwap(env, provider, wallet, position.token_address, position.stablecoin_address, sellAmount, slippageResult.optimal, position.router_address, network.chain_id, tokenDec);
    txHash = swapResp.hash;
    await waitTx(swapResp, 1, 30000);
  } catch (err: any) {
    return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: sellAmount, amountOut: '0', profitPct: 0, status: 'failed', txHash: null, errorMsg: err.message };
  }

  if (!txHash) {
    return { success: false, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address, amountIn: sellAmount, amountOut: '0', profitPct: 0, status: 'failed', txHash: null, errorMsg: 'No swap executed' };
  }

  const afterState = await getWalletState(provider, wallet.address, position.token_address, position.stablecoin_address);
  const stablecoinOut = afterState.tokenOutBalance - beforeState.tokenOutBalance;
  const buyPrice = parseFloat(position.buy_price);
  const sellPrice = buyPrice > 0 ? Number(ethers.formatUnits(stablecoinOut, stableDec)) / parseFloat(position.amount_bought) : 0;
  const profitPct = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;

  const result: TradeResult = {
    success: true, strategy: 'spot', tokenA: position.token_address, tokenB: position.stablecoin_address,
    amountIn: sellAmount, amountOut: ethers.formatUnits(stablecoinOut, stableDec), profitPct, status: 'success', txHash, errorMsg: null,
  };

  try {
    await DB.prepare(
      'UPDATE spot_positions SET status = "closed", sell_price = ?, sell_tx_hash = ?, profit_pct = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(String(sellPrice), txHash, profitPct, position.id).run();
    await DB.prepare('UPDATE spot_strategies SET reference_price = ? WHERE id = ?').bind(String(sellPrice), position.spot_strategy_id).run();
  } catch (e) {
    console.error('[spot] failed to update position:', e);
  }

  if (result.txHash) {
    try {
      await recordBotTransaction(env, {
        chainId: network.chain_id,
        strategy: 'spot_sell',
        opportunityId: position.id,
        walletAddress: wallet.address,
        tokenIn: position.token_address,
        tokenOut: position.stablecoin_address,
        amountIn: sellAmount,
        amountOut: ethers.formatUnits(stablecoinOut, stableDec),
        txHash: result.txHash,
        txStatus: 'confirmed',
      });
    } catch (e) { console.error('[executor] failed to record spot sell tx:', e); }
    try {
      await logTradeReceipt(env, {
        chainId: network.chain_id,
        strategy: 'spot_sell',
        opportunityId: position.id,
        walletAddress: wallet.address,
        tokenIn: position.token_address,
        tokenOut: position.stablecoin_address,
        amountIn: sellAmount,
        amountOut: ethers.formatUnits(stablecoinOut, stableDec),
        txHash: result.txHash,
        txStatus: 'confirmed',
        blockNumber: undefined,
        gasUsed: undefined,
        gasPriceGwei: undefined,
        gasCostNative: undefined,
        gasCostUsd: undefined,
        logsJson: undefined,
        errorMsg: null,
      });
    } catch (e) { console.error('[executor] failed to log spot sell receipt:', e); }
  }

  return result;
}


export async function executeMMRebalance(
  env: Env,
  network: NetworkConfig,
  opp: any,
  walletAddress: string,
  DB: any,
  defaultFeeTier: number
): Promise<TradeResult> {
  const cfgId = parseInt(opp.router_a);
  const cfg = await DB.prepare('SELECT * FROM mm_lp_configs WHERE id = ? AND is_active = 1').bind(cfgId).first() as any;
  if (!cfg) return { success: false, strategy: 'mm_rebalance', tokenA: opp.token_a, tokenB: opp.token_b, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Config not found or inactive' };

  const { provider } = await getWorkingProvider(env, network.rpc_url, '', DB, network.chain_id);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY!, getMevProtectedProvider(env, network));

  const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(network.chain_id).all() as { results: any[] };
  const validRouters = routers.results.filter((r: any) => r.address && (r.version === 'v3' ? !!r.quoter_address : true));
  if (validRouters.length === 0) return { success: false, strategy: 'mm_rebalance', tokenA: opp.token_a, tokenB: opp.token_b, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'No valid routers' };

  const router = validRouters[0];
  const version = (router.version || 'v2').toLowerCase();
  const refPrice = parseFloat(cfg.reference_price || '0');
  if (refPrice <= 0) return { success: false, strategy: 'mm_rebalance', tokenA: opp.token_a, tokenB: opp.token_b, amountIn: '0', amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'No reference price' };

  const cfgRes = await DB.prepare('SELECT key, value FROM config WHERE key IN ("min_slippage","max_decimals","daily_loss_limit","min_balance_pct","max_balance_pct","min_balance_amount")').all() as { results: { key: string; value: string }[] };
  const cfgMap = Object.fromEntries(cfgRes.results.map((r: any) => [r.key, r.value]));
  const minSlippagePct = parseFloat(cfgMap.min_slippage || '0.5');
  const maxDecimals = parseInt(cfgMap.max_decimals || '3');
  const dailyLossLimit = parseFloat(cfgMap.daily_loss_limit || '5');
  const minBalancePct = parseInt(cfgMap.min_balance_pct || '10');
  const maxBalancePct = parseInt(cfgMap.max_balance_pct || '50');
  const minBalanceAmount = cfgMap.min_balance_amount || '0';

  const direction = opp.token_a === cfg.token_address ? 'sell' : 'buy';
  const tradeAmount = truncateDecimals(cfg.trade_amount || '10', maxDecimals);
  const tokenIn = direction === 'sell' ? cfg.token_address : opp.token_b;
  const tokenOut = direction === 'sell' ? opp.token_b : cfg.token_address;

  const breaker = await checkCircuitBreaker(DB, dailyLossLimit);
  if (breaker.active) return { success: false, strategy: 'mm_rebalance', tokenA: tokenIn, tokenB: tokenOut, amountIn: '0', amountOut: '0', profitPct: 0, status: 'stopped', txHash: null, errorMsg: `Circuit Breaker: Daily loss ${breaker.currentLoss}%` };

  const risk = await checkRiskRules(provider, wallet.address, network.chain_id, tradeAmount, minBalancePct, maxBalancePct, minBalanceAmount, tokenIn);
  if (!risk.valid) return { success: false, strategy: 'mm_rebalance', tokenA: tokenIn, tokenB: tokenOut, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: risk.reason };

  const slippageResult = await calculateOptimalSlippage(provider, router.address, ethers.parseEther(tradeAmount), tokenIn, tokenOut, minSlippagePct);
  if (!slippageResult) return { success: false, strategy: 'mm_rebalance', tokenA: tokenIn, tokenB: tokenOut, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'skipped', txHash: null, errorMsg: 'Slippage calc failed' };

  // BRT fee-token: use Kyber aggregator only (reliable, handles 8% fee), isolated wallet per mode
  const isBRT = isFeeToken(tokenIn) || isFeeToken(tokenOut);
  const brtDecimals = isBRT ? await getTokenDecimals(provider, tokenIn, network.chain_id) : 18;
  // Override slippage floor for BRT 8% fee if not excluded
  let effectiveSlippage = slippageResult.optimal;
  if (isBRT) effectiveSlippage = Math.max(slippageResult.optimal, 8.5);
  let txHash: string | null = null;
  try {
    if (isBRT) {
      const kyberResp = await executeKyberSwap(provider, wallet, tokenIn, tokenOut, tradeAmount, effectiveSlippage, brtDecimals);
      txHash = kyberResp.hash;
      await waitTx(kyberResp, 1, 30000);
    } else if (version === 'v3') {
      const quoterAddr = (router.quoter_address || '').trim();
      if (!quoterAddr) throw new Error('V3 router missing quoter');
      const swapResp = await executeSwapV3(env, provider, wallet, tokenIn, tokenOut, tradeAmount, effectiveSlippage, router.address, quoterAddr, defaultFeeTier);
      txHash = swapResp.hash;
      await waitTx(swapResp, 1, 30000);
    } else {
      const swapResp = await executeSwap(env, provider, wallet, tokenIn, tokenOut, tradeAmount, effectiveSlippage, router.address, network.chain_id);
      txHash = swapResp.hash;
      await waitTx(swapResp, 1, 30000);
    }
  } catch (err: any) {
    return { success: false, strategy: 'mm_rebalance', tokenA: tokenIn, tokenB: tokenOut, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'failed', txHash: null, errorMsg: err.message };
  }

  if (!txHash) return { success: false, strategy: 'mm_rebalance', tokenA: tokenIn, tokenB: tokenOut, amountIn: tradeAmount, amountOut: '0', profitPct: 0, status: 'failed', txHash: null, errorMsg: 'No swap executed' };

  const afterState = await getWalletState(provider, wallet.address, tokenIn, tokenOut);
  const netOut = afterState.tokenOutBalance;
  const tokenOutDec = await getTokenDecimals(provider, tokenOut, network.chain_id);

  await DB.prepare('UPDATE mm_lp_configs SET reference_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(String(netOut > 0n ? Number(ethers.formatUnits(netOut, tokenOutDec)) / parseFloat(tradeAmount) : 0), cfg.id).run();

  const result: TradeResult = {
    success: true, strategy: 'mm_rebalance', tokenA: tokenIn, tokenB: tokenOut,
    amountIn: tradeAmount, amountOut: ethers.formatUnits(netOut > 0n ? netOut : 0n, tokenOutDec), profitPct: opp.profit_pct || 0, status: 'success', txHash, errorMsg: null,
  };

  try {
    await DB.prepare(
      'INSERT INTO trades (wallet_label, chain_id, strategy, token_a, token_b, amount_in, amount_out, profit_pct, status, tx_hash, error_msg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('mm', network.chain_id, 'mm_rebalance', tokenIn, tokenOut, tradeAmount, ethers.formatUnits(netOut > 0n ? netOut : 0n, tokenOutDec), opp.profit_pct || 0, 'success', txHash, null).run();
  } catch (e) {
    console.error('[mm] failed to record trade:', e);
  }

  if (result.txHash) {
    try {
      await recordBotTransaction(env, {
        chainId: network.chain_id,
        strategy: 'mm_rebalance',
        opportunityId: opp.id,
        walletAddress: wallet.address,
        tokenIn,
        tokenOut,
        amountIn: tradeAmount,
        amountOut: ethers.formatUnits(netOut > 0n ? netOut : 0n, tokenOutDec),
        txHash: result.txHash,
        txStatus: 'confirmed',
      });
    } catch (e) { console.error('[executor] failed to record mm rebalance tx:', e); }
    try {
      await logTradeReceipt(env, {
        chainId: network.chain_id,
        strategy: 'mm_rebalance',
        opportunityId: opp.id,
        walletAddress: wallet.address,
        tokenIn,
        tokenOut,
        amountIn: tradeAmount,
        amountOut: ethers.formatUnits(netOut > 0n ? netOut : 0n, tokenOutDec),
        amountInUsd: undefined,
        amountOutUsd: undefined,
        txHash: result.txHash,
        txStatus: 'confirmed',
        blockNumber: undefined,
        gasUsed: undefined,
        gasPriceGwei: undefined,
        gasCostNative: undefined,
        gasCostUsd: undefined,
        logsJson: undefined,
        errorMsg: null,
      });
    } catch (e) { console.error('[executor] failed to log mm rebalance receipt:', e); }
  }

  return result;
}


