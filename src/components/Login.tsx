import { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const TEST_PASSWORD = import.meta.env.VITE_TEST_PASSWORD || 'bot123';
const TEST_API_KEY = import.meta.env.VITE_TEST_API_KEY || 'dashboard2026';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'apikey' | 'password'>('apikey');
  const [loading, setLoading] = useState(false);

  const handleApiKeyLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const res = await fetch(`${API_BASE}/api/config`, { headers });
      if (res.ok) {
        sessionStorage.setItem('dashboard_api_key', apiKey);
        onLogin();
        return;
      }
      throw new Error('Invalid API key');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/login-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        const data = await res.json();
        sessionStorage.setItem('dashboard_api_key', data.apiKey);
        onLogin();
      } else {
        setError('Wrong password');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'apikey') {
      await handleApiKeyLogin();
      if (error && apiKey) {
        setMode('password');
      }
    } else {
      await handlePasswordLogin();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-darker">
      <div className="bg-dark p-8 rounded-lg border border-gray-800 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Lock size={48} className="text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-center mb-6">Private Bot Dashboard</h2>

        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => setMode('apikey')}
            className={`flex-1 py-2 rounded font-bold text-sm ${mode === 'apikey' ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300'}`}>
            API Key
          </button>
          <button type="button" onClick={() => setMode('password')}
            className={`flex-1 py-2 rounded font-bold text-sm ${mode === 'password' ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300'}`}>
            Password
          </button>
        </div>

        {error && <p className="text-danger text-center mb-4">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'apikey' ? (
            <input placeholder="API Key"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
              value={apiKey} onChange={e => setApiKey(e.target.value)} />
          ) : (
            <div className="relative">
              <input placeholder="Password" type={showPassword ? "text" : "password"}
                className="w-full pl-10 pr-10 p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-gray-500 hover:text-gray-300">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full bg-primary hover:bg-blue-600 disabled:bg-gray-600 text-white font-bold py-3 rounded">
            {loading ? 'Authenticating...' : 'Unlock Dashboard'}
          </button>
        </form>
        <p className="text-xs text-gray-500 text-center mt-4">
          Testing environment - password: <code className="bg-gray-800 px-1 rounded">{TEST_PASSWORD}</code> or API key: <code className="bg-gray-800 px-1 rounded">{TEST_API_KEY}</code>
        </p>
      </div>
    </div>
  );
}
