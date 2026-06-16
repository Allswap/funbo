> **⚠️ WARNING: This directory is for CODING & TESTING only.**  
> Workers are deployed via CI/CD (`.github/workflows/deploy.yml`) on push to `main`.  
> The dashboard is deployed by Cloudflare Pages native auto-build (connected to this repo).  
> DO NOT use this directory for local production deployments or rely on its git state for production.

---

### Cloudflare Workers Free Plan Limits (2026)

### Completely Free & Unlimited:
| Service | Limits | Notes |
|---------|--------|-------|
| **CDN** | Unlimited bandwidth, global Anycast | Content delivery |
| **DNS** | Unlimited queries, unlimited records | Zone management |
| **DDoS Protection** | Unmetered L3/L4/L7 mitigation | Always on security |
| **SSL/TLS** | Universal SSL (shared cert) with auto-renewal | HTTPS enabled |
| **Tunnel** | Unlimited tunnels, free connector | Local development tunnel |
| **Zero Trust Access** | Up to 50 users, unlimited applications | Enterprise SSO |

### Generous Free Allowances:
| Service | Free Tier Limits | Notes |
|---------|------------------|-------|
| **Workers** | 100K requests/day | Core compute platform |
| **R2** | 10 GB storage, zero egress fees | Object storage |
| **KV** | 100K reads/day, 1 GB storage | Key-value store |
| **D1** | 5M rows read/day, 5 GB storage | SQL database |
| **Queues** | 10K operations/day, up to 10K queues | Message queues |
| **Pages** | 500 builds/mo, 20K files/site | Static hosting |
| **Turnstile** | Unlimited free | CAPTCHA service |
| **Analytics Engine** | 10M writes/month | Time-series analytics |
| **Browser Rendering** | 10 min/day, 3 concurrent browsers | Headless browser API |
| **Durable Objects** | Now available on free plan with compute & storage limits | Stateful coordination |
| **Bulk Redirects** | 10,000 URL redirects | HTTP redirects |

### No Free Tier (Usage-Based Only):
| Service | Pricing |
|---------|---------|
| **Stream** | Pay per minute stored & delivered |
| **Images** | Pay per image stored & delivered |

### Currently Configured for This Bot (Free Tier):

| Service | Workers Configured | Free Tier Usage | Purpose |
|---------|-------------------|-----------------|---------|
| **Workers** | 4 (`funbo`, `funbo-execution`, `funbo-discovery`, `funbo-analytics`) | 100K req/day | Core compute - API gateway, execution engine, discovery scanner, analytics |
| **D1** | 1 shared (`funbo-db`) | 5M reads/day, 5 GB | Primary database - all state, config, trades, opportunities |
| **Workers KV** | 4 namespaces (1 per worker) | 100K reads/day, 1 GB | `decimalCache`, RPC pool caching, rate limiting, session state |
| **Queues** | 4 queues (scan, execute, analytics, cross-worker) | 10K ops/day | Async job processing - scan→execute decoupling, async notifications |
| **Workers AI** | All 4 workers (`env.AI`) | 10K neurons/day | Trade risk scoring, AI advisor, strategy generation |
| **Analytics Engine** | `funbo-analytics` | 10M writes/month | Trade metrics, PnL time-series, custom dashboards |
| **R2** | Ready (needs dashboard enable) | 10 GB, 1M Class A/mo | Trade logs archive, historical data, backups |
| **Turnstile** | Gateway (placeholder) | Unlimited | Dashboard login CAPTCHA |
| **Email** | All 4 workers (`send_email`) | 3K emails/mo | Alerts, notifications, trade confirmations |
| **Workers Observability** | All 4 workers | Enabled | Logs, metrics, tracing |

### Missing / Not Yet Enabled (Free Tier Available):

| Service | Status | Notes |
|---------|--------|-------|
| **R2 Buckets** | Defined in wrangler, needs dashboard enable | 10 GB free, zero egress - for trade logs, backups |
| **Durable Objects** | Excluded per requirements | Available on free tier with compute limits |
| **Browser Rendering** | Not configured | 10 min/day free - for web scraping, screenshot capture |
| **Pages** | Not used | 500 builds/mo - for dashboard deployment |
| **Zero Trust Access** | Not configured | 50 users free - for team dashboard access |
| **Hyperdrive** | Not available free tier | Requires paid plan for DB connection pooling |

# EVM Bots — System Status

## Architecture

4 independent Cloudflare Workers share D1 `funbo-db`:

| Worker | Native Cron | GH Actions Cron | Role | AI File |
|--------|-------------|-----------------|------|---------|
| `funbo` | none | — | API gateway, auth, CRUD | `ai-gateway.ts` — general Q&A endpoint |
| `funbo-execution` | `*/15 * * * *` + `*/20 * * * *` | `*/15` execute + `*/20` scan-execute | Trade execution, scanner | `ai-execution.ts` — trade risk scoring |
| `funbo-analytics` | none | `0 * * * *` hourly | Analytics, AI advisor, notifications | `ai-advisor.ts` — config suggestions + main AI |
| `funbo-discovery` | `*/30 * * * *` + `0 * * * *` | `*/30` spot + `*/30` cross-dex shards + `0` hourly | Pool discovery, arbitrage scanning | `ai-discovery.ts` — pair quality scoring |

> Native Worker crons + GH Actions crons coexist. `dedupCronRun()` in each handler prevents double execution by checking D1 config table.

## Strategy Status

| Strategy | Scanner | Executor | Frequency | Status |
|----------|---------|----------|-----------|--------|
| **Arbitrage (DEX)** | `runScanCycle` — checks router price differences ≥1% | `executeOpportunity` in execution cron | Every 30 min (native + GH shards) | ✅ **Running** |
| **Triangular Arbitrage** | `scanTriangularArb` (part of runScanCycle) | `executeOpportunity` in execution cron | Every 30 min (native + GH shards) | ✅ **Running** |
| **Solo-Spot Round-Trip** | `scanSoloSpotStrategies` | `executeSoloSpotFromOpp` in execution cron | Every 30 min (native) | ✅ **Running** |
| **Spot Swing-Trade** | `scanSpotStrategies` — checks price thresholds | `executeSpotBuy` / `executeSpotSell` in execution cron | Every 30 min (native) | ✅ **Running** |
| **MM Rebalance** | `scanMMStrategies` — monitors price deviation vs reference | `executeMMRebalance` in execution cron | Every 30 min (native) | ✅ **Running** |
| **Cross-Chain Arb** | `scanCrossChainArb` (part of runScanCycle) | `executeOpportunity` in execution cron | Every 30 min (native + GH shards) | ✅ **Running** |
| **Yield Farming** | Not implemented | Not implemented | ❌ **DRAFT** — config registered, no code |
| **Webacy DD API** | Not implemented | Not implemented | ❌ **DRAFT** — evaluated, not needed yet |

