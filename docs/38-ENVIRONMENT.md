# 38 — Environment Variables & Configuration

> Derived from `docs/_CANON.md` (§2, §8, §9, §11, §16, §17). If this doc deviates from CANON, CANON wins.

## 1. Purpose

Enumerate every environment variable InvoiceFlow reads, its scope (client/server/build), its default, and its per-environment value class; define the `.env.example` contract, environment validation, the per-environment matrix (dev/preview/production), and the secret rotation policy. The goal: no configuration ambiguity for any agent, and no secret ever reaching a client bundle or an Electron package.

## 2. Scope

| In scope | Out of scope |
|---|---|
| All `DATABASE_URL`, `NEXT_PUBLIC_*`, `SUPABASE_*`, Electron and feature-flag variables | Deployment procedures (docs/37-DEPLOYMENT.md) |
| `.env.example` canonical content, zod env validation, fallbacks | User-facing settings stored in `app_settings` (CANON §7) — runtime data, not config |
| Per-environment matrix (dev/preview/prod), secret rotation | CI secrets beyond listing (docs/37 §4.6) |

## 3. Business requirements

- **BR-1** The application must boot with safe defaults in local development from `.env.example` alone (dev-cloud mode, CANON §8: Prisma/SQLite dev cloud requires no Supabase).
- **BR-2** Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`) must be structurally impossible to import from client code: no `NEXT_PUBLIC_` prefix, validated server-side, flagged in review.
- **BR-3** Every variable must be validated at startup with a descriptive error (fail fast), so a misconfigured deploy fails loudly instead of degrading silently.
- **BR-4** Feature flags must default to the CANON behavior (cloud sync on where available, PWA registration production-only — CANON §17) and be overridable per environment without a code change.
- **BR-5** Rotation of any secret must be documented as a bounded, reversible procedure (§7) with no downtime and no client redeploy where possible.

## 4. Technical design

### 4.1 Variable reference

| Variable | Scope | Required | Default | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | Server | dev only | `file:./db/custom.db` | Prisma/SQLite dev-cloud connection (CANON §8). Not used when the Supabase persistence adapter is active; never prefixed `NEXT_PUBLIC_`. Sandbox value: `file:/home/z/my-project/db/custom.db`. |
| `NEXT_PUBLIC_APP_URL` | Client/build | yes (prod) | `http://localhost:3000` | Absolute origin used for manifest `start_url`/scope, OAuth redirect construction, and health-check self-reference. |
| `NEXT_PUBLIC_SUPABASE_URL` | Client/build | prod only | — | Supabase project URL (`https://<ref>.supabase.co`); safe public — protected by RLS (CANON §8). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client/build | prod only | — | Supabase anon (publishable) key; identity is the JWT, authorization is RLS. Never a secret by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | prod only | — | Bypasses RLS. Used exclusively inside server code (route handlers, migration/seed jobs) after its own membership/role checks (CANON §9/§16). See warning box §4.2. |
| `SUPABASE_JWT_SECRET` | **Server only** | prod only | — | HS256 secret used to verify Supabase-issued JWTs server-side (session verification in `/api/sync/*` when the Supabase auth adapter is active, CANON §11). |
| `ELECTRON_START_URL` | Desktop | no | *(packaged local bundle)* | Desktop renderer target. Unset in production → loads the bundled web build offline (CANON §17/§19.6). Set to `http://localhost:3000` for desktop-against-dev-server development. Never points to remote content in production (CANON §16). |
| `NEXT_PUBLIC_ENABLE_CLOUD_SYNC` | Client/build | no | `true` | Master feature flag for the sync engine + auth surfaces. `false` = fully local mode (guest workspaces only); outbox UI shows "cloud sync disabled". |
| `NEXT_PUBLIC_ENABLE_PWA` | Client/build | no | `true` | Gates SW registration on top of the production-only rule (`NODE_ENV === 'production'`) — CANON §17. Set `false` on preview deployments. |
| `NEXT_PUBLIC_ENABLE_REPORTS_CSV` | Client/build | no | `true` | Gates the Reports CSV export shortcuts (Settings → Data, CANON §15) for staged rollout. |

Notes:
- The dev auth adapter (scrypt + session cookie, CANON §11) requires **no** secret variable: session tokens are random 32-byte values stored hashed in the `Session` table — there is no signing secret to configure. If a future adapter swaps in NextAuth, its `NEXTAUTH_SECRET` plays exactly the role `SUPABASE_JWT_SECRET` plays today (session/JWT signing) — this is the documented equivalence; InvoiceFlow does not ship NextAuth in v1.
- `NODE_ENV` is platform-provided (Vercel/Electron build) and not listed as an app variable; it gates SW registration and dev-only diagnostics (CANON §17).
- Electron additionally honors `ELECTRON_DEV=1` internally for dev tooling; it is not a user-facing variable.

### 4.2 Server-only secret handling

