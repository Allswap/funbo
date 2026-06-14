import { useState } from 'react';
import { errorLogService } from '../api/client';
import { RefreshCw, Loader2, Power } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

const LEVELS = ['', 'error', 'warn', 'info'] as const;
const SOURCES = ['', 'discovery', 'execution', 'dashboard', 'system'] as const;

function levelColor(level: string): string {
  switch (level) {
    case 'error': return 'text-red-400';
    case 'warn': return 'text-yellow-400';
    case 'info': return 'text-blue-400';
    default: return 'text-gray-400';
  }
}

export function ErrorLogManager() {
  const [logs, setLogs] = useState<any[]>([]);
  const [filterLevel, setFilterLevel] = useState('');
  const [filterSource, setFilterSource] = useState('');

  const fetchLogs = async () => {
    try {
      const res = await errorLogService.list(filterSource || undefined, filterLevel || undefined, 200);
      setLogs(res.data || []);
    } catch { }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchLogs, POLL_HEAVY);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Error Logs</h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-4 items-center">
            <select value={filterLevel} onChange={e => { setFilterLevel(e.target.value); setTimeout(refetch, 0); }}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm">
              <option value="">All Levels</option>
              {LEVELS.filter(Boolean).map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={filterSource} onChange={e => { setFilterSource(e.target.value); setTimeout(refetch, 0); }}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm">
              <option value="">All Sources</option>
              {SOURCES.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={refetch}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              Refresh
            </button>
            <button onClick={togglePolling}
              className={`flex items-center gap-2 font-bold py-2 px-4 rounded ${isPolling ? 'bg-success hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
              <Power size={18} />
              {isPolling ? 'Auto ON' : 'Auto OFF'}
            </button>
          </div>
        </div>

        {logs.length === 0 ? (
          <p className="text-gray-500">No error logs recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Time</th>
                  <th className="p-3">Level</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Worker</th>
                  <th className="p-3">Chain</th>
                  <th className="p-3">Message</th>
                  <th className="p-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any, i: number) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 text-xs font-mono text-gray-400">{log.created_at}</td>
                    <td className={`p-3 font-semibold ${levelColor(log.level)}`}>{log.level}</td>
                    <td className="p-3 text-sm">{log.source}</td>
                    <td className="p-3 text-xs text-gray-400">{log.worker || '-'}</td>
                    <td className="p-3 text-xs font-mono">{log.chain_id || '-'}</td>
                    <td className="p-3 text-sm max-w-md truncate">{log.message}</td>
                    <td className="p-3 text-xs text-gray-400 max-w-xs truncate">
                      {log.details ? (
                        <span title={typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}>
                          {typeof log.details === 'string' ? log.details.slice(0, 60) : JSON.stringify(log.details).slice(0, 60)}
                        </span>
                      ) : '-'}
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