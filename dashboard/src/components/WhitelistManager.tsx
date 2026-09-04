import { useState } from 'react';
import { configService, networkService } from '../api/client';
import { api } from '../api/client';
import { Plus, Trash2, Loader2, RefreshCw, Power, Shield, CheckCircle, XCircle } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function WhitelistManager() {
  const [configTokens, setConfigTokens] = useState<Record<string, string[]>>({});
  const [networks, setNetworks] = useState<any[]>([]);
  const [form, setForm] = useState({ chainId: '', address: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchData = async () => {
    try {
      const [cfgRes, netsRes] = await Promise.all([
        configService.get('well_known_tokens').catch(() => ({ data: { value: '{}' } })),
        networkService.list()
      ]);
      setNetworks(netsRes.data);
      const raw = cfgRes?.data?.value || '{}';
      try { setConfigTokens(JSON.parse(raw)); } catch { setConfigTokens({}); }
    } catch (err) {
      console.error("Failed to fetch whitelist", err);
    }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchData, POLL_HEAVY);

  const syncNow = async () => {
    setSyncResult(null);
    setSyncing(true);
    try {
      const res = await api.post('/api/executor/sync-approvals');
      setSyncResult(res.data);
    } catch (err) {
      console.error('Failed to sync executor approvals', err);
      setSyncResult({ error: 'sync_failed' });
    } finally {
      setSyncing(false);
    }
  };

  const persist = async (updated: Record<string, string[]>) => {
    setSaving(true);
    setSyncResult(null);
    try {
      await configService.set('well_known_tokens', JSON.stringify(updated));
      setConfigTokens(updated);
      try {
        setSyncing(true);
        const res = await api.post('/api/executor/sync-approvals');
        setSyncResult(res.data);
      } catch (err) {
        console.error('Failed to sync executor approvals', err);
        setSyncResult({ error: 'sync_failed' });
      } finally {
        setSyncing(false);
      }
    } catch (err) {
      alert('Failed to save whitelist');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const chainId = form.chainId;
    const addr = form.address.trim().toLowerCase();
    if (!chainId || !addr) return;
    const updated = { ...configTokens };
    if (!updated[chainId]) updated[chainId] = [];
    if (updated[chainId].includes(addr)) { alert('Token already in whitelist'); return; }
    updated[chainId] = [...updated[chainId], addr];
    await persist(updated);
    setForm({ chainId: '', address: '', label: '' });
  };

  const handleRemove = async (chainId: string, addr: string) => {
    if (!confirm(`Remove ${addr.slice(0, 10)}… from whitelist?`)) return;
    const updated = { ...configTokens };
    updated[chainId] = (updated[chainId] || []).filter(a => a !== addr);
    if (updated[chainId].length === 0) delete updated[chainId];
    await persist(updated);
  };

  const sortedChains = Object.keys(configTokens).sort();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Shield size={24} /> Token Whitelist
      </h2>
      <p className="text-gray-400 text-sm">
        Well-known tokens bypass all security checks (GoPlus, Blockscout, AI risk scoring, router safety).
        Add custom tokens here that you trust. Hardcoded defaults (WMATIC, USDC, USDT, DAI, WETH, WBTC, etc.)
        are always included — no need to add them manually.
      </p>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Custom Whitelist Token</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Chain</label>
            <select
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required
            >
              <option value="">Select Chain</option>
              {networks.map((n: any) => (
                <option key={n.chain_id} value={String(n.chain_id)}>{n.name} (ID: {n.chain_id})</option>
              ))}
            </select>
          </div>
          <input placeholder="Token Address (0x...)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
            value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} required />
          <button type="submit"
            className="bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add to Whitelist
          </button>
        </form>
      </div>

      {(saving || syncing || syncResult) && (
        <div className="bg-dark p-4 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Executor Contract Sync</h3>
            <button onClick={syncNow} disabled={syncing}
              className="flex items-center gap-2 bg-purple-700 hover:bg-purple-600 text-white font-bold py-1 px-3 rounded text-xs disabled:opacity-50">
              {syncing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              Sync Now
            </button>
          </div>
          {saving && <p className="text-sm text-yellow-400">Saving whitelist to D1...</p>}
          {syncing && <p className="text-sm text-yellow-400 flex items-center"><Loader2 className="animate-spin mr-2" size={14} /> Syncing approvals on-chain...</p>}
          {syncResult && !syncing && (
            <div className="text-xs">
              {syncResult.error ? (
                <p className="text-danger flex items-center gap-1"><XCircle size={14} /> Sync failed</p>
              ) : (
                <div>
                  <p className="text-success flex items-center gap-1 mb-1"><CheckCircle size={14} /> Sync complete</p>
                  <pre className="text-gray-400 overflow-auto max-h-40">{JSON.stringify(syncResult.tokens || syncResult, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Custom Whitelisted Tokens</h3>
          <div className="flex gap-2">
            {saving && <span className="text-sm text-yellow-400 flex items-center"><Loader2 className="animate-spin mr-1" size={14} /> Saving...</span>}
            <button onClick={refetch} disabled={loading}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              Manual Refresh
            </button>
            <button onClick={togglePolling}
              className={`flex items-center gap-2 font-bold py-2 px-4 rounded ${
                isPolling ? 'bg-success hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}>
              <Power size={18} />
              {isPolling ? 'Auto ON' : 'Auto OFF'}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : sortedChains.length === 0 ? (
          <p className="text-gray-500">No custom tokens whitelisted. Add tokens above.</p>
        ) : (
          <div className="space-y-4">
            {sortedChains.map(chainId => {
              const net = networks.find((n: any) => String(n.chain_id) === chainId);
              return (
                <div key={chainId} className="border border-gray-700 rounded-lg overflow-hidden">
                  <div className="bg-gray-800 px-4 py-2 font-semibold text-sm flex items-center gap-2">
                    <span className="text-primary">{net?.name || `Chain ${chainId}`}</span>
                    <span className="text-gray-500">(ID: {chainId})</span>
                    <span className="text-gray-500 ml-auto">{configTokens[chainId].length} token{configTokens[chainId].length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-700 text-xs">
                          <th className="p-3">Address</th>
                          <th className="p-3 w-20">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {configTokens[chainId].map(addr => (
                          <tr key={addr} className="border-b border-gray-800 hover:bg-gray-800/50 text-sm">
                            <td className="p-3 font-mono text-xs text-gray-300">{addr}</td>
                            <td className="p-3">
                              <button onClick={() => handleRemove(chainId, addr)}
                                className="text-danger hover:text-red-400" title="Remove">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
