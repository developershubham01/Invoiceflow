# 29. Security

> Derived from `docs/_CANON.md` — §4 (money integrity), §8 (RLS), §9 (sync server rules), §11 (auth & account), §14 (API surface), §16 (**security baseline — definitive**), §17/§19.6 (Electron). `_CANON.md` wins on any conflict. Deep dives: docs/07-AUTHENTICATION.md, docs/28-TEAM-MEMBERS.md, docs/19-CLOUD-SYNC.md, docs/22-STORAGE.md.

---

## 1. Purpose

Consolidate InvoiceFlow's security posture into one reference: authentication and session hardening, server-side authorization, input validation and money integrity, injection and XSS defenses, CSRF stance, Electron shell hardening, secrets management, upload validation, audit logging, dependency hygiene, account deletion/data export, the threat model, and acceptance criteria. Every item traces directly to CANON §16.

## 2. Scope

**In scope** — client (web PWA + Electron renderer), API routes, dev cloud, Supabase production design, local storage on shared devices, and the desktop shell.

**Out of scope** — role matrix detail (docs/28), session/auth flows (docs/07), storage bucket policies (docs/22), sync protocol mechanics (docs/17).

## 3. Business requirements

| # | Requirement |
|---|---|
| BR1 | Financial data is never corrupted by a client: the **server recomputes all money** and overwrites client numbers (CANON §4, §9.4). |
| BR2 | All authorization is **server-side**: membership + role checks on every op; RLS as the production backstop (CANON §8, §16). |
| BR3 | Credentials and sessions are hardened: scrypt hashing (dev) / Supabase Auth (prod), httpOnly SameSite cookies, rate-limited auth (CANON §11, §16). |
| BR4 | Untrusted input never reaches a query, the DOM, or the filesystem unvalidated: Zod both ends, parameterized queries, React escaping, strict CSP (CANON §16). |
| BR5 | The Electron shell is sandboxed: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, typed IPC only, allow-listed external links (CANON §16). |
| BR6 | Users can leave: **account deletion** cascades server data; **data export** (JSON backup/CSV) is always available (CANON §11, §15 Settings → Data). |
| BR7 | Sensitive actions are auditable: finalize/convert/cancel/payment/conflict written to `audit_logs` (CANON §16). |

## 4. Technical design

### 4.1 Authentication security

| Area | Dev (sandbox) | Production |
|---|---|---|
| Password storage | `scrypt`, random 16-byte salt, 64-byte key, `timingSafeEqual` compare (CANON §11) | Supabase Auth (bcrypt/argon2 internally); app never sees hashes |
| Session token | Random 32 bytes, stored in `sessions` table, 30-day expiry | Supabase JWT (access + refresh, rotating) |
| Cookie | `if_session` — **httpOnly**, **SameSite=Lax**, `path=/`, `Secure` on HTTPS | httpOnly cookie or bearer JWT per Supabase client config |
| Rate limiting | In-memory token bucket, **10 req/min/IP** on `/api/auth/*` + `/api/workspace/claim`; `429` + `Retry-After` | Shared/edge limiter (same contract) |
| Brute force | Rate limit + generic error messages (no "email exists" on login) | Supabase leak-protection options |

Session fixation is prevented by generating a fresh token at login; logout destroys the row (not just the cookie).

### 4.2 Authorization

- Every mutating endpoint resolves the caller's `workspace_members` row and applies the role matrix (docs/28 §5) **before** touching state; sync ops additionally require `role ≥ MEMBER` (CANON §9.7).
- Production defense in depth: RLS enabled on all 17 tables via `is_workspace_member()` / `has_role()` (CANON §8); even a buggy API route cannot read or write across workspaces because Postgres itself filters rows.
- `workspaces.owner_user_id` is server-written only; clients can never self-assign ownership.

### 4.3 Input validation & money integrity

- **Zod validates on both ends** using the *same* schemas from `src/lib/domain/schemas.ts` (CANON §16, docs/33-VALIDATION.md): forms (RHF `zodResolver`), API route handlers, and the sync server.
- The server **recomputes every total** from item payloads with `computeDocumentTotals` (shared domain engine) and overwrites client-supplied numbers — client arithmetic is never trusted (CANON §4, §9.4).
- Amounts are integer paise, quantities integer milli-units, rates integer bps — floats are rejected at schema level (docs/33).
- State transitions are re-validated server-side (e.g., `upsert` of a FINALIZED invoice → `rejected`; `cancel` with payments → blocked with explanation) per CANON §9.5, §12.

### 4.4 Injection & XSS

