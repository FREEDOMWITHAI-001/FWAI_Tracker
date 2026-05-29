import { Client } from 'ssh2';

// Read CPU / Memory / Disk from a Linux box over SSH. CPU is sampled from
// /proc/stat over ~0.4s; memory from `free`; disk from `df /`.
const CMD = [
  "cpu1=$(grep '^cpu ' /proc/stat)",
  'sleep 0.4',
  "cpu2=$(grep '^cpu ' /proc/stat)",
  `CPU=$(awk -v l1="$cpu1" -v l2="$cpu2" 'BEGIN{split(l1,a);split(l2,b);i1=a[5];t1=0;for(i=2;i<=8;i++)t1+=a[i];i2=b[5];t2=0;for(i=2;i<=8;i++)t2+=b[i];dt=t2-t1;di=i2-i1;if(dt<=0)print 0;else printf "%.0f",(1-di/dt)*100}')`,
  `MEM=$(free | awk '/^Mem:/{printf "%.0f",$3/$2*100}')`,
  `DISK=$(df -P / | awk 'NR==2{gsub("%","",$5);print $5}')`,
  'echo "$CPU|$MEM|$DISK"',
].join('; ');

export interface SshCreds {
  host: string;
  port?: number;
  username: string;
  privateKey: string; // PEM / OpenSSH private key text
  passphrase?: string;
}

export interface SshMetrics {
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  reachable: boolean;
  detail: string;
}

export function collectSshMetrics(creds: SshCreds): Promise<SshMetrics> {
  return runOverSsh(creds, CMD).then((r) => {
    if (!r.reachable) return { cpu: null, mem: null, disk: null, reachable: false, detail: r.detail };
    const line = r.output.trim().split('\n').pop() || '';
    const [c, m, d] = line.split('|');
    const num = (x: string) => {
      const n = Number(x);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
    };
    return { cpu: num(c), mem: num(m), disk: num(d), reachable: true, detail: 'ok' };
  });
}

export interface SshPortResult {
  reachable: boolean;
  response_ms: number;
  detail: string;
}

// Check if an application port is listening on the VM's localhost. We tunnel
// the check through SSH so app ports don't need to be exposed publicly — the
// only port that must be reachable from us is SSH (22).
export async function sshPortCheck(creds: SshCreds, port: number): Promise<SshPortResult> {
  const cmd = [
    'T0=$(date +%s%N)',
    `if timeout 5 bash -c "true </dev/tcp/127.0.0.1/${port}" 2>/dev/null; then S=OK; else S=FAIL; fi`,
    'T1=$(date +%s%N)',
    'echo "$S|$(( (T1-T0)/1000000 ))"',
  ].join('; ');
  const r = await runOverSsh(creds, cmd);
  if (!r.reachable) return { reachable: false, response_ms: 0, detail: r.detail };
  const line = r.output.trim().split('\n').pop() || '';
  const [s, ms] = line.split('|');
  return { reachable: s === 'OK', response_ms: Number(ms) || 0, detail: s === 'OK' ? 'ok' : 'port closed' };
}

interface SshRun {
  reachable: boolean;
  output: string;
  detail: string;
}

function runOverSsh(creds: SshCreds, command: string): Promise<SshRun> {
  return runOverSshOnce(creds, command).then(async (first) => {
    if (first.reachable) return first;
    // One retry on transient failures (timeout, handshake, reset, refused).
    // SSH from serverless functions to AWS occasionally drops the first
    // connection — a single retry with a short delay absorbs that without
    // flipping the row to Down.
    const transient = /timeout|handshake|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|EPIPE/i;
    if (!transient.test(first.detail)) return first;
    await new Promise((r) => setTimeout(r, 1000));
    const second = await runOverSshOnce(creds, command);
    return second.reachable ? second : { ...second, detail: `${first.detail} (retried: ${second.detail})` };
  });
}

function runOverSshOnce(creds: SshCreds, command: string): Promise<SshRun> {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    const finish = (r: SshRun) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const fail = (detail: string) => finish({ reachable: false, output: '', detail });

    const hardTimeout = setTimeout(() => fail('timeout'), 15000);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) return fail(err.message);
        let out = '';
        stream.on('data', (d: Buffer) => {
          out += d.toString();
        });
        stream.stderr.on('data', () => {});
        stream.on('close', () => {
          clearTimeout(hardTimeout);
          finish({ reachable: true, output: out, detail: 'ok' });
        });
      });
    });
    conn.on('error', (e) => {
      clearTimeout(hardTimeout);
      fail(e.message);
    });

    try {
      conn.connect({
        host: creds.host,
        port: creds.port || 22,
        username: creds.username,
        privateKey: creds.privateKey,
        passphrase: creds.passphrase || undefined,
        readyTimeout: 12000,
      });
    } catch (e: any) {
      fail(e?.message || 'connect error');
    }
  });
}