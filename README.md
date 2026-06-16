# EVM Trading Bot

Multi-chain arbitrage trading bot with a Cloudflare Worker backend and React dashboard. Configure everything dynamically — networks, DEX routers, wallets, and bot parameters — with no code changes needed.

## Architecture

```
evm-bots/
├── worker/              Cloudflare Worker (Hono + D1) — bot engine + REST API
│   ├── src/
│   │   ├── index.ts         Hono app, CRUD routes, cron handler
│   │   ├── bot-engine.ts    Arb scanner, safety checks, swap execution
│   │   ├── ai-advisor.ts    Workers AI — strategy + config suggestions
│   │   ├── notifier.ts      Discord / Telegram / Email alerts
│   │   ├── db.ts            D1 schema init, key hashing, trade logging
│   │   └── env.d.ts         TypeScript bindings
│   ├── schema.sql           D1 table definitions
│   ├── seed.sql             Default config values + API key
│   └── wrangler.jsonc       Cloudflare config (D1, cron, AI, email)
│
└── dashboard/          Vite + React + Tailwind dashboard (Cloudflare Pages)
    ├── functions/api/[[path]].ts    Proxies /api/* to Worker
    ├── public/_redirects            SPA fallback
    └── src/
        ├── api/client.ts            Axios + X-API-Key interceptor
        └── components/              Login, Dashboard, Network, Dex,
                                     Wallet, Config managers
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare account](https://dash.cloudflare.com/) with D1 database + Workers AI
- An EVM private key (for the wallet that executes swaps)
- RPC URLs for the chains you want to trade on

## Setup

### 1. Worker (deploy locally)

```bash
cd worker
npm install

# Create D1 database
npx wrangler d1 create bot-db
# → Copy database_id into wrangler.jsonc

# Set required secrets
npx wrangler secret put PRIVATE_KEY

# Optional secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put BLOXROUTE_RPC_URL
npx wrangler secret put GOPLES_API_KEY

# Seed database
npm run seed

# Deploy
npx wrangler deploy
```

### 2. Dashboard (Cloudflare Pages — auto-deploys from GitHub)

```bash
cd dashboard
npm install
npm run dev     # local dev with Vite proxy to local Worker
```

1. Push repo to GitHub
2. Connect to Cloudflare Pages (build: `npm run build`, output: `dist`)
3. Update `functions/api/[[path]].ts` with your Worker URL
4. Push → auto-deploys

### 3. Login

Enter the default API key: **`admin123`**

Replace it before production:
```bash
cd worker
npm run generate-key     # outputs a secure key + hash
# Then delete admin123:
npx wrangler d1 execute bot-db --command "DELETE FROM api_keys WHERE key_hash = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';"
```

## Bot Config (all managed from dashboard)

| Key | Default | Description |
|-----|---------|-------------|
| `auto_scan_enabled` | `true` | Toggle automated scanning |
| `scan_interval_minutes` | `5` | Min between scans (cron fires every 1min) |
| `min_profit_pct` | `1.5` | Minimum profit % to execute |
| `max_profit_pct` | `20.0` | Max profit % to execute (upper bound filter) |
| `max_trade_decimals` | `3` | Truncate amount to N decimals |
| `min_slippage` | `0.5` | Min slippage floor — bot auto-detects optimal slippage, clamped to at least this |
| `daily_loss_limit` | `5.0` | Circuit breaker — stops if daily loss exceeds |
| `mm_rebalance_threshold` | `5.0` | LP rebalance threshold |
| `trade_token_a` | — | Token A address for arb pairs |
| `trade_token_b` | — | Token B address for arb pairs |
| `trade_amount` | `0.1` | Trade amount in native token |

### Notifications

| Key | Default | Description |
|-----|---------|-------------|
| `notify_urgent` | `discord,telegram` | Channels for circuit breaker alerts |
| `notify_average` | `discord` | Channels for AI suggestions (1/hr max) |
| `notify_normal` | `discord` | Channels for daily summary (1/24hr) |
| `discord_webhook_url` | — | Discord webhook URL |
| `telegram_chat_id` | — | Numeric chat ID |
| `telegram_username` | — | @username fallback |
| `notify_email_from` | — | Sender email (needs Cloudflare Email domain) |
| `notify_email_to` | — | Recipient email |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/networks` | List all networks |
| POST | `/api/networks` | Add network |
| DELETE | `/api/networks/:chainId` | Deactivate network |
| GET | `/api/routers` | List DEX routers |
| POST | `/api/routers` | Add router |
| DELETE | `/api/routers/:id` | Remove router |
| GET | `/api/wallets` | List wallets |
| POST | `/api/wallets` | Add wallet |
| PATCH | `/api/wallets/:id` | Toggle active |
| DELETE | `/api/wallets/:id` | Remove wallet |
| GET | `/api/config` | List config |
| GET | `/api/config/:key` | Get config value |
| POST | `/api/config` | Set config value |
| GET | `/api/trades` | Trade history |
| POST | `/api/bot/run` | Trigger manual scan |
| GET | `/api/bot/status` | Auto-scan toggle + last scan |

All requests require `X-API-Key` header.

## AI Advisor

After each scan, the bot feeds recent trades + PnL + config to **Llama 3 (Workers AI)**. The AI returns suggestions stored as `ai_suggest_*` config keys:

- Strategy switches (arb ↔ mm ↔ yield)
- Config tweaks (min/max profit, slippage, decimals)
- Security flags

View suggestions: `SELECT * FROM config WHERE key LIKE 'ai_suggest_%';`

## Notification Levels

| Level | Throttle | Triggers | Default channels |
|-------|----------|----------|-----------------|
| Urgent | Instant | Circuit breaker | discord, telegram |
| Average | 1 hour | AI suggestions | discord |
| Normal | 24 hours | Daily summary | discord |

## Cron Schedule

Cron fires every minute (`* * * * *`). The `scan_interval_minutes` config (default 5) controls actual scan frequency — configurable from dashboard without redeploying.

## Safety Features

- **Token safety scan** — GoPlus honeypot/tax/blacklist check
- **Router verification** — validates DEX router bytecode
- **MEV risk check** — mempool sandwich/frontrun detection
- **Circuit breaker** — stops trading when daily loss exceeds limit
- **Per-wallet balance rules** — minimum balance enforcement
- **Max profit ceiling** — skips suspiciously profitable opportunities

## Deployment

```bash
# Worker
cd worker
npx wrangler deploy

# Dashboard — push to GitHub, Pages auto-deploys
git add . && git commit -m "update" && git push
```
