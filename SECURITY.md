# SECURITY.md

Security overview for InvoiceFlow. The full policy and threat notes are in [docs/29-SECURITY.md](docs/29-SECURITY.md); this page summarizes the baseline that all code must uphold ([`docs/_CANON.md` §16](docs/_CANON.md)).

## Baseline checklist

| Area | Measure | Status |
|---|---|---|
| Input validation | Zod validation on both client and server; shared schemas | Implemented |
| Authorization | Server-side workspace membership & role checks on **every** operation | Implemented |
| Row-level security | Supabase RLS on every table via `is_workspace_member()` / `has_role()` helpers | Migrations provided (production) |
| SQL injection | Parameterized queries via Prisma (dev cloud); Supabase Postgres in production | Implemented |
| XSS | React-safe rendering only; no `dangerouslySetInnerHTML` | Implemented |
| CSRF | `SameSite=Lax` session cookies + JSON-only API (no GET mutations) | Implemented |
| Uploads | Logo/signature limited to PNG/JPEG ≤ 1 MB (client check + dataURL size check) | Implemented |
| Rate limiting | In-memory token bucket, 10 requests/min/IP on auth routes | Implemented |
| Password storage | scrypt hashing (dev) / Supabase Auth (production) | Implemented (dev adapter) |
| Money integrity | Server recomputes every total; client numbers are never trusted | Implemented |
| Secrets policy | Service-role keys server-side only, never bundled into client code | Enforced by policy & build review |
| Electron hardening | contextIsolation, sandbox, no node integration, strict CSP, typed IPC | Scaffold provided |
| Audit logging | Records finalize / convert / cancel / payment / conflict events | Implemented |
| Dependency audit | Automated dependency auditing in CI | Defined (CI per docs/35) |

## Password storage

- Passwords are hashed with **scrypt**: random 16-byte salt per user, 64-byte derived key, verified with a timing-safe comparison. Plaintext passwords are never stored or logged.
- In production the dev auth adapter is replaced by **Supabase Auth** (email/password + Google OAuth); the application code talks to the adapter interface only ([docs/07-AUTHENTICATION.md](docs/07-AUTHENTICATION.md)).

## Session handling

- Sessions are random 32-byte tokens stored in the `Session` table; the browser holds an `if_session` cookie that is **httpOnly**, `SameSite=Lax`, with a **30-day expiry**.
- Logout destroys the server session. On `401` during sync, the client pauses syncing, flags `needs_reauth`, and prompts for re-login **without local data loss**.
- Combined with the JSON-only API (no GET mutations), `SameSite=Lax` cookies provide the CSRF defense.

## Server-side authorization & RLS

- Every API operation verifies that the caller is a member of the target workspace and has a sufficient role: **OWNER > ADMIN > MEMBER > VIEWER** (VIEWER read-only; MEMBER cannot delete; ADMIN cannot delete the workspace; writing requires ≥ MEMBER).
- In production, the same rules are enforced by **Postgres row-level security** on every table using `is_workspace_member(workspace_id)` and `has_role(workspace_id, role[])` — the client can never bypass the database policies.
- Enforcement is server-side only; client-side checks exist purely for UX.
- Account deletion (`DELETE /api/auth/account`) cascades the user's server-side data; local device data remains under the user's control.

## Money integrity

All arithmetic uses **integer paise**, milli-unit quantities, and basis-point rates with half-up rounding, computed in one shared domain engine. **The server recomputes every document total from item payloads and overwrites client-supplied numbers** — client arithmetic is never trusted. Finalized documents are immutable server-side (correction workflow: duplicate → edit → reissue), and document numbers are allocated with server authority ([docs/_CANON.md §4/§6](docs/_CANON.md)).

## Electron hardening

The desktop shell (`electron/`) follows this baseline:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- **Typed `contextBridge` API only** — no raw IPC surface exposed to the renderer
- Content Security Policy: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`
- External links opened via controlled `shell.openExternal` with an **https allow-list**; no remote content is loaded into the app shell
- Renderer reuses the web app verbatim (same security model as the PWA)

## Secrets policy

> **⚠️ Service-role keys are server-only.** Supabase service-role keys (and any other privileged credentials) must never be embedded in client bundles, committed to the repository, or exposed to the renderer process. The application never embeds service keys — privileged access happens exclusively in server-side code (`src/lib/server/`, Supabase edge/functions). Local development secrets live in `.env` (git-ignored); document required variables in `.env.example` and [docs/38-ENVIRONMENT.md](docs/38-ENVIRONMENT.md).

## Reporting policy

Security issues should be reported privately — please do not open public issues for vulnerabilities. Production deployments should publish a `/.well-known/security.txt` file with a real contact address before public launch; the file is intentionally not included in this repository because the contact endpoint is deployment-specific (placeholder to be filled at deployment time — see [docs/29-SECURITY.md](docs/29-SECURITY.md)). Every finalize/convert/cancel/payment/conflict event is recorded in `audit_logs`, providing an investigation trail for reported incidents.
