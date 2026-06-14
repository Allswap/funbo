export async function initDB(env: Env) {
  if (!env['funbo-db']) {
    console.warn("D1 database 'funbo-db' not bound - skipping DB initialization");
    return;
  }
  try {
    await env['funbo-db'].prepare('SELECT 1').all();
  } catch (e) {
    console.error(`Database verification failed:`, (e as Error).message);
  }
}
