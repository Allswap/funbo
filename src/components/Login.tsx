import { useState } from 'react';
import { authService } from '../api/client';
import { Lock, Key } from 'lucide-react';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) {
      setError('API Key is required');
      return;
    }
    try {
      await authService.login(apiKey);
      onLogin();
    } catch (err) {
      setError('Invalid API Key');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-darker">
      <div className="bg-dark p-8 rounded-lg border border-gray-800 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Lock size={48} className="text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-center mb-6">Private Bot Dashboard</h2>
        {error && <p className="text-danger text-center mb-4">{error}</p>}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">API Key</label>
            <div className="relative">
              <Key className="absolute left-3 top-3 text-gray-500" size={18} />
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="w-full pl-10 p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                placeholder="Enter your secret API key"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded"
          >
            Unlock Dashboard
          </button>
        </form>
        <p className="text-xs text-gray-500 text-center mt-4">
          This is a private bot. Do not share your API key.
        </p>
      </div>
    </div>
  );
}
