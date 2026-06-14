interface Env {
  'funbo-db': D1Database;
  AI: Ai;
  EMAIL?: SendEmail;
  PRIVATE_KEY: string;
  TELEGRAM_BOT_TOKEN?: string;
  GOPLUS_API_KEY?: string;
  ANKR_API_KEY?: string;
  DRPC_API_KEY?: string;
  NOWNODES_API_KEY?: string;
  GETBLOCK_API_KEY?: string;
  MORALIS_API_KEY?: string;
  BLOCKSCOUT_API_KEY?: string;
  CORS_ORIGIN?: string;
  FUNBO_R2?: R2Bucket;
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

interface SendEmail {
  send(options: {
    to: string;
    from: { email: string; name?: string };
    subject: string;
    text?: string;
    html?: string;
  }): Promise<void>;
}
