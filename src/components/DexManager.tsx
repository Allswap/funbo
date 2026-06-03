import { useState } from 'react';
import { routerService } from '../api/client';
import { Plus, Trash2, Loader2, RefreshCw, Power } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function DexManager() {
  const [routers, setRouters] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', address: '', chainId: '', version: 'v2', quoterAddress: '', feeTiers: '', poolId: '' });

  const fetchRouters = async () => {
    try {
      const res = await routerService.list();
      setRouters(res.data);
    } catch (err) {
      console.error("Failed to fetch routers", err);
    }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchRouters, POLL_HEAVY);

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
      if (form.version === 'balancer') {
        payload.feeTiers = form.poolId || '';
      }
      await routerService.add(payload);
      alert('DEX Router Added!');
      setForm({ name: '', address: '', chainId: '', version: 'v2', quoterAddress: '', feeTiers: '', poolId: '' });
      refetch();
    } catch (err: any) {
      alert(`Failed to add router: ${err.response?.data?.error || err.message || 'Unknown error'}`);
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this DEX router?')) return;
    try {
      await routerService.remove(id);
      refetch();
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
          <input placeholder="Name (e.g. Uniswap V3, Balancer Vault)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />

          <div className="flex gap-2">
            {['v2', 'v3', 'balancer', 'universal'].map(v => (
              <button key={v} type="button" onClick={() => setForm({ ...form, version: v, quoterAddress: '', feeTiers: '', poolId: '' })}
                className={`flex-1 py-2 px-4 rounded font-bold text-sm transition-colors ${form.version === v ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {v === 'balancer' ? 'BALANCER' : v === 'universal' ? 'UNIVERSAL' : v.toUpperCase()}
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
              <input placeholder="Fee Tiers (e.g. 500,3000 or 0.05,0.3,1.0)"
                className="p-3 bg-gray-800 rounded border border-purple-700 focus:border-purple-400 outline-none font-mono text-sm"
                value={form.feeTiers} onChange={e => setForm({ ...form, feeTiers: e.target.value })} />
              <span className="text-xs text-purple-400 col-span-full">Accept decimal (0.05=500, 0.3=3000, 1.0=10000) or raw basis points</span>
            </>
          )}

          {form.version === 'balancer' && (
            <>
              <input placeholder="Pool ID (e.g. 0x...)"
                className="p-3 bg-gray-800 rounded border border-orange-700 focus:border-orange-400 outline-none font-mono text-sm"
                value={form.poolId} onChange={e => setForm({ ...form, poolId: e.target.value })} required />
              <span className="text-xs text-orange-400 col-span-full">Balancer v2 uses Vault system. Pool ID is required (find on analytics.balancer.fi)</span>
            </>
          )}

          {form.version === 'universal' && (
            <span className="text-xs text-blue-400 col-span-full">Uniswap Universal Router - uses V2+V3 pools internally. No quoter needed.</span>
          )}

          {form.version === 'v2' && (
            <span className="text-xs text-gray-500 col-span-full">Standard V2 router (Uniswap V2, SushiSwap, etc.)</span>
          )}

          <button type="submit"
            className="md:col-span-3 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Router
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Configured Routers</h3>
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
