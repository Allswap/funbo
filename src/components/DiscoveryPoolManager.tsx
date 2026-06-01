import { useState, useEffect } from 'react';
import { discoveryPoolService, networkService } from '../api/client';
import { Plus, Trash2, Loader2 } from 'lucide-react';

export function DiscoveryPoolManager() {
  const [pools, setPools] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ chainId: '', apiUrl: '', apiKeyRef: '', intervalMinutes: '60', sourceType: 'gecko' });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [poolsRes, networksRes] = await Promise.all([
        discoveryPoolService.list(),
        networkService.list()
      ]);
      setPools(poolsRes.data);
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
      await discoveryPoolService.add({
        chainId: parseInt(form.chainId),
        apiUrl: form.apiUrl,
        apiKeyRef: form.apiKeyRef || undefined,
        intervalMinutes: parseInt(form.intervalMinutes),
        sourceType: form.sourceType,
      });
      alert('Discovery Pool Added!');
      setForm({ chainId: '', apiUrl: '', apiKeyRef: '', intervalMinutes: '60', sourceType: 'gecko' });
      fetchData();
    } catch (err) {
      alert('Failed to add discovery pool');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this discovery pool?')) return;
    try {
      await discoveryPoolService.remove(id);
      fetchData();
    } catch (err) {
      alert('Failed to remove discovery pool');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Discovery Pools (Auto Token Pair)</h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Discovery Source</h3>
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
          <select
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.sourceType} onChange={e => setForm({ ...form, sourceType: e.target.value })}
          >
            <option value="gecko">Gecko Terminal</option>
            <option value="defillama">DefiLlama</option>
            <option value="onchain">On-Chain (coming soon)</option>
          </select>
          <input placeholder="API URL (auto-filled)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
            value={form.apiUrl} onChange={e => setForm({ ...form, apiUrl: e.target.value })} />
          <input placeholder="Secret Ref (optional)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
            value={form.apiKeyRef} onChange={e => setForm({ ...form, apiKeyRef: e.target.value })} />
          <input placeholder="Interval (min)" type="number" min="10"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.intervalMinutes} onChange={e => setForm({ ...form, intervalMinutes: e.target.value })} />
          <button type="submit"
            className="md:col-span-3 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Discovery Pool
          </button>
        </form>
        <p className="text-xs text-gray-500 mt-2">
          Auto-discovers trending token pairs. Free APIs (Gecko/DefiLlama) don't need API key.
        </p>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Active Discovery Pools</h3>
        {loading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : pools.length === 0 ? (
          <p className="text-gray-500">No discovery pools configured. Add sources for auto token discovery.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Chain</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Interval</th>
                  <th className="p-3">API URL</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p) => (
                  <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono">{p.chain_id}</td>
                    <td className="p-3">{p.source_type}</td>
                    <td className="p-3">{p.interval_minutes}m</td>
                    <td className="p-3 font-mono text-xs truncate max-w-xs">{p.api_url}</td>
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