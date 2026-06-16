import { useState } from 'react';
import { rpcPoolService, networkService, quotaService, api } from '../api/client';
import { Plus, Trash2, Loader2, RefreshCw, ShieldAlert, Activity, Power } from 'lucide-react';
import type { NodeHealth } from '../api/types';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function RpcManager() {
  const [rpcPools, setRpcPools] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [health, setHealth] = useState<NodeHealth[]>([]);
  const [form, setForm] = useState({ chainId: '', url: '', priority: '0' });

  const fetchPools = async () => {
    try {
      const [poolsRes, networksRes] = await Promise.all([
        rpcPoolService.list(),
        networkService.list(),
      ]);
      setRpcPools(poolsRes.data);
      setNetworks(networksRes.data);
    } catch (err) {
      console.error("Failed to fetch pools/networks", err);
    }
  };

  const fetchHealth = async () => {
    try {
      const res = await api.get('/api/nodes/health');
      const hd = Array.isArray(res.data) ? res.data : [];
      setHealth(hd);
    } catch (err) {
      console.error("Failed to fetch health", err);
    }
  };

  const { loading: poolsLoading, isPolling: poolsPolling, refetch: refetchPools, togglePolling: togglePools } = useAutoPoll(fetchPools, POLL_HEAVY);
  const { isPolling: healthPolling, refetch: refetchHealth, togglePolling: toggleHealth } = useAutoPoll(fetchHealth, { ...POLL_HEAVY, interval: 20000 });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await rpcPoolService.add({
        chainId: parseInt(form.chainId),
        url: form.url,
        priority: parseInt(form.priority)
      });
      alert('RPC Pool Added!');
      setForm({ chainId: '', url: '', priority: '0' });
      refetchPools();
    } catch (err) {
      alert('Failed to add RPC pool');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this RPC pool?')) return;
    try {
      await rpcPoolService.remove(id);
      refetchPools();
    } catch (err) {
      alert('Failed to remove RPC pool');
    }
  };

  const handlePreset = async () => {
    const chainId = parseInt(form.chainId);
    if (!chainId) return alert('Select a chain first');
    if (!confirm('Add default multichain RPC pool for this chain?')) return;
    try {
      const { data } = await rpcPoolService.preset(chainId);
      if (data.success) alert(`Added ${data.added} of ${data.total} default endpoints.`);
      else alert(data.error || 'Failed to load presets');
      refetchPools();
    } catch {
      alert('Failed to load presets');
    }
  };

  const handleCheckAll = async () => {
    const chainId = parseInt(form.chainId);
    if (!chainId) return alert('Select a chain first');
    try {
      await rpcPoolService.check(chainId);
      refetchHealth();
    } catch {
      alert('Health check failed');
    }
  };

  const handleAutoAdjust = async () => {
    try {
      await quotaService.adjust();
      alert('Quotas auto-adjusted');
    } catch {
      alert('Failed to adjust quotas');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">RPC Pools</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-dark p-6 rounded-lg border border-gray-800">
          <h3 className="text-lg font-semibold mb-4">Add RPC Endpoint</h3>
          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Chain</label>
              <select
                className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required
              >
                <option value="">Select Chain</option>
              {networks.map((n: any) => (
                <option key={n.chain_id} value={n.chain_id}>{n.name} (ID: {n.chain_id})</option>
              ))}
            </select>
            </div>
            <input placeholder="RPC URL (https://...)"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
              value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} required />
            <input placeholder="Priority (0=high)" type="number" min="0"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} />
            <div className="flex gap-2">
              <button type="submit"
                className="flex-1 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
                <Plus size={20} /> Add
              </button>
              <button type="button" onClick={handlePreset}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded">
                Load Default Pool
              </button>
            </div>
          </form>
        </div>

        <div className="bg-dark p-6 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Monitor</h3>
            <div className="flex gap-2">
              <button onClick={toggleHealth}
                className={`flex items-center gap-2 font-bold py-2 px-3 rounded text-sm ${
                  healthPolling ? 'bg-success hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}>
                <Power size={16} />
                {healthPolling ? 'Health Auto' : 'Health Manual'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleCheckAll}
              className="flex items-center justify-center gap-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded">
              <Activity size={18} /> Check All Nodes
            </button>
            <button onClick={handleAutoAdjust}
              className="flex items-center justify-center gap-2 bg-success hover:bg-green-600 text-white font-bold py-3 rounded">
              <RefreshCw size={18} /> Auto-Adjust Limits
            </button>
          </div>
          {health.length > 0 && (
            <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
              <h4 className="text-sm text-gray-400 mb-2">Latest Health</h4>
              {health.slice(0, 10).map((h, i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 bg-gray-800 rounded">
                  <span className="font-mono text-gray-400 truncate w-1/2">{h.url}</span>
                  <span className={`px-2 py-1 rounded ${h.status === 1 ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                    {h.status === 1 ? 'OK' : 'ERR'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">RPC Endpoints by Network</h3>
          <div className="flex gap-2">
            <button onClick={refetchPools} disabled={poolsLoading}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
              {poolsLoading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              Manual Refresh
            </button>
            <button onClick={togglePools}
              className={`flex items-center gap-2 font-bold py-2 px-4 rounded ${
                poolsPolling ? 'bg-success hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}>
              <Power size={18} />
              {poolsPolling ? 'Auto ON' : 'Auto OFF'}
            </button>
          </div>
        </div>
        {poolsLoading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : rpcPools.length === 0 ? (
          <div className="flex items-center gap-2 text-gray-500">
            <ShieldAlert size={18} />
            <p>No RPC pools configured. Select a chain and click "Load Default Pool" for redundancy.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Chain</th>
                  <th className="p-3">URL</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {rpcPools.map((p) => (
                  <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono">{p.chain_id}</td>
                    <td className="p-3 font-mono text-xs text-gray-400 truncate max-w-xs">{p.url}</td>
                    <td className="p-3">{p.priority}</td>
                    <td className="p-3">
                      <button onClick={() => handleRemove(p.id)}
                        className="text-danger hover:text-red-400" title="Remove">
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
