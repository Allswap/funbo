import { useState, useEffect } from 'react';
import { rpcPoolService, networkService } from '../api/client';
import { Plus, Trash2, Loader2, RefreshCw, ShieldAlert, Activity } from 'lucide-react';
import type { NodeHealth } from '../api/types';

export function RpcManager() {
  const [rpcPools, setRpcPools] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [health, setHealth] = useState<NodeHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ chainId: '', url: '', priority: '0' });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [poolsRes, networksRes, healthRes] = await Promise.all([
        rpcPoolService.list(),
        networkService.list(),
        fetch('/api/nodes/health', { headers: { 'X-API-Key': sessionStorage.getItem('dashboard_api_key') || '' } }),
      ]);
      const hd = healthRes.ok ? await healthRes.json() : [];
      setRpcPools(poolsRes.data);
      setNetworks(networksRes.data);
      setHealth(Array.isArray(hd) ? hd : []);
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

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
      fetchData();
    } catch (err) {
      alert('Failed to add RPC pool');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this RPC pool?')) return;
    try {
      await rpcPoolService.remove(id);
      fetchData();
    } catch (err) {
      alert('Failed to remove RPC pool');
    }
  };

  const handlePreset = async () => {
    const chainId = parseInt(form.chainId);
    if (!chainId) return alert('Select a chain first');
    if (!confirm('Add default multichain RPC pool for this chain?')) return;
    try {
      const res = await fetch('/api/nodes/preset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': sessionStorage.getItem('dashboard_api_key') || '',
        },
        body: JSON.stringify({ chainId }),
      });
      const data = await res.json();
      if (data.success) alert(`Added ${data.added} of ${data.total} default endpoints.`);
      else alert(data.error || 'Failed to load presets');
      fetchData();
    } catch {
      alert('Failed to load presets');
    }
  };

  const handleCheckAll = async () => {
    const chainId = parseInt(form.chainId) || 137;
    try {
      await fetch('/api/nodes/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': sessionStorage.getItem('dashboard_api_key') || '',
        },
        body: JSON.stringify({ chainId }),
      });
      fetchData();
    } catch {
      alert('Health check failed');
    }
  };

  const handleAutoAdjust = async () => {
    try {
      await fetch('/api/quotas/adjust', {
        method: 'POST',
        headers: {
          'X-API-Key': sessionStorage.getItem('dashboard_api_key') || '',
        },
      });
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
            <select
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required
            >
              <option value="">Select Chain</option>
              {networks.map((n: any) => (
                <option key={n.chain_id} value={n.chain_id}>{n.name} (ID: {n.chain_id})</option>
              ))}
            </select>
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
          <h3 className="text-lg font-semibold mb-4">Monitor</h3>
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
        <h3 className="text-lg font-semibold mb-4">RPC Endpoints by Network</h3>
        {loading ? (
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
