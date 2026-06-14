export {};

declare global {
  interface Env {
    'funbo-db': D1Database;
    AI?: Ai;
    CORS_ORIGIN?: string;
    TELEGRAM_BOT_TOKEN?: string;
    GOPLUS_API_KEY?: string;
    ANKR_API_KEY?: string;
    DRPC_API_KEY?: string;
    NOWNODES_API_KEY?: string;
    GETBLOCK_API_KEY?: string;
    MORALIS_API_KEY?: string;
    FUNBO_R2?: R2Bucket;
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
