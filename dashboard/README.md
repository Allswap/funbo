# EVM Trading Bot — Dashboard

Vite + React + TypeScript + Tailwind dashboard for the EVM arbitrage bot.

## Setup

```bash
npm install
npm run dev
```

Create `.env`:

```
VITE_API_URL=/api
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8787` (local Worker).

## Deployment (Cloudflare Pages)

1. Connect your repo to Cloudflare Pages
2. Build settings:
   - **Build command:** `npm run build`
   - **Build output:** `dist`
3. Update `functions/api/[[path]].ts` with your Worker URL:

   ```ts
   const WORKER_URL = 'https://evm-trading-bot.<your-sub>.workers.dev';
   ```

4. Deploy. The Pages Function forwards all `/api/*` requests to your Worker.

## Build Only

```bash
npm run build
```

Output goes to `dist/`.
