import type { Status } from '@/lib/types';
import { Socket } from 'node:net';

export interface ProbeResult {
  status: Status;
  response_ms: number | null;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  detail: string; // human-readable health string, e.g. "200 OK", "timeout"
}

const WARN_MS = 1500; // reachable but slow -> warning
const TIMEOUT_MS = 30000; // allow for cold starts before calling it a miss

function clampPct(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Probe a URL: measure reachability + response time, and if the endpoint
// returns JSON with cpu/mem/disk (0-100) those are captured too.
//
// Expected (optional) metrics shape from the endpoint:
//   { "cpu": 34, "mem": 58, "disk": 61 }
// Nested {"metrics": {...}} is also accepted.
export async function probe(url: string): Promise<ProbeResult> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'fwai-tracker/healthcheck' },
      cache: 'no-store',
    });
    const response_ms = Date.now() - started;

    let cpu: number | null = null;
    let mem: number | null = null;
    let disk: number | null = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try {
        const body: any = await res.json();
        const m = body?.metrics ?? body ?? {};
        cpu = clampPct(m.cpu);
        mem = clampPct(m.mem ?? m.memory);
        disk = clampPct(m.disk);
      } catch {
        /* body wasn't usable JSON — ignore, keep reachability result */
      }
    }

    if (!res.ok) {
      return { status: 'down', response_ms, cpu, mem, disk, detail: `HTTP ${res.status}` };
    }

    const overloaded = [cpu, mem, disk].some((v) => v != null && v >= 90);
    const status: Status = response_ms > WARN_MS || overloaded ? 'warning' : 'healthy';
    return { status, response_ms, cpu, mem, disk, detail: `${res.status} ${res.statusText || 'OK'}` };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return {
      status: 'down',
      response_ms: null,
      cpu: null,
      mem: null,
      disk: null,
      detail: aborted ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

// TCP port check: try to open a connection to host:port. Reachable -> up
// (warning if slow); refused/timeout -> down. No CPU/mem/disk from a raw port.
export function probePort(host: string, port: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new Socket();
    let settled = false;

    const finish = (status: Status, detail: string) => {
      if (settled) return;
      settled = true;
      const response_ms = status === 'down' ? null : Date.now() - started;
      socket.destroy();
      resolve({ status, response_ms, cpu: null, mem: null, disk: null, detail });
    };

    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => {
      const ms = Date.now() - started;
      finish(ms > WARN_MS ? 'warning' : 'healthy', `open (${ms} ms)`);
    });
    socket.once('timeout', () => finish('down', 'timeout'));
    socket.once('error', (e: NodeJS.ErrnoException) => finish('down', e.code || 'unreachable'));

    try {
      socket.connect(port, host);
    } catch (e: any) {
      finish('down', e?.code || 'connect error');
    }
  });
}