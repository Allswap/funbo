import axios from 'axios';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const DISCOVERY_URL = (import.meta.env.VITE_DISCOVERY_URL || '').replace(/\/$/, '');

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

const discoveryApi = DISCOVERY_URL ? axios.create({
  baseURL: DISCOVERY_URL,
  headers: { 'Content-Type': 'application/json' },
}) : null;

api.interceptors.request.use((config) => {
  const apiKey = sessionStorage.getItem('dashboard_api_key');
  if (apiKey) {
    config.headers['X-API-Key'] = apiKey;
  }
  return config;
});

export const networkService = {
  add: (data: { chainId: number; name: string; rpcUrl: string; explorerUrl?: string }) =>
    api.post('/api/networks', data),
  remove: (chainId: number) =>
    api.delete(`/api/networks/${chainId}`),
  list: () =>
    api.get('/api/networks'),
  getStats: (chainId: number, explorerUrl?: string) =>
    api.get(`/api/networks/${chainId}/stats`, { params: { explorerUrl } }),
};

export const walletService = {
  add: (data: {
    label: string;
    address: string;
    chainId: number;
    strategyType: string;
    minBalancePct: number;
    maxBalancePct: number;
    minBalanceAmount: string
  }) => api.post('/api/wallets', data),
  list: () => api.get('/api/wallets'),
  remove: (id: number) => api.delete(`/api/wallets/${id}`),
  activate: (id: number, isActive: boolean) =>
    api.patch(`/api/wallets/${id}`, { is_active: isActive }),
};

export const configService = {
  set: (key: string, value: string | number) =>
    api.post('/api/config', { key, value: value.toString() }),
  get: (key: string) =>
    api.get(`/api/config/${key}`),
  getAll: () =>
    api.get('/api/config'),
  setBlockscoutApiKey: (key: string) =>
    api.post('/api/config', { key: 'blockscout_api_key', value: key }),
};

export const tradeService = {
  getHistory: (walletLabel?: string, limit = 100) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (walletLabel) params.append('walletLabel', walletLabel);
    return api.get(`/api/trades?${params}`);
  },
  runBot: () =>
    api.post('/api/bot/run'),
  getStatus: () =>
    api.get('/api/bot/status'),
};

export const routerService = {
  add: (data: { name: string; address: string; chainId: number; version?: string; quoterAddress?: string; feeTiers?: string }) =>
    api.post('/api/routers', data),
  list: (chainId?: number) => {
    const params = chainId ? `?chainId=${chainId}` : '';
    return api.get(`/api/routers${params}`);
  },
  update: (id: number, data: Partial<{ name: string; address: string; chainId: number; version: string; quoterAddress: string; feeTiers: string; isActive: boolean }>) =>
    api.patch(`/api/routers/${id}`, data),
  remove: (id: number) =>
    api.delete(`/api/routers/${id}`),
};

export const rpcPoolService = {
  add: (data: { chainId: number; url: string; priority?: number }) =>
    api.post('/api/rpc-pools', data),
  list: (chainId?: number) => {
    const params = chainId ? `?chainId=${chainId}` : '';
    return api.get(`/api/rpc-pools${params}`);
  },
  remove: (id: number) =>
    api.delete(`/api/rpc-pools/${id}`),
  preset: (chainId: number) =>
    api.post('/api/nodes/preset', { chainId }),
  check: (chainId: number) =>
    api.post('/api/nodes/check', { chainId }),
};

export const nodeService = {
  health: () => api.get('/api/nodes/health'),
  recommendedPool: (chainId: number) =>
    api.get(`/api/nodes/recommended-pool?chainId=${chainId}`),
};

export const quotaService = {
  adjust: () => api.post('/api/quotas/adjust'),
};

export const strategyService = {
  add: (data: { key: string; name: string; description?: string; params?: string }) =>
    api.post('/api/strategies', data),
  list: () =>
    api.get('/api/strategies'),
  remove: (key: string) =>
    api.delete(`/api/strategies/${key}`),
};

export const aiService = {
  add: (data: { name: string; provider: string; model: string; apiKeyRef?: string; params?: string; priority?: number; isActive?: boolean }) =>
    api.post('/api/ai', data),
  list: (provider?: string) => {
    const params = provider ? `?provider=${provider}` : '';
    return api.get(`/api/ai${params}`);
  },
  update: (id: number, data: Partial<{ name: string; provider: string; model: string; apiKeyRef: string; params: string; priority: number; isActive: boolean }>) =>
    api.patch(`/api/ai/${id}`, data),
  remove: (id: number) =>
    api.delete(`/api/ai/${id}`),
};

