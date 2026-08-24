// BRT Quote MM — mean-reversion quoting around slow-EMA reference price.
// Phase 1 (dry_run): detects band breaches and records opportunity rows with
// status='dry_run' so executePendingOpportunities never touches them.
// Phase 2 (live): fee-aware — BRT has immutable 8% reflection tax (no owner key,
// no excludeFromFee). Live requires deviation > BAND(0.75)+FEE(8)=~9% so net after
// fee+gas is non-negative. Dry_run still logs gross 0.75% breaches for AI/tax
// validation; live is gated by BRT_FEE_PCT.
import { rawEthCall } from '../../shared/quotes';
import { BRT_FEE_PCT } from '../../shared/aggregator';

const BRT = '0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b';
const WPOL = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
const BRT_WPOL_LP = '0xc445b18b3ff85e0691fe416ad91e456f8697b166'; // Quickswap V2
const CHAIN_ID = 137;
const BRT_DECIMALS = 9;

const SEL_TOKEN0 = '0x0dfe1681';
const SEL_GET_RESERVES = '0x0902f1ac';

async function getConfig(DB: any, key: string): Promise<string | null> {
  const row = await DB.prepare('SELECT value FROM config WHERE key = ?').first() as { value: string } | null;
  return row ? row.value : null;
}

async function setConfig(DB: any, key: string, value: string): Promise<void> {
  await DB.prepare(`INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`).bind(key, value, value).run();
}

export async function scanBrtQuote(env: any, chainId: number): Promise<{ inserted: number; skipped: string }> {
  const DB = env['funbo-db'];
  if (chainId !== CHAIN_ID) return { inserted: 0, skipped: 'not-polygon' };

  const mode = (await getConfig(DB, 'brt_quote_mode')) || 'off';
  if (mode === 'off') return { inserted: 0, skipped: 'mode-off' };
  const bandPct = parseFloat((await getConfig(DB, 'brt_quote_band_pct')) || '0.75');
  const maxTradeBrt = (await getConfig(DB, 'brt_quote_max_trade_brt')) || '10';
  const cooldownMin = parseInt((await getConfig(DB, 'brt_quote_cooldown_minutes')) || '45');
  const maxTradesPerDay = parseInt((await getConfig(DB, 'brt_quote_max_trades_per_day')) || '6');

  const net = await DB.prepare('SELECT rpc_url FROM networks WHERE is_active = 1 AND chain_id = ?').bind(chainId).first() as { rpc_url: string } | null;
  if (!net?.rpc_url) return { inserted: 0, skipped: 'no-network' };

  // token0 ordering + reserves (two lightweight eth_calls, no provider spin-up)
  let token0 = '', reservesHex = '';
  try {
    const t0 = await rawEthCall(net.rpc_url, BRT_WPOL_LP, SEL_TOKEN0);
    const res = await rawEthCall(net.rpc_url, BRT_WPOL_LP, SEL_GET_RESERVES);
    if (!t0 || !res || res === '0x' || t0 === '0x') return { inserted: 0, skipped: 'rpc-empty' };
    token0 = '0x' + t0.slice(-40);
    reservesHex = res.slice(2);
  } catch {
    return { inserted: 0, skipped: 'rpc-error' };
  }
  // getReserves returns (uint112, uint112, uint32) packed in 3 words
  const w = [reservesHex.slice(0, 64), reservesHex.slice(64, 128)];
  const r0 = BigInt('0x' + w[0]);
  const r1 = BigInt('0x' + w[1]);
  const isBrtToken0 = token0.toLowerCase() === BRT.toLowerCase();
  const rBrt = isBrtToken0 ? r0 : r1;
  const rWpol = isBrtToken0 ? r1 : r0;
  if (rBrt === 0n || rWpol === 0n) return { inserted: 0, skipped: 'empty-reserves' };

  // WPOL per BRT: (rWpol/1e18) / (rBrt/1e9)
  const price = Number(rWpol) / Number(rBrt) / 1e9;
  if (!isFinite(price) || price <= 0) return { inserted: 0, skipped: 'bad-price' };

  // slow EMA reference (10% weight per scan)
  const prevRef = parseFloat((await getConfig(DB, 'brt_quote_ref_price')) || '');
  const ref = prevRef && isFinite(prevRef) && prevRef > 0 ? prevRef * 0.9 + price * 0.1 : price;
  await setConfig(DB, 'brt_quote_ref_price', String(ref));

  const devPct = ((price - ref) / ref) * 100;
  // Fee-aware bands: dry_run uses gross band for data collection, live requires net > fee
  const grossBand = bandPct;
  const netBand = bandPct + BRT_FEE_PCT;
  let side: 'buy' | 'sell' | null = null;
  if (mode === 'live') {
    if (devPct <= -netBand) side = 'buy';
    else if (devPct >= netBand) side = 'sell';
  } else {
    if (devPct <= -grossBand) side = 'buy';       // dry_run: log gross 0.75% breach
    else if (devPct >= grossBand) side = 'sell';
  }

  if (!side) {
    const need = mode === 'live' ? netBand : grossBand;
    return { inserted: 0, skipped: `in-band ${devPct.toFixed(3)}% < ${need}%${mode==='live'?' net(0.75+8)':''}` };
  }

  // caps + cooldown apply only to live mode (dry_run costs nothing)
  if (mode === 'live') {
    const lastStr = await getConfig(DB, 'brt_quote_last_trade');
    if (lastStr) {
      const elapsedMin = (Math.floor(Date.now() / 1000) - parseInt(lastStr)) / 60;
      if (elapsedMin < cooldownMin) return { inserted: 0, skipped: `cooldown ${elapsedMin.toFixed(0)}/${cooldownMin}m` };
    }
    const cntRow = await DB.prepare(
      `SELECT COUNT(*) AS n FROM opportunities WHERE router_b = 'brt_quote' AND created_at >= date('now') AND status IN ('pending','executed')`
    ).first() as { n: number };
    if (cntRow.n >= maxTradesPerDay) return { inserted: 0, skipped: `daily-cap ${cntRow.n}/${maxTradesPerDay}` };
  }

  await DB.prepare(
    `INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status, error_msg)
     VALUES (?, 'brt_quote', 'brt_quote', ?, ?, ?, ?, ?, ?)`
  ).bind(
    CHAIN_ID,
    side === 'buy' ? BRT : WPOL,
    side === 'buy' ? WPOL : BRT,
    maxTradeBrt,
    Math.abs(devPct),
    mode === 'live' ? 'pending' : 'dry_run',
    `${side} @ ${price.toPrecision(6)} WPOL/BRT, EMA ${ref.toPrecision(6)}, dev ${devPct.toFixed(3)}%${mode === 'dry_run' ? ' [DRY-RUN]' : ''}`
  ).run();

  if (mode === 'live') await setConfig(DB, 'brt_quote_last_trade', String(Math.floor(Date.now() / 1000)));
  console.log(`[brt-quote] ${mode} ${side} inserted: dev=${devPct.toFixed(3)}% price=${price.toPrecision(6)}`);
  return { inserted: 1, skipped: '' };
}
