export type NodeHealth = {
  url: string;
  provider: string | null;
  chain_id: number | null;
  status: number;
  latency_ms: number | null;
  last_checked?: string;
};

export type QuotaRow = {
  service: string;
  metric: string;
  limit_value: number;
  current_usage: number;
  window_seconds: number;
};
