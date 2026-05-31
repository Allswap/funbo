import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

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
  add: (data: { chainId: number; tokenA: string; tokenB: string; label?: string }) =>
    api.post('/api/token-pairs', data),
  list: (chainId?: number) => {
    const params = chainId ? `?chainId=${chainId}` : '';
    return api.get(`/api/token-pairs${params}`);
  },
  remove: (id: number) =>
    api.delete(`/api/token-pairs/${id}`),
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
