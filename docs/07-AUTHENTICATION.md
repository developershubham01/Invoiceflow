# InvoiceFlow — Authentication

> Derived from `docs/_CANON.md` (especially §9 auth, §11 auth & account model, §14 API surface, §16 security baseline). If any statement here appears to deviate from CANON, CANON wins and this doc must be corrected.

## 1. Purpose

Specify InvoiceFlow's complete authentication and account model:

- the **guest-first** account philosophy and the guest → cloud migration path (workspace claim),
- the **dev auth implementation** running in this sandbox (scrypt password hashing, httpOnly session cookie, `Session` table, rate limiting),
- the **production design** on Supabase Auth (email/password + Google OAuth, JWT → RLS) and session persistence,
- auth-expiry handling during sync, logout and account-deletion flows,
- security stance (including CSRF), error handling, and acceptance criteria.

## 2. Scope

Covers identity, sessions, and the account↔workspace link. It does **not** cover role permissions inside a workspace (CANON §8 / `docs/28-TEAM-MEMBERS.md`), the sync protocol itself (`docs/17-SYNC-ENGINE.md`), or general API design (`docs/30-API-DESIGN.md`). Auth affects sync only as a gate: the engine never runs unauthenticated against a cloud-linked workspace.

## 3. Business requirements

1. **Zero-friction start** — a user must be able to create invoices offline, with no account, forever (guest mode is first-class, CANON §11).
2. **Optional cloud, when the user is ready** — registering or claiming must attach the existing guest workspace without data loss or manual re-entry.
3. **Multi-device continuity** — one account, several devices, consistent shared state via the sync engine.
4. **Trustworthy credentials** — passwords never stored in clear text; sessions unguessable, httpOnly, expiring; brute force rate-limited.
5. **Recoverable sessions** — a 30-day session must survive restarts; expiry must degrade gracefully (pause sync, never lose data).
6. **Exit rights** — logout and full account deletion must be first-class, documented flows (CANON §11).

## 4. Technical design

### 4.1 Guest-first account model (CANON §11)

- On first launch the app creates a **local workspace** (plus an OWNER `workspace_members` row keyed by `device_id`) with `cloud_linked_at = null`. No account exists; no network call is required.
- While guest: a banner shows **"Guest workspace — connect cloud to sync"**; Settings → Security offers *Create account / Sign in*; every feature except cloud sync works.
- Two entry points attach the cloud:
  1. **Register** (`POST /api/auth/register`) — if a guest workspace exists, the claim happens **automatically** as part of registration (CANON §11).
  2. **Claim explicitly** (`POST /api/workspace/claim`) — for a user who registered elsewhere (or signs in on a device with a local workspace) and wants to attach that workspace to their account from Settings → Security.
- After claim: the client sets `cloud_linked_at`, resets `pull_cursor = 0`, and the sync engine pushes the full local dataset as normal ops (bulk-safe: batches of 25, idempotent via `ProcessedOp`).

### 4.2 Dev auth implementation (this sandbox)

The dev cloud (`src/lib/server/` + `src/app/api/*`) implements the auth adapter described below. The app consumes only the HTTP interface, so production swaps the adapter without touching feature code (`docs/19-CLOUD-SYNC.md`).

**Password hashing — scrypt:**

| Parameter | Value |
|---|---|
| Algorithm | `scrypt` (Node `crypto.scrypt`) |
| Salt | random 16 bytes per user, generated at registration |
| Derived key | 64 bytes |
| Storage | `password_hash = salt:derivedKey` (hex) on the `users` row |
| Verification | re-derive with stored salt + `timingSafeEqual` comparison (timing-safe compare) |

**Sessions:**

| Parameter | Value |
|---|---|
| Token | random 32 bytes (`crypto.randomBytes(32).toString('hex')`) |
| Storage | `sessions` table (`token` UNIQUE, `user_id`, `expires_at`) |
| Cookie | `if_session` = token; **httpOnly**, **SameSite=Lax**, `path=/`; `Secure` in production HTTPS |
| Expiry | 30 days (`expires_at = now + 30d`); sliding re-issue is not implemented in MVP — re-login after expiry |
| Lookup | `GET /api/auth/session` returns the current user or `{ user: null }` (never an error for anonymous visitors) |