> ⚠️ **WARNING — `SUPABASE_SERVICE_ROLE_KEY`**
> This key bypasses row-level security entirely. It must exist **only** in:
> - Vercel **server-side encrypted** environment variables (never "expose to previews" as plain, never in `NEXT_PUBLIC_*`),
> - CI secrets for migration jobs,
> - the Supabase dashboard.
>
> It must **NEVER** appear in: any client bundle (the `NEXT_PUBLIC_` prefix is forbidden for it by convention and by the env schema), any Electron package or main/preload file, any git-tracked file, any client-side sync payload. If it leaks: rotate immediately (§7), audit the Supabase auth log for anomalous service-role usage, and treat all workspace data as potentially exposed (docs/29-SECURITY.md incident flow).

Client/server split is enforced in code: the env module exports `clientEnv` (only `NEXT_PUBLIC_*`, importable anywhere) and `serverEnv` (all vars, importable only from `src/lib/server/**`); a lint rule (no-restricted-imports) blocks `serverEnv` outside server code.

### 4.3 Environment validation (fail fast)

```ts
// src/lib/env.ts
import { z } from 'zod';

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_ENABLE_CLOUD_SYNC: z.enum(['true', 'false']).default('true'),
  NEXT_PUBLIC_ENABLE_PWA: z.enum(['true', 'false']).default('true'),
  NEXT_PUBLIC_ENABLE_REPORTS_CSV: z.enum(['true', 'false']).default('true'),
});

const serverSchema = clientSchema.extend({
  DATABASE_URL: z.string().default('file:./db/custom.db'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  ELECTRON_START_URL: z.string().url().optional(),
});

// Coherence rules (validated at boot):
// - Supabase URL present ⇔ anon key present (pair them).
// - Cloud sync "enabled" in prod ⇔ Supabase pair present (else app starts local-only with a visible notice).
// - SUPABASE_JWT_SECRET required in prod when the Supabase auth adapter is selected.
```

A variable missing in production that the selected adapter requires produces a startup error naming the variable and the adapter — never a silent fallback to dev behavior.

### 4.4 `.env.example` (canonical reproduction)

```bash
# ---------------------------------------------------------------------------
# InvoiceFlow — environment template (copy to .env.local and adjust)
# Client-safe values use the NEXT_PUBLIC_ prefix. Everything else is
# SERVER-ONLY and must never be exposed to the browser or Electron renderer.
# ---------------------------------------------------------------------------

# ── Dev cloud (default sandbox mode: Next.js API routes + Prisma/SQLite) ──
DATABASE_URL="file:./db/custom.db"

# ── App identity ───────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# ── Supabase (production target; leave unset for dev-cloud mode) ──────────
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""

# SERVER-ONLY — bypasses RLS. NEVER prefix with NEXT_PUBLIC_. NEVER ship to
# Electron. See docs/38-ENVIRONMENT.md §4.2.
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_JWT_SECRET=""

# ── Desktop (Electron) ─────────────────────────────────────────────────────
# Unset in production builds → renderer loads the packaged local bundle.
ELECTRON_START_URL=""

# ── Feature flags (true/false) ─────────────────────────────────────────────
NEXT_PUBLIC_ENABLE_CLOUD_SYNC="true"
NEXT_PUBLIC_ENABLE_PWA="true"
NEXT_PUBLIC_ENABLE_REPORTS_CSV="true"
```

### 4.5 Per-environment matrix

| Variable | Development (local) | Preview (Vercel PR) | Production (Vercel + Supabase) | Desktop package |
|---|---|---|---|---|
| `DATABASE_URL` | `file:./db/custom.db` (dev cloud) | staging Supabase adapter active (not used) | not used (Supabase adapter active) | not used |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://<project>-<hash>.vercel.app` | `https://app.<domain>` | baked from production build |
| `NEXT_PUBLIC_SUPABASE_URL` | unset (dev cloud) | staging project URL | production project URL | baked (public value) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | unset | staging anon key | production anon key | baked (public value) |
| `SUPABASE_SERVICE_ROLE_KEY` | unset | staging service key (server-side encrypted) | production service key (server-side encrypted) | **absent** |
| `SUPABASE_JWT_SECRET` | unset | staging secret | production secret | **absent** |
| `ELECTRON_START_URL` | `http://localhost:3000` (desktop dev only) | unset | unset (loads local bundle) | unset |
| `NEXT_PUBLIC_ENABLE_CLOUD_SYNC` | `true` | `true` | `true` | baked `true` |
| `NEXT_PUBLIC_ENABLE_PWA` | `true` (SW still dev-disabled by `NODE_ENV` rule, CANON §17) | **`false`** | `true` | baked `true` (local shell, no SW needed) |
| `NEXT_PUBLIC_ENABLE_REPORTS_CSV` | `true` | `true` | `true` | baked `true` |

Invariants: preview and production use **separate Supabase projects**; only production receives production secrets; the desktop package contains only public (`NEXT_PUBLIC_`) values.

### 4.6 Secret rotation policy

| Secret | Cadence | Procedure (zero-downtime unless noted) |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 90 days or on suspicion | Supabase dashboard → rotate JWT-based keys (old key valid during grace if configured) → update Vercel server env → redeploy server routes → revoke old key. **On leak: revoke immediately; brief API downtime accepted.** |
| `SUPABASE_JWT_SECRET` | 90 days | Rotating invalidates existing Supabase JWTs → schedule with a maintenance window; users re-login (local data untouched, CANON §11 offline-first). Update Vercel secret + Supabase project together. |
| `DATABASE_URL` (dev) | n/a (local only) | Recreate file DB; dev cloud holds no production data. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | follows project key rotation | Public by design; update + redeploy clients. RLS is the security boundary. |
| Auth sessions | continuous | 30-day expiry, rotation on login (CANON §11); no operator action. |
| Desktop signing certs | per vendor validity (1–3 years) | Renew before expiry; update CI secrets; verify notarization on a staging build first. |

Rotation runbook rule: every rotation is a two-step deploy (add new → verify → remove old) and is recorded in the security log (docs/29-SECURITY.md).

## 5. Data models / API contracts

- Configuration is not part of the sync contract; `schema_version: 1` in `/api/sync/push` (CANON §9) is a constant of the build, not an env var.
- The dev-cloud adapters read exactly `DATABASE_URL` (Prisma) and the auth routes read no secrets (scrypt + random session tokens, CANON §11); the Supabase adapter reads the four `SUPABASE_*` variables — this is the entire credential surface of the app (CANON §16).

## 6. Offline behavior

- All client feature flags are baked at build time (`NEXT_PUBLIC_*`), so an offline desktop/PWA run behaves identically to its online run — flags never depend on runtime fetches.
- `ELECTRON_START_URL` unset is what makes offline desktop launch possible: the renderer loads the packaged local bundle with zero network (CANON §17, docs/36 §4.7).
- Misconfiguration never manifests as a hang: missing cloud config yields local-only mode with the guest banner (CANON §11), not a broken app.

## 7. Online behavior

- Vercel injects environment values at build (client) and runtime (server); preview and production are isolated per §4.5.
- The `/api/health` response reports `version` and, for diagnostics, which cloud adapter is active (never any secret material) — used by post-deploy checks (docs/37 §4.9).

## 8. Security considerations

- The §4.2 warning box is mirrored in docs/29-SECURITY.md; CI includes a build-artifact scan asserting the service-role key string appears in **no** client chunk and no Electron ASAR.
- `.env.local` is git-ignored; only `.env.example` is tracked and it contains empty values only.
- Client-exposed values (`NEXT_PUBLIC_*`) are treated as public knowledge: the anon key is safe only because every table is RLS-guarded (CANON §8) — the RLS release gate (docs/37 §4.2) is therefore a configuration security control, not merely a feature.
- Electron hardening (CANON §16) means even a compromised renderer cannot read process env: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, typed IPC only.

## 9. Error-handling rules

- Startup validation (§4.3) fails with the variable name, expected format, and the doc reference; no partial boot.
- Incoherent pairs (URL without anon key, cloud-sync enabled without Supabase pair in prod) are errors, not warnings, in production; in development they downgrade to local-only mode with a visible notice.
- Invalid boolean flags fall back to defaults and log once — a typo in a flag must never crash the renderer.
- Server routes that require a secret which is absent return `503 { error: 'cloud_unconfigured', code: 'server_misconfig' }` rather than leaking which variable is missing to the client.

## 10. Acceptance criteria

1. Copying `.env.example` to `.env.local` and running `pnpm dev` boots the app in dev-cloud mode with zero errors (BR-1).
2. The env module rejects: `NEXT_PUBLIC_` prefixed secret names (lint), unparseable URLs, and production boot without required adapter variables (BR-2, BR-3).
3. A production build artifact scan finds no occurrence of `SUPABASE_SERVICE_ROLE_KEY` or its value outside server code (BR-2).
4. Preview deployments register no service worker while production does (matrix §4.5 + CANON §17).
5. Every variable in §4.1 is either consumed by code or documented as reserved — no dead entries, no undocumented reads (`process.env` grep audit passes).
6. The rotation procedures of §4.6 have been dry-run on staging within the last quarter.

## 11. References

CANON §2 (sandbox mapping), §8 (dev cloud vs Supabase), §9 (sync contract), §11 (auth adapters, guest-first), §16 (security baseline), §17 (PWA/Electron), §19.1 (INR/English), §19.6 (Electron scaffold); docs/37-DEPLOYMENT.md; docs/29-SECURITY.md; docs/07-AUTHENTICATION.md; docs/19-CLOUD-SYNC.md.
