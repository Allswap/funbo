import { useState, useEffect } from 'react';
import { routerService } from '../api/client';
import { Plus, Trash2, Loader2 } from 'lucide-react';

export function DexManager() {
  const [routers, setRouters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', chainId: '', version: 'v2', quoterAddress: '', feeTiers: '' });

  const fetchRouters = async () => {
    setLoading(true);
    try {
      const res = await routerService.list();
      setRouters(res.data);
    } catch (err) {
      console.error("Failed to fetch routers", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRouters(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name: form.name,
        address: form.address,
        chainId: parseInt(form.chainId),
        version: form.version,
      };
      if (form.version === 'v3') {
        payload.quoterAddress = form.quoterAddress;
        payload.feeTiers = form.feeTiers || '3000';
      }
      await routerService.add(payload);
      alert('DEX Router Added!');
      setForm({ name: '', address: '', chainId: '', version: 'v2', quoterAddress: '', feeTiers: '' });
      fetchRouters();
    } catch (err) {
      alert('Failed to add router');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this DEX router?')) return;
    try {
      await routerService.remove(id);
      fetchRouters();
    } catch (err) {
      alert('Failed to remove router');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">DEX Routers</h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add DEX Router</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder="Name (e.g. Uniswap V3)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />

          <div className="flex gap-2">
            {['v2', 'v3'].map(v => (
              <button key={v} type="button" onClick={() => setForm({ ...form, version: v, quoterAddress: '', feeTiers: '' })}
                className={`flex-1 py-2 px-4 rounded font-bold text-sm transition-colors ${form.version === v ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {v.toUpperCase()}
              </button>
            ))}
          </div>

          <input placeholder="Chain ID" type="number"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required />

          <input placeholder="Router Address (0x...)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
            value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} required />

          {form.version === 'v3' && (
            <>
              <input placeholder="Quoter Address (0x...)"
                className="p-3 bg-gray-800 rounded border border-purple-700 focus:border-purple-400 outline-none font-mono text-sm"
                value={form.quoterAddress} onChange={e => setForm({ ...form, quoterAddress: e.target.value })} required />
              <input placeholder="Fee Tiers (e.g. 500,3000,10000)"
                className="p-3 bg-gray-800 rounded border border-purple-700 focus:border-purple-400 outline-none font-mono text-sm"
                value={form.feeTiers} onChange={e => setForm({ ...form, feeTiers: e.target.value })} />
            </>
          )}

          <button type="submit"
            className="md:col-span-3 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Router
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Configured Routers</h3>
        {loading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : routers.length === 0 ? (
          <p className="text-gray-500">No DEX routers configured. Add at least 2 per network for arb scanning.</p>
        ) : (
          <div className="overflow-x-auto">
             <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Name</th>
                  <th className="p-3">Version</th>
                  <th className="p-3">Address</th>
                  <th className="p-3">Chain ID</th>
                  <th className="p-3">Quoter / Fee Tiers</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {routers.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-bold">{r.name}</td>
                    <td className="p-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${(r.version || 'v2') === 'v3' ? 'bg-purple-900/50 text-purple-300' : 'bg-blue-900/50 text-blue-300'}`}>
                        {(r.version || 'v2').toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-sm text-gray-400 truncate max-w-[140px]">{r.address}</td>
                    <td className="p-3 font-mono">{r.chain_id}</td>
                    <td className="p-3 text-xs text-gray-500 truncate max-w-[160px]">
                      {r.version === 'v3' ? `${r.quoter_address?.slice(0, 10)}…` : '-'}
                      {r.fee_tiers ? ` / ${r.fee_tiers}` : ''}
                    </td>
                    <td className="p-3">
                      <span className={`text-sm ${r.is_active ? 'text-success' : 'text-gray-500'}`}>
                        {r.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-3">
                      <button onClick={() => handleRemove(r.id)}
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
