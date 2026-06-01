import { useState } from 'react';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { NetworkManager } from './components/NetworkManager';
import { WalletManager } from './components/WalletManager';
import { ConfigManager } from './components/ConfigManager';
import { DexManager } from './components/DexManager';
import { RpcManager } from './components/RpcManager';
import { StrategyManager } from './components/StrategyManager';
import { AiManager } from './components/AiManager';
import { SecurityManager } from './components/SecurityManager';
import { TokenPairManager } from './components/TokenPairManager';
import { OpportunityManager } from './components/OpportunityManager';
import { DiscoveryPoolManager } from './components/DiscoveryPoolManager';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'networks' | 'routers' | 'rpc' | 'opportunities' | 'discovery' | 'pairs' | 'wallets' | 'strategies' | 'ai' | 'security' | 'config'>('dashboard');

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-darker text-white">
      <header className="bg-dark border-b border-gray-800 px-6 py-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-primary">Private EVM Bot</h1>
          <nav className="flex flex-wrap gap-2">
            <button onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'dashboard' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Dashboard
            </button>
            <button onClick={() => setActiveTab('networks')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'networks' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Networks
            </button>
            <button onClick={() => setActiveTab('routers')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'routers' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Routers
            </button>
            <button onClick={() => setActiveTab('rpc')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'rpc' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              RPC Pools
            </button>
            <button onClick={() => setActiveTab('discovery')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'discovery' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Discovery Pools
            </button>
            <button onClick={() => setActiveTab('pairs')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'pairs' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Token Pairs
            </button>
            <button onClick={() => setActiveTab('wallets')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'wallets' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Wallets
            </button>
            <button onClick={() => setActiveTab('strategies')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'strategies' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Strategies
            </button>
            <button onClick={() => setActiveTab('ai')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'ai' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              AI Models
            </button>
            <button onClick={() => setActiveTab('security')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'security' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Security
            </button>
            <button onClick={() => setActiveTab('config')}
              className={`px-3 py-2 rounded text-sm ${activeTab === 'config' ? 'bg-primary' : 'hover:bg-gray-800'}`}>
              Config
            </button>
            <button onClick={() => {
              sessionStorage.removeItem('dashboard_api_key');
              setIsAuthenticated(false);
            }} className="px-3 py-2 rounded text-danger hover:bg-red-900/20 text-sm">
              Logout
            </button>
          </nav>
        </div>
      </header>

      <main className="p-6">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'networks' && <NetworkManager />}
        {activeTab === 'routers' && <DexManager />}
        {activeTab === 'rpc' && <RpcManager />}
        {activeTab === 'opportunities' && <OpportunityManager />}
        {activeTab === 'discovery' && <DiscoveryPoolManager />}
        {activeTab === 'pairs' && <TokenPairManager />}
        {activeTab === 'wallets' && <WalletManager />}
        {activeTab === 'strategies' && <StrategyManager />}
        {activeTab === 'ai' && <AiManager />}
        {activeTab === 'security' && <SecurityManager />}
        {activeTab === 'config' && <ConfigManager />}
      </main>
    </div>
  );
}

export default App;
