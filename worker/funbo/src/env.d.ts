export {};

declare global {
  interface Env {
    'funbo-db': D1Database;
    FUNBO_KV?: any;
    FUNBO_R2?: any;
    AI?: Ai;
    CORS_ORIGIN?: string;
    TELEGRAM_BOT_TOKEN?: string;
    BLOCKSCOUT_API_KEY?: string;
    GOPLUS_API_KEY?: string;
    ANKR_API_KEY?: string;
    DRPC_API_KEY?: string;
    NOWNODES_API_KEY?: string;
    GETBLOCK_API_KEY?: string;
    MORALIS_API_KEY?: string;
    EXECUTION_WORKER_URL?: string;
    DISCOVERY_WORKER_URL?: string;
    EXECUTION_WORKER?: Fetcher;
    DISCOVERY_WORKER?: Fetcher;
  }
}

interface Ai {
  run(
    model: string,
    options: {
      messages: { role: string; content: string }[];
      max_tokens?: number;
    }
  ): Promise<unknown>;
}