**Rate limiting:** in-memory **token bucket, 10 req/min/IP** on all auth routes (`/api/auth/*`, `/api/workspace/claim`). Exceeding it yields `429 { error, code: 'rate_limited' }` with a `Retry-After` header. The limiter is per-process (dev); production replaces it with a shared limiter/edge rule — the contract (429 + `Retry-After`) is identical.

### 4.3 Workspace claim (guest → cloud migration)

`POST /api/workspace/claim { workspace_id, name, device_id }` — authenticated:

1. Server verifies the session; validates the body (Zod).
2. Creates the server `workspace` owned by the caller (`owner_user_id`).
3. Creates the caller's `workspace_members` row with role **OWNER**.
4. Writes the **initial ChangeLog entry** so later devices have a join point.
5. Responds `200 { workspace }` (errors: `401` unauthenticated, `409` workspace already claimed, `400` validation).
6. Client then: sets `cloud_linked_at`, resets `pull_cursor = 0`, and lets the sync engine push the full local dataset as normal ops.

### 4.4 Production design — Supabase Auth

| Concern | Production design |
|---|---|
| Email/password | `supabase.auth.signUp({ email, password })` (confirmation email) and `supabase.auth.signInWithPassword`; identity rows live in Supabase's `auth.users` (no custom user table) |
| Google OAuth | `supabase.auth.signInWithOAuth({ provider: 'google' })` with PKCE redirect back to the app; identity linking to an existing email/password account handled by Supabase |
| Tokens | short-lived **JWT access token** + refresh token managed by `supabase-js` (auto-refresh); the **JWT is what gates every API call and RLS policy** (`auth.uid()`) |
| RLS bridge | `workspace_members.user_id` ↔ `auth.users.id`; helper SQL functions `is_workspace_member()` / `has_role()` (`0003_functions.sql`) read `auth.uid()` — every table's policies (CANON §8) enforce tenancy |
| API enforcement | Next.js API routes / Edge Functions verify the JWT (signature via Supabase secret/JWKS), then enforce membership/role in code — **server-side enforcement only**; RLS remains defense-in-depth |
| Session persistence | `supabase-js` stores the session client-side and refreshes transparently; the app treats a failed refresh as auth-expiry (§4.5) |
| Keys | only the **anon** key (RLS-protected) may exist client-side; **service-role keys are server-side only, never bundled** (CANON §16) |

The dev adapter and Supabase expose the **same logical operations** to the app (register, login, logout, current session, claim, delete account) — see `docs/19-CLOUD-SYNC.md` for the swap procedure.

### 4.5 Auth-expiry handling during sync (CANON §9)

A 401 from any sync endpoint **never** triggers retries or data changes:

1. Engine pauses the sync loop immediately (mutex released, batch left untouched).
2. Engine sets the `needs_reauth` flag; the sync pill shows "Re-authentication required".
3. UI prompts re-login; all local data, outbox ops, and cursors remain intact.
4. After successful re-login the engine resumes: pending ops push exactly once (idempotent by `op_id`), pull resumes from `pull_cursor`.

Production nuance: `supabase-js` attempts a transparent token refresh first; only an unrecoverable refresh failure (revoked session, logged-out elsewhere) surfaces as `needs_reauth`.

### 4.6 Logout & account deletion

**Logout** — `POST /api/auth/logout`:

1. Server deletes the `Session` row (all sessions of the user, if "sign out everywhere" is chosen).
2. Cookie cleared (`Set-Cookie: if_session=; Max-Age=0; HttpOnly; SameSite=Lax`).
3. Client clears the cached user (`app_settings.session_cache`), stops the sync engine, and returns to guest mode. **Local workspace data is retained** — logout is not data loss.

