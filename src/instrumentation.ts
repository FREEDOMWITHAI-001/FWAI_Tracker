// Next.js runs this once when the server starts. We use it to launch the
// background check scheduler (server-only).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}