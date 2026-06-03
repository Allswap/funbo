import { useState } from 'react';
import { tokenPairService, networkService } from '../api/client';
import { Plus, Trash2, Loader2, Repeat, RefreshCw, Power } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function TokenPairManager() {
  const [pairs, setPairs] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [form, setForm] = useState({ chainId: '', tokenA: '', tokenB: '', label: '' });

  const fetchData = async () => {
    try {
      const [pairsRes, networksRes] = await Promise.all([
        tokenPairService.list(),
        networkService.list()
      ]);
      setPairs(pairsRes.data);
      setNetworks(networksRes.data);
    } catch (err) {
      console.error("Failed to fetch data", err);
    }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchData, POLL_HEAVY);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await tokenPairService.add({
        chainId: parseInt(form.chainId),
        tokenA: form.tokenA,
        tokenB: form.tokenB,
        label: form.label
      });
      alert('Token Pair Added!');
      setForm({ chainId: '', tokenA: '', tokenB: '', label: '' });
      refetch();
    } catch (err) {
      alert('Failed to add token pair');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this token pair?')) return;
    try {
      await tokenPairService.remove(id);
      refetch();
    } catch (err) {
      alert('Failed to remove token pair');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Repeat size={24} /> Token Pairs
      </h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Token Pair</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required
          >
            <option value="">Select Chain</option>
            {networks.map((n: any) => (
              <option key={n.chain_id} value={n.chain_id}>{n.name} (ID: {n.chain_id})</option>
            ))}
          </select>
          <input placeholder="Label (optional)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
          <input placeholder="Token A Address (0x...)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
            value={form.tokenA} onChange={e => setForm({ ...form, tokenA: e.target.value })} required />
          <input placeholder="Token B Address (0x...)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
            value={form.tokenB} onChange={e => setForm({ ...form, tokenB: e.target.value })} required />
          <button type="submit"
            className="md:col-span-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Token Pair
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Configured Pairs</h3>
          <div className="flex gap-2">
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
        ) : pairs.length === 0 ? (
          <p className="text-gray-500">No token pairs configured. Bot will use config-defined tokens if empty.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Chain</th>
                  <th className="p-3">Label</th>
                  <th className="p-3">Token A</th>
                  <th className="p-3">Token B</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono">{p.chain_id}</td>
                    <td className="p-3">{p.label || '-'}</td>
                    <td className="p-3 font-mono text-xs text-gray-400 truncate max-w-[120px]">{p.token_a?.slice(0,6)}…{p.token_a?.slice(-4)}</td>
                    <td className="p-3 font-mono text-xs text-gray-400 truncate max-w-[120px]">{p.token_b?.slice(0,6)}…{p.token_b?.slice(-4)}</td>
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