export const securityService = {
  add: (data: { name: string; provider: string; apiKeyRef?: string; params?: string; priority?: number; isActive?: boolean }) =>
    api.post('/api/security', data),
  list: (provider?: string) => {
    const params = provider ? `?provider=${provider}` : '';
    return api.get(`/api/security${params}`);
  },
  update: (id: number, data: Partial<{ name: string; provider: string; apiKeyRef: string; params: string; priority: number; isActive: boolean }>) =>
    api.patch(`/api/security/${id}`, data),
  remove: (id: number) =>
    api.delete(`/api/security/${id}`),
};

export const tokenPairService = {
  add: (data: { chainId: number; tokenA: string; tokenB: string; label?: string; dexLabel?: string }) =>
    api.post('/api/token-pairs', data),
  list: (chainId?: number) => {
    const params = chainId ? `?chainId=${chainId}` : '';
    return api.get(`/api/token-pairs${params}`);
  },
  update: (id: number, data: Partial<{ label: string; dexLabel: string; isActive: boolean }>) =>
    api.patch(`/api/token-pairs/${id}`, data),
  remove: (id: number) =>
    api.delete(`/api/token-pairs/${id}`),
};

export const opportunityService = {
  list: (chainId?: number, status?: string) => {
    const params = new URLSearchParams();
    if (chainId) params.append('chainId', chainId.toString());
    if (status) params.append('status', status);
    return api.get(`/api/opportunities?${params.toString()}`);
  },
};

export const discoveryPoolService = {
  add: (data: { chainId: number; apiUrl: string; apiKeyRef?: string; intervalMinutes?: number; sourceType: string; isActive?: boolean }) =>
    api.post('/api/discovery-pools', data),
  list: (chainId?: number, sourceType?: string) => {
    const params = new URLSearchParams();
    if (chainId) params.append('chainId', chainId.toString());
    if (sourceType) params.append('sourceType', sourceType);
    return api.get(`/api/discovery-pools?${params.toString()}`);
  },
  remove: (id: number) =>
    api.delete(`/api/discovery-pools/${id}`),
  runDiscovery: (data: { chainId?: number; sourceType?: string }) => {
    if (discoveryApi) return discoveryApi.post('/api/discovery/run', data);
    return Promise.reject(new Error('VITE_DISCOVERY_URL not set — configure it to use Run Discovery'));
  },
};

export const authService = {
  login: (apiKey: string) => {
    sessionStorage.setItem('dashboard_api_key', apiKey);
    return Promise.resolve({ success: true });
  },
  logout: () => {
    sessionStorage.removeItem('dashboard_api_key');
  },
};

export const spotStrategyService = {
  add: (data: { chainId: number; tokenAddress: string; stablecoinAddress: string; routerAddress: string; buyThresholdPct?: number; sellThresholdPct?: number; tradeAmount?: string }) =>
    api.post('/api/spot-strategies', data),
  list: () => api.get('/api/spot-strategies'),
  update: (id: number, data: Partial<{ tokenAddress: string; stablecoinAddress: string; routerAddress: string; buyThresholdPct: number; sellThresholdPct: number; tradeAmount: string; referencePrice: string; isActive: boolean }>) =>
    api.patch(`/api/spot-strategies/${id}`, data),
  remove: (id: number) => api.delete(`/api/spot-strategies/${id}`),
  execute: (id: number) => api.post(`/api/spot-strategies/${id}/execute`),
};

export const spotPositionService = {
  list: (status?: string) => {
    const params = status ? `?status=${status}` : '';
    return api.get(`/api/spot-positions${params}`);
  },
};

export const soloSpotStrategyService = {
  add: (data: { chainId: number; tokenAddress: string; tradeAmount?: string; minTradeAmount?: string; maxTradeAmount?: string }) =>
    api.post('/api/solo-spot-strategies', data),
  list: () => api.get('/api/solo-spot-strategies'),
  update: (id: number, data: Partial<{ tokenAddress: string; tradeAmount: string; minTradeAmount: string; maxTradeAmount: string; isActive: boolean }>) =>
    api.patch(`/api/solo-spot-strategies/${id}`, data),
  remove: (id: number) => api.delete(`/api/solo-spot-strategies/${id}`),
  execute: () => api.post('/api/solo-spot/execute'),
};

export const soloSpotTradeService = {
  list: (strategyId?: number) => {
    const params = strategyId ? `?strategyId=${strategyId}` : '';
    return api.get(`/api/solo-spot-trades${params}`);
  },
};

export const mmLpConfigService = {
  add: (data: { chainId: number; tokenAddress: string; lpAddress?: string; rebalanceThresholdPct?: number }) =>
    api.post('/api/mm-lp-configs', data),
  list: (chainId?: number) => {
    const params = chainId ? `?chainId=${chainId}` : '';
    return api.get(`/api/mm-lp-configs${params}`);
  },
  update: (id: number, data: Partial<{ tokenAddress: string; lpAddress: string; rebalanceThresholdPct: number; isActive: boolean }>) =>
    api.patch(`/api/mm-lp-configs/${id}`, data),
  remove: (id: number) => api.delete(`/api/mm-lp-configs/${id}`),
};
