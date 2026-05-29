import { useState, useEffect } from 'react';
import { configService, tradeService } from '../api/client';
import { Save, AlertTriangle, Play, Pause } from 'lucide-react';

export function ConfigManager() {
  const [config, setConfig] = useState({
    min_profit_pct: '1.5',
    max_profit_pct: '20.0',
    max_trade_decimals: '3',
    daily_loss_limit: '5.0',
    min_slippage: '0.5',
    mm_rebalance_threshold: '5.0',
    auto_scan_enabled: 'true',
    notify_urgent: 'discord,telegram',
    notify_average: 'discord',
    notify_normal: 'discord',
    discord_webhook_url: '',
    telegram_chat_id: '',
    notify_email_from: '',
    notify_email_to: '',
    telegram_username: '',
    scan_interval_minutes: '5',
  });
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const keys = Object.keys(config);
    Promise.all([
      ...keys.map(key =>
        configService.get(key).then(res => ({ key, value: res.data.value }))
      ),
      tradeService.getStatus().then(res => ({ key: 'status', value: res.data })).catch(() => null),
    ]).then(results => {
      const newConfig: any = {};
      results.forEach(r => {
        if (!r) return;
        if (r.key === 'status') {
          setLastScan(r.value.last_auto_scan);
          newConfig.auto_scan_enabled = r.value.auto_scan_enabled ? 'true' : 'false';
        } else if (config[r.key as keyof typeof config] !== undefined) {
          newConfig[r.key as keyof typeof config] = r.value;
        }
      });
      setConfig(prev => ({ ...prev, ...newConfig }));
    });
  }, []);

  const handleChange = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(config).map(([key, value]) => configService.set(key, value))
      );
      alert('Configuration saved!');
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
        <button onClick={handleSave} disabled={saving}
          className="bg-success hover:bg-green-600 text-white font-bold py-2 px-6 rounded flex items-center gap-2">
          <Save size={18} /> {saving ? 'Saving...' : 'Save Changes'}
        </button>
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
          {lastScan && <p className="text-xs text-gray-500 mt-1">Last scan: {new Date(lastScan).toLocaleString()}</p>}
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
          <p className="text-xs text-gray-500 mt-1">Minimum profit required to execute.</p>
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
          <label className="block text-sm text-gray-400 mb-2">MM Rebalance Threshold (%)</label>
          <input type="number" step="0.1" value={config.mm_rebalance_threshold}
            onChange={e => handleChange('mm_rebalance_threshold', e.target.value)}
            className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none" />
          <p className="text-xs text-gray-500 mt-1">Rebalance BroilerPlus LP if deviation &gt; X%.</p>
        </div>
      </div>
    </div>
  );
}
