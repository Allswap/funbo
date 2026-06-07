import { useState } from 'react';
import { walletService, strategyService, spotStrategyService, soloSpotStrategyService, networkService } from '../api/client';
import { Plus, RefreshCw, Power, Loader2, Activity, Play } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function WalletManager() {
  const [wallets, setWallets] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [spotStrategies, setSpotStrategies] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: '', address: '', chainId: '',
    strategyType: '',
    minBalancePct: '', maxBalancePct: '', minBalanceAmount: '',
    // Spot strategy fields (shown when strategyType === 'spot')
    tokenAddress: '', stablecoinAddress: '', routerAddress: '',
    buyThresholdPct: '', sellThresholdPct: '', tradeAmount: '',
  });

  const fetchAll = async () => {
    try {
      setError(null);
      const [walRes, strRes, spotRes, netRes] = await Promise.all([
        walletService.list(),
        strategyService.list(),
        spotStrategyService.list(),
        networkService.list(),
      ]);
      setWallets(walRes.data);
      setStrategies(strRes.data);
      setSpotStrategies(spotRes.data);
      setNetworks(netRes.data);
    } catch (err) {
      setError('Failed to fetch data');
      console.error(err);
    }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchAll, POLL_HEAVY);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      await walletService.add({
        label: form.label, address: form.address,
        chainId: parseInt(form.chainId),
        strategyType: form.strategyType,
        minBalancePct: parseFloat(form.minBalancePct),
        maxBalancePct: parseFloat(form.maxBalancePct),
        minBalanceAmount: form.minBalanceAmount,
      });

      if (form.strategyType === 'spot' && form.tokenAddress && form.stablecoinAddress && form.routerAddress) {
        await spotStrategyService.add({
          chainId: parseInt(form.chainId),
          tokenAddress: form.tokenAddress,
          stablecoinAddress: form.stablecoinAddress,
          routerAddress: form.routerAddress,
          buyThresholdPct: parseFloat(form.buyThresholdPct),
          sellThresholdPct: parseFloat(form.sellThresholdPct),
          tradeAmount: form.tradeAmount,
        });
      }

      if (form.strategyType === 'solo_spot' && form.tokenAddress) {
        await soloSpotStrategyService.add({
          chainId: parseInt(form.chainId),
          tokenAddress: form.tokenAddress,
          tradeAmount: form.tradeAmount || '10',
        });
      }

      setForm({
        label: '', address: '', chainId: '', strategyType: '',
        minBalancePct: '', maxBalancePct: '', minBalanceAmount: '',
        tokenAddress: '', stablecoinAddress: '', routerAddress: '',
        buyThresholdPct: '', sellThresholdPct: '', tradeAmount: '',
      });
      refetch();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to add');
    }
  };

  const toggleActive = async (id: number, current: boolean) => {
    try {
      setError(null);
      await walletService.activate(id, !current);
      refetch();
    } catch (err) {
      setError('Failed to update wallet');
    }
  };

  const handleRunStrategy = async (stratId: number) => {
    try {
      setError(null);
      await spotStrategyService.execute(stratId);
      refetch();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to execute strategy');
    }
  };

  const handleToggleSpotActive = async (id: number, current: boolean) => {
    try {
      setError(null);
      await spotStrategyService.update(id, { isActive: !current });
      refetch();
    } catch (err) {
      setError('Failed to toggle auto mode');
    }
  };

  const isSpot = form.strategyType === 'spot';
  const isSoloSpot = form.strategyType === 'solo_spot';

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Wallet Management</h2>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 p-4 rounded-lg flex items-center gap-2">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-200">&times;</button>
        </div>
      )}

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Strategy Wallet</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Label</label>
            <input placeholder="e.g. BroilerPlus LP"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Wallet Address</label>
            <input placeholder="0x..."
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Chain ID</label>
            <input placeholder="e.g. 137 for Polygon" type="number"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Strategy Type</label>
            <select className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.strategyType} onChange={e => setForm({ ...form, strategyType: e.target.value })} required>
            <option value="">Select Strategy</option>
            {strategies.map((s: any) => (
              <option key={s.key} value={s.key}>{s.name}</option>
            ))}
            <option value="spot">⚡ Spot Swing-Trade</option>
            <option value="solo_spot">🔄 Solo-Spot Round-Trip</option>
          </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Min Balance % (Safety)</label>
            <input placeholder="e.g. 10" type="number" step="0.1"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.minBalancePct} onChange={e => setForm({ ...form, minBalancePct: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Max Balance % Per Trade</label>
            <input placeholder="e.g. 50" type="number" step="0.1"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.maxBalancePct} onChange={e => setForm({ ...form, maxBalancePct: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Min Fixed Amount</label>
            <input placeholder="e.g. 0.05"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.minBalanceAmount} onChange={e => setForm({ ...form, minBalanceAmount: e.target.value })} />
          </div>

          {isSpot && (
            <>
              <div className="md:col-span-2 border-t border-gray-700 pt-4 mt-2">
                <p className="text-sm text-primary font-semibold mb-3">⚡ Spot Swing-Trade Configuration</p>
              </div>
              <div>
              <label className="block text-sm text-gray-400 mb-1">Chain</label>
              <select className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                value={form.chainId} disabled>
                <option value="">Chain (from above)</option>
                {networks.map((n: any) => (
                  <option key={n.chain_id} value={n.chain_id}>{n.name} (ID: {n.chain_id})</option>
                ))}
              </select>
              </div>
              <input placeholder="Token Address (token to swing-trade)"
                className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
                value={form.tokenAddress} onChange={e => setForm({ ...form, tokenAddress: e.target.value })} required={isSpot} />
              <input placeholder="Stablecoin Address (e.g. USDC)"
                className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
                value={form.stablecoinAddress} onChange={e => setForm({ ...form, stablecoinAddress: e.target.value })} required={isSpot} />
              <input placeholder="DEX Router Address"
                className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
                value={form.routerAddress} onChange={e => setForm({ ...form, routerAddress: e.target.value })} required={isSpot} />
              <input placeholder="Buy Threshold % (price drop to trigger buy)" type="number" step="0.1"
                className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                value={form.buyThresholdPct} onChange={e => setForm({ ...form, buyThresholdPct: e.target.value })} />
              <input placeholder="Sell Threshold % (price rise to trigger sell)" type="number" step="0.1"
                className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                value={form.sellThresholdPct} onChange={e => setForm({ ...form, sellThresholdPct: e.target.value })} />
              <input placeholder="Trade Amount (stablecoin per swing)" type="number" step="0.1"
                className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                value={form.tradeAmount} onChange={e => setForm({ ...form, tradeAmount: e.target.value })} />
            </>
          )}

          {isSoloSpot && (
            <>
              <div className="md:col-span-2 border-t border-gray-700 pt-4 mt-2">
                <p className="text-sm text-primary font-semibold mb-3">🔄 Solo-Spot Round-Trip Configuration</p>
              </div>
              <input placeholder="Token Address (the token to round-trip on)"
                className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
                value={form.tokenAddress} onChange={e => setForm({ ...form, tokenAddress: e.target.value })} required={isSoloSpot} />
              <input placeholder="Trade Amount (token amount per round-trip)" type="number" step="0.1"
                className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                value={form.tradeAmount} onChange={e => setForm({ ...form, tradeAmount: e.target.value })} />
            </>
          )}

          <button type="submit"
            className="md:col-span-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> {isSpot ? 'Add Wallet + Spot Strategy' : isSoloSpot ? 'Add Wallet + Solo-Spot Strategy' : 'Add Wallet'}
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
                  <th className="p-3">Auto</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((w) => {
                  const relatedSpot = spotStrategies.find((s: any) =>
                    s.chain_id === w.chain_id && s.is_active
                  );
                  return (
                    <tr key={w.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="p-3 font-bold">{w.label}</td>
                      <td className="p-3 font-mono text-sm text-gray-400">
                        {w.address.slice(0, 6)}...{w.address.slice(-4)}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          w.strategy_type === 'mm' ? 'bg-purple-900 text-purple-300' :
                          w.strategy_type === 'yield' ? 'bg-green-900 text-green-300' :
                          w.strategy_type === 'spot' ? 'bg-yellow-900 text-yellow-300' :
                          w.strategy_type === 'solo_spot' ? 'bg-cyan-900 text-cyan-300' :
                          'bg-blue-900 text-blue-300'
                        }`}>
                          {w.strategy_type === 'solo_spot' ? 'SOLO-SPOT' : w.strategy_type.toUpperCase()}
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
                      <td className="p-3">
                        {w.strategy_type === 'spot' && relatedSpot ? (
                          <button onClick={() => handleToggleSpotActive(relatedSpot.id, relatedSpot.is_active)}
                            className={`text-xs px-2 py-1 rounded ${
                              relatedSpot.is_active
                                ? 'bg-success hover:bg-green-600 text-white'
                                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                            }`}>
                            {relatedSpot.is_active ? 'ON' : 'OFF'}
                          </button>
                        ) : (
                          <span className="text-gray-600 text-xs">N/A</span>
                        )}
                      </td>
                      <td className="p-3 flex gap-2">
                        <button onClick={() => toggleActive(w.id, w.is_active)}
                          className={`text-xs px-2 py-1 rounded ${
                            w.is_active ? 'bg-gray-700 hover:bg-gray-600' : 'bg-success hover:bg-green-600'
                          }`}>
                          {w.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        {w.strategy_type === 'spot' && relatedSpot && (
                          <button onClick={() => handleRunStrategy(relatedSpot.id)}
                            className="text-xs px-2 py-1 rounded bg-primary hover:bg-blue-600 text-white flex items-center gap-1">
                            <Play size={12} /> Run
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}