| Vector | Defense |
|---|---|
| SQL injection | Prisma client — all queries parameterized; no string-concatenated SQL anywhere. Supabase: PostgREST parameterization + RLS. |
| XSS | React escapes all output by default; **`dangerouslySetInnerHTML` is banned** (lint-enforced). Company logo/signature render as `data:` images via `<img src>`, never as markup. PDF text goes through jsPDF `text()` (no HTML). |
| CSP (web, production) | `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'` (CANON §16). No third-party script origins; analytics absent by design. |
| Template/JS injection | No `eval`, no `new Function`, no dynamic `import()` of remote URLs (lint rules + CSP `default-src 'self'`). |

### 4.5 CSRF stance

- Session cookie is `SameSite=Lax` → cross-site POSTs from other origins do not carry it (CANON §16).
- All mutating endpoints are **JSON-only** (`Content-Type: application/json`, JSON body) — classic form-based CSRF cannot construct them; **no GET mutations exist** (CANON §14 conventions).
- No CORS headers are emitted (same-origin only), so even token-bearing JS from foreign origins cannot read responses. A separate CSRF token is therefore unnecessary in this threat model and is not used.

### 4.6 Electron hardening (CANON §16, scaffold in `electron/`)

| Control | Setting / behavior |
|---|---|
| Process isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on every `BrowserWindow` |
| Bridge surface | One typed `contextBridge` API (`window.invoiceflow`); every IPC handler type-guards `unknown` payloads before use |
| Navigation | Strict `will-navigate` allow-list (bundle origin only); `setWindowOpenHandler` denies all window.open |
| External links | Only via controlled `shell.openExternal` with an **https allow-list** (`EXTERNAL_HOST_ALLOWLIST`); everything else is blocked |
| Remote content | None — renderer is the local Next.js bundle; CSP injected via `onHeadersReceived` |
| Permissions | Global `setPermissionRequestHandler` deny-all (camera, geolocation, notifications, …) |
| Extras | Single-instance lock, `will-attach-webview` blocked, packaged renderer over `file://` of the static export |

### 4.7 Secrets management

