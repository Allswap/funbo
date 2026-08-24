const MIGRATIONS = [
  { id: '001_add_dex_routers_version', sql: `ALTER TABLE dex_routers ADD COLUMN version TEXT DEFAULT 'v2';` },
  { id: '002_add_dex_routers_quoter', sql: `ALTER TABLE dex_routers ADD COLUMN quoter_address TEXT;` },
  { id: '003_add_dex_routers_fee_tiers', sql: `ALTER TABLE dex_routers ADD COLUMN fee_tiers TEXT;` },
  { id: '004_add_trades_gas', sql: `ALTER TABLE trades ADD COLUMN gas_spent REAL;` },
  { id: '005_add_wallets_max_balance', sql: `ALTER TABLE wallets ADD COLUMN max_balance_pct REAL;` },
  { id: '006_add_opportunities_executed_at', sql: `ALTER TABLE opportunities ADD COLUMN executed_at DATETIME;` },
  { id: '007_add_quotas_usage', sql: `ALTER TABLE service_quotas ADD COLUMN current_usage INTEGER DEFAULT 0;` },
  { id: '008_add_quotas_last_reset', sql: `ALTER TABLE service_quotas ADD COLUMN last_reset INTEGER DEFAULT 0;` },
  { id: '009_add_quotas_window', sql: `ALTER TABLE service_quotas ADD COLUMN window_seconds INTEGER DEFAULT 86400;` },
  { id: '010_add_discovery_pools', sql: `CREATE TABLE IF NOT EXISTS discovery_pools (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, api_url TEXT NOT NULL, api_key_ref TEXT, interval_minutes INTEGER DEFAULT 60, source_type TEXT DEFAULT 'gecko', is_active BOOLEAN DEFAULT 1, last_run DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);` },
  { id: '011_add_token_pairs_security', sql: `ALTER TABLE token_pairs ADD COLUMN security_checked INTEGER DEFAULT 0;` },
  { id: '012_add_token_pairs_security_info', sql: `ALTER TABLE token_pairs ADD COLUMN security_info TEXT;` },
  { id: '013_add_token_pairs_dex_label', sql: `ALTER TABLE token_pairs ADD COLUMN dex_label TEXT;` },
  { id: '014_dedup_trade_strategies', sql: `DELETE FROM trade_strategies WHERE id NOT IN (SELECT MIN(id) FROM trade_strategies GROUP BY key);` },
  { id: '015_add_strategies_unique_index', sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_strategies_key ON trade_strategies(key);` },
  { id: '016_fix_wallets_unique_address_strategy', sql: `CREATE TABLE IF NOT EXISTS wallets_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, address TEXT NOT NULL, chain_id INTEGER, min_balance_pct REAL DEFAULT 0.1, max_balance_pct REAL DEFAULT 50.0, min_balance_amount TEXT, is_active BOOLEAN DEFAULT 1, strategy_type TEXT DEFAULT 'arb', last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(address, strategy_type)); INSERT OR IGNORE INTO wallets_v2 SELECT * FROM wallets; DROP TABLE wallets; ALTER TABLE wallets_v2 RENAME TO wallets;` },
  { id: '017_create_spot_strategies', sql: `CREATE TABLE IF NOT EXISTS spot_strategies (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, stablecoin_address TEXT NOT NULL, router_address TEXT NOT NULL, buy_threshold_pct REAL NOT NULL DEFAULT 5.0, sell_threshold_pct REAL NOT NULL DEFAULT 5.0, trade_amount TEXT NOT NULL DEFAULT '10', reference_price TEXT, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);` },
  { id: '018_create_spot_positions', sql: `CREATE TABLE IF NOT EXISTS spot_positions (id INTEGER PRIMARY KEY AUTOINCREMENT, spot_strategy_id INTEGER NOT NULL, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, stablecoin_address TEXT NOT NULL, router_address TEXT NOT NULL, buy_price TEXT NOT NULL, buy_tx_hash TEXT, amount_bought TEXT NOT NULL, trade_amount_spent TEXT NOT NULL, status TEXT DEFAULT 'open', sell_price TEXT, sell_tx_hash TEXT, profit_pct REAL, bought_at DATETIME DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME);` },
  { id: '019_create_solo_spot_strategies', sql: `CREATE TABLE IF NOT EXISTS solo_spot_strategies (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, trade_amount TEXT NOT NULL DEFAULT '10', is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);` },
  { id: '020_create_solo_spot_trades', sql: `CREATE TABLE IF NOT EXISTS solo_spot_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id INTEGER NOT NULL, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, pair_token_address TEXT NOT NULL, buy_dex TEXT NOT NULL, sell_dex TEXT NOT NULL, buy_price TEXT NOT NULL, sell_price TEXT NOT NULL, amount_in TEXT NOT NULL, amount_out TEXT NOT NULL, net_profit_pct REAL, buy_tx_hash TEXT, sell_tx_hash TEXT, status TEXT DEFAULT 'completed', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);` },
  { id: '021_create_mm_lp_configs', sql: `CREATE TABLE IF NOT EXISTS mm_lp_configs (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, lp_address TEXT, rebalance_threshold_pct REAL NOT NULL DEFAULT 5.0, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);` },
  { id: '022_add_solo_spot_min_max_amount', sql: `ALTER TABLE solo_spot_strategies ADD COLUMN min_trade_amount TEXT; ALTER TABLE solo_spot_strategies ADD COLUMN max_trade_amount TEXT;` },
  { id: '023_add_mm_ref_price_trade_amount', sql: `ALTER TABLE mm_lp_configs ADD COLUMN reference_price TEXT; ALTER TABLE mm_lp_configs ADD COLUMN trade_amount TEXT DEFAULT '10';` },
  { id: '024_add_opportunities_error_msg', sql: `ALTER TABLE opportunities ADD COLUMN error_msg TEXT;` },
  { id: '025_create_error_logs_table', sql: `CREATE TABLE IF NOT EXISTS error_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'error', message TEXT NOT NULL, details TEXT, chain_id INTEGER, worker TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC); CREATE INDEX IF NOT EXISTS idx_error_logs_source ON error_logs(source);` },
  { id: '026_add_token_pairs_unique_index', sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_token_pairs_chain_ab ON token_pairs(chain_id, token_a, token_b);` },
  { id: '027_seed_networks_config', sql: `INSERT OR IGNORE INTO networks (chain_id, name, rpc_url, explorer_url, is_active) VALUES (137, 'Polygon', 'https://polygon-bor-rpc.publicnode.com', 'https://polygonscan.com', 1); INSERT OR IGNORE INTO config (key, value) VALUES ('min_profit_pct', '0.5'), ('trade_amount', '0.1'), ('default_fee_tier', '3000'), ('min_net_profit_pct', '0.15'), ('min_slippage', '1'), ('daily_loss_limit', '5.0'), ('min_profit_pct_triangular', '0.3');` },
  { id: '028_add_networks_mev_protected_rpc', sql: `ALTER TABLE networks ADD COLUMN mev_protected_rpc TEXT; UPDATE networks SET mev_protected_rpc = 'https://polygon-bor-rpc.publicnode.com' WHERE chain_id = 137;` },
  { id: '029_add_thin_liquidity_pairs', sql: `
    INSERT OR IGNORE INTO token_pairs (chain_id, token_a, token_b, label) VALUES
    (137, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', 'WMATIC/DAI'),
    (137, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', '0xd6df932a45c0f255f85145f286ea0b292b21c90b', 'WMATIC/AAVE'),
    (137, '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', 'ETH/DAI'),
    (137, '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', 'WBTC/USDC.e'),
    (137, '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', 'SUSHI/USDC.e'),
    (137, '0xb33eaad8d922b1083446dc23f610c2567fb5180f', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', 'UNI/USDC.e'),
    (137, '0x7fb688ccf682d58f86d7e38e03f9d22e7705448f', '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', 'CRV/DAI'),
    (137, '0xd93f7e271cb87c23aaa73edc008a79646d1f9912', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', 'SOL/USDC.e'),
    (137, '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', 'SUSHI/WMATIC'),
    (137, '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', 'WBTC/ETH'),
    (137, '0xd6df932a45c0f255f85145f286ea0b292b21c90b', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', 'AAVE/USDC.e'),
    (137, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', 'WMATIC/USDT'),
    (137, '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', 'ETH/USDT');
  ` },
  { id: '030_add_mm_label_column', sql: `ALTER TABLE mm_lp_configs ADD COLUMN label TEXT` },
  { id: '031_seed_brt_mm_modes', sql: `
    INSERT OR IGNORE INTO mm_lp_configs (chain_id, token_address, lp_address, rebalance_threshold_pct, trade_amount, label, is_active) VALUES
    (137, '0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b', '0xc445b18b3ff85e0691fe416ad91e456f8697b166', 2.0, '25', 'BRT-low', 1),
    (137, '0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b', '0xc445b18b3ff85e0691fe416ad91e456f8697b166', 5.0, '120', 'BRT-med', 0),
    (137, '0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b', '0xc445b18b3ff85e0691fe416ad91e456f8697b166', 8.0, '600', 'BRT-high', 0);
  ` },
  { id: '032_seed_brt_config_and_pair', sql: `
    INSERT OR IGNORE INTO config (key, value) VALUES ('mm_brt_mode', 'auto');
    INSERT OR IGNORE INTO token_pairs (chain_id, token_a, token_b, label) VALUES (137, '0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b', '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 'BRT/WPOL');
  ` },
  { id: '033_seed_cron_api_key', sql: `INSERT OR IGNORE INTO api_keys (key_hash, name, permissions, is_active) VALUES ('d2905a0d371561910374f184ef54f3d8462c78d46a5e7fa70d3a615f60e35f66', 'gh-actions-cron', 'read,write', 1);` },
  { id: '034_seed_brt_quote', sql: `
    INSERT OR IGNORE INTO config (key, value) VALUES
      ('brt_quote_mode', 'dry_run'),
      ('brt_quote_band_pct', '0.75'),
      ('brt_quote_max_trade_brt', '10'),
      ('brt_quote_max_trades_per_day', '6'),
      ('brt_quote_cooldown_minutes', '45'),
      ('brt_quote_ref_price', '');
  ` },
];

const TABLE_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS networks (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER UNIQUE NOT NULL, name TEXT NOT NULL, rpc_url TEXT NOT NULL, explorer_url TEXT, is_active BOOLEAN DEFAULT 1, is_private BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS wallets (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, address TEXT NOT NULL, chain_id INTEGER, min_balance_pct REAL DEFAULT 0.1, max_balance_pct REAL DEFAULT 50.0, min_balance_amount TEXT, is_active BOOLEAN DEFAULT 1, strategy_type TEXT DEFAULT 'arb', last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(address, strategy_type));`,
  `CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_label TEXT NOT NULL, chain_id INTEGER NOT NULL, strategy TEXT NOT NULL, token_a TEXT NOT NULL, token_b TEXT NOT NULL, amount_in TEXT NOT NULL, amount_out TEXT NOT NULL, profit_pct REAL, status TEXT NOT NULL, tx_hash TEXT, error_msg TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS bot_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, strategy TEXT NOT NULL, opportunity_id INTEGER, wallet_address TEXT NOT NULL, token_in TEXT NOT NULL, token_out TEXT NOT NULL, amount_in TEXT NOT NULL, amount_out TEXT, amount_in_usd TEXT, amount_out_usd TEXT, tx_hash TEXT NOT NULL, tx_status TEXT NOT NULL, block_number INTEGER, gas_used INTEGER, gas_price_gwei REAL, gas_cost_native TEXT, gas_cost_usd TEXT, logs_json TEXT, error_msg TEXT, confirmed_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, key_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, permissions TEXT DEFAULT 'read,write', is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS external_secrets (key TEXT PRIMARY KEY, provider TEXT NOT NULL, is_active BOOLEAN DEFAULT 1);`,
  `CREATE TABLE IF NOT EXISTS dex_routers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL, chain_id INTEGER NOT NULL, is_active BOOLEAN DEFAULT 1, version TEXT DEFAULT 'v2', quoter_address TEXT, fee_tiers TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS daily_pnl (date TEXT PRIMARY KEY, total_profit_pct REAL DEFAULT 0.0, total_loss_pct REAL DEFAULT 0.0, trade_count INTEGER DEFAULT 0, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS rpc_pools (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER, url TEXT NOT NULL, priority INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS trade_strategies (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, name TEXT NOT NULL, description TEXT, params TEXT, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS ai_configs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, api_key_ref TEXT, params TEXT, is_active BOOLEAN DEFAULT 1, priority INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS security_layers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, provider TEXT NOT NULL, api_key_ref TEXT, params TEXT, is_active BOOLEAN DEFAULT 1, priority INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS token_pairs (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, token_a TEXT NOT NULL, token_b TEXT NOT NULL, label TEXT, is_active BOOLEAN DEFAULT 1, security_checked INTEGER DEFAULT 0, security_info TEXT, dex_label TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS opportunities (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, router_a TEXT, router_b TEXT, token_a TEXT NOT NULL, token_b TEXT NOT NULL, amount_in TEXT NOT NULL, profit_pct REAL, status TEXT DEFAULT 'pending', error_msg TEXT, executed_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS service_quotas (id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT NOT NULL, metric TEXT NOT NULL, limit_value INTEGER NOT NULL, current_usage INTEGER DEFAULT 0, window_seconds INTEGER DEFAULT 86400, UNIQUE(service, metric));`,
  `CREATE TABLE IF NOT EXISTS node_health (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, provider TEXT, chain_id INTEGER, latency_ms INTEGER, status INTEGER DEFAULT 1, last_checked DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS spot_strategies (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, stablecoin_address TEXT NOT NULL, router_address TEXT NOT NULL, buy_threshold_pct REAL NOT NULL DEFAULT 5.0, sell_threshold_pct REAL NOT NULL DEFAULT 5.0, trade_amount TEXT NOT NULL DEFAULT '10', reference_price TEXT, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS spot_positions (id INTEGER PRIMARY KEY AUTOINCREMENT, spot_strategy_id INTEGER NOT NULL, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, stablecoin_address TEXT NOT NULL, router_address TEXT NOT NULL, buy_price TEXT NOT NULL, buy_tx_hash TEXT, amount_bought TEXT NOT NULL, trade_amount_spent TEXT NOT NULL, status TEXT DEFAULT 'open', sell_price TEXT, sell_tx_hash TEXT, profit_pct REAL, bought_at DATETIME DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME);`,
  `CREATE TABLE IF NOT EXISTS solo_spot_strategies (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, trade_amount TEXT NOT NULL DEFAULT '10', is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS solo_spot_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy_id INTEGER NOT NULL, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, pair_token_address TEXT NOT NULL, buy_dex TEXT NOT NULL, sell_dex TEXT NOT NULL, buy_price TEXT NOT NULL, sell_price TEXT NOT NULL, amount_in TEXT NOT NULL, amount_out TEXT NOT NULL, net_profit_pct REAL, buy_tx_hash TEXT, sell_tx_hash TEXT, status TEXT DEFAULT 'completed', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS mm_lp_configs (id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, lp_address TEXT, rebalance_threshold_pct REAL NOT NULL DEFAULT 5.0, is_active BOOLEAN DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS error_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'error', message TEXT NOT NULL, details TEXT, chain_id INTEGER, worker TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`,
];

export async function initDB(env: Env) {
  if (!env['funbo-db']) {
    console.warn("D1 database 'funbo-db' not bound - skipping schema init");
    return;
  }
  const schemaScript = TABLE_SCHEMAS.join('\n');
  try {
    await env['funbo-db'].exec(schemaScript);
  } catch (e) {
    console.error(`Schema initialization failed:`, (e as Error).message);
  }

  await env['funbo-db'].exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);

  // Seed default strategies once
  try {
    const seeded = await env['funbo-db'].prepare("SELECT value FROM config WHERE key = 'strategies_seeded'").first();
    if (!seeded) {
      const defaults = [
        { key: 'arb', name: 'Arbitrage (DEX)', description: 'Cross-DEX arbitrage on same chain' },
        { key: 'triangle', name: 'Triangular Arbitrage', description: '3-token cycle on one DEX' },
        { key: 'crosschain', name: 'Cross-Chain Arbitrage', description: 'Stablecoin spread via PactSwap bridge' },
        { key: 'mm', name: 'Market Making', description: 'Provide liquidity on BroilerPlus LP' },
        { key: 'yield', name: 'Yield Farming', description: '' },
        { key: 'spot', name: 'Dex-Spot Strategy', description: 'Swing-trade a token on a single DEX (buy low, sell high)' },
      ];
      for (const s of defaults) {
        await env['funbo-db'].prepare('INSERT OR IGNORE INTO trade_strategies (key, name, description) VALUES (?, ?, ?)').bind(s.key, s.name, s.description).run();
      }
      await env['funbo-db'].prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('strategies_seeded', '1')").run();
    }
  } catch {}

  for (const m of MIGRATIONS) {
    try {
      const row = await env['funbo-db'].prepare('SELECT id FROM _migrations WHERE id = ?').bind(m.id).first();
      if (!row) {
        try {
          await env['funbo-db'].exec(m.sql);
        } catch (e: any) {
          // If the column/table already exists, mark migration as applied anyway
          const msg = (e.message || '').toLowerCase();
          if (msg.includes('duplicate column') || msg.includes('already exists')) {
            console.warn(`Migration ${m.id} already applied (duplicate), marking as done.`);
          } else {
            throw e;
          }
        }
        await env['funbo-db'].prepare('INSERT INTO _migrations (id) VALUES (?)').bind(m.id).run();
      }
    } catch (e) {
      console.warn(`Migration ${m.id} failed:`, (e as Error).message);
    }
  }
}

export async function hashApiKey(apiKey: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function logTrade(
  db: any,
  walletLabel: string,
  chainId: number,
  strategy: string,
  tokenA: string,
  tokenB: string,
  amountIn: string,
  amountOut: string,
  profitPct: number,
  status: string,
  txHash: string | null,
  errorMsg: string | null
) {
  await db.prepare(`
    INSERT INTO trades (wallet_label, chain_id, strategy, token_a, token_b, amount_in, amount_out, profit_pct, status, tx_hash, error_msg)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    walletLabel, chainId, strategy, tokenA, tokenB, amountIn, amountOut, profitPct, status, txHash, errorMsg
  ).run();
}
