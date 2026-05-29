import { useState } from 'react';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { NetworkManager } from './components/NetworkManager';
import { WalletManager } from './components/WalletManager';
import { ConfigManager } from './components/ConfigManager';
import { DexManager } from './components/DexManager';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'networks' | 'routers' | 'wallets' | 'config'>('dashboard');

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-darker text-white">
      <header className="bg-dark border-b border-gray-800 px-6 py-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-primary">Private EVM Bot</h1>
          <nav className="flex gap-4">
            <button onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 rounded ${activeTab === 'dashboard' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Dashboard
            </button>
            <button onClick={() => setActiveTab('networks')}
              className={`px-4 py-2 rounded ${activeTab === 'networks' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Networks
            </button>
            <button onClick={() => setActiveTab('routers')}
              className={`px-4 py-2 rounded ${activeTab === 'routers' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Routers
            </button>
            <button onClick={() => setActiveTab('wallets')}
              className={`px-4 py-2 rounded ${activeTab === 'wallets' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Wallets
            </button>
            <button onClick={() => setActiveTab('config')}
              className={`px-4 py-2 rounded ${activeTab === 'config' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Config
            </button>
            <button onClick={() => {
              localStorage.removeItem('dashboard_api_key');
              setIsAuthenticated(false);
            }} className="px-4 py-2 rounded text-danger hover:bg-red-900/20">
              Logout
            </button>
          </nav>
        </div>
      </header>

      <main className="p-6">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'networks' && <NetworkManager />}
        {activeTab === 'routers' && <DexManager />}
        {activeTab === 'wallets' && <WalletManager />}
        {activeTab === 'config' && <ConfigManager />}
      </main>
    </div>
  );
}

export default App;
