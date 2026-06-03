import { useState } from 'react';
import { securityService } from '../api/client';
import { Plus, Trash2, Loader2, Shield, RefreshCw, Power } from 'lucide-react';
import { useAutoPoll, POLL_HEAVY } from '../hooks/useAutoPoll';

export function SecurityManager() {
  const [layers, setLayers] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', provider: 'goplus', priority: '0' });

  const fetchLayers = async () => {
    try {
      const res = await securityService.list();
      setLayers(res.data);
    } catch (err) {
      console.error("Failed to fetch security layers", err);
    }
  };

  const { loading, isPolling, refetch, togglePolling } = useAutoPoll(fetchLayers, POLL_HEAVY);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await securityService.add({
        name: form.name,
        provider: form.provider,
        priority: parseInt(form.priority)
      });
      alert('Security Layer Added!');
      setForm({ name: '', provider: 'goplus', priority: '0' });
      refetch();
    } catch (err) {
      alert('Failed to add security layer');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this security layer?')) return;
    try {
      await securityService.remove(id);
      refetch();
    } catch (err) {
      alert('Failed to remove security layer');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Shield size={24} /> Security Layers
      </h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Security Provider</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder="Name (e.g. GoPlus Token Safety)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <select
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}
          >
            <option value="goplus">GoPlus Security</option>
            <option value="custom">Custom Provider</option>
            <option value="rugcheck">RugCheck</option>
            <option value="honeypot">Honeypot Detector</option>
          </select>
          <input placeholder="Priority (0=high)" type="number" min="0"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} />
          <button type="submit"
            className="md:col-span-3 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Security Layer
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Security Providers</h3>
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
        ) : layers.length === 0 ? (
          <p className="text-gray-500">No security layers configured. Add providers to scan for honeypots, rug pulls, etc.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Name</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {layers.map((l) => (
                  <tr key={l.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-bold">{l.name}</td>
                    <td className="p-3 text-sm">{l.provider}</td>
                    <td className="p-3">{l.priority}</td>
                    <td className="p-3">
                      <span className={`text-sm ${l.is_active ? 'text-success' : 'text-gray-500'}`}>
                        {l.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-3">
                      <button onClick={() => handleRemove(l.id)}
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