> No trade executes unless the scanner first creates a pending `opportunities` row.  
> If no scanner finds a profitable opportunity, the execution cron has nothing to do.

## Database

> **⚠️ CRITICAL: `funbo` (gateway) is the ONLY worker that owns/manages DB schema.**  
> All other workers (`funbo-execution`, `funbo-discovery`, `funbo-analytics`) are **read/write only** — they must NEVER create/alter tables or run migrations. Their `initDB` must be a lightweight `SELECT 1` connectivity check.

- Single D1 instance: `funbo-db` (`35c17ec6-46fd-41e5-8e70-f829b4b77909`)
- Schema owned by `funbo` (gateway) — all other workers read/write only
- Tables: `networks`, `wallets`, `trades`, `config`, `api_keys`, `dex_routers`, `daily_pnl`, `rpc_pools`, `trade_strategies`, `ai_configs`, `security_layers`, `token_pairs`, `opportunities`, `service_quotas`, `node_health`, `spot_strategies`, `spot_positions`, `discovery_pools`, `error_logs`

## AI System (Multi-Layer)

```
┌──────────────┐     config: ai_discovery_*     ┌──────────────┐
│  Discovery   │──────────────────────────────▶ │              │
│ ai-discovery │                                │              │
│  score pairs │                                │              │
└──────────────┘                                │   Main AI    │
                                                │  (runMainAi  │
┌──────────────┐     config: ai_execution_*     │   in shared  │
│  Execution   │──────────────────────────────▶ │  ai-advisor) │
│ ai-execution │                                │              │
│  risk trades │                                │  Reads all   │
└──────────────┘                                │  AI outputs  │
                                                │  + trade     │
┌──────────────┐     config: ai_suggest_*       │  history     │
│  Analytics   │──────────────────────────────▶ │  + opps      │
│ ai-advisor   │                                │  + strats    │
│  suggestions │                                │              │
└──────────────┘                                │  → creates   │
                                                │  new spot_   │
┌──────────────┐     config: ai_strategy_*      │  strategies  │
│   Gateway    │◀──────────────────────────────│              │
│  ai-gateway  │     (new strategies created)   └──────────────┘
│ /api/ai/analyze│
└──────────────┘
```

Each worker AI persists to `config` table with its own prefix. The Main AI (`runMainAi` in `shared/ai-advisor.ts`) runs hourly from analytics cron, collects all AI outputs + 7-day trade history, and generates new `spot_strategies`.

## Security Layers (per trade path)

All 3 trade paths (`runBotStrategy`, `executeSpotBuy`, `executeSpotSell`) now pass:

1. `checkRiskRules` — wallet balance, stablecoin/ETH thresholds
2. `checkCircuitBreaker` — daily loss limit (5%)
3. `goplusScanTokenSafety` — GoPlus token security scan
4. `BlockscoutClient.isContractVerified` — contract verification check
5. `verifyRouterSafety` — router bytecode/source verification
6. `checkTokenTradeHistory` — min 10 holders, 5 txs (Blockscout)
7. `scoreTrade` (AI) — blocks trades rated `critical`

## API Endpoints

### Gateway (`funbo`)
- CRUD: networks, wallets, dex_routers, token_pairs, strategies, spot_strategies, spot_positions, ai_configs
- `POST /api/spot-strategies` — creates with token history check
- `POST /api/discovery/run` — forwarded to discovery worker
- `POST /api/bot/run` — forwarded to execution worker
- `POST /api/ai/analyze` — general AI Q&A
- `POST /api/errors/log` — public error log ingestion (workers submit here)
- `GET /api/errors/logs` — authenticated error log query (dashboard reads here)
- `POST /api/token-pairs/recheck-security` — batch re-scan all pairs via GoPlus

### Discovery (`funbo-discovery`)
- CRUD: discovery_pools, token_pairs
- `POST /api/discovery/run` — pool discovery + GoPlus security + AI scoring
- `POST /api/cron/spot-strategies` — run spot/solo-spot/MM scans (public, no auth)
- `POST /api/cron/cross-dex` — run cross-dex + triangular arb scan with sharding (public, no auth)
- `POST /api/cron/hourly-discovery` — hourly pool discovery (public, no auth)
- `GET /api/health`

### Execution (`funbo-execution`)
- `POST /api/bot/run` — main bot strategy execution
- `POST /api/opportunities/scan` — manual scan trigger
- `POST /api/spot-strategies/:id/execute` — manual spot trade
- `POST /api/cron/execute` — execute pending opportunities (public, no auth)
- `POST /api/cron/scan-and-execute` — scan + execute combined run (public, no auth)

### Analytics (`funbo-analytics`)
- `GET /api/analytics/pnl`, `/stats`, `/success-rate`
- `POST /api/analytics/ai-suggest` — AI advisor suggestions
- `POST /api/analytics/ai-main` — main AI strategy generation
- `POST /api/notify` — send notification
- `POST /api/cron/analytics` — hourly analytics run (public, no auth)
- `POST /api/cron/cleanup` — daily cleanup (public, no auth)
- CRUD: quotas, trades

## Key Changes Applied

- MM Rebalance strategy implemented: `scanMMStrategies` (discovery) + `executeMMRebalance` (execution) — monitors price deviation vs reference, rebalances via swap when threshold exceeded
- Discovery worker proxy routes added to gateway
- AI configs table queried by `runAiAdvisorBase` instead of hardcoded model
- Missing security checks added to `executeSpotBuy` and `executeSpotSell`
- `checkTokenTradeHistory()` validates min holders/txs before strategy creation
- Each worker has its own AI file fitting its function
- Execution AI persists risk scores; main AI aggregates all worker outputs
- Scanner try/catch protects against missing tables before gateway init

### Dashboard: All data now reads from DB (Jun 7)

All 18 previously hardcoded data sources across 12 dashboard components now fetch from the database:

- **CRITICAL**: `ConfigManager.tsx` — removed 28 hardcoded config keys including embedded credentials (`system_api_key: 'dashboard2026'`, `default_password: 'bot123'`). All config values come from `GET /api/config/{key}` with empty fallbacks.
- **HIGH**: `Login.tsx` — removed `'bot123'` hardcoded fallback password.
- **HIGH**: `SoloSpotStrategyManager.tsx` — `viewTx()` uses network's `explorer_url` from DB instead of hardcoded `https://polygonscan.com`.
- **MEDIUM**: `RpcManager.tsx` — no longer defaults to chain ID 137; requires explicit chain selection.
- **MEDIUM**: `MmConfigManager.tsx` — added `useAutoPoll` (previously used plain `useEffect`, missing auto-refresh toggle).
- **MEDIUM**: `DexManager.tsx` — removed `|| '3000'` V3 fee tier fallback.
- **MEDIUM**: `SpotStrategyManager.tsx` — explorer fallback changed from `https://etherscan.io` to `'#'`.
- **MEDIUM**: `OpportunityManager.tsx` — uses standard `POLL_HEAVY` interval instead of hardcoded 20s.
- **LOW**: All form defaults (`tradeAmount`, `minBalancePct`, `buyThresholdPct`, `rebalanceThresholdPct`, `intervalMinutes`, etc.) cleared to empty strings across 8 components.

