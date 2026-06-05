import { useState } from 'react';
import { api, spotStrategyService, spotPositionService, networkService } from '../api/client';
import { Plus, Trash2, Loader2, TrendingUp, RefreshCw, Power, ExternalLink } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function SpotStrategyManager() {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ chainId: '', tokenAddress: '', stablecoinAddress: '', routerAddress: '', buyThresholdPct: '5', sellThresholdPct: '5', tradeAmount: '10' });

  const fetchAll = async () => {
    try {
      setError(null);
      const [stratRes, posRes, netRes] = await Promise.all([
        spotStrategyService.list(),
        spotPositionService.list(),
        networkService.list(),
      ]);
      setStrategies(stratRes.data);
      setPositions(posRes.data);
      setNetworks(netRes.data);
    } catch (err) {
      const msg = 'Failed to fetch spot data';
      console.error(msg, err);
      setError(msg);
    }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchAll, POLL_HEAVY);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await spotStrategyService.add({
        chainId: parseInt(form.chainId),
        tokenAddress: form.tokenAddress,
        stablecoinAddress: form.stablecoinAddress,
        routerAddress: form.routerAddress,
        buyThresholdPct: parseFloat(form.buyThresholdPct),
        sellThresholdPct: parseFloat(form.sellThresholdPct),
        tradeAmount: form.tradeAmount,
      });
      alert('Spot Strategy Added!');
      setForm({ chainId: '', tokenAddress: '', stablecoinAddress: '', routerAddress: '', buyThresholdPct: '5', sellThresholdPct: '5', tradeAmount: '10' });
      refetch();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Unknown error';
      alert(`Failed to add spot strategy: ${msg}`);
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this spot strategy?')) return;
    try {
      setError(null);
      await spotStrategyService.remove(id);
      refetch();
    } catch (err) {
      setError('Failed to remove spot strategy');
    }
  };

  const handleToggleActive = async (id: number, current: boolean) => {
    try {
      setError(null);
      await spotStrategyService.update(id, { isActive: !current });
      refetch();
    } catch (err) {
      setError('Failed to toggle strategy');
    }
  };

  const handleClosePosition = async (position: any) => {
    if (!confirm(`Close position #${position.id} immediately? This will create a pending sell opportunity.`)) return;
    try {
      setError(null);
      await api.post('/api/opportunities', {
        chain_id: position.chain_id,
        router_a: position.router_address,
        router_b: 'spot_sell',
        token_a: position.stablecoin_address,
        token_b: position.token_address,
        amount_in: String(position.id),
        profit_pct: 0,
        status: 'pending',
      });
      refetch();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to close position');
    }
  };

  const networkMap = Object.fromEntries(networks.map((n: any) => [n.chain_id, n]));
  const openPositions = positions.filter((p: any) => p.status === 'open');
  const closedPositions = positions.filter((p: any) => p.status === 'closed');

  const explorerTxUrl = (chainId: number, txHash: string) => {
    const explorer = networkMap[chainId]?.explorer_url;
    return explorer ? `${explorer.replace(/\/$/, '')}/tx/${txHash}` : `https://etherscan.io/tx/${txHash}`;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <TrendingUp size={24} /> Dex-Spot Strategy
      </h2>
      <p className="text-gray-400 text-sm">Swing-trade tokens on a single DEX. Buy on price dip, sell on price rise.</p>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Spot Strategy</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required>
            <option value="">Select Chain</option>
            {networks.map((n: any) => (
              <option key={n.chain_id} value={n.chain_id}>{n.name} (ID: {n.chain_id})</option>
            ))}
          </select>
          <input placeholder="Token Address (token to trade)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
            value={form.tokenAddress} onChange={e => setForm({ ...form, tokenAddress: e.target.value })} required />
          <input placeholder="Stablecoin Address (e.g. USDC)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
            value={form.stablecoinAddress} onChange={e => setForm({ ...form, stablecoinAddress: e.target.value })} required />
          <input placeholder="DEX Router Address"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
            value={form.routerAddress} onChange={e => setForm({ ...form, routerAddress: e.target.value })} required />
          <input placeholder="Buy Threshold % (price drop % to trigger buy)" type="number" step="0.1"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.buyThresholdPct} onChange={e => setForm({ ...form, buyThresholdPct: e.target.value })} required />
          <input placeholder="Sell Threshold % (price rise % to trigger sell)" type="number" step="0.1"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.sellThresholdPct} onChange={e => setForm({ ...form, sellThresholdPct: e.target.value })} required />
          <input placeholder="Trade Amount (stablecoin amount per swing)" type="number" step="0.1"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.tradeAmount} onChange={e => setForm({ ...form, tradeAmount: e.target.value })} required />
          <button type="submit"
            className="md:col-span-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Spot Strategy
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 p-4 rounded-lg flex items-center gap-2">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-200">&times;</button>
        </div>
      )}

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Configured Spot Strategies</h3>
          <div className="flex gap-2">
            <button onClick={refetch} disabled={loading}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              Manual Refresh
            </button>
            <button onClick={togglePolling}
              className={`flex items-center gap-2 font-bold py-2 px-4 rounded ${isPolling ? 'bg-success hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
              <Power size={18} /> {isPolling ? 'Auto ON' : 'Auto OFF'}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : strategies.length === 0 ? (
          <p className="text-gray-500">No spot strategies configured. Add one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Chain</th>
                  <th className="p-3">Token</th>
                  <th className="p-3">Stablecoin</th>
                  <th className="p-3">Buy Drop</th>
                  <th className="p-3">Sell Rise</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Ref Price</th>
                  <th className="p-3">Active</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((s: any) => (
                  <tr key={s.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono text-sm">{s.chain_id}</td>
                    <td className="p-3 font-mono text-xs max-w-[120px] truncate" title={s.token_address}>{s.token_address.slice(0, 10)}...</td>
                    <td className="p-3 font-mono text-xs max-w-[120px] truncate" title={s.stablecoin_address}>{s.stablecoin_address.slice(0, 10)}...</td>
                    <td className="p-3">{s.buy_threshold_pct}%</td>
                    <td className="p-3">{s.sell_threshold_pct}%</td>
                    <td className="p-3">{s.trade_amount}</td>
                    <td className="p-3 font-mono text-xs">{s.reference_price ? parseFloat(s.reference_price).toFixed(6) : '-'}</td>
                    <td className="p-3">{s.is_active ? <span className="text-success">Yes</span> : <span className="text-gray-500">No</span>}</td>
                    <td className="p-3 flex gap-2">
                      <button onClick={() => handleToggleActive(s.id, s.is_active)}
                        className={`${s.is_active ? 'text-warning hover:text-yellow-400' : 'text-success hover:text-green-400'}`} title={s.is_active ? 'Deactivate' : 'Activate'}>
                        <Power size={18} />
                      </button>
                      <button onClick={() => handleRemove(s.id)}
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

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Open Positions ({openPositions.length})</h3>
        {openPositions.length === 0 ? (
          <p className="text-gray-500">No open positions. Scanner will trigger buys on price dips.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">ID</th>
                  <th className="p-3">Token</th>
                  <th className="p-3">Buy Price</th>
                  <th className="p-3">Amount Bought</th>
                  <th className="p-3">Tx</th>
                  <th className="p-3">Bought At</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono text-sm">{p.id}</td>
                    <td className="p-3 font-mono text-xs max-w-[100px] truncate" title={p.token_address}>{p.token_address.slice(0, 8)}...</td>
                    <td className="p-3 font-mono text-xs">{parseFloat(p.buy_price).toFixed(6)}</td>
                    <td className="p-3 font-mono text-xs">{parseFloat(p.amount_bought).toFixed(4)}</td>
                    <td className="p-3">
                      {p.buy_tx_hash ? (
                        <a href={explorerTxUrl(p.chain_id, p.buy_tx_hash)} target="_blank" rel="noopener noreferrer"
                          className="text-primary hover:text-blue-400">
                          <ExternalLink size={14} />
                        </a>
                      ) : '-'}
                    </td>
                    <td className="p-3 text-xs">{p.bought_at}</td>
                    <td className="p-3">
                      <button onClick={() => handleClosePosition(p)}
                        className="text-warning hover:text-yellow-400" title="Close position manually">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Closed Positions ({closedPositions.length})</h3>
        {closedPositions.length === 0 ? (
          <p className="text-gray-500">No closed positions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">ID</th>
                  <th className="p-3">Buy Price</th>
                  <th className="p-3">Sell Price</th>
                  <th className="p-3">Profit %</th>
                  <th className="p-3">Bought At</th>
                  <th className="p-3">Closed At</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions.map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono text-sm">{p.id}</td>
                    <td className="p-3 font-mono text-xs">{parseFloat(p.buy_price).toFixed(6)}</td>
                    <td className="p-3 font-mono text-xs">{p.sell_price ? parseFloat(p.sell_price).toFixed(6) : '-'}</td>
                    <td className={`p-3 font-mono text-xs ${(p.profit_pct || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                      {p.profit_pct ? `${p.profit_pct.toFixed(2)}%` : '-'}
                    </td>
                    <td className="p-3 text-xs">{p.bought_at}</td>
                    <td className="p-3 text-xs">{p.closed_at || '-'}</td>
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
