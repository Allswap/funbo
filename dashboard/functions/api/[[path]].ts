const WORKER_URL = 'https://YOUR_WORKER_NAME.YOUR_SUBDOMAIN.workers.dev';

export default {
  async fetch(request: Request, env: Record<string, string>, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const targetUrl = `${WORKER_URL}${url.pathname}${url.search}`;

    const headers = new Headers(request.headers);
    headers.delete('host');

    const proxy = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
    });

    try {
      const response = await fetch(proxy);
      return response;
    } catch (error: any) {
      return new Response(JSON.stringify({ error: 'Proxy failed', details: error.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
};