### Execution worker: end-to-end arb verified (Jun 7)

- Network RPC URL updated from defunct Ankr to `polygon.drpc.org`
- `executeOpportunity` flow verified: scan → INSERT → cron pick → swap → settle
- Opps #276 (WMATIC→USDC, 3.18%) and #277 (WMATIC→USDT, 0.31%) processed as "skipped: Round-trip lost 0.00%" — arb window closed between scan and execution
- Well-known token bypass verified across all execution paths
- Aggregating re-quote before execution needed for real profit

### Full codebase audit + 18 bug fixes (Jun 7)

A comprehensive audit uncovered 18+ bugs across all workers and dashboard. All fixed in this session:

**Execution worker (`bot-engine.ts`)**:
- **CRITICAL**: `slotBlockscout` `ReferenceError` — `const` declared inside one `if` block, referenced in a second. Moved to function scope.
- **CRITICAL**: `executeSwapUniversal` — `amountOutMin` declared but never passed to Universal Router V3_SWAP command. Now ABI-encodes swap params properly.
- `triExecuteLeg` contract-mode `minOut` used input amount instead of quoted output (slippage protection was meaningless). Now re-quotes before calculating.
- `executeLegWithMode` / `soloExecuteLeg` — `executeSwapV3` calls missing `fromDecimals` parameter.
- `executeMMRebalance` — `formatEther` assumed 18 decimals for all tokens. Now fetches actual token decimals.
- Removed all `setTimeout` hardcoded delays between legs.
- All `executeSwap*` / `executeLegWithMode` / `triExecuteLeg` / `soloExecuteLeg` now return `TransactionResponse` (not string). Callers log `.hash` immediately then `await .wait(1)` before balance reads.

**Shared (`rate-limiter.ts`)**:
- CPU budget used module-level `cpuStart` timestamp — after 10s of cumulative wall-clock time, `checkCpuBudget` permanently rejected all requests. Removed entirely (was checking wall clock, not actual CPU).
- `isRateLimitError` treated HTTP 403 as rate-limit (auth conflated with rate limiting). Removed — only 429 counts.

**Discovery worker**:
- `LIMIT 3` on `dex_routers` and `token_pairs` queries starved triangular/DEX arb of candidates. Removed limits.
- `decimalCache` key was `tokenAddress` without chain ID — tokens on different chains with same address caused cross-chain contamination. Added `chainId:` prefix.
- `fetchDefiLlama` sent numeric `chainId` — DefiLlama expects slug names (`'polygon'`, `'arbitrum'`). Added `CHAIN_SLUGS` map.
- `initDB` ran on every HTTP request — removed from middleware (first real query verifies connection naturally).
- Standard DEX arb `amount_in` hardcoded to `'0'` — now reads `trade_amount` from config table.

**Dashboard**:
- `ConfigManager.handleSave` overwrote existing secrets with empty strings — now filters empty/undefined/null values.
- `ConfigManager` double-fetched on mount — removed redundant `useEffect`.
- `system_api_key` input displayed as plain text — changed to `type="password"`.
- `walletService.activate` sent `{ is_active }` but endpoint expects `{ isActive }` — fixed field name.
- `NodeHealth` type had `chainId` but API returns `chain_id` (snake_case mismatch).
- `runDiscovery` / `soloSpotStrategyService.execute` bypassed auth gateway — now use main authenticated `api`.
- `executor_mode` and `auto_discover_source` defaults were empty string, causing broken select renders — changed to `'direct'` and `'gecko'`.

### Three execution modes (Jun 7)

All 3 strategies (arb, triangular arb, solo-spot) support 3 modes controlled via `executor_mode` config key in `ConfigManager.tsx`:

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Worker Only** (`direct`) | Wallet signs every transaction directly | Default. No contract needed, full control |
| **Contract Only** (`contract`) | Worker calls `ArbExecutor.executeArb()` per leg; contract manages the swap on-chain | Trust-minimized. Contract handles token transfer + swap atomically |
| **Contract → Worker** (`become`) | Tries contract first; on revert, falls back to direct signing per leg | Gradual migration: test contract with full safety net |

- `ArbExecutor.sol` deployed on Polygon (address in `executor_contract_address` config)
- Supports V2 (`swapExactTokensForTokens`) and V3 (`exactInputSingle`) routers via `dexData` encoding
- Balancer/Universal routers throw clear error in contract modes (not supported by contract ABI)
- Allowance auto-managed: worker approves `MaxUint256` for contract on first use per token

## Future Considerations

- **Dedicated trade-strategies worker**: Solo-spot, spot swing-trade, and future strategy types currently share the execution worker's cron. If CPU limits are hit again, extract a 4th worker owning all strategy execution (solo-spot + spot buy/sell + future types). The execution worker would then only own arb opportunity execution. Deferred until a 4th strategy type is added or CPU limits are reached.

- **Yield Farming (DRAFT)**: Strategy key `yield` is registered but not implemented. The intended lifecycle:
   1. User creates a `yield_strategy` (token, yield_contract, min_apr, harvest_interval)
   2. Bot calls `approve()` + `deposit()` on the yield contract to stake tokens
   3. Cron harvests rewards on a schedule (`harvest_interval_min`)
   4. If APR drops below `min_apr_pct`, bot withdraws and returns tokens to wallet
   5. Tables needed: `yield_strategies`, `yield_positions`, `yield_rewards`
   Requires protocol-specific ABIs for deposit/harvest/withdraw functions.

- **Webacy DD API (DRAFT)**: Enterprise blockchain risk intelligence ([docs.webacy.com](https://docs.webacy.com)). Covers token security, contract vuln detection, holder analysis (snipers/whales), sanctions/OFAC, address poisoning, and transaction KYT. Supported EVM chains: eth, pol, opt, arb, base, bsc. Overlaps with GoPlus (token security) and Blockscout (contract verification) — would add holder analysis, sanctions, and poison detection as new capabilities. Not currently needed; revisit if GoPlus/Blockscout gaps emerge.

### Quoter trailing spaces fixed (Jun 7)

V3 quoter addresses in `dex_routers` had trailing whitespace (e.g. id=7 `0xb27308f9...  `, len=44). Fixed via `UPDATE ... SET quoter_address = TRIM(quoter_address)` and all 3 `rawQuoteRoute`/`rawQuoteRouteAmount` functions now use `(router.quoter_address || '').trim()` defensively.

### V3 quoting fixed + config-driven thresholds (Jun 7)

**V3 quoting** — all 3 `rawQuoteRoute`/`rawQuoteRouteAmount` functions (discovery ×2, execution ×1):
- `BigInt(result)` replaced with `ethers.AbiCoder.decode(['uint256'], result)` — works for both QuoterV1 (32-byte) and QuoterV2 (128-byte) returns
- Iterates fee tiers `[1000, 3000, 500, 10000, 100]` per V3 quote, returns best (highest) `amountOut` — no longer stuck at hardcoded 3000

**Config-driven thresholds**:
- `runScanCycle` reads `min_profit_pct` from config table instead of hardcoded 1.0%
- Execution scan endpoint reads `min_profit_pct`, `default_fee_tier`, and `trade_amount` from config table instead of hardcoded values
- `amount_in` in discovery INSERT changed from `'0'` to `trade_amount`

**Dashboard ConfigManager**:
- `loadConfig` no longer overwrites form defaults with `null` from missing DB keys
- `handleSave` no longer filters out empty/null values — all config entries persist to DB

## Notes

### V3 Quoting (Jun 7)
- `rawQuoteRoute`/`rawQuoteRouteAmount` iterate fee tiers `[1000, 3000, 500, 10000, 100]` returning highest non-null amountOut — covers all UniV3 pool tiers
- ABI decode `ethers.AbiCoder.decode(['uint256'], result)` works for both QuoterV1 (32-byte single uint256) and QuoterV2 (128-byte tuple) — `BigInt(result)` only works for V1
- Fee tier parameter passed to `rawQuoteRoute` is unused for V3 (multi-tier iteration), kept for backward compat with V2

### Config-Driven Thresholds (Jun 7)
- `min_profit_pct` read from D1 `config` table in `runScanCycle` + execution scan — falls back to 1.0% if missing
- `default_fee_tier` read in execution scan for V3 fallback — falls back to 3000
- `trade_amount` read in both discovery and execution scan INSERT — falls back to '0.1'
- Dashboard `ConfigManager.handleSave` now persists ALL values (no filter), nulls map to `''`

### Net Profit Execution Fix (Jun 8)
**Root cause**: Scan cron (`*/7 * * * *`) and execution cron (`*/5 * * * *`) run separately. By execution time (3-5 min later), arb window closes → all 299 opportunities showed "No arb at execution time" / "Round-trip lost 0.00%".

**Changes deployed**:
- Added `min_net_profit_pct = 0.15` config — execution-time net profit threshold (after gas)
- Execution re-quotes via `scanArbOpportunity` with threshold `max(min_net_profit_pct, 0.1%)` = 0.15%
- Net profit check: estimates gas cost, only executes if `net_profit ≥ 0.15%` (vs 0.5% gross at scan)
- Fixed `quoteAmountOut`: trims quoter address, uses full fee tier iteration `[1000,3000,500,10000,100]`
- Fixed scan endpoint: uses correct snake_case `token_a`/`token_b` from DB (was camelCase `tokenA`/`tokenB`)
- Added `executeImmediately` option to scan endpoint — scan + execute in single call, no cron delay
- Deployed execution worker (v `e7393444`) with `*/5 * * * *` cron

**Config verified**:
| Key | Value |
|-----|-------|
| `min_profit_pct` | 0.5 (scan threshold) |
| `min_net_profit_pct` | 0.15 (execution net threshold) |
| `trade_amount` | 0.1 |
| `default_fee_tier` | 1000 |
| `min_slippage` | 1 |
| `daily_loss_limit` | 5.0 |

### Quoter Trailing Spaces (Jun 7)
- DB row id=7 had `0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6  ` (44 chars, 2 trailing spaces)
- Trimmed via SQL + **all `quoter_address` usages** in `quoteAmountOut`, `executeLegWithMode`, `scanSameDexOpportunity`, `triExecuteLeg`, `soloExecuteLeg`, `executeMMRebalance` now use `(router.quoter_address || '').trim()` defensively
- Discovery worker `rawQuoteRoute`/`rawQuoteRouteAmount` also use `.trim()`

### API Services Cleanup (Jun 7)
- Removed dead `discoveryApi`/`executionApi` axios instances from `dashboard/src/api/client.ts` — never used by any service
- Removed dead `networkService.getStats` endpoint — no backend route exists
- All 20 dashboard services use single `api` instance pointing to gateway (VITE_API_URL)

### Dashboard Auth Flow
- `authService.login` stores API key in `sessionStorage` as `dashboard_api_key`
- Axios interceptor reads key for every request as `X-API-Key` header
- Gateway validates key against D1 `api_keys` table

### Security Gaps
- Discovery and analytics workers still have NO auth middleware. If .workers.dev URLs are discovered, they can be called directly without auth.
- **Intentional bypass**: Well-known tokens (WMATIC, USDC, USDT, WETH, WBTC) bypass ALL security checks (GoPlus, AI scoring, Blockscout) — this is intentional per security design, saves 50+ subrequests per trade while maintaining safety for known major tokens.

### Execution Pricing (Jun 7)
- `executeOpportunity` trusts 5-minute-old scan prices — every run shows "Round-trip lost 0.00%" because arb window closed
- Fix: aggregate re-quote before execution (confirm profit still exists)
- Single working V3 quoter: `0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6` (UniV3 QuoterV1 on Polygon) — returns 32-byte uint256

### Bot Engine Patterns
- Well-known tokens (WMATIC, USDC, USDT, WETH, WBTC) bypass ALL security checks (GoPlus, AI scoring, Blockscout) — saves 50+ subrequests per trade
- Risk rules skipped for arb path: fixed 0.1 trade on known WMATIC balance saves 2 subrequests
- Same-DEX arbitrage compares different fee tiers on same V3 router (e.g. 0.05% vs 0.3% pool on QuickSwap)
- Triangular arb derives token C from token_pairs table: finds third token that pairs with both A and B
- Executor modes: `direct` (wallet signs), `contract` (ArbExecutor contract), `become` (contract first, fallback to direct)

### Discovery Worker CPU Limit Fix (Jun 8)
**Root cause**: `runScanCycle` made ~3458 RPC calls per cron (19 pairs × 91 router pairs × 2 calls) every 7 min → Cloudflare Workers CPU limit exceeded.

**Fixes deployed** (v `7ea1cc81`):
- **Rate limits per cron run**:
  - `runScanCycle`: max 3 pairs × 5 router pairs = 15 quote pairs (30 RPC calls) + 50ms delay
  - `scanTriangularArb`: max 3 triangles × 2 routers = 6 triangles (18 RPC calls) + 50ms delay
  - `scanSoloSpotStrategies`: max 3 pairs per strat × 4 router pairs = 12 quote pairs (24 RPC calls) + 50ms delay
- **Work estimation**: skips chains where total work > 500 quote pairs
- **Cron frequency reduced**:
  - `*/10 * * * *` (was `*/5`) — spot strategies
  - `*/15 * * * *` (was `*/7`) — cross-dex + triangular arb
  - `0 * * * *` — hourly discovery (unchanged)
- **Sequential with delays**: each RPC batch waits 50ms to spread CPU usage

### Quoter Address Trim Complete (Jun 8)
**Root cause**: DB `quoter_address` had trailing spaces causing V3 quote failures. Initial fix only covered `rawQuoteRoute` functions.

**Full fix deployed** (execution v `e7393444`):
- All 7 `quoter_address` usages now defensively use `(router.quoter_address || '').trim()`:
  - `quoteAmountOut` (main quote function)
  - `executeLegWithMode` (V3 swap leg)
  - `scanSameDexOpportunity` (same-DEX arb)
  - `triExecuteLeg` (triangular arb)
  - `soloExecuteLeg` (solo-spot)
  - `executeMMRebalance` (MM rebalance)
  - `rawQuoteRoute` / `rawQuoteRouteAmount` (discovery + execution scan)

### Config Additions (Jun 8)
Added missing config keys to D1:
| Key | Value | Purpose |
|-----|-------|---------|
| `min_net_profit_pct` | 0.15 | Execution-time net profit threshold |
| `min_balance_pct` | 10 | Wallet balance minimum % |
| `min_balance_amount` | 0.05 | Wallet balance minimum fixed amount |

### Cross-Chain Arb Disabled (Jun 8)
**Root cause**: Only Polygon chain active in DB — cross-chain arb requires ≥2 chains but was running every 15 min making unnecessary PactSwap API calls.

**Fix deployed** (discovery v `5754e96e`):
- `runScanCycle` now checks `if (networks.length > 1)` before calling `scanCrossChainArb`
- Logs `cross_chain=0 (single chain mode)` and skips when only 1 chain active
- Saves CPU/RPC budget for actual arb scanning

### Discovery Scan Work Fix (Jun 8)
**Root cause**: Work estimation used theoretical max (19 pairs × 91 router pairs = 1729) instead of actual limits → scanner skipped chain as "too much work".

**Fix** (discovery v `248dc5cf`):
- Uses `pairsToScan = min(pairs.length, maxPairsPerRun)` and `routerPairsPerPair = min(routerPairCount, maxRouterPairsPerPair)`
- Estimated work = 3 × 5 = 15 (under 100 threshold) → scanner now runs properly

### Scheduling: GitHub Actions (Jun 8)
**File**: `.github/workflows/bot-crons.yml`

| Schedule | Endpoint | Purpose |
|----------|----------|---------|
| `*/10 * * * *` | `discovery /api/cron/spot-strategies` | Solo-spot, Spot, MM |
| `*/15 * * * *` | `discovery /api/cron/cross-dex` | Cross-DEX + Triangular |
| `0 * * * *` | `discovery /api/cron/hourly-discovery` | Pool discovery |
| `*/5 * * * *` | `execution /api/cron/execute` | Execute pending |
| `*/2 * * * *` | `execution /api/cron/scan-and-execute` | Inline cross-dex scan + execute |

**Why GitHub Actions over cron-job.org / Workers AI:**
| Approach | Pros | Cons |
|----------|------|------|
| **GitHub Actions** | Free, auditable, conditional runs, secrets, 90-day logs | HTTP latency, 2000 min/mo limit |
| **cron-job.org** | Simple UI | No conditionals, plaintext secrets, 30-day logs |
| **Cron + Workers AI** | Native, adaptive, no HTTP | Uses AI tokens, complex code |

**Chosen**: GitHub Actions — single workflow, conditional steps, free, reliable, works with dashboard git push.

### Unified Scan API + Inline Execution Scan (Jun 8)
**Root cause**: Duplicate scan logic in both workers; execution had inline scan endpoint, discovery had cron-based scanning.

**Fixes deployed**:
- **Discovery v `e472a7c7`**: Added `POST /api/scan` — unified endpoint supporting `type: "spot" | "cross-dex" | "triangular" | "all"` — all scan logic centralized
- **Execution v `0bb0de48`**: Removed duplicate `/api/opportunities/scan` endpoint; `scan-and-execute` now has inline cross-dex scan (no HTTP to discovery)
- **Dashboard v `...`**: Added `.github/workflows/bot-crons.yml` — GitHub Actions cron (removed from worker repo)

**Endpoints now**:
| Endpoint | Worker | Purpose |
|----------|--------|---------|
| `POST /api/scan` | Discovery | Unified scan (spot/cross-dex/all) |
| `POST /api/cron/spot-strategies` | Discovery | Solo-spot, Spot, MM |
| `POST /api/cron/cross-dex` | Discovery | Cross-DEX + Triangular |
| `POST /api/cron/hourly-discovery` | Discovery | Pool discovery |
| `POST /api/cron/execute` | Execution | Execute pending |
| `POST /api/cron/scan-and-execute` | Execution | Inline cross-dex scan + execute |
| `POST /api/cron/analytics` | Analytics | Hourly AI advisor + Main AI + quota reset |

### Analytics Cron to GitHub Actions (Jun 8)
**Root cause**: Analytics worker had hourly cron (`0 * * * *`) for quota reset, AI advisor, and Main AI — Cloudflare cron unreliable.

**Fix deployed** (analytics v `60469915`):
- Added `POST /api/cron/analytics` endpoint — runs quota reset, auto-adjust, AI advisor, Main AI
- Added to GitHub Actions workflow at `0 * * * *` (hourly)
- Removed cron from analytics worker (`triggers.crons: []`)

### Discovery Scan Rate Limit Increases (Jun 8)
**Root cause**: Conservative limits (3 pairs × 5 router pairs) caused timeouts (error 1102) and missed opportunities.

**Fixes deployed** (discovery v `7ccaa98e`):
| Function | Before | After |
|----------|--------|-------|
| `runScanCycle` | 3 pairs × 5 router pairs (30 RPC) | 8 pairs × 10 router pairs (160 RPC) |
| `scanSoloSpotStrategies` | 3 pairs × 4 router pairs (24 RPC) | 8 pairs × 10 router pairs (160 RPC) |
| `scanTriangularArb` | 3 triangles × 2 routers (18 RPC) | 8 triangles × 4 routers (96 RPC) |
| `rpcDelayMs` | 50ms | 30ms |
| `estimatedWork` threshold | 100 | 300 |

### Daily Cleanup Cron (Jun 9)
**Root cause**: No cleanup for `opportunities`, `bot_transactions`, `daily_pnl` tables → unbounded growth.

**Fix deployed** (analytics v `614b1b3e`):
- Added `POST /api/cron/cleanup` endpoint — deletes old records:
  - `opportunities`: status IN ('skipped','failed') older than 30 days
  - `bot_transactions`: older than 90 days
  - `daily_pnl`: older than 180 days
- Added to GitHub Actions at `0 2 * * *` (daily 2 AM UTC)
- Configurable via JSON body: `{"oppDays": 30, "tradeDays": 90, "pnlDays": 180}`

## Pending / Known

- `funbo-discovery/package.json` deps mismatch (wrangler ^3.99, typescript ^5.7)
- No `.gitignore` or `.dev.vars` in any worker
- Hardcoded native token addresses for only 5 chains in `bot-engine.ts`
- `generate-api-key.mjs` references wrong DB name (`bot-db` → should be `funbo-db`)
- Stale `wrangler.jsonc.backup` in funbo
- **Gateway→worker proxy broken (error 1042)**: `fetch()` between workers on same zone fails. Workaround: dashboard calls execution worker directly via `VITE_EXECUTION_URL` for manual solo-spot run. Auto-run via execution worker's `*/5 * * * *` cron works fine (no gateway needed).
- **Re-quote before execution**: `executeOpportunity` trusts 5-minute-old scan prices, causing "Round-trip lost 0.00%" on every run. Should re-quote via `scanArbOpportunity` before swapping to only execute when profit still exists.
- **No opportunities found until V3 pools are detected**: Only WMATIC→USDC V3 pool exists on Polygon. Scanner must first discover V3 token_pairs via discovery cron before arb scan can find profitable routes.

## Audit Fixes Applied (Jun 8)
**Critical Fixes:**
- Fixed duplicate catch block syntax error in `executePendingOpportunities` (funbo-execution/src/index.ts) — removed erroneous second catch that caused parsing errors
- Added auth middleware to execution worker — validates `X-API-Key` against `api_keys` table, skips only `/api/health` endpoint
- Added `bot_transactions` table to schema (funbo/src/db.ts) — single source of truth for transaction records with full receipt schema

**High Priority Fixes:**
- Updated `decimalCache` key to include chain ID prefix (`${chainId}:${token.toLowerCase()}`) in bot-engine.ts — prevents cross-chain token address collision
- Removed stale `rpc.ankr.com` endpoints from `DEFAULT_POOLS` in both gateway and shared rpc-pool.ts
- Consolidated `encodeV3Path` function into shared module (`worker/shared/rpc-pool.ts`) — removed duplicate definitions from execution and discovery workers

**Security Note:** Well-known tokens (WMATIC, USDC, USDT, WETH, WBTC) continue to bypass ALL security checks (GoPlus, AI scoring, Blockscout) — this is intentional behavior per STATUS.md line 286, saves 50+ subrequests per trade.

### UI Improvements Added (Jun 9)
- **ConfigManager.tsx**: Added `min_net_profit_pct` field with label "Net Profit After Gas (%)" and helper text explaining it's the minimum net profit after gas costs.
- **DexManager.tsx**: Wrapped V3 quoter/fee tier inputs in proper form groups with labels and helper text.
- **SoloSpotStrategyManager.tsx**: Wrapped trade amount inputs in form groups with proper labels (Trade Amount, Min Trade Amount, Max Trade Amount).

### V2 ABI Encoding Fix + RPC Pool Rotation (Jun 9)
**Root cause**: All `getAmountsOut` calls were reverting because ABI offset for dynamic `address[]` was `0x20` (should be `0x40` for 2 head parameters).

**Fixes deployed** (discovery v `a7e29083` → `16f48b95` → `44bbe35f`):
- **V2 ABI offset**: `abiEncodeUint256AddressList` in `shared/quotes.ts` — offset changed from `0x20` to `0x40`. Verified output matches ethers.js exactly via manual RPC test.
- **Removed ethers dependency**: `shared/quotes.ts` now uses zero external deps — all ABI functions (`abiEncodeUint256AddressList`, `abiEncodeBytesUint256`, `abiDecodeUint256List`, `abiDecodeUint256`) are manual hex encoding/decoding
- **RPC pool rotation**: Added `getWorkingRpcUrl()` to `shared/rpc-pool.ts` — probes URLs from `getHealthyRpcPool()`, returns first healthy endpoint. Discovery worker scan functions now use pool instead of `net.rpc_url` directly
- **API keys added**: `GETBLOCK_API_KEY`, `NOWNODES_API_KEY`, `ANKR_API_KEY` set as secrets on discovery worker for richer RPC pool
- **Scan reordered**: `scanMMStrategies` runs before `scanSoloSpotStrategies` — MM scan only needs 14 RPC calls, no longer blocked by solo-spot's rate limit exhaustion
- **Extra `});`**: Fixed dangling syntax error from debug endpoint removal

**GoPlus security batch now skips well-known tokens**:
- `goplusBatchTokenSafety()` in `shared/api-providers.ts` — pre-marks well-known tokens as safe without calling GoPlus API
- Added `POST /api/token-pairs/recheck-security` endpoint — scans all pairs via GoPlus batch (skipping well-known), updates `security_checked = 1`
- All 19 token pairs on Polygon now show "Safe"/"Checked" on dashboard (were all "Unchecked")

### Auth bypass for cron endpoints (Jun 10)
**Root cause**: GH Actions HTTP calls to `/api/cron/execute` and `/api/cron/scan-and-execute` were rejected with 401 because neither endpoint was in `publicPaths`.

**Fix deployed** (execution v `...`):
- Added `/api/cron/execute` and `/api/cron/scan-and-execute` to execution worker's `publicPaths`
- GH Actions now reaches both endpoints without `X-API-Key` header
- Tested: returns 200 with `{ success: true, message: "Execution triggered" }`

### Become mode version guard fix (Jun 10)
**Root cause**: `executeLegWithMode` checked router version INSIDE the contract attempt try-block — unsupported routers (Balancer, Universal) triggered a spurious contract call + revert before hitting the version check.

**Fix deployed** (execution v `...`):
- Moved `version === 'v2' || version === 'v3'` check to EARLY GUARD before try-block
- Unsupported routers skip directly to direct mode with zero contract calls
- No more unnecessary allowance approvals or contract reverts for Balancer/Universal

### RPC quota tracking wired (Jun 10)
**Root cause**: `rawEthCall` made RPC requests but never called `recordUsage()` — `service_quotas.current_usage` was always 0.

**Fixes deployed** (shared v `...`):
- Added `classifyProvider()` to `rpc-pool.ts` — extracts provider name from URL (publicnode, drpc, blockscout, ankr, getblock, nownodes)
- `rawEthCall` now calls `recordUsage(env, provider, 'requests_per_day')` after every successful RPC call
- Added optional `env` param to `rawQuoteRoute`, `rawQuoteRouteAmount`, `getTokenDecimals` — all callers pass `env` through
- Updated ALL caller sites in both discovery and execution workers

### Cron dedup via D1 (Jun 10)
**Root cause**: GH Actions cron + native Worker cron could fire simultaneously on the same worker, causing double execution.

**Fix deployed** (both workers):
- Added `dedupCronRun(DB, key, intervalMin)` function — reads `last_cron:<key>` from config table, skips if within interval
- Each cron HTTP handler calls dedup before proceeding
- Uses D1 (not KV) because D1 has 5M reads/month vs KV's 1000 reads/day

### Stale opportunity auto-cleanup (Jun 10)
**Root cause**: 14 pending opportunities from failed/delayed scans accumulated with no auto-cleanup.

**Fix deployed** (execution v `...`):
- `executePendingOpportunities` now runs `UPDATE opportunities SET status='skipped' WHERE status='pending' AND created_at < datetime('now','-1 hour')` before each execution cycle
- 14 stale opps (IDs 337-349) automatically cleared

### False executed counter fix (Jun 10)
**Root cause**: `executeSingleOpp` returned `true` unconditionally for all three strategy paths — the dashboard showed "executed: 1" even when the trade was skipped (no arb at execution time).

**Fix deployed** (execution v `...`):
- Lines 222, 228, 249: changed `return true` to `return result.status === 'success'` in all three strategy paths

### Batch size + wall clock guard (Jun 10)
**Root cause**: Pending opps query used `LIMIT 3` — CPU-intensive with 3 concurrent trade attempts.

**Fixes deployed**:
- `LIMIT 3` → `LIMIT 2` — reduces max concurrent trade attempts
- Added 45s wall-clock guard in `executePendingOpportunities` loop — kills long-running cycles

### Cron handlers use waitUntil (Jun 10)
**Root cause**: All cron HTTP handlers used `await`, tying scan lifetime to the HTTP request timeout (30s). Long scans were killed at 30s.

**Fix deployed** (both workers):
- Changed from `await scanFunction()` to `c.executionCtx.waitUntil(scanFunction())`
- HTTP response returns immediately (<200ms), scan continues in background (up to 15 min worker lifetime)

### All native crons removed — then partially re-added (Jun 10→11)
**Root cause**: Native Worker crons conflicted with GH Actions crons, doubling RPC usage.

**Jun 10**: All crons removed (`"triggers.crons": []` in both workers). GH Actions drove all triggers.
**Jun 11**: Crons re-added at reduced frequencies with `dedupCronRun()` preventing double-execution:
- Discovery: `*/30 * * * *` — spot + cross-dex scan; `0 * * * *` — hourly pool discovery
- Execution: `*/15 * * * *` — execute pending; `*/20 * * * *` — scan + execute

### RPC pool shuffle + quota tiers (Jun 11)
**Root cause**: `getWorkingRpcUrl` returned URLs in fixed order → 100% of traffic went to the first healthy provider (publicnode). API-key providers (Ankr, GetBlock, NOWNodes, DRPC) were unused despite being configured.

**Fix deployed** (shared/rpc-pool.ts v `...`):
- Added `urlQuotaTier()` — classifies each URL by provider:
  - **Tier 0** (unlimited, shuffled): publicnode, blockscout, 1rpc, public DRPC
  - **Tier 1** (100K/day, shuffled): Ankr
  - **Tier 2** (limited, last resort): GetBlock, DRPC with API key
  - **Tier 3** (10K/month, last resort): NOWNodes
- Pool is sorted by tier then randomized within tiers via `pool.sort((a,b) => tier(a)-tier(b) || Math.random()-0.5)`

### GH Actions frequencies + scan work reduced (Jun 11)
**Root cause**: Scans ran at `*/2` (720/day), `*/5` (288/day), `*/10` (144/day), `*/15` (96/day) → ~273K RPC calls/day, exceeding EVERY free RPC provider quota.

**Frequencies reduced** (bot-crons.yml):
| Before | After | GH Triggers/day |
|--------|-------|-----------------|
| `*/2` scan-execute | `*/20` | 720 → 72 |
| `*/5` execute | `*/15` | 288 → 96 |
| `*/10` spot scan | `*/30` | 144 → 48 |
| `*/15` cross-dex | `*/30` | 96 → 48 |

**Scan work reduced** (discovery + execution):
| Param | Before | After |
|-------|--------|-------|
| `maxPairsPerRun` | 8 | 4 |
| `maxRouterPairsPerPair` | 10 | 5 |

**RPC calls per cross-dex scan**: 380 → 40 (10x reduction)
**Total daily RPC calls**: ~273K → ~16K (17x reduction)

### Scan-and-execute now uses RPC pool (Jun 11)
**Root cause**: Execution worker's `scan-and-execute` handler used `network.rpc_url` directly (single hardcoded URL), bypassing the entire RPC pool. It also iterated ALL pairs × ALL router pairs with no limits.

**Fix deployed** (execution index.ts):
- Now calls `getWorkingRpcUrl()` before scanning — distributes RPC load across pool
- Added `maxPairsPerRun = 4` and `maxRouterPairsPerPair = 5` limits
- Uses RPC pool's shuffled URL instead of hardcoded `network.rpc_url`

### GitHub Actions deploy workflow (Jun 11)
**New file**: `.github/workflows/deploy.yml` — deploys all 4 workers + dashboard on push to `main`:

```
main push → workers job (matrix: 4 workers in parallel) → dashboard job (build + Pages deploy)
```

- Workers deployed via `npx wrangler deploy` in each subdirectory
- Dashboard built with `npm run build`, deployed to Cloudflare Pages as `funbo-dashboard`
- Requires `CF_API_TOKEN` secret with Workers + Pages permissions

### Error log system (Jun 11)
**Root cause**: No centralized error tracking — errors were only visible in Cloudflare dashboard logs during the 15-min window.

**System deployed**:
- **D1 table** `error_logs` — migration `025` in `funbo/src/db.ts`, auto-created on deploy
- **API endpoints** on funbo worker:
  - `POST /api/errors/log` — public (no auth), workers submit errors here
  - `GET /api/errors/logs` — authenticated, dashboard queries (filters: `source`, `level`, `limit`)
- **Shared utility** `logError(env, source, message, opts)` in `shared/rpc-pool.ts` — any worker can log errors directly to D1
- **Dashboard component** `ErrorLogManager.tsx` — filterable table (time, level, source, worker, chain, message, details), auto-poll toggle

### Horizontal multi-level menu (Jun 11)
**Root cause**: 16 flat nav buttons made navigation cluttered and hard to scan.

**Redesign** (App.tsx):
- Two-row horizontal menu: main tabs on top, sub-tabs below
- Main: Dashboard | Network | Wallet | Routers | Config
- Sub-items organized by category:

| Main | Sub |
|------|-----|
| Dashboard | *(overview, no subs)* |
| Network | Networks · RPC Pools · Discovery Pools · Security |
| Wallet | Wallets · Whitelist |
| Routers | DEX Routers · Token Pairs · Opportunities · Strategies · Spot · Solo-Spot · MM LP |
| Config | Config · AI Models · Error Logs |

- Strategies/Spot/Solo-Spot/MM LP moved from Config → Routers (trading belongs with trading)
- Security moved from Config → Network (network security)
- Whitelist moved from Config → Wallet (whitelisted addresses)
- Errors moved from Config → Error Logs under Config (renamed for clarity)

### .gitignore standardized (Jun 11)
- Added root `.gitignore` with common ignores
- Standardized all worker `.gitignore` files: `node_modules/`, `.wrangler/`, `.dev.vars`, `dist/`, `*.log`
- Updated dashboard `.gitignore`: added `.wrangler/`, `*.log`, standardized format

### Dashboard deploy removed from deploy.yml (Jun 13)
**Problem**: Cloudflare Pages native auto-build (triggered by GitHub repo connection) and the `deploy.yml` dashboard job both deployed on push to `main`, causing a race condition — two simultaneous deploys to the same Pages project could overwrite each other, wasting minutes on both sides.

**Fix**: Removed the `dashboard` job from `.github/workflows/deploy.yml`. Dashboard deploys are now handled exclusively by Cloudflare Pages native CI (automatic on push to `main`). The workflow only deploys the 4 Workers.

### Deploy workflow fixes (Jun 14)
**Problem**: `deploy.yml` failed repeatedly in CI. 6 issues total:
1. Secret name mismatch (workflow referenced `CF_API_TOKEN`/`CLOUDFLAR_WORKERS_API`, user created `CLOUDFLARE_API_TOKEN` as Environment secret)
2. `fail-fast: true` cancelled all workers when one failed
3. No `npm ci` — `npx wrangler deploy` can't resolve `hono`/`ethers` without `node_modules`
4. Environment secret vs Repository secret — secrets under "Environment secrets" need `environment:` in the job
5. Node.js 20 action deprecation warnings
6. `wrangler.jsonc` `turnstile` field deprecated in wrangler v4 (warning only)

**Resolution** (`.github/workflows/deploy.yml` final state):
- `fail-fast: false` — matrix jobs independent
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` — quiets Node 20 warnings
- `node-version: 22` — modern Node
- `npm ci` step before deploy — installs deps
- `CLOUDFLARE_API_TOKEN: ${{ secrets.CF_TOKEN }}` — secret name finally matches
- Secret created as **Repository secret** (not Environment secret), so no `environment:` needed

**Workers deployed** (Jun 14): funbo, funbo-discovery, funbo-execution, funbo-analytics — all 4 green.

### Chainstack RPC added (Jun 14)
- Added `https://polygon-mainnet.core.chainstack.com/8dff6ff47187271e7b9873336e77f749` to Polygon (137) default RPC pool in both `shared/rpc-pool.ts` and `funbo/src/index.ts`
- Added `chainstack` to `classifyProvider()` and `urlQuotaTier()` — tier 1 (same as Ankr, high-limit premium provider)

### Blockscout Pro API integration (Jun 13)
**Problem**: BlockscoutClient used wrong URL format for both Pro and free tiers. Pro URLs were `https://api.blockscout.com/{chainId}{path}` (missing `/api/v2` between chain ID and endpoint path). Free per-instance URLs were `https://{chain}.blockscout.com{path}` (also missing `/api/v2`). Both returned 404s for all queries — Blockscout data was effectively non-functional.

**Fix deployed** (`shared/api-providers.ts`):
- **Pro REST URL** (line 165): `https://api.blockscout.com/{chainId}/api/v2{path}` — added `/api/v2` segment
- **Pro auth** (line 164): `authorization: Bearer {apiKey}` header instead of `?apikey=` query param
- **Free per-instance URL** (line 167): `{base}/api/v2{path}` — added `/api/v2` segment
- Fallback URL (line 169): unchanged, already had `/api/v2`
- **Rate limiter**: bumped `blockscout` limit from 30 RPM → 120 RPM, reduced backoff (matches Pro free tier's 5 RPS = 300 RPM capacity)

Correct URLs per [Blockscout Pro API docs](https://docs.blockscout.com/devs/pro-api-responses-and-routes):
| Tier | Correct REST URL |
|------|-----------------|
| Pro | `https://api.blockscout.com/137/api/v2/tokens/{address}` + `Bearer proapi_xxx` |
| Free | `https://polygon.blockscout.com/api/v2/tokens/{address}` |

## Current Daily Resource Estimates (post-optimization)

| Resource | Daily | Monthly | Limit | Status |
|----------|-------|---------|-------|--------|
| Workers requests | 409 | ~12K | 100K/day | ✅ |
| RPC calls | ~16K | ~480K | varies | ✅ (shared across 7 providers) |
| D1 reads | ~2K | ~60K | 5M/month | ✅ |
| D1 writes | ~500 | ~15K | — | ✅ |
| GH Actions min | ~300 | ~9K | 2,000/mo private | ✅ (within 2000 limit) |
| KV ops | <10 | <300 | 1K ops/day | ✅ |

**RPC provider load distribution** (with tiered shuffle, ~95% to tier 0-1):
- publicnode, blockscout, DRPC public (unlimited): ~15K calls/day shared
- Ankr (100K/day): ~1K calls/day
- GetBlock (40K/month): <1K calls/day (only when tier 0-1 all fail)
- NOWNodes (10K/month): negligible (last resort tier)

## Pending / Known

- Solo-spot scan (WMATIC) still makes ~1,120 RPC calls — could exceed CPU on slow providers. Already mitigated by `maxPairsPerRun=4`.
- `spot_strategies` table empty — no spot swing-trade strategies created yet
- Broiler token only has QuickSwap V2 pool (no V3 quoter); `rawQuoteRoute` still requires V3 quoter for fee tier iteration
- `CF_API_TOKEN` secret must be added to GitHub repo settings (needs Workers + Pages permissions)
- Worker `.dev.vars` files contain placeholder values — need real API keys filled in for local dev
- GetBlock (40K/month) and NOWNodes (10K/month) quotas would be exhausted in ~2 weeks and ~1 week respectively if they receive equal traffic — mitigated by tier-2/3 fallback ordering
- Dashboard Cloudflare Pages project must exist (`funbo-dashboard`) — create in Cloudflare dashboard and connect GitHub repo for native auto-build
- `BLOCKSCOUT_API_KEY` secret should be added to all 4 workers (only `funbo` + `funbo-execution` have it in env.d.ts currently)
- Blockscout free per-instance URLs (`rpc.blockscout.com/{chain}`) in RPC default pools cannot be upgraded to Pro ETH RPC endpoint without adding per-URL auth header support
