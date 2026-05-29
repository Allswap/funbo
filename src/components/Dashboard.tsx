import { useState, useEffect } from 'react';
import { tradeService, networkService } from '../api/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Play, Loader2 } from 'lucide-react';

export function Dashboard() {
  const [trades, setTrades] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const [tradesRes, networksRes] = await Promise.all([
        tradeService.getHistory(),
        networkService.list()
      ]);
      setTrades(tradesRes.data);
      setNetworks(networksRes.data);
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTrades(); }, []);

  const runBot = async () => {
    if (!confirm("Start bot scan? This will check all active networks.")) return;
    setRunning(true);
    try {
      await tradeService.runBot();
      await fetchTrades();
      alert("Bot scan complete. Check logs below.");
    } catch (err) {
      alert("Bot scan failed. Check console.");
    } finally {
      setRunning(false);
    }
  };

  const networkMap = Object.fromEntries(networks.map((n: any) => [n.chain_id, n]));

  const totalProfit = trades
    .filter(t => t.status === 'success')
    .reduce((acc, t) => acc + (t.profit_pct || 0), 0);
  const successRate = trades.length
    ? ((trades.filter(t => t.status === 'success').length / trades.length) * 100).toFixed(1)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Bot Dashboard</h2>
        <button onClick={runBot} disabled={running}
          className="bg-success hover:bg-green-600 text-white font-bold py-3 px-6 rounded flex items-center gap-2 disabled:opacity-50">
          {running ? <Loader2 className="animate-spin" size={20} /> : <Play size={20} />}
          {running ? 'Scanning...' : 'Run Bot Scan'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-dark p-4 rounded-lg border border-gray-800">
          <h3 className="text-gray-400 text-sm">Total Trades</h3>
          <p className="text-2xl font-bold">{trades.length}</p>
        </div>
        <div className="bg-dark p-4 rounded-lg border border-gray-800">
          <h3 className="text-gray-400 text-sm">Success Rate</h3>
          <p className="text-2xl font-bold text-success">{successRate}%</p>
        </div>
        <div className="bg-dark p-4 rounded-lg border border-gray-800">
          <h3 className="text-gray-400 text-sm">Total Profit</h3>
          <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-success' : 'text-danger'}`}>
            {totalProfit.toFixed(2)}%
          </p>
        </div>
        <div className="bg-dark p-4 rounded-lg border border-gray-800">
          <h3 className="text-gray-400 text-sm">Active Networks</h3>
          <p className="text-2xl font-bold text-primary">{networks.filter((n: any) => n.is_active).length}</p>
        </div>
      </div>

      <div className="bg-gray-800 p-4 rounded-lg h-64 mb-6">
        <h3 className="text-lg font-bold mb-2 text-white">Profit Trend</h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trades}>
            <XAxis dataKey="created_at" stroke="#888" />
            <YAxis stroke="#888" />
            <Tooltip contentStyle={{ backgroundColor: '#333', border: 'none' }} />
            <Line type="monotone" dataKey="profit_pct" stroke="#8884d8" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-700 text-gray-300">
            <tr>
              <th className="p-3">Wallet</th>
              <th className="p-3">Chain</th>
              <th className="p-3">Strategy</th>
              <th className="p-3">Pair</th>
              <th className="p-3">Profit %</th>
              <th className="p-3">Status</th>
              <th className="p-3">TX Hash</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id} className="border-b border-gray-700 hover:bg-gray-750">
                <td className="p-3 text-xs text-gray-400">{t.wallet_label}</td>
                <td className="p-3">{t.chain_id}</td>
                <td className="p-3">{t.strategy}</td>
                <td className="p-3 font-mono text-xs">{t.token_a?.slice(0,6)}... → {t.token_b?.slice(0,6)}...</td>
                <td className={`p-3 font-bold ${t.profit_pct > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {t.profit_pct}%
                </td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    t.status === 'success' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                  }`}>
                    {t.status}
                  </span>
                </td>
                <td className="p-3 font-mono text-xs text-blue-400">
                  <a href={t.tx_hash ? `${networkMap[t.chain_id]?.explorer_url || ''}/tx/${t.tx_hash}` : '#'} target="_blank" rel="noreferrer">
                    {t.tx_hash?.slice(0, 8)}...
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
