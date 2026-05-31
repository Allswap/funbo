import { useState, useEffect } from 'react';
import { networkService } from '../api/client';
import { Plus, Trash2, Loader2, CheckCircle, XCircle } from 'lucide-react';

export function NetworkManager() {
  const [networks, setNetworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ chainId: '', name: '', rpcUrl: '', explorerUrl: '' });

  const fetchNetworks = async () => {
    setLoading(true);
    try {
      const res = await networkService.list();
      setNetworks(res.data);
    } catch (err) {
      console.error("Failed to fetch networks", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchNetworks(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await networkService.add({
        chainId: parseInt(form.chainId),
        name: form.name,
        rpcUrl: form.rpcUrl,
        explorerUrl: form.explorerUrl || undefined
      });
      alert('Network Added!');
      setForm({ chainId: '', name: '', rpcUrl: '', explorerUrl: '' });
      fetchNetworks();
    } catch (err: any) {
      alert(`Failed to add network: ${err.response?.data?.error || err.message || 'Unknown error'}`);
    }
  };

  const handleRemove = async (chainId: number) => {
    if (!confirm('Deactivate this network?')) return;
    try {
      await networkService.remove(chainId);
      fetchNetworks();
    } catch (err) {
      alert('Failed to remove network');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Manage Networks</h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add New Network</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input placeholder="Chain ID (e.g. 137)" type="number"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required />
          <input placeholder="Name (e.g. Polygon)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="RPC URL (https://...)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.rpcUrl} onChange={e => setForm({ ...form, rpcUrl: e.target.value })} required />
          <input placeholder="Explorer URL (optional)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.explorerUrl} onChange={e => setForm({ ...form, explorerUrl: e.target.value })} />
          <button type="submit"
            className="md:col-span-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Network
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Active Networks</h3>
        {loading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : networks.length === 0 ? (
          <p className="text-gray-500">No networks added yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Chain ID</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">RPC URL</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {networks.map((net) => (
                  <tr key={net.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono">{net.chain_id}</td>
                    <td className="p-3">{net.name}</td>
                    <td className="p-3 font-mono text-sm text-gray-400 truncate max-w-xs">{net.rpc_url}</td>
                    <td className="p-3">
                      {net.is_active ? (
                        <span className="flex items-center gap-1 text-success text-sm">
                          <CheckCircle size={16} /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-gray-500 text-sm">
                          <XCircle size={16} /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {net.is_active && (
                        <button onClick={() => handleRemove(net.chain_id)}
                          className="text-danger hover:text-red-400" title="Deactivate">
                          <Trash2 size={18} />
                        </button>
                      )}
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
