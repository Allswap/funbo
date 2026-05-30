import { useState, useEffect } from 'react';
import { aiService } from '../api/client';
import { Plus, Trash2, Loader2, Sparkles } from 'lucide-react';

export function AiManager() {
  const [configs, setConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', provider: 'workers-ai', model: '@cf/meta/llama-3-70b-instruct', priority: '0' });

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await aiService.list();
      setConfigs(res.data);
    } catch (err) {
      console.error("Failed to fetch AI configs", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConfigs(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await aiService.add({
        name: form.name,
        provider: form.provider,
        model: form.model,
        priority: parseInt(form.priority)
      });
      alert('AI Config Added!');
      setForm({ name: '', provider: 'workers-ai', model: '@cf/meta/llama-3-70b-instruct', priority: '0' });
      fetchConfigs();
    } catch (err) {
      alert('Failed to add AI config');
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Remove this AI config?')) return;
    try {
      await aiService.remove(id);
      fetchConfigs();
    } catch (err) {
      alert('Failed to remove AI config');
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Sparkles size={24} /> AI Models
      </h2>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Add AI Model</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input placeholder="Name (e.g. Llama 3 Advisor)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <select
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}
          >
            <option value="workers-ai">Workers AI</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google AI</option>
          </select>
          <input placeholder="Model (e.g. @cf/meta/llama-3-70b-instruct)"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
            value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} required />
          <input placeholder="Priority (0=high)" type="number" min="0"
            className="p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
            value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} />
          <button type="submit"
            className="md:col-span-2 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            <Plus size={20} /> Add AI Model
          </button>
        </form>
      </div>

      <div className="bg-dark p-6 rounded-lg border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">Configured AI Models</h3>
        {loading ? (
          <div className="flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
        ) : configs.length === 0 ? (
          <p className="text-gray-500">No AI models configured. Add AI configs for strategy suggestions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-3">Name</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Model</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((c) => (
                  <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-bold">{c.name}</td>
                    <td className="p-3 text-sm">{c.provider}</td>
                    <td className="p-3 font-mono text-xs text-gray-400 truncate max-w-xs">{c.model}</td>
                    <td className="p-3">{c.priority}</td>
                    <td className="p-3">
                      <button onClick={() => handleRemove(c.id)}
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