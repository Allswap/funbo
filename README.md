# Funbo — EVM Trading Bot

Multi-strategy arbitrage trading bot on Polygon with Cloudflare Workers backend and React dashboard. Supports solo-spot, triangular, and cross-DEX arbitrage with optional flash loan execution via Aave V3.

## Architecture

```
funbo-repo/
├── worker/
│   ├── funbo/                  Main API + dashboard proxy (Cloudflare Worker)
│   ├── funbo-discovery/        Scanner: finds arb opportunities (spot, cross-dex, triangular)
│   ├── funbo-execution/        Executor: executes pending opportunities
│   ├── funbo-analytics/        Analytics + cleanup cron
│   └── shared/                 Shared code (quotes, RPC pool, token safety, API providers)
│
├── contracts/
│   └── src/FlashLoanArb.sol    Aave V3 flash loan arb contract (deployed on Polygon)
│
├── dashboard/                  Vite + React + Tailwind dashboard (Cloudflare Pages)
│
└── .github/workflows/
    ├── deploy.yml              CI/CD: deploys all workers on push to main
    └── bot-crons.yml           Cron: spot, cross-dex shards, execute, scan-and-execute (every 30m)
```

### Worker URLs

| Worker | URL | Purpose |
|--------|-----|---------|
| funbo | `https://funbo.nobtx-io.workers.dev` | Main API |
| funbo-discovery | `https://funbo-discovery.nobtx-io.workers.dev` | Scanner |
| funbo-execution | `https://funbo-execution.nobtx-io.workers.dev` | Executor |
| funbo-analytics | `https://funbo-analytics.nobtx-io.workers.dev` | Analytics |

## Strategies

| Strategy | Description | Status |
|----------|-------------|--------|
| `solo_spot` | Configured token pairs across routers (via `solo_spot_strategies` table) | ✅ Active |
| `triangular` | Same-DEX 3-leg arb: WPOL→A→B→WPOL on one router | ✅ Active |
| `cross_dex` | Cross-DEX arb: buy on router X, sell on router Y with round-trip verification | ✅ Active |

### Cross-DEX Scanner (Round-Trip Verified)

The scanner quotes A→B on both routers, picks the one giving more B, then verifies the full round-trip (sell B back for A on the other router). Only records if `reverse output > input` — no fake profits.

### Flash Loan Integration

For cross_dex and triangular strategies, the executor first attempts a flash loan path:
1. Borrows from Aave V3 Pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`)
2. Buys token on router A
3. Sells token on router B
4. Repays loan + fee in one atomic tx

Falls back to normal 2-leg swap if flash loan fails.

**Contract:** `0x205d93c618AE9Ce01E963eba6e97d022235dceBe` (verified on PolygonScan)

## Cron Schedule

Managed by **cron-job.org** (external) + **GH Actions** (fallback):

| Cron | Interval | Source | Endpoint |
|------|----------|--------|----------|
| `execute` | 5 min | cron-job.org | `POST /api/cron/execute` |
| `spot_strategies` | 15 min | cron-job.org | `POST /api/cron/spot-strategies` |
| `cross_dex` (×3 shards) | 15 min | cron-job.org | `POST /api/cron/cross-dex` |
| `registry_verify` | 30 min | cron-job.org | `POST /api/cron/registry-verify` |
| `hourly_discovery` | 60 min | cron-job.org | `POST /api/cron/hourly-discovery` |
| `scan_and_execute` | 30 min | GH Actions | `POST /api/cron/scan-and-execute` |

Dedup gates prevent overlapping runs (10-20 min windows per cron key).

## Bot Config (D1 `config` table)

| Key | Default | Description |
|-----|---------|-------------|
| `active_strategies` | `solo_spot,triangular,cross_dex` | Enabled strategies |
| `trade_amount` | `1.0` | Trade size in POL |
| `min_profit_pct` | `0.5` | Minimum gross profit % |
| `max_profit_pct` | `50` | Max profit ceiling |
| `min_net_profit_pct` | `0.1` | Net profit after gas + slippage |
| `min_net_profit_pct_cross_dex` | `0.5` | Net profit threshold for cross-dex |
| `min_net_profit_pct_triangular` | `0.5` | Net profit threshold for triangular |
| `min_net_profit_pct_solo_spot` | `0.1` | Net profit threshold for solo-spot |
| `min_slippage` | `0.5` | Min slippage floor |
| `slippage_buffer_pct` | `1.0` | Sandwich/volatility buffer |
| `lp_fee_pct` | `0.3` | LP fee for slippage calc |
| `scan_cost_buffer_pct` | `2.0` | Min gross spread for scan insertion |
| `max_decimals` | `3` | Truncate trade amount decimals |
| `daily_loss_limit` | `5.0` | Circuit breaker threshold |
| `main_token` | `0x000...1010` | Native POL |
| `wrapped_token` | `0x0d50...1270` | WPOL |

## D1 Database

| Table | Purpose |
|-------|---------|
| `config` | Bot configuration (key-value) |
| `networks` | Chain configs (chain_id, rpc_url, is_active) |
| `dex_routers` | DEX router configs (address, version, quoter, is_active) |
| `token_pairs` | Tradeable pairs (token_a, token_b, is_active) |
| `solo_spot_strategies` | Solo-spot strategy configs (token, trade_amount, thresholds) |
| `opportunities` | Scanner output → executor input (status: pending/executed/failed/skipped) |
| `trades` | Executed trade history |
| `wallets` | Bot wallet addresses |
| `api_keys` | Dashboard auth |

## Supported Routers

| Router | Version | Address |
|--------|---------|---------|
| QuickSwap V2 | v2 | `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff` |
| SushiSwap V2 | v2 | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` |
| Uniswap V2 | v2 | `0xedf6066a2b290C185783862C7F4776A2C8077AD1` |
| QuickSwap V3 | v3 | `0xf5b509bB0909a69B1c207E495f687a596C168E12` |

## Key Token Addresses (Polygon)

| Token | Address |
|-------|---------|
| WPOL | `0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270` |
| USDC | `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359` |
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| WETH | `0x7ceb23fd6bc0add59e62ac25578270cff1b9f619` |
| WBTC | `0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6` |
| BRT (BroilerPuls) | `0xecb4cac0c9e5cbd42a9ed36467ce8f96072ad58b` |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Worker health check |
| GET | `/api/networks` | List networks |
| GET | `/api/routers` | List DEX routers |
| GET | `/api/config` | List config |
| POST | `/api/config` | Set config value |
| GET | `/api/trades` | Trade history |
| POST | `/api/bot/run` | Trigger manual scan |
| GET | `/api/bot/status` | Bot status |
| POST | `/api/cron/execute` | Execute pending opps |
| POST | `/api/cron/spot-strategies` | Run spot scan |
| POST | `/api/cron/cross-dex` | Run cross-dex scan |
| POST | `/api/cron/scan-and-execute` | Combined scan + execute |
| POST | `/api/cron/registry-verify` | Verify router bytecode |

## Safety Features

- **Round-trip verification** — cross-dex scanner verifies full buy→sell cycle before recording
- **Live re-quote** — executor re-checks arb exists at execution time
- **Token safety** — GoPlus honeypot/tax/blacklist scan
- **Circuit breaker** — stops trading on daily loss limit
- **Slippage protection** — live price impact + LP fee + sandwich buffer
- **Max profit ceiling** — skips suspiciously profitable opportunities
- **RPC health** — automatic failover across multiple RPC providers
- **403 blocklist** — RPCs that return errors are temporarily blacklisted

## Deployment

```bash
# Push to main → CI/CD auto-deploys all workers
git add . && git commit -m "feat: ..." && git push origin main

# Manual deploy
cd worker/funbo-discovery && npx wrangler deploy
cd worker/funbo-execution && npx wrangler deploy
```

## Environment Secrets (Cloudflare Workers)

| Secret | Purpose |
|--------|---------|
| `PRIVATE_KEY` | Bot wallet private key |
| `POLYGON_RPC` | Primary RPC URL (Alchemy) |
| `ETHERSCAN_API_KEY` | Contract verification |
| `AI` | Cloudflare Workers AI binding |
| `EMAIL` | Cloudflare Email binding |
