const WORKER_URL = 'funbo.nobtx-io.workers.dev';

export async function onRequest(context: { request: Request; env: Record<string, string> }) {
  const url = new URL(context.request.url);
  const target = `${WORKER_URL}${url.pathname}${url.search}`;

  const headers = new Headers(context.request.headers);
  headers.delete('host');

  const proxy = new Request(target, {
    method: context.request.method,
    headers,
    body: context.request.method === 'GET' || context.request.method === 'HEAD' ? null : context.request.body,
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
