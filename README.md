# FWAI Tracker

VM & application monitoring for an agency/ops team — organized **client-wise and VM-wise**.
Built with **Next.js 15 (App Router) + React 19 + TypeScript**, backed by **PostgreSQL**.

This is the working app behind the `monitoring-dashboard.html` mockup: the exact same
design, but every page reads/writes real data from Postgres, with in-app **add/edit/delete**
forms for clients, VMs, applications, alerts and webinars.

---

## What's inside

| Page | Route | What it does |
|------|-------|--------------|
| Dashboard | `/` | Fleet stat cards, 14-day uptime chart, system-status donut, client table, recent alerts |
| Clients | `/clients` | Searchable/filterable list of companies + project counts; **add client** |
| Client detail | `/clients/[id]` | Projects grid, VMs table, client alerts, uptime chart; **add/edit/delete** apps & VMs; **live-check apps** (URL/host:port → response history); edit/delete the client |
| VM Status | `/vms` | Live up/down + response time via **TCP port checks** (host:port); CPU/mem/disk **bar gauges**; "Check now" + auto-refresh; cloud-account import; open a VM for big gauges & history charts; **add/edit/delete VM** |
| Zoom Metrics | `/zoom` | Webinars per client with the expandable reminder-funnel matrix; **add/edit/delete webinar** |
| Alerts | `/alerts` | Active/Resolved tabs, resolve/reopen, WhatsApp delivery history; **raise alert** |
| Reports | `/reports` | Fleet uptime, uptime-by-client bars, reliability summary |
| Settings | `/settings` | Notification toggles + editable integrations |

---

## Setup

### 1. Point at a Postgres database

```bash
cp .env.example .env.local
```

`DATABASE_URL` is the only database setting — swapping between local Docker, a managed
host and a self-hosted VM is a one-line change with no code edits.

**Local development** — bring up Postgres 17 in Docker:

```bash
docker compose up -d
```

That serves the database on host port **5433** (not 5432, so it can't clash with a local
Postgres install) and matches the `DATABASE_URL` already in `.env.example`.

**Hosted / production** — set `DATABASE_URL` to your own instance. TLS is enabled
automatically for any non-local host; append `?sslmode=disable` to force it off. On Vercel,
point it at a **pooled** endpoint (PgBouncer, or a Neon/Supabase pooler): every serverless
invocation opens its own connection, so an unpooled database will exhaust `max_connections`.

If you'll use **Cloud accounts** (AWS/Azure/GCP/OCI), Zoom or AI Sensy, also set the master
key used to encrypt those credentials at rest — any long random string
(e.g. `openssl rand -base64 48`):

```
APP_ENCRYPTION_KEY=your-long-random-string
```

> Changing `APP_ENCRYPTION_KEY` later makes every already-stored credential undecryptable.

### 2. Create the schema

```bash
npm run migrate
```

This applies everything in [`migrations/`](migrations/) in numeric order, exactly once each,
recording what ran in a `schema_migrations` table. Each file runs in its own transaction, so a
failure rolls back cleanly and leaves the database untouched. Re-running is safe — pending
migrations only.

```bash
npm run migrate -- --list   # show applied vs pending
npm run migrate -- --dry    # show what would run, change nothing
```

Adding a schema change means dropping a new `migration_NN_name.sql` into `migrations/` and
re-running the command. There is no SQL to paste into a console by hand.

### 3. Run it

```bash
npm install
npm run dev
```

Open **http://localhost:3002**. The app starts **empty** — go to **Clients → Add client**,
then open the client to add its VMs and applications.

---

## Cloud accounts (AWS / Azure / GCP)

As an alternative (or complement) to URL health-checks, you can connect a cloud provider and
have the app **import instances automatically**.

On **VM Status → Add cloud account**, pick the client the VMs belong to, give it a name, and
choose a provider tab:

- **AWS** — Access key ID, Secret access key, Default region
- **Azure** — Tenant ID, Client (Application) ID, Client secret, Subscription ID
- **GCP** — Service-account JSON key (upload the file or paste it)

Then hit **Sync** (or **Sync all**). The app lists every instance, maps its state to
healthy / warning / down, pulls recent **CPU** from the provider's monitoring API, and upserts
each one as that client's VM. Re-syncing updates the same rows. Removing an account removes the
VMs it imported.

**Credential handling:**
- Credentials are encrypted with **AES-256-GCM** (key derived from `APP_ENCRYPTION_KEY`) before
  being stored — only the ciphertext goes into the database, and it's useless without that key.
- The list endpoint never returns secrets; decryption happens only server-side during a sync.
- Use **read-only** credentials (e.g. an AWS IAM user limited to `ec2:Describe*` +
  `cloudwatch:GetMetricData`, an Azure Reader role, a GCP viewer service account).
- **Never paste credentials anywhere but the app's form.** If a key is ever exposed, rotate it.

**Notes & limits:**
- Memory/disk usually aren't available from cloud metrics without an in-VM agent installed, so
  those gauges may stay at 0 for imported VMs; CPU comes from CloudWatch / Azure Monitor / Cloud
  Monitoring. (Health-check VMs can still report mem/disk via their metrics endpoint.)
- For scheduled imports, point cron/Task Scheduler at `POST /api/cloud-accounts/sync-all`
  (GET works too), same pattern as the health-check `check-all`.

---

## Live VM monitoring (port checks)

The primary way to monitor a VM is a **TCP port check** — no cloud credentials, no agent, works
for any reachable service (web server, SSH, database, etc.).

1. Edit a VM and set its **Host / IP** and **Port** (e.g. `13.232.10.5` + `443`).
2. Hit **Check now** on the VM Status page (or toggle **Auto (60s)** while the page is open).
   Each probe opens a TCP connection to that host:port and records **up/down + connect time**
   into `vm_metrics`, so a reachability/latency **history graph** builds over time.

**Status logic:** connects → `healthy` (or `warning` if slower than 1.5s); refused/timeout →
`down`. A raw port check can't read CPU/memory/disk — those need a Health URL that returns them,
or a connected cloud account.

**Requirement:** the machine running FWAI Tracker must be able to reach that host:port over the
network (the VM's firewall / security group must allow it). Test from Windows with
`Test-NetConnection HOST -Port PORT`.

### Optional: HTTP Health URL

If a VM has no port set, the app falls back to an HTTP **Health URL** you can set instead. If
that endpoint returns JSON like `{ "cpu": 34, "mem": 58, "disk": 61 }` (0–100), those also drive
the CPU/memory/disk gauges and history. (A nested `{ "metrics": { ... } }` wrapper works too.)

### Running checks on a schedule (optional)

The in-app **Auto (60s)** toggle only runs while the page is open. For always-on monitoring, hit
the bulk endpoint from any scheduler — it probes every VM that has a host:port or a Health URL:

```
POST  http://localhost:3002/api/vms/check-all     (GET also works)
```

- **Linux/macOS cron:** `* * * * * curl -s http://localhost:3002/api/vms/check-all >/dev/null`
- **Windows Task Scheduler:** run `curl http://localhost:3002/api/vms/check-all` every minute.

To stop `vm_metrics` growing forever, periodically delete old rows (sample query is at the
bottom of `migration_02_healthchecks.sql`).

---

## How it talks to Postgres (security model)

- The database is reached **only from the server** — inside Next.js route handlers under
  `src/app/api/*` — through the pooled client in `src/lib/db.ts`.
- `DATABASE_URL` is **not** a `NEXT_PUBLIC_` variable, so the connection string (and the
  credentials in it) is never shipped to the browser.
- Client components fetch from those `/api/*` routes (`src/lib/client.ts`); they hold no
  database credentials at all.
- **Every query is parameterised.** Values are always bound as `$1, $2, …` — never
  interpolated into SQL text. The few places that must name a table or column dynamically
  (the generic insert/update/delete helpers) validate the identifier against a strict
  allowlist pattern first.
- Endpoints that return rows containing secrets select columns explicitly and strip the
  ciphertext (`ssh_key_encrypted`, `credentials_encrypted`) before responding, exposing only
  a boolean like `has_ssh`.
- The app connects as a single trusted role, so **RLS is left disabled** in the migrations. If
  you later add user auth, enable RLS and add policies (there are commented examples at the
  bottom of `migrations/migration.sql`).

> Keep this app behind your own auth / network (it assumes a trusted internal Ops team).

---

## The uptime charts

`GET /api/uptime` derives the 14-day series from the real check history — `vm_metrics` and
`app_metrics` — so the charts fill in on their own as checks run; nothing needs seeding.
A day's uptime is `checks that were reachable (status <> 'down') / total checks that day`,
bucketed in UTC. Pass `?client_id=` to scope it to one client's VMs and apps, or `?days=` to
change the window (default 14).

The bucketing and counting happen in SQL, so the endpoint stays flat as history grows rather
than reading every sample into memory.

---

## Project structure

```
fwai-tracker/
├─ docker-compose.yml          # local Postgres 17 (host port 5433)
├─ migrations/                 # numbered .sql, applied by `npm run migrate`
│  └─ migration.sql            # base schema
├─ scripts/
│  ├─ migrate.mjs              # migration runner (tracks schema_migrations)
│  └─ import-from-supabase.mjs # one-off data copy off Supabase
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx            # fonts + <Shell>
│  │  ├─ globals.css           # the FWAI design, ported verbatim
│  │  ├─ page.tsx              # Dashboard
│  │  ├─ clients/              # list + [id] detail
│  │  ├─ vms/ zoom/ alerts/ reports/ settings/
│  │  └─ api/                  # CRUD route handlers (server-side SQL)
│  ├─ components/
│  │  ├─ shell.tsx             # sidebar + header + mobile nav
│  │  ├─ ui.tsx                # Pill, StatCard, LineChart, Donut, Modal, Field…
│  │  └─ dialogs/              # add/edit forms per entity
│  └─ lib/
│     ├─ db.ts                 # server-only pg pool + query helpers
│     ├─ types.ts              # shared types + helpers
│     ├─ api.ts                # route response helpers
│     ├─ client.ts             # browser fetch helpers
│     └─ icons.tsx             # SVG icon set
└─ .env.example
```

---

## Notes

- Built on port **3002** (`npm run dev` / `npm run start`).
- A client's **overall status** is derived from its apps (down > warning > healthy) — not stored.
- Dashboard stats, uptime-by-client and the reliability summary are all computed from live data.