**Account deletion** — `DELETE /api/auth/account` (CANON §11):

1. Requires an authenticated, confirmed destructive action (AlertDialog).
2. Server cascades the user's data: `sessions`, `workspace_members`, owned `workspaces` and all their business rows (FK cascade).
3. Client keeps **local data** (the user may clear it explicitly via Settings → Data → Clear local data) and reverts to guest mode with sync disabled.
4. The action is documented in `docs/29-SECURITY.md`; deleted server data is not recoverable.

### 4.7 Flow diagrams

**Registration → session → claim → sync enabled:**

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant UI as Settings → Security (or onboarding)
    participant API as /api/auth/* + /api/workspace/claim
    participant DB as Dev cloud (Prisma/SQLite)
    participant ENG as Sync engine

    U->>UI: Enter name, email, password
    UI->>UI: Zod validation (client)
    UI->>API: POST /api/auth/register {name, email, password}
    API->>API: Rate-limit check (10 req/min/IP)
    API->>DB: SELECT user WHERE email
    alt email already registered
        DB-->>API: existing row
        API-->>UI: 409 {error, code:'email_taken'}
    else new account
        API->>API: scrypt(password, salt=16 B) → 64 B key
        API->>DB: INSERT user (password_hash = salt:key)
        API->>API: Detect guest workspace (active_workspace_id set, cloud_linked_at null)
        API->>DB: INSERT workspace (owner_user_id = user)
        API->>DB: INSERT workspace_member (role OWNER)
        API->>DB: INSERT changelog (initial entry)
        API->>DB: INSERT session (token = 32 random bytes, expires +30 d)
        API-->>UI: 200 {user, workspace} + Set-Cookie if_session (httpOnly, SameSite=Lax)
        UI->>UI: cache user; set cloud_linked_at; reset pull_cursor = 0
        UI->>ENG: trigger sync
        ENG->>API: POST /api/sync/push (full local dataset as ops, batches ≤ 25)
        API-->>ENG: results[] (applied / duplicate / …)
        ENG->>API: GET /api/sync/pull?cursor=0
        API-->>ENG: changes[] (own records echoed back)
        ENG->>ENG: mark records synced; advance pull_cursor; last_sync_at set
    end
```

**Login:**

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant UI as LoginView (#/login)
    participant API as /api/auth/login
    participant DB as Dev cloud
    participant ENG as Sync engine

    U->>UI: Enter email + password
    UI->>API: POST /api/auth/login {email, password}
    API->>API: Rate-limit check (429 if exceeded)
    API->>DB: SELECT user WHERE email
    alt unknown email or wrong password
        API-->>UI: 401 {error:'Invalid email or password'}
        UI-->>U: Inline error — no enumeration hints
    else credentials valid
        API->>API: scrypt re-derive + timingSafeEqual
        API->>DB: INSERT session (token, expires_at = now + 30 d)
        API-->>UI: 200 {user} + Set-Cookie if_session (httpOnly, SameSite=Lax)
        UI->>UI: cache user (session_cache); enable cloud features
        UI->>ENG: sync allowed → push pending ops, pull changes
    end
```

**Auth expiry mid-sync:**

```mermaid
sequenceDiagram
    autonumber
    participant ENG as Sync engine
    participant API as /api/sync/*
    participant UI as Sync pill + dialog

    ENG->>API: POST /api/sync/push (ops batch)
    API-->>ENG: 401 (session expired)
    ENG->>ENG: pause sync; set needs_reauth (ops stay pending)
    ENG-->>UI: pill → "Re-authentication required"
    UI-->>User: re-login prompt (no data touched)
    User->>UI: authenticate again
    UI->>ENG: resume — pending ops push once (idempotent op_id)
```

## 5. Data models

### 5.1 Dev cloud (Prisma/SQLite)

**`users`**

| Field | Type | Null | Meaning |
|---|---|:---:|---|
| `id` | string, PK | no | Server-generated unique id (UUIDv4) |
| `email` | string, UNIQUE | no | Login identifier (lower-cased, trimmed) |
| `name` | string | yes | Display name |
| `password_hash` | string | no | `salt(16 B):key(64 B)` hex from scrypt |
| `created_at` / `updated_at` | datetime | no | Timestamps |

**`sessions`**

| Field | Type | Null | Meaning |
|---|---|:---:|---|
| `id` | string, PK | no | Server-generated |
| `user_id` | string, FK → users | no | Owning user (cascade delete) |
| `token` | string, UNIQUE | no | 32 random bytes (hex); stored server-side, sent only via the httpOnly cookie |
| `expires_at` | datetime | no | `created_at + 30 days`; expired rows are GC candidates |

### 5.2 Production

- `auth.users` (Supabase-managed): id, email, identities (password / Google), encrypted password, confirmed flags. Not replicated by InvoiceFlow.
- `workspace_members.user_id` = `auth.users.id` — the only app-level link identity → tenancy.
- No custom session table: refresh tokens are Supabase-managed; the JWT carries `sub` (= user id) consumed by RLS helpers.

### 5.3 Local, auth-related state

| Where | Key/Field | Content |
|---|---|---|
| `app_settings` | `device_id` | random UUID persisted on first launch (identifies guest membership) |
| `app_settings` | `session_cache` | non-authoritative display cache of the signed-in user (name/email) for offline UI |
| `workspaces` | `cloud_linked_at`, `owner_user_id` | claim markers (CANON §11) |
| `sync_metadata` | `pull_cursor`, `last_sync_*` | sync state guarded by auth |

## 6. API contracts

All bodies JSON; errors `{ error: string, code?: string }` (CANON §14). Full contracts: `docs/30-API-DESIGN.md`.

| Endpoint | Method | Request | Success | Errors |
|---|---|---|---|---|
| `/api/auth/register` | POST | `{ name, email, password }` | `200 { user, workspace? }` + session cookie (claims guest workspace automatically) | `400` validation · `409 code:'email_taken'` · `429` rate-limited |
| `/api/auth/login` | POST | `{ email, password }` | `200 { user }` + session cookie | `400` validation · `401` invalid credentials · `429` |
| `/api/auth/logout` | POST | — | `200 {}`, cookie cleared | `401` (no session) |
| `/api/auth/session` | GET | — | `200 { user }` or `200 { user: null }` | — (never 4xx for anonymous) |
| `/api/auth/account` | DELETE | — | `200 {}`, server data cascaded | `401` |
| `/api/workspace/claim` | POST | `{ workspace_id, name, device_id }` | `200 { workspace }` | `400` · `401` · `409` already claimed |

Guarantees: sessions are created only after credential verification; the cookie is the **only** credential transport (tokens never appear in JSON bodies); `GET /api/auth/session` is safe to call on every boot.

## 7. Offline behavior

- **Auth is meaningless offline — and never blocks anything.** Guest mode is the offline mode: full CRUD, numbering, PDFs, reports work with no account and no network (CANON §11).
- The sync engine **skips** runs when: offline, workspace not cloud-linked, or not authenticated (CANON §9 guard). Pending ops simply wait.
- Cached display identity (`app_settings.session_cache`) lets the topbar show the user's name offline; it is cosmetic only — the server session remains the sole authority.
- Login/register require connectivity; the buttons degrade with an offline explanation rather than a dead spinner.

## 8. Online behavior

- On boot: `GET /api/auth/session` restores identity; if a guest workspace exists and the user just registered, the claim path (§4.3) runs automatically; otherwise Settings → Security offers explicit claim.
- With a valid session and a cloud-linked workspace, the engine pushes pending ops and pulls changes per CANON §9; membership is re-verified **server-side on every op** (403 if revoked mid-session).
- Logout/account deletion immediately stops the engine (no further pushes) and leaves local data intact.

## 9. Security considerations

- **Password storage:** scrypt (16-byte salt, 64-byte key) with `timingSafeEqual` verification; plaintext passwords never logged or persisted (CANON §11).
- **Session cookie:** `if_session` is httpOnly (invisible to JS → XSS cannot steal it), `SameSite=Lax` (not sent on cross-site POSTs), `Secure` over HTTPS; 30-day expiry with server-side revocation (logout deletes the row).
- **CSRF stance (CANON §16):** no CSRF tokens. Rationale: all mutating endpoints are POST/DELETE with **JSON-only bodies** (no GET mutations), and `SameSite=Lax` prevents the cookie from being attached to cross-site requests; cross-origin JSON POSTs additionally require a CORS preflight the API never grants. This combination is the documented defense.
- **Rate limiting:** 10 req/min/IP token bucket on auth routes → slows credential stuffing; 429 responses include `Retry-After`.
- **Enumeration resistance:** login failures return one generic `401 Invalid email or password` for unknown email and wrong password alike.
- **Secrets:** service-role keys (dev cloud env, Supabase) exist only in server environment; the client bundle contains at most the public/anon key protected by RLS (CANON §16).
- **Electron:** the session flows inside the sandboxed renderer with `contextIsolation: true`; cookies belong to the shell's partition; typed IPC exposes no raw token access.
- **Least data:** the server stores identity + business data it must sync — nothing else; account deletion cascades everything server-side (CANON §11).

## 10. Error-handling rules

| Scenario | HTTP | Client behavior |
|---|---|---|
| Malformed body / weak password / invalid email | `400 { error, code:'validation' }` | Inline field errors (react-hook-form + Zod), no request retry |
| Invalid credentials | `401 { error:'Invalid email or password' }` | Inline error; generic wording (no enumeration) |
| Email already registered | `409 { error, code:'email_taken' }` | Inline error + "Sign in instead" affordance |
| Rate limit exceeded | `429 { error, code:'rate_limited' }` + `Retry-After` | Disabled submit with countdown; no auto-retry storm |
| Expired session (any call) | `401` | `needs_reauth`; sync paused; re-login prompt; **data and outbox untouched** |
| Revoked membership (removed from workspace) | `403 { error }` | Sync stops for that workspace; explanatory notice (no data wipe) |
| Workspace already claimed | `409 { error, code:'workspace_claimed' }` | Offer sign-in with the owning account |
| Network failure during auth | fetch error | Offline-aware message; form state preserved |
| Unexpected server error | `500 { error }` | Generic failure toast; safe to retry manually |

## 11. Acceptance criteria

- [ ] App is fully usable with no account (guest mode): create/edit customers, products, documents, payments, PDFs — zero auth prompts.
- [ ] Guest banner "Guest workspace — connect cloud to sync" is visible while unlinked; Settings → Security exposes register/sign-in/claim.
- [ ] `POST /api/auth/register` hashes with scrypt (16-byte salt, 64-byte key), creates the session (32-byte token, 30-day expiry), sets the `if_session` httpOnly SameSite=Lax cookie, and **automatically claims** an existing guest workspace (OWNER membership + initial ChangeLog entry).
- [ ] `POST /api/workspace/claim` attaches a local workspace to the signed-in account; client sets `cloud_linked_at`, resets `pull_cursor = 0`, and pushes the full dataset as normal ops.
- [ ] Login failures are generic (no user enumeration); auth routes enforce the 10 req/min/IP bucket and answer `429` with `Retry-After`.
- [ ] `GET /api/auth/session` returns `{ user }` or `{ user: null }`; boot restores identity from it.
- [ ] A 401 during sync pauses the engine, sets `needs_reauth`, prompts re-login, and resumes with **no data loss and no duplicate applies** (op_id idempotency).
- [ ] Logout destroys the server session, clears the cookie, stops sync, and keeps all local data; account deletion cascades server data and keeps local data.
- [ ] The client bundle contains no service keys; production uses Supabase Auth (email/password + Google OAuth) with JWT → RLS per §4.4.
- [ ] All endpoints return the `{ error, code? }` envelope with the HTTP codes of §6.
