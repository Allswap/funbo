import { useState, useEffect } from 'react';
import { Wallet, Loader2, Lock, Eye, EyeOff } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const TEST_PASSWORD = import.meta.env.VITE_TEST_PASSWORD || 'bot123';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function Login({ onLogin }: { onLogin: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'wallet' | 'password'>('wallet');
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checking, setChecking] = useState(true);
  const [account, setAccount] = useState<string | null>(null);
  const [nonce, setNonce] = useState('');

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/setup-check`);
        const data = await res.json();
        if (data.needsSetup) setNeedsSetup(true);
      } catch {}
      setChecking(false);
    };
    checkSetup();
  }, []);

  useEffect(() => {
    const init = async () => {
      if (typeof window === 'undefined' || !window.ethereum) return;
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          await fetchNonce(accounts[0]);
        }
      } catch {}
    };
    init();
  }, []);

  const fetchNonce = async (addr: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/nonce?address=${addr}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.nonce) setNonce(data.nonce);
      else setError('No nonce in response');
    } catch (err: any) {
      console.error('fetchNonce error:', err);
      setError(`Nonce fetch failed: ${err.message}`);
    }
  };

  const connectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('No wallet found. Install MetaMask/Rabby.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      setMode('wallet');
      await fetchNonce(accounts[0]);
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const signAndLogin = async () => {
    if (!account || !window.ethereum || !nonce) return;
    setLoading(true);
    setError('');
    try {
      const message = `Authorize funbo dashboard\nNonce: ${nonce}`;
      const sig = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, account],
      });
      const res = await fetch(`${API_BASE}/api/auth/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account, signature: sig, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Auth failed');
      }
      const data = await res.json();
      sessionStorage.setItem('dashboard_api_key', data.apiKey);
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Sign failed');
    } finally {
      setLoading(false);
    }
  };

  const handleApiKeyLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey.trim()) headers['X-API-Key'] = apiKey.trim();
      const res = await fetch(`${API_BASE}/api/config`, { headers });
      if (res.ok) {
        sessionStorage.setItem('dashboard_api_key', apiKey.trim());
        onLogin();
        return;
      }
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Invalid API key');
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
        body: JSON.stringify({ password: password.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        sessionStorage.setItem('dashboard_api_key', data.apiKey);
        onLogin();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Wrong password');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'wallet') {
      if (!nonce) {
        setError('Nonce not loaded yet. Connect wallet first.');
        return;
      }
      await signAndLogin();
    }
    else if (mode === 'password') await handlePasswordLogin();
    else if (mode === 'apikey') await handleApiKeyLogin();
  };

  const handleSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/setup-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'dashboard' }),
      });
      if (res.ok) {
        const data = await res.json();
        sessionStorage.setItem('dashboard_api_key', data.key);
        onLogin();
      } else setError('Setup failed');
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem('dashboard_api_key');
    setAccount(null);
    setMode('wallet');
    setError('');
    setPassword('');
    setApiKey('');
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-darker">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (needsSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-darker">
        <div className="bg-dark p-8 rounded-lg border border-gray-800 w-full max-w-md">
          <div className="flex justify-center mb-6">
            <Lock size={48} className="text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-center mb-4">Initial Setup</h2>
          <p className="text-gray-400 text-center mb-6">No API keys found. Initialize the system?</p>
          <button onClick={handleSetup} disabled={loading}
            className="w-full bg-primary hover:bg-blue-600 disabled:bg-gray-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            {loading && <Loader2 className="animate-spin" size={20} />}
            {loading ? 'Setting up...' : 'Initialize Dashboard'}
          </button>
          <p className="text-xs text-gray-500 text-center mt-4">
            Default password: <code className="bg-gray-800 px-1 rounded">{TEST_PASSWORD}</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-darker">
      <div className="bg-dark p-8 rounded-lg border border-gray-800 w-full max-w-md">
        <div className="flex justify-center mb-6">
          {mode === 'wallet' ? <Wallet size={48} className="text-primary" /> : <Lock size={48} className="text-primary" />}
        </div>
        <h2 className="text-2xl font-bold text-center mb-6">Private Bot Dashboard</h2>

        {account && mode === 'wallet' ? (
          <div className="text-center mb-4">
            <p className="text-gray-400 text-xs mb-2">Connected</p>
            <p className="font-mono text-sm bg-gray-800 px-2 py-1 rounded inline-block break-all">{account}</p>
          </div>
        ) : null}

        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => setMode('wallet')}
            className={`flex-1 py-2 rounded font-bold text-sm ${mode === 'wallet' ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300'}`}>
            Wallet
          </button>
          <button type="button" onClick={() => setMode('password')}
            className={`flex-1 py-2 rounded font-bold text-sm ${mode === 'password' ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300'}`}>
            Password
          </button>
        </div>

        {error && <p className="text-danger text-center mb-4">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'wallet' ? (
            account ? (
              <button type="button" onClick={signAndLogin} disabled={loading || !nonce}
                className="w-full bg-primary hover:bg-blue-600 disabled:bg-gray-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
                {loading && <Loader2 className="animate-spin" size={20} />}
                {loading ? 'Signing...' : 'Sign Message'}
              </button>
            ) : (
              <button type="button" onClick={connectWallet} disabled={loading}
                className="w-full bg-primary hover:bg-blue-600 disabled:bg-gray-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
                {loading && <Loader2 className="animate-spin" size={20} />}
                {loading ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )
          ) : mode === 'password' ? (
            <div className="relative">
              <input placeholder="Password" type={showPassword ? "text" : "password"}
                className="w-full pl-10 pr-10 p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none"
                value={password} onChange={e => setPassword(e.target.value)} autoFocus />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-gray-500 hover:text-gray-300">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          ) : (
            <input placeholder="API Key"
              className="w-full p-3 bg-gray-800 rounded border border-gray-700 focus:border-primary outline-none font-mono text-sm"
              value={apiKey} onChange={e => setApiKey(e.target.value)} autoFocus />
          )}
          <button type="submit" disabled={loading}
            className="w-full bg-primary hover:bg-blue-600 disabled:bg-gray-600 text-white font-bold py-3 rounded flex items-center justify-center gap-2">
            {loading && <Loader2 className="animate-spin" size={20} />}
            {loading ? 'Authenticating...' : 'Unlock Dashboard'}
          </button>
        </form>
        <button onClick={logout}
          className="w-full mt-3 text-gray-500 hover:text-gray-300 text-xs">
          Logout
        </button>
        <p className="text-xs text-gray-500 text-center mt-3">
          Wallet sign OR password fallback.
        </p>
      </div>
    </div>
  );
}
