import { useState, useEffect } from 'react';
import { mmLpConfigService, networkService } from '../api/client';
import { Plus, Trash2, Layers, RefreshCw } from 'lucide-react';

export function MmConfigManager() {
  const [configs, setConfigs] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ chainId: '', tokenAddress: '', lpAddress: '', rebalanceThresholdPct: '5.0' });

  const fetchAll = async () => {
    setError(null);
    try {
      const [cfgRes, netRes] = await Promise.all([
        mmLpConfigService.list(),
        networkService.list(),
      ]);
      setConfigs(cfgRes.data);
      setNetworks(netRes.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load');
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.chainId || !form.tokenAddress) { setError('Chain and Token Address required'); return; }
    try {
      await mmLpConfigService.add({
        chainId: parseInt(form.chainId),
        tokenAddress: form.tokenAddress,
        lpAddress: form.lpAddress || undefined,
        rebalanceThresholdPct: parseFloat(form.rebalanceThresholdPct),
      });
      setForm({ chainId: '', tokenAddress: '', lpAddress: '', rebalanceThresholdPct: '5.0' });
      fetchAll();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to add');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this MM LP config?')) return;
    try {
      await mmLpConfigService.remove(id);
      fetchAll();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to remove');
    }
  };

  const handleToggleActive = async (id: number, current: boolean) => {
    try {
      await mmLpConfigService.update(id, { isActive: !current });
      fetchAll();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to toggle');
    }
  };

  const handleUpdateThreshold = async (id: number, val: string) => {
    try {
      await mmLpConfigService.update(id, { rebalanceThresholdPct: parseFloat(val) });
      fetchAll();
    } catch { }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Layers size={24} /> MM LP Config
      </h2>
      <p className="text-sm text-gray-400">
        Per-token and/or per-LP rebalance thresholds for Market Making strategy.
        Rebalance BroilerPlus LP if deviation exceeds the set percentage.
      </p>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add LP Config</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Chain</label>
            <select className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required>
              <option value="">Select Chain</option>
              {networks.map((n: any) => (
                <option key={n.chain_id} value={n.chain_id}>{n.name} (ID: {n.chain_id})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Token Address</label>
            <input placeholder="0x..." className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
              value={form.tokenAddress} onChange={e => setForm({ ...form, tokenAddress: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">LP Address (optional — leave empty for token-wide)</label>
            <input placeholder="0x... (optional)" className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
              value={form.lpAddress} onChange={e => setForm({ ...form, lpAddress: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Rebalance Threshold (%)</label>
            <input type="number" step="0.1" min="0"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.rebalanceThresholdPct} onChange={e => setForm({ ...form, rebalanceThresholdPct: e.target.value })} />
          </div>
          <button type="submit" className="md:col-span-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add LP Config
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 p-4 rounded-lg">
          {error} <button onClick={() => setError(null)} className="float-right">✕</button>
        </div>
      )}

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">LP Configs ({configs.length})</h3>
          <button onClick={fetchAll} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        {configs.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No LP configs yet. Add one above.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="p-3">Chain</th>
                <th className="p-3">Token</th>
                <th className="p-3">LP</th>
                <th className="p-3">Threshold</th>
                <th className="p-3">Active</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c: any) => (
                <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="p-3 font-mono text-sm">{c.chain_id}</td>
                  <td className="p-3 font-mono text-xs max-w-[150px] truncate" title={c.token_address}>{c.token_address}</td>
                  <td className="p-3 font-mono text-xs max-w-[150px] truncate text-gray-400" title={c.lp_address || ''}>
                    {c.lp_address || <span className="text-gray-600">— (token-wide)</span>}
                  </td>
                  <td className="p-3">
                    <input type="number" step="0.1" min="0"
                      className="w-24 p-1 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none text-sm"
                      value={c.rebalance_threshold_pct}
                      onChange={e => handleUpdateThreshold(c.id, e.target.value)} />
                  </td>
                  <td className="p-3">
                    <button onClick={() => handleToggleActive(c.id, c.is_active)}
                      className={`px-2 py-1 rounded text-xs ${c.is_active ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="p-3">
                    <button onClick={() => handleRemove(c.id)} className="p-2 rounded hover:bg-gray-700 text-danger" title="Remove">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
