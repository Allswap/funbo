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
import { SpotStrategyManager } from './components/SpotStrategyManager';
import { SoloSpotStrategyManager } from './components/SoloSpotStrategyManager';
import { MmConfigManager } from './components/MmConfigManager';
import { WhitelistManager } from './components/WhitelistManager';
import { ErrorLogManager } from './components/ErrorLogManager';

type MainTab = 'dashboard' | 'network' | 'wallet' | 'routers' | 'config';
type SubTab = 'networks' | 'rpc' | 'discovery' | 'wallets' | 'dex' | 'pairs' | 'opportunities' | 'config' | 'strategies' | 'security' | 'ai' | 'whitelist' | 'spot' | 'solo-spot' | 'mm' | 'errors';

const MAIN_MENU: { key: MainTab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'network', label: 'Network' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'routers', label: 'Routers' },
  { key: 'config', label: 'Config' },
];

const SUB_MENU: Record<MainTab, { key: SubTab; label: string }[] | null> = {
  dashboard: null,
  network: [
    { key: 'networks', label: 'Networks' },
    { key: 'rpc', label: 'RPC Pools' },
    { key: 'discovery', label: 'Discovery Pools' },
    { key: 'security', label: 'Security' },
  ],
  wallet: [
    { key: 'wallets', label: 'Wallets' },
    { key: 'whitelist', label: 'Whitelist' },
  ],
  routers: [
    { key: 'dex', label: 'DEX Routers' },
    { key: 'pairs', label: 'Token Pairs' },
    { key: 'opportunities', label: 'Opportunities' },
    { key: 'strategies', label: 'Strategies' },
    { key: 'spot', label: 'Spot' },
    { key: 'solo-spot', label: 'Solo-Spot' },
    { key: 'mm', label: 'MM LP' },
  ],
  config: [
    { key: 'config', label: 'Config' },
    { key: 'ai', label: 'AI Models' },
    { key: 'errors', label: 'Error Logs' },
  ],
};

const FIRST_SUB: Record<MainTab, SubTab | null> = {
  dashboard: null,
  network: 'networks',
  wallet: 'wallets',
  routers: 'dex',
  config: 'config',
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>('dashboard');
  const [subTab, setSubTab] = useState<SubTab | null>(null);

  const handleMainClick = (tab: MainTab) => {
    setMainTab(tab);
    setSubTab(FIRST_SUB[tab] ?? null);
  };

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  const subs = SUB_MENU[mainTab];

  return (
    <div className="min-h-screen bg-darker text-white">
      <header className="bg-dark border-b border-gray-800">
        <div className="flex items-center justify-between px-6 py-3">
          <h1 className="text-xl font-bold text-primary">Private EVM Bot</h1>
          <div className="flex items-center gap-1">
            {MAIN_MENU.map(item => (
              <button key={item.key} onClick={() => handleMainClick(item.key)}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  mainTab === item.key
                    ? 'bg-primary text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}>
                {item.label}
              </button>
            ))}
            <button onClick={() => {
              sessionStorage.removeItem('dashboard_api_key');
              setIsAuthenticated(false);
            }} className="ml-4 px-4 py-2 rounded text-sm font-medium text-danger hover:bg-red-900/20">
              Logout
            </button>
          </div>
        </div>
        {subs && (
          <div className="flex items-center gap-1 px-6 pb-3">
            {subs.map(item => (
              <button key={item.key} onClick={() => setSubTab(item.key)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  subTab === item.key
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="p-6">
        {mainTab === 'dashboard' && <Dashboard />}
        {subTab === 'networks' && <NetworkManager />}
        {subTab === 'rpc' && <RpcManager />}
        {subTab === 'discovery' && <DiscoveryPoolManager />}
        {subTab === 'wallets' && <WalletManager />}
        {subTab === 'dex' && <DexManager />}
        {subTab === 'pairs' && <TokenPairManager />}
        {subTab === 'opportunities' && <OpportunityManager />}
        {subTab === 'config' && <ConfigManager />}
        {subTab === 'strategies' && <StrategyManager />}
        {subTab === 'security' && <SecurityManager />}
        {subTab === 'ai' && <AiManager />}
        {subTab === 'whitelist' && <WhitelistManager />}
        {subTab === 'spot' && <SpotStrategyManager />}
        {subTab === 'solo-spot' && <SoloSpotStrategyManager />}
        {subTab === 'mm' && <MmConfigManager />}
        {subTab === 'errors' && <ErrorLogManager />}
      </main>
    </div>
  );
}

export default App;
