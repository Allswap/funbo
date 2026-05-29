import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem('dashboard_api_key');
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
  add: (data: { name: string; address: string; chainId: number }) =>
    api.post('/api/routers', data),
  list: (chainId?: number) => {
    const params = chainId ? `?chainId=${chainId}` : '';
    return api.get(`/api/routers${params}`);
  },
  remove: (id: number) =>
    api.delete(`/api/routers/${id}`),
};

export const authService = {
  login: (apiKey: string) => {
    localStorage.setItem('dashboard_api_key', apiKey);
    return Promise.resolve({ success: true });
  },
  logout: () => {
    localStorage.removeItem('dashboard_api_key');
  },
};
