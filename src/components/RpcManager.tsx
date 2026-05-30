import { useState, useEffect } from 'react';
import { rpcPoolService, networkService } from '../api/client';
import { Plus, Trash2, Loader2 } from 'lucide-react';

export function RpcManager() {
  const [rpcPools, setRpcPools] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ chainId: '', url: '', priority: '0' });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [poolsRes, networksRes] = await Promise.all([
        rpcPoolService.list(),
        networkService.list()
      ]);
      setRpcPools(poolsRes.data);
      setNetworks(networksRes.data);
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

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">RPC Pools</h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add RPC Endpoint</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <select
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required
          >
            <option value="">Select Chain</option>
            {networks.map((n: any) => (
              <option key={n.chain_id} value={n.chain_id}>{n.name} (ID: {n.chain_id})</option>
            ))}
          </select>
          <input placeholder="RPC URL (https://...)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
            value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} required />
          <input placeholder="Priority (0=high)" type="number" min="0"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} />
          <button type="submit"
            className="md:col-span-3 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add RPC Pool
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">RPC Endpoints by Network</h3>
        {loading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : rpcPools.length === 0 ? (
          <p className="text-gray-500">No RPC pools configured. Add endpoints for redundancy.</p>
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