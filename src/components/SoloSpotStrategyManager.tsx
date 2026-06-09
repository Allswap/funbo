import { useState, useEffect } from 'react';
import { networkService, soloSpotStrategyService, soloSpotTradeService } from '../api/client';
import { Plus, Trash2, Loader2, Zap, RefreshCw, Power, ExternalLink } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function SoloSpotStrategyManager() {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeMsg, setExecuteMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ chainId: '', tokenAddress: '', tradeAmount: '', minTradeAmount: '', maxTradeAmount: '' });

  const fetchAll = async () => {
    const [stratRes, netRes] = await Promise.all([
      soloSpotStrategyService.list(),
      networkService.list(),
    ]);
    setStrategies(stratRes.data);
    setNetworks(netRes.data);
  };

  const fetchTrades = async (strategyId?: number) => {
    const res = await soloSpotTradeService.list(strategyId);
    setTrades(res.data);
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchAll, POLL_HEAVY);

  useEffect(() => {
    fetchAll();
    fetchTrades();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.chainId || !form.tokenAddress) { setError('Chain and Token Address required'); return; }
    try {
      await soloSpotStrategyService.add({
        chainId: parseInt(form.chainId),
        tokenAddress: form.tokenAddress,
        tradeAmount: form.tradeAmount,
        minTradeAmount: form.minTradeAmount || undefined,
        maxTradeAmount: form.maxTradeAmount || undefined,
      });
      setForm({ chainId: '', tokenAddress: '', tradeAmount: '', minTradeAmount: '', maxTradeAmount: '' });
      refetch();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to add');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this solo-spot strategy?')) return;
    try {
      await soloSpotStrategyService.remove(id);
      refetch();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to remove');
    }
  };

  const handleToggleActive = async (id: number, current: boolean) => {
    try {
      await soloSpotStrategyService.update(id, { isActive: !current });
      refetch();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to toggle');
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setExecuteMsg(null);
    try {
      const res = await soloSpotStrategyService.execute();
      setExecuteMsg(res.data.message || `Executed ${res.data.executed} trades`);
      refetch();
      fetchTrades();
    } catch (err: any) {
      setExecuteMsg(`Error: ${err?.response?.data?.error || err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const viewTx = (txHash: string, chainId?: number) => {
    if (!txHash) return;
    const net = networks.find((n: any) => n.chain_id === chainId);
    const baseUrl = net?.explorer_url ? net.explorer_url.replace(/\/$/, '') : 'https://polygonscan.com';
    window.open(`${baseUrl}/tx/${txHash}`, '_blank');
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Zap size={24} /> Solo-Spot Strategy
      </h2>
      <p className="text-sm text-gray-400">
        Configure a single token — bot auto-discovers pairs across all DEXes and executes profitable round-trips.
      </p>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Strategy</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Chain</label>
            <select className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.chainId} onChange={e => setForm({ ...form, chainId: e.target.value })} required>
              <option value="">Select Chain</option>
              {networks.map((n: any) => (
                <option key={n.chain_id} value={n.chain_id}>{n.name} (ID: {n.chain_id})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Token Address</label>
            <input placeholder="0x..." className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
              value={form.tokenAddress} onChange={e => setForm({ ...form, tokenAddress: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Trade Amount (default 10)</label>
            <input placeholder="Trade Amount (default 10)" type="number" step="0.1" min="0"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.tradeAmount} onChange={e => setForm({ ...form, tradeAmount: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Min Trade Amount (optional)</label>
            <input placeholder="Min Trade Amount (optional)" type="number" step="0.1" min="0"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.minTradeAmount} onChange={e => setForm({ ...form, minTradeAmount: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Max Trade Amount (optional)</label>
            <input placeholder="Max Trade Amount (optional)" type="number" step="0.1" min="0"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
              value={form.maxTradeAmount} onChange={e => setForm({ ...form, maxTradeAmount: e.target.value })} />
          </div>
          <button type="submit" className="bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Strategy
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 p-4 rounded-lg">
          {error} <button onClick={() => setError(null)} className="float-right">✕</button>
        </div>
      )}

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Configured Strategies</h3>
          <div className="flex gap-2">
            <button onClick={handleExecute} disabled={executing}
              className="flex items-center gap-2 bg-success hover:bg-green-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
              {executing ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
              Run Now
            </button>
            <button onClick={refetch} disabled={loading}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              Refresh
            </button>
            <button onClick={togglePolling}
              className={`flex items-center gap-2 font-bold py-2 px-4 rounded ${isPolling ? 'bg-success hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
              {isPolling ? 'Auto ON' : 'Auto OFF'}
            </button>
          </div>
        </div>

        {executeMsg && (
          <div className="bg-blue-900/30 border border-blue-700 text-blue-300 p-3 rounded-lg mb-4">
            {executeMsg}
          </div>
        )}

        {strategies.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No strategies configured yet.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="p-3">ID</th>
                <th className="p-3">Chain</th>
                <th className="p-3">Token</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Min</th>
                <th className="p-3">Max</th>
                <th className="p-3">Active</th>
                <th className="p-3">Created</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s: any) => (
                <tr key={s.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="p-3 text-xs">{s.id}</td>
                  <td className="p-3">{s.chain_id}</td>
                  <td className="p-3 font-mono text-xs max-w-[200px] truncate">{s.token_address}</td>
                  <td className="p-3">{s.trade_amount}</td>
                  <td className="p-3">{s.min_trade_amount || <span className="text-gray-500">-</span>}</td>
                  <td className="p-3">{s.max_trade_amount || <span className="text-gray-500">-</span>}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${s.is_active ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-400">{s.created_at}</td>
                  <td className="p-3 flex gap-2">
                    <button onClick={() => handleToggleActive(s.id, s.is_active)}
                      className={`p-2 rounded hover:bg-gray-700 ${s.is_active ? 'text-green-400' : 'text-gray-500'}`}
                      title={s.is_active ? 'Deactivate' : 'Activate'}>
                      <Power size={18} />
                    </button>
                    <button onClick={() => handleRemove(s.id)}
                      className="p-2 rounded hover:bg-gray-700 text-danger" title="Remove">
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Trade History</h3>
          <button onClick={() => fetchTrades()} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        {trades.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No trades yet.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="p-3">Token</th>
                <th className="p-3">Pair</th>
                <th className="p-3">Buy DEX</th>
                <th className="p-3">Sell DEX</th>
                <th className="p-3">Profit</th>
                <th className="p-3">Buy Tx</th>
                <th className="p-3">Sell Tx</th>
                <th className="p-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: any) => (
                <tr key={t.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="p-3 font-mono text-xs max-w-[100px] truncate">{t.token_address?.slice(0, 10)}...</td>
                  <td className="p-3 font-mono text-xs max-w-[100px] truncate">{t.pair_token_address?.slice(0, 10)}...</td>
                  <td className="p-3 font-mono text-xs max-w-[100px] truncate">{t.buy_dex?.slice(0, 10)}...</td>
                  <td className="p-3 font-mono text-xs max-w-[100px] truncate">{t.sell_dex?.slice(0, 10)}...</td>
                  <td className={`p-3 font-mono text-xs ${parseFloat(t.net_profit_pct || '0') >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {t.net_profit_pct ? `${parseFloat(t.net_profit_pct).toFixed(2)}%` : '-'}
                  </td>
                  <td className="p-3">
                    {t.buy_tx_hash ? (
                      <button onClick={() => viewTx(t.buy_tx_hash, t.chain_id)} className="text-primary hover:underline flex items-center gap-1 text-xs">
                        Tx <ExternalLink size={12} />
                      </button>
                    ) : '-'}
                  </td>
                  <td className="p-3">
                    {t.sell_tx_hash ? (
                      <button onClick={() => viewTx(t.sell_tx_hash, t.chain_id)} className="text-primary hover:underline flex items-center gap-1 text-xs">
                        Tx <ExternalLink size={12} />
                      </button>
                    ) : '-'}
                  </td>
                  <td className="p-3 text-xs text-gray-400">{t.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}