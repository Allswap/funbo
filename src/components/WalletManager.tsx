import { useState } from 'react';
import { walletService } from '../api/client';
import { Plus, RefreshCw, Power, Loader2, Activity } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function WalletManager() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [form, setForm] = useState({
    label: '', address: '', chainId: '',
    strategyType: 'arb',
    minBalancePct: '10', maxBalancePct: '50', minBalanceAmount: '0.05'
  });

  const fetchWallets = async () => {
    try {
      const res = await walletService.list();
      setWallets(res.data);
    } catch (err) {
      console.error("Failed to fetch wallets", err);
    }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchWallets, POLL_HEAVY);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await walletService.add({
        label: form.label, address: form.address,
        chainId: parseInt(form.chainId),
        strategyType: form.strategyType as 'arb' | 'mm' | 'yield',
        minBalancePct: parseFloat(form.minBalancePct),
        maxBalancePct: parseFloat(form.maxBalancePct),
        minBalanceAmount: form.minBalanceAmount
      });
      alert('Wallet Added!');
      setForm({ label: '', address: '', chainId: '', strategyType: 'arb', minBalancePct: '10', maxBalancePct: '50', minBalanceAmount: '0.05' });
      refetch();
    } catch (err) {
      alert('Failed to add wallet');
    }
  };

  const toggleActive = async (id: number, current: boolean) => {
    try {
      await walletService.activate(id, !current);
      refetch();
    } catch (err) {
      alert('Failed to update wallet');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Wallet Management</h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Strategy Wallet</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input placeholder="Label (e.g., BroilerPlus LP)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} required />
          <input placeholder="Wallet Address"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} required />
          <input placeholder="Chain ID (e.g., 137 for Polygon)" type="number"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required />
          <select className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.strategyType} onChange={e => setForm({ ...form, strategyType: e.target.value })}>
            <option value="arb">Arbitrage (High Risk/High Reward)</option>
            <option value="mm">Market Making (BroilerPlus LP)</option>
            <option value="yield">Yield Farming (hNOBT Staking)</option>
          </select>
          <input placeholder="Min Balance % (Safety)" type="number" step="0.1"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.minBalancePct} onChange={e => setForm({ ...form, minBalancePct: e.target.value })} />
          <input placeholder="Max Balance % Per Trade (e.g., 50)" type="number" step="0.1"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.maxBalancePct} onChange={e => setForm({ ...form, maxBalancePct: e.target.value })} />
          <input placeholder="Min Fixed Amount (e.g., 0.05)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.minBalanceAmount} onChange={e => setForm({ ...form, minBalanceAmount: e.target.value })} />
          <button type="submit"
            className="md:col-span-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Wallet
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Active Strategy Wallets</h3>
          <div className="flex gap-2">
            <button onClick={refetch} disabled={loading}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
              {loading ? <Activity className="animate-spin" size={18} /> : <RefreshCw size={18} />}
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
          <div className="flex justify-center text-primary"><Loader2 className="animate-spin" size={24} /></div>
        ) : wallets.length === 0 ? (
          <p className="text-gray-500">No wallets configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Label</th>
                  <th className="p-3">Address</th>
                  <th className="p-3">Strategy</th>
                  <th className="p-3">Chain</th>
                  <th className="p-3">Safety Rules</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((w) => (
                  <tr key={w.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-bold">{w.label}</td>
                    <td className="p-3 font-mono text-sm text-gray-400">
                      {w.address.slice(0, 6)}...{w.address.slice(-4)}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        w.strategy_type === 'mm' ? 'bg-purple-900 text-purple-300' :
                        w.strategy_type === 'yield' ? 'bg-green-900 text-green-300' :
                        'bg-blue-900 text-blue-300'
                      }`}>
                        {w.strategy_type.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-sm">{w.chain_id}</td>
                    <td className="p-3 text-xs text-gray-400">
                      Min: {w.min_balance_pct}% / Max: {w.max_balance_pct || 50}% / Fixed: {w.min_balance_amount}
                    </td>
                    <td className="p-3">
                      {w.is_active ? (
                        <span className="flex items-center gap-1 text-success text-sm">
                          <Activity size={14} /> Active
                        </span>
                      ) : (
                        <span className="text-gray-500 text-sm">Inactive</span>
                      )}
                    </td>
                    <td className="p-3 flex gap-2">
                      <button onClick={() => toggleActive(w.id, w.is_active)}
                        className={`text-xs px-2 py-1 rounded ${
                          w.is_active ? 'bg-gray-700 hover:bg-gray-600' : 'bg-success hover:bg-green-600'
                        }`}>
                        {w.is_active ? 'Deactivate' : 'Activate'}
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
