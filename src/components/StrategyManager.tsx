import { useState, useEffect } from 'react';
import { strategyService } from '../api/client';
import { Plus, Trash2, Loader2, Brain } from 'lucide-react';

export function StrategyManager() {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', description: '', params: '{}' });

  const fetchStrategies = async () => {
    setLoading(true);
    try {
      const res = await strategyService.list();
      setStrategies(res.data);
    } catch (err) {
      console.error("Failed to fetch strategies", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStrategies(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await strategyService.add({
        key: form.key,
        name: form.name,
        description: form.description,
        params: form.params
      });
      alert('Strategy Added!');
      setForm({ key: '', name: '', description: '', params: '{}' });
      fetchStrategies();
    } catch (err) {
      alert('Failed to add strategy');
    }
  };

  const handleRemove = async (key: string) => {
    if (!confirm('Remove this strategy?')) return;
    try {
      await strategyService.remove(key);
      fetchStrategies();
    } catch (err) {
      alert('Failed to remove strategy');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Brain size={24} /> Trading Strategies
      </h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add Strategy</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input placeholder="Key (e.g. arb, triangle, sandwich)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
            value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} required />
          <input placeholder="Name (e.g. Arbitrage)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="Description"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <textarea placeholder='Params (JSON) e.g. {"slippage": 0.5}'
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-xs"
            value={form.params} onChange={e => setForm({ ...form, params: e.target.value })} rows={2} />
          <button type="submit"
            className="md:col-span-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add Strategy
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Configured Strategies</h3>
        {loading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : strategies.length === 0 ? (
          <p className="text-gray-500">No strategies configured. Add strategies for trading.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Key</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((s) => (
                  <tr key={s.key} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono text-sm">{s.key}</td>
                    <td className="p-3">{s.name}</td>
                    <td className="p-3 text-xs text-gray-400">{s.description}</td>
                    <td className="p-3">
                      <button onClick={() => handleRemove(s.key)}
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