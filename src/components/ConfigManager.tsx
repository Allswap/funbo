import { useState } from 'react';
import { configService, tradeService } from '../api/client';
import { Save, AlertTriangle, Play, Pause, RefreshCw, Power } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function ConfigManager() {
  const [config, setConfig] = useState({
    min_profit_pct: '',
    max_profit_pct: '',
    min_net_profit_pct: '',
    max_trade_decimals: '',
    daily_loss_limit: '',
    min_slippage: '',

    auto_scan_enabled: 'false',
    notify_urgent: '',
    notify_average: '',
    notify_normal: '',
    discord_webhook_url: '',
    telegram_chat_id: '',
    notify_email_from: '',
    notify_email_to: '',
    telegram_username: '',
    scan_interval_minutes: '',
    default_fee_tier: '',
    protected_rpc_pool: '',
    blockscout_api_key: '',
    system_api_key: '',
    default_password: '',
    auto_discover_enabled: 'false',
    auto_discover_source: 'gecko',
    auto_discover_interval: '',
    executor_contract_address: '',
    executor_mode: 'direct',
  });
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadConfig = async () => {
    const keys = Object.keys(config);
    try {
      const results = await Promise.all([
        ...keys.map(key =>
          configService.get(key).then(res => ({ key, value: res.data.value }))
        ),
        tradeService.getStatus().then(res => ({ key: 'status', value: res.data })).catch(() => null),
      ]);
      const newConfig: any = {};
      results.forEach(r => {
        if (!r) return;
        if (r.key === 'status') {
          setLastScan(r.value.last_auto_scan);
          newConfig.auto_scan_enabled = r.value.auto_scan_enabled ? 'true' : 'false';
        } else if (r.value !== null && config[r.key as keyof typeof config] !== undefined) {
          newConfig[r.key as keyof typeof config] = r.value;
        }
      });
      setConfig(prev => ({ ...prev, ...newConfig }));
    } catch (err) {
      console.error("Failed to load config", err);
    }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(loadConfig, POLL_HEAVY);



  const handleChange = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const SECRET_KEYS = ['system_api_key', 'default_password', 'blockscout_api_key'];

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(config)
          .filter(([key, value]) => !(SECRET_KEYS.includes(key) && (!value || value === '')))
          .map(([key, value]) => configService.set(key, value ?? ''))
      );
      alert('Configuration saved!');
      await refetch();
    } catch (err) {
      alert('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const isAutoScan = config.auto_scan_enabled === 'true';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Bot Safety & Config</h2>
        <div className="flex gap-2">
          <button onClick={togglePolling}
            className={`flex items-center gap-2 font-bold py-2 px-4 rounded ${
              isPolling ? 'bg-success hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}>
            <Power size={18} />
            {isPolling ? 'Auto Reload ON' : 'Auto Reload OFF'}
          </button>
          <button onClick={refetch} disabled={loading}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
            {loading ? <RefreshCw className="animate-spin" size={18} /> : <RefreshCw size={18} />}
            Reload Config
          </button>
          <button onClick={handleSave} disabled={saving}
            className="bg-success hover:bg-green-600 text-white font-bold py-2 px-6 rounded flex items-center gap-2">
            <Save size={18} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="md:col-span-2 bg-darker p-4 rounded border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {isAutoScan ? <Play size={20} className="text-success" /> : <Pause size={20} className="text-gray-500" />}
              <h3 className="font-bold text-lg">Auto-Scan</h3>
            </div>
            <button onClick={() => handleChange('auto_scan_enabled', isAutoScan ? 'false' : 'true')}
              className={`relative w-12 h-6 rounded-full transition-colors ${isAutoScan ? 'bg-success' : 'bg-gray-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${isAutoScan ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Scan Interval (minutes)</label>
              <input type="number" min="1" max="60" value={config.scan_interval_minutes}
                onChange={e => handleChange('scan_interval_minutes', e.target.value)}
                className="w-full p-2 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none text-sm" />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {isAutoScan ? `Bot scans every ${config.scan_interval_minutes || 5} minutes` : 'Manual mode — use Run Bot Scan on Dashboard'}
          </p>
          {lastScan && <p className="text-xs text-gray-500 mt-1">Last scan: {(() => { try { return new Date(lastScan).toLocaleString(); } catch { return 'Invalid date'; } })()}</p>}
        </div>

        <div className="md:col-span-2 bg-darker p-4 rounded border border-danger/30">
          <div className="flex items-center gap-2 text-warning mb-2">
            <AlertTriangle size={20} />
            <h3 className="font-bold text-lg">Circuit Breaker (Critical)</h3>
          </div>
          <label className="block text-sm text-gray-400 mb-2">Daily Loss Limit (%)</label>
          <input type="number" step="0.1" value={config.daily_loss_limit}
            onChange={e => handleChange('daily_loss_limit', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-danger outline-none" />
          <p className="text-xs text-gray-500 mt-1">
            <span className="text-danger font-bold">STOP</span> trading immediately if daily loss exceeds this %.
          </p>
        </div>

        <div className="md:col-span-2 bg-darker p-4 rounded border border-blue-900/50">
          <h3 className="font-bold text-lg text-blue-400 mb-3">Notifications</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Urgent Channels</label>
              <input value={config.notify_urgent}
                onChange={e => handleChange('notify_urgent', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-blue-400 outline-none" />
              <p className="text-xs text-gray-500 mt-1">Comma-separated: discord,telegram,email</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Average Channels</label>
              <input value={config.notify_average}
                onChange={e => handleChange('notify_average', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-blue-400 outline-none" />
              <p className="text-xs text-gray-500 mt-1">Throttled to once per hour</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Normal Channels</label>
              <input value={config.notify_normal}
                onChange={e => handleChange('notify_normal', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-blue-400 outline-none" />
              <p className="text-xs text-gray-500 mt-1">Daily summary, once per 24h</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Discord Webhook URL</label>
              <input value={config.discord_webhook_url}
                onChange={e => handleChange('discord_webhook_url', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-blue-400 outline-none font-mono text-xs" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Telegram Chat ID</label>
              <input value={config.telegram_chat_id}
                onChange={e => handleChange('telegram_chat_id', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-blue-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Telegram @Username</label>
              <input value={config.telegram_username}
                onChange={e => handleChange('telegram_username', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-blue-400 outline-none" />
              <p className="text-xs text-gray-500 mt-1">Set TELEGRAM_BOT_TOKEN as Worker secret. Uses Chat ID first, falls back to username.</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Email From</label>
              <input value={config.notify_email_from}
                onChange={e => handleChange('notify_email_from', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-blue-400 outline-none" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Email To</label>
              <input value={config.notify_email_to}
                onChange={e => handleChange('notify_email_to', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-blue-400 outline-none" />
              <p className="text-xs text-gray-500 mt-1">Requires Cloudflare Email Sending domain</p>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Min Profit (%)</label>
          <input type="number" step="0.1" value={config.min_profit_pct}
            onChange={e => handleChange('min_profit_pct', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none" />
          <p className="text-xs text-gray-500 mt-1">Minimum gross profit required to execute.</p>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Net Profit After Gas (%)</label>
          <input type="number" step="0.01" value={config.min_net_profit_pct}
            onChange={e => handleChange('min_net_profit_pct', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none" />
          <p className="text-xs text-gray-500 mt-1">Minimum net profit after gas costs. Bot skips trades where net profit under threshold.</p>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Max Profit (%)</label>
          <input type="number" step="0.1" value={config.max_profit_pct}
            onChange={e => handleChange('max_profit_pct', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-warning outline-none" />
          <p className="text-xs text-gray-500 mt-1">Skip opportunities above this profit %.</p>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Max Trade Decimals</label>
          <input type="number" min="0" max="18" value={config.max_trade_decimals}
            onChange={e => handleChange('max_trade_decimals', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none" />
          <p className="text-xs text-gray-500 mt-1">Truncate trade amount to N decimal places (e.g. 6.1234567 → 6.123).</p>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Min Slippage (%)</label>
          <input type="number" step="0.1" value={config.min_slippage}
            onChange={e => handleChange('min_slippage', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none" />
          <p className="text-xs text-gray-500 mt-1">
            <span className="text-primary font-bold">Auto-Detect Mode</span>: Bot calculates optimal slippage,
            clamped to at least this floor. Skipped if liquidity too thin.
          </p>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Default Fee Tier (V3)</label>
          <input type="number" min="1" value={config.default_fee_tier}
            onChange={e => handleChange('default_fee_tier', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none" />
          <p className="text-xs text-gray-500 mt-1">Default V3 pool fee in hundredths of a basis point (500=0.05%, 3000=0.3%, 10000=1%).</p>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm text-gray-400 mb-2">Protected RPC Pool</label>
          <input value={config.protected_rpc_pool}
            onChange={e => handleChange('protected_rpc_pool', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs" />
          <p className="text-xs text-gray-500 mt-1">
            Protected/MEV-safe RPCs tried first for every chain. Comma-separated.
            Pool priority: protected RPCs → explicit URL → per-chain pools → hardcoded defaults → API providers.
          </p>
        </div>

        <div className="md:col-span-2 bg-darker p-4 rounded border border-primary/30">
          <h3 className="font-bold text-lg text-primary mb-3">Blockscout PRO API</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">API Key (optional)</label>
              <input type="password" value={config.blockscout_api_key || ''}
                onChange={e => handleChange('blockscout_api_key', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
                placeholder="proapi_xxxxxxxx" />
              <p className="text-xs text-gray-500 mt-1">Get your free API key at <a href="https://dev.blockscout.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">dev.blockscout.com</a>. Enables PRO API access with higher rate limits.</p>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 bg-darker p-4 rounded border border-warning/30">
          <h3 className="font-bold text-lg text-warning mb-3">System Credentials</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Default API Key</label>
              <input type="password" value={config.system_api_key || ''}
                onChange={e => handleChange('system_api_key', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-warning outline-none font-mono text-xs"
                placeholder="(set via config)" />
              <p className="text-xs text-gray-500 mt-1">API key used by /api/setup-key and /api/login-password.</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Default Password</label>
              <input type="password" value={config.default_password || ''}
                onChange={e => handleChange('default_password', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-warning outline-none font-mono text-xs"
                placeholder="(set via config)" />
              <p className="text-xs text-gray-500 mt-1">Password used for /api/login-password fallback.</p>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 bg-darker p-4 rounded border border-purple-900/50">
          <h3 className="font-bold text-lg text-purple-400 mb-3">Executor & Auto-Discovery</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Executor Contract Address</label>
              <input value={config.executor_contract_address || ''}
                onChange={e => handleChange('executor_contract_address', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-purple-400 outline-none font-mono text-xs"
                placeholder="0x..." />
              <p className="text-xs text-gray-500 mt-1">ArbExecutor.sol address on Polygon. Leave empty for worker-only mode.</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Executor Mode</label>
              <select value={config.executor_mode}
                onChange={e => handleChange('executor_mode', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-purple-400 outline-none">
                <option value="direct">Worker Only (wallet signs tx directly)</option>
                <option value="contract">Contract Only (ArbExecutor.sol handles swap)</option>
                <option value="become">Contract → Worker (try contract, fallback to direct)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                <span className="text-purple-400">Worker Only</span> — Worker signs directly via its wallet key.<br />
                <span className="text-purple-400">Contract Only</span> — Worker calls ArbExecutor contract which executes the swap on-chain.<br />
                <span className="text-purple-400">Contract → Worker</span> — Tries contract first; if it reverts, falls back to direct signing.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Auto-Discover</label>
              <select value={config.auto_discover_source}
                onChange={e => handleChange('auto_discover_source', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-purple-400 outline-none">
                <option value="gecko">Gecko Terminal</option>
                <option value="defillama">DefiLlama</option>
                <option value="dexscreener">DexScreener</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Interval (min)</label>
              <input type="number" min="10" max="1440" value={config.auto_discover_interval}
                onChange={e => handleChange('auto_discover_interval', e.target.value)}
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-purple-400 outline-none" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={config.auto_discover_enabled === 'true'}
                  onChange={e => handleChange('auto_discover_enabled', e.target.checked ? 'true' : 'false')}
                  className="w-4 h-4" />
                Enabled
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
