// Small fetch helpers for client components. Throw on non-2xx with the
// server-provided error message.

async function handle(res: Response) {
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

export const api = {
  get: <T = any>(url: string) => fetch(url, { cache: 'no-store' }).then(handle) as Promise<T>,
  post: <T = any>(url: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle) as Promise<T>,
  patch: <T = any>(url: string, body: unknown) =>
    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle) as Promise<T>,
  put: <T = any>(url: string, body: unknown) =>
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle) as Promise<T>,
  del: <T = any>(url: string) => fetch(url, { method: 'DELETE' }).then(handle) as Promise<T>,
};