- **Service-role keys, database URLs, and webhook secrets live only server-side** (env vars on the API host) and are **never bundled into client code** (CANON §16). The app embeds only publishable values (e.g., the app's own origin).
- `.env*` files are git-ignored; `.env.example` documents names without values (docs/38-ENVIRONMENT.md).
- Client → Supabase always passes through RLS with the user's JWT; the service key exists only in Edge Functions / trusted server contexts.
- No secrets in logs: request logging redacts cookies and bodies; error reports carry stack traces, never tokens.

### 4.8 Upload & attachment validation

- Logo/signature: **PNG/JPEG only, ≤ 1 MB**, enforced client-side (MIME sniff + `File.size`) and by dataURL size check before persisting to `company_profiles` (CANON §16); rendered via `<img>` (no decoding beyond the browser's image pipeline).
- Attachments: inline blobs ≤ 2 MB in MVP (docs/22-STORAGE.md); MIME allow-list; filenames sanitized before any filesystem use in Electron (`sanitizeFileName`).
- Production storage: Supabase buckets with path convention `{workspace_id}/{entity}/{filename}` + RLS-style bucket policies (CANON §8, docs/22).

### 4.9 Audit logging

`audit_logs` records security-relevant business events: `FINALIZE`, `CONVERT`, `CANCEL`, `PAYMENT`, `SYNC_CONFLICT`, plus `CREATE|UPDATE|DELETE|STATUS` (CANON §7, §16). Each row carries `entity_type`, `entity_id`, `action`, `detail_json`, `device_id`, `at`, and (production) `actor_user_id`. Production policies make the table **append-only** for clients (no UPDATE/DELETE) — tamper evidence. Server-side security events (failed logins, 429s, rejected ops) are logged server-side without secrets.

### 4.10 Dependency & supply-chain hygiene

- Pinned dependency versions with a lockfile (docs/04-TECH-STACK.md policy); automated **`audit` in CI** (CANON §16) plus Renovate-style update reviews when the monorepo is scaffolded.
- Minimal dependency surface: no runtime client network SDKs beyond the fetch-based cloud client; Electron scaffold pins major versions and is rebuilt/packaged in CI.

### 4.11 Account deletion & data export

- **Delete account**: `DELETE /api/auth/account` — destroys the user, sessions, and cascades server-owned workspace data; **local data remains** on-device (user may clear it via Settings → Data → Clear local data) (CANON §11). Requires an authenticated session and a confirm dialog; returns `204`.
- **Export** (always available, even offline): JSON backup export/import and per-report CSV from Settings → Data (CANON §15) — this is the user's data-ownership path and doubles as the backup mechanism (docs/39-BACKUP-RESTORE.md).

## 5. Threat model

| Threat | Vector | Mitigation |
|---|---|---|
| Stolen session cookie | XSS, network sniffing, local access | httpOnly + `Secure` cookie (no JS read), HTTPS, SameSite=Lax, 30-day expiry, server-side revocation on logout |
| Credential brute force | `/api/auth/login` | 10 req/min/IP token bucket → `429` + `Retry-After`; scrypt raises offline cost; generic errors avoid user enumeration |
| Cross-workspace data access | Forged `workspace_id` in requests | Server membership check + role gate (CANON §9.7); RLS filters every row query in production |
| Privilege escalation | Client claims other role / self-claims ownership | `owner_user_id` server-written only; role matrix enforced in API + RLS; membership mutations restricted to OWNER/ADMIN |
| Financial data tampering in transit | Client sends doctored totals | Server recomputes all totals from items (CANON §4); Zod rejects malformed payloads → `rejected` |
| Invoice-number collision | Two devices finalize concurrently | Server-authoritative sequences in serializable transaction; `number_reassigned` resolution (CANON §6) |
| SQL injection | Malformed inputs to queries | Prisma parameterization; no dynamic SQL; PostgREST in production |
| XSS / script injection | Company fields, notes, filenames | React escaping, no `dangerouslySetInnerHTML`, strict CSP, sanitized filenames |
| CSRF | Crafted cross-site form/request | SameSite=Lax cookie + JSON-only APIs + no CORS; no GET mutations |
| Malicious/buggy renderer in Electron | Compromised iframe/remote content | No remote content; `sandbox` + `contextIsolation`; deny-all permission handler; allow-listed navigation & external links |
| Arbitrary file write (desktop) | IPC payload with path | Type-guarded IPC; only user-chosen paths via dialogs are written; filename sanitization |
| Secret leakage | Bundled keys in client | Service keys server-only (CANON §16); env git-ignored; log redaction |
| Oversized/malicious uploads | Logo/attachment abuse | MIME allow-list (PNG/JPEG), ≤ 1 MB branding / ≤ 2 MB attachments, dataURL size check |
| Local data exposure on shared device | IndexedDB readable by other OS users | Documented risk: device-level OS security is expected; guest/clear-local-data flows; JSON export for portability (CANON §19.8) |
| Supply-chain compromise | Vulnerable dependency | CI audit + pinning + minimal deps |

## 6. API contracts (security-relevant)

Error envelope `{ error: string, code?: string }` with status codes per CANON §14: `400` validation, `401` unauthenticated, `403` forbidden/not member, `404` missing, `409` conflict (incl. `schema_version`), `429` rate-limited, `500` internal. Full endpoint contracts: docs/30-API-DESIGN.md. Security additions: `Retry-After` header on `429`; no stack traces or internal identifiers in client-facing errors; every 401 from sync triggers the `needs_reauth` pause (CANON §9).

## 7. Offline behavior

- Offline is the **default safe state**: no credentials in transit, no server exposure; IndexedDB is the store of record. All validation still runs locally via shared Zod schemas, so only valid data ever enters the outbox.
- Local session cache lives in `app_settings.session_cache` (non-sensitive profile data only — never the password or raw token material beyond what the cookie already carries).
- If IndexedDB is unavailable or evicted (browser storage pressure), the app shows the storage banner and advises PWA install / desktop app / JSON backup (CANON §17, §19.8) — availability mitigation, not a confidentiality control.

## 8. Online behavior

- First authenticated action after resume revalidates the session (`GET /api/auth/session`); expired sessions degrade to `needs_reauth` without data loss (docs/07).
- Sync traffic is always authenticated and workspace-scoped; pull responses contain only rows belonging to the caller's membership (enforced by query + RLS).

## 9. Security acceptance criteria

1. Every mutating endpoint performs: session → membership → role → Zod validation → state check → apply, in that order; ordering is visible in code and covered by the review checklist (docs/35-TESTING.md defines the tests to add).
2. A request with a valid session but no membership receives `403`; a VIEWER receives `403`/`rejected` on every write; a MEMBER cannot delete; an ADMIN cannot delete a workspace (docs/28 matrix).
3. No `dangerouslySetInnerHTML`, no `eval`, no concatenated SQL exists in the codebase (grep-able and lint-enforced).
4. Cookies are `httpOnly; SameSite=Lax` (+ `Secure` in production HTTPS); auth routes rate-limit at 10 req/min/IP with `429` + `Retry-After`.
5. Electron windows run with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; all external navigation goes through the https allow-list.
6. No service-role key or DB URL appears in any client bundle (build-time grep in CI).
7. Uploads: PNG/JPEG > 1 MB for branding (and > 2 MB generic attachments) are rejected client- and server-side.
8. `audit_logs` contains entries for finalize/convert/cancel/payment/conflict and is append-only in production.
9. `DELETE /api/auth/account` removes all server-side user data (verified by fresh-session `404`/`401` behavior afterwards) while local data remains until the user clears it.
10. CI runs dependency audit and fails on high/critical advisories.
