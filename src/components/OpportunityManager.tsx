import { useState } from 'react';
import { opportunityService } from '../api/client';
import { RefreshCw, Play, Loader2, Power } from 'lucide-react';
import { useAutoPoll } from '../hooks/useAutoPoll';

export function OpportunityManager() {
  const [ops, setOps] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchOps = async () => {
    try {
      const res = await opportunityService.list(undefined, 'pending');
      setOps(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const { loading: pollLoading, isPolling, refetch, togglePolling } = useAutoPoll(fetchOps, { interval: 20000 });

  const runExec = async () => {
    setLoading(true);
    try {
      await fetch('/api/bot/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': sessionStorage.getItem('dashboard_api_key') || '',
        },
      });
      await refetch();
    } catch {
      alert('Execution failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Opportunities</h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Pending Opportunities</h3>
          <div className="flex gap-2">
            <button onClick={refetch}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
              {pollLoading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              Manual Refresh
            </button>
            <button onClick={togglePolling}
              className={`flex items-center gap-2 font-bold py-2 px-4 rounded ${
                isPolling ? 'bg-success hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}>
              <Power size={18} />
              {isPolling ? 'Auto ON' : 'Auto OFF'}
            </button>
            <button onClick={runExec} disabled={loading || ops.length === 0}
              className="flex items-center gap-2 bg-success hover:bg-green-600 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
              Execute Top {ops.length}
            </button>
          </div>
        </div>

        {ops.length === 0 ? (
          <p className="text-gray-500">No pending opportunities. Scanner runs on schedule.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Chain</th>
                  <th className="p-3">Pair</th>
                  <th className="p-3">Buy Router</th>
                  <th className="p-3">Sell Router</th>
                  <th className="p-3">Profit</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((op, i) => (
                  <tr key={i} className="border-b border-gray-800">
                    <td className="p-3 font-mono">{op.chain_id}</td>
                    <td className="p-3 font-mono text-xs">{op.token_a?.slice(0,8)} → {op.token_b?.slice(0,8)}</td>
                    <td className="p-3 font-mono text-xs text-gray-400 truncate max-w-xs">{op.router_a}</td>
                    <td className="p-3 font-mono text-xs text-gray-400 truncate max-w-xs">{op.router_b}</td>
                    <td className={`p-3 font-bold ${op.profit_pct > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {op.profit_pct?.toFixed(2)}%
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
