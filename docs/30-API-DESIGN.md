# 30. API Design

> Derived from `docs/_CANON.md` — §9 (**sync protocol — definitive**), §11 (auth & claim), §14 (**API surface — the complete endpoint list**), §6 (numbering), §4 (money), §16 (security). `_CANON.md` wins on any conflict. Companion: root `API.md` (quick reference); server rules detail in docs/17-SYNC-ENGINE.md.

---

## 1. Purpose

Specify the complete dev-cloud HTTP API: conventions (content types, error envelope, status codes, authentication), a full contract for **every** endpoint in CANON §14 — request/response schemas, status codes, JSON and `curl` examples — plus the sync operation model: the entity × action validity matrix and the per-op result statuses (`applied | duplicate | conflict | rejected | number_reassigned`) with an example of each.

## 2. Scope

Covers `src/app/api/*` (Next.js route handlers) against the Prisma/SQLite dev cloud. The sync contracts are **provider-agnostic**: production swaps persistence to Supabase with byte-identical request/response shapes (CANON §8, docs/19-CLOUD-SYNC.md).

## 3. Business requirements

| # | Requirement |
|---|---|
| BR1 | The API is the **only** network surface (no server actions — CANON §2) and is small: exactly the nine endpoints in CANON §14. |
| BR2 | Every request/response body is JSON; every error is `{ error, code? }` with the CANON §14 status-code policy. |
| BR3 | All mutating endpoints authenticate (session cookie) and authorize (workspace membership + role) server-side (CANON §9, §11). |
| BR4 | The server is authoritative: it revalidates with shared Zod schemas, recomputes money (CANON §4), owns numbering (CANON §6), and is idempotent per `op_id` (CANON §9). |
| BR5 | A client that follows this contract can operate fully offline and reconcile later without data loss (no silent drops — CANON §9). |

## 4. Conventions

| Convention | Rule |
|---|---|
| Base URL | Same origin as the app (e.g., `http://localhost:3000`) |
| Content type | `application/json` for all request/response bodies (health has none) |
| Auth | Dev: `if_session` httpOnly SameSite=Lax cookie. Prod: Supabase JWT. Anonymous callers on protected routes → `401` |
| Error envelope | `{ "error": "human readable", "code": "machine_code?" }` |
| Status codes | `400` validation · `401` unauthenticated · `403` forbidden/not member · `404` missing · `409` conflict (incl. schema version) · `429` rate-limited (+ `Retry-After`) · `500` internal (CANON §14) |
| Rate limiting | 10 req/min/IP on `/api/auth/*` and `/api/workspace/claim` (docs/07) |
| IDs | UUIDv4 everywhere; timestamps ISO-8601; money paise ints; dates `YYYY-MM-DD` (CANON §3) |
| CORS | None emitted (same-origin only) |
| Validation | Shared Zod schemas from `src/lib/domain/schemas.ts` — identical on client and server (CANON §16) |

## 5. Endpoint contracts (CANON §14, complete)

### 5.1 `GET /api/health`

Liveness + connectivity heartbeat (drives the offline badge — CANON §17). No auth.

```jsonc
// 200
{ "ok": true, "time": "2025-09-21T10:15:00.000Z", "version": "0.1.0" }
```

```bash
curl -s http://localhost:3000/api/health
```

Errors: none expected; a non-2xx or timeout is treated by the client as "cloud unreachable" (never as a data error).

### 5.2 `POST /api/auth/register`

Creates an account; **claims the guest workspace automatically** when a local guest workspace exists (CANON §11). Rate limited.

```jsonc
// request
{ "name": "Priya Sharma", "email": "priya@acme.test", "password": "correct-horse-battery",
  "workspace": { "workspace_id": "uuid-of-local-ws", "name": "Acme Traders", "device_id": "uuid" } } // optional
// 200
{ "user": { "id": "u_…", "name": "Priya Sharma", "email": "priya@acme.test" },
  "claimed_workspace_id": "uuid-of-local-ws" }   // null when no guest workspace existed
```

```bash
curl -s -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Priya Sharma","email":"priya@acme.test","password":"correct-horse-battery"}'
```

| Status | When |
|---|---|
| `200` | Account created (Zod-validated body) |
| `400` | Invalid email/password policy/body |
| `409` | Email already registered (`code: 'email_taken'`) |
| `429` | Rate limited |

### 5.3 `POST /api/auth/login`

Verifies credentials (scrypt, timing-safe) and issues the session cookie. Rate limited.

```jsonc
// request
{ "email": "priya@acme.test", "password": "correct-horse-battery" }
// 200
{ "user": { "id": "u_…", "name": "Priya Sharma", "email": "priya@acme.test" } }
// Set-Cookie: if_session=<64 hex chars>; HttpOnly; SameSite=Lax; Path=/
```

```bash
curl -s -i -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"priya@acme.test","password":"correct-horse-battery"}'
```

| Status | When |
|---|---|
| `200` | Success (sets cookie) |
| `400` | Malformed body |
| `401` | Unknown email or wrong password (identical message — no enumeration) |
| `429` | Rate limited |

### 5.4 `POST /api/auth/logout`

Destroys the `Session` row and clears the cookie. Auth optional (idempotent).

```jsonc
// 200
{ "ok": true }
```

```bash
curl -s -X POST http://localhost:3000/api/auth/logout
```

### 5.5 `GET /api/auth/session`

Current user or `{ user: null }` — **never an error for anonymous visitors** (docs/07). Used on app resume.

```jsonc
// 200 (authenticated)
{ "user": { "id": "u_…", "name": "Priya Sharma", "email": "priya@acme.test" } }
// 200 (anonymous)
{ "user": null }
```

```bash
curl -s http://localhost:3000/api/auth/session
```

### 5.6 `DELETE /api/auth/account`

Deletes the account: user row, sessions, and cascades server-owned workspace data. **Local data remains** (user may clear it) — CANON §11. Requires auth + confirm dialog client-side.

```jsonc
// 204 No Content
```

```bash
curl -s -X DELETE -b cookies.txt http://localhost:3000/api/auth/account
```

| Status | When |
|---|---|
| `204` | Deleted |
| `401` | No valid session |

### 5.7 `POST /api/workspace/claim`

Attaches a local (guest) workspace to the authenticated account: creates the server workspace owned by the caller + OWNER membership + initial ChangeLog entry (CANON §11). Rate limited.

```jsonc
// request
{ "workspace_id": "local-ws-uuid", "name": "Acme Traders", "device_id": "device-uuid" }
// 200
{ "workspace": { "id": "local-ws-uuid", "name": "Acme Traders", "slug": "acme-traders",
                 "owner_user_id": "u_…", "created_at": "…", "updated_at": "…" } }
```

```bash
curl -s -X POST -b cookies.txt http://localhost:3000/api/workspace/claim \
  -H 'Content-Type: application/json' \
  -d '{"workspace_id":"local-ws-uuid","name":"Acme Traders","device_id":"device-uuid"}'
```

| Status | When |
|---|---|
| `200` | Claimed (client then sets `cloud_linked_at`, resets `pull_cursor = 0`, pushes full dataset) |
| `400` | Validation failure |
| `401` | Unauthenticated |
| `409` | Workspace already claimed (`code: 'already_claimed'`) |

### 5.8 `POST /api/sync/push`

Full contract and server rules are CANON §9 (reproduced in docs/17-SYNC-ENGINE.md §4.1). Summary of the pipeline order: auth → membership/role (≥ MEMBER) → `ProcessedOp` idempotency → Zod validation → state-transition rules → CAS on `base_version` → totals recomputation → numbering (finalize) → apply + ChangeLog + version bump.

```jsonc
// request
{ "device_id": "d-…", "workspace_id": "w-…", "schema_version": 1,
  "ops": [ { "op_id": "uuid", "entity": "invoice", "entity_id": "uuid",
             "action": "upsert|finalize|cancel|delete", "base_version": 3,
             "payload": { } } ] }            // full record; items embedded for documents
// response
{ "results": [ { "op_id": "uuid", "status": "applied|duplicate|conflict|rejected|number_reassigned",
                 "record": { }, "error": "…" } ],
  "server_time": "2025-09-21T10:15:00.000Z" }
```

```bash
curl -s -X POST -b cookies.txt http://localhost:3000/api/sync/push \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"d-1","workspace_id":"w-1","schema_version":1,"ops":[{"op_id":"o-1","entity":"customer","entity_id":"c-1","action":"upsert","base_version":1,"payload":{"id":"c-1","workspace_id":"w-1","type":"BUSINESS","business_name":"Sharma & Co","state_code":"27","updated_at":"2025-09-21T10:00:00Z","version":1}}]}'
```

| Status | When |
|---|---|
| `200` | Batch processed — **individual op outcomes are in `results[]`** (a 200 can still contain `rejected`/`conflict` ops) |
| `400` | Envelope itself invalid (bad JSON/shape) |
| `401` | Unauthenticated |
| `403` | Not a member / role too low |
| `409` | `code: 'schema_version'` — client stops syncing and shows the upgrade notice (CANON §9) |

### 5.9 `GET /api/sync/pull?workspace_id=…&cursor=<seq>&limit=500`

Change feed since `cursor` (last seen ChangeLog `seq`). Records include embedded items; `op` is the mutation kind.

```jsonc
// 200
{ "changes": [ { "seq": 41, "entity": "invoice", "op": "upsert", "record": { "id": "i-1", "version": 4 } } ],
  "next_cursor": 41,
  "server_time": "2025-09-21T10:15:00.000Z" }
```

```bash
curl -s -b cookies.txt "http://localhost:3000/api/sync/pull?workspace_id=w-1&cursor=0&limit=500"
```

| Status | When |
|---|---|
| `200` | Page returned (possibly empty `changes`) |
| `400` | Missing/invalid `workspace_id` or `cursor` |
| `401` / `403` | Unauthenticated / not a member |

## 6. Sync op model

### 6.1 Entity × action validity matrix

The `sync_operations.entity` enum is `invoice | quotation | customer | product | company | payment | workspace` and `action` is `upsert | finalize | cancel | delete` (CANON §7). Valid combinations:

| Entity | upsert | finalize | cancel | delete | Rules |
|---|:---:|:---:|:---:|:---:|---|
| `invoice` | ✓ | ✓ | ✓ | ✓ (draft only) | `finalize` allocates the number + stamps `finalized_at` (§6). FINALIZED/PAID invoices reject `upsert`/`delete`; `cancel` allowed only when `paid_total = 0` (CANON §9.5, §12) |
| `quotation` | ✓ | ✓ (= mark SENT, allocates number) | — | ✓ (draft only) | After SENT only status transitions (`ACCEPTED|REJECTED`); `CONVERTED` arises from conversion ops (CANON §12) |
| `customer` | ✓ | — | — | ✓ | Soft delete retains history (CANON §3) |
| `product` | ✓ | — | — | ✓ | Prefer `active=false` over delete for catalogs |
| `company` | ✓ | — | — | — | One profile per workspace; no delete (audit history) |
| `payment` | ✓ | — | — | ✓ | Recording recalculates invoice `paid_total`/status server-side (CANON §9, §12); `delete` reverses it |
| `workspace` | ✓ | — | — | — | Name/settings only; membership & deletion are account/API concerns (docs/28) |

Any combination not marked ✓ → per-op `rejected` (`error: 'invalid entity/action pair'`).

### 6.2 Per-op result statuses — one example each

**`applied`** — first successful apply of a new op:

```jsonc
{ "op_id": "o-1", "status": "applied",
  "record": { "id": "c-1", "workspace_id": "w-1", "business_name": "Sharma & Co",
              "version": 2, "sync_state": "synced", "updated_at": "2025-09-21T10:15:01Z" } }
```

**`duplicate`** — the same `op_id` was already processed (crash/replay); the stored outcome is returned, nothing re-applies:

```jsonc
{ "op_id": "o-1", "status": "duplicate",
  "record": { "id": "c-1", "business_name": "Sharma & Co", "version": 2 } }
```

**`conflict`** — CAS failure: `base_version` ≠ server version; the server record is attached so the client can open the conflict UI (docs/18):

```jsonc
{ "op_id": "o-2", "status": "conflict", "error": "version mismatch",
  "record": { "id": "c-1", "business_name": "Sharma & Co. (server edit)",
              "version": 7, "updated_at": "2025-09-21T09:58:11Z" } }
```

**`rejected`** — schema violation or state-rule violation; op lands in `failed` with the reason, retryable only by user edit (CANON §9):

```jsonc
{ "op_id": "o-3", "status": "rejected",
  "error": "Cannot edit finalized invoice; duplicate → edit → reissue instead",
  "record": null }
```

**`number_reassigned`** — a `finalize` whose client-allocated number was already issued elsewhere; the server allocated the next free one (CANON §6). Client **must adopt** the returned record:

```jsonc
{ "op_id": "o-4", "status": "number_reassigned", "notice": "number_reassigned",
  "record": { "id": "i-9", "number": "INV/2025-26/0043", "status": "FINALIZED",
              "finalized_at": "2025-09-21T10:15:02Z", "version": 5 } }
```

## 7. Offline behavior

The API is unreachable offline by definition; the client never blocks on it. All business ops apply locally first and enqueue `sync_operations` (CANON §1 golden rule). `navigator.onLine` + `/api/health` heartbeat gate the engine; queued ops drain via §5.8 with the retry/backoff of CANON §9 (`min(10 min, 2^attempts × 2 s)`, 8 attempts → `failed`, manual retry).

## 8. Online behavior

Normal operation is: push oldest 25 pending ops → apply per-op results → pull changes since cursor inside one local transaction (CANON §9). The client adopts server records/totals/numbers on `applied | duplicate | number_reassigned`; `conflict` surfaces in Settings → Sync → Conflicts; `rejected` is user-visible and never silently dropped.

## 9. Security considerations

Auth + role checks precede any state change (CANON §9.7, docs/28 §7); Zod on both ends with server money recomputation (CANON §4, §16); Prisma parameterization; SameSite=Lax + JSON-only APIs as the CSRF stance; rate limiting on auth/claim; secrets server-only. Detail: docs/29-SECURITY.md.

## 10. Error-handling rules

All errors use the §4 envelope. `500` responses are intentionally generic ("Internal server error") with a server-side log correlation id; clients treat `5xx` as transient and rely on outbox retry. `401` mid-sync pauses the engine with `needs_reauth` (CANON §9). `429` honors `Retry-After`. `409 { code: 'schema_version' }` halts sync with an upgrade notice (CANON §9).

## 11. Acceptance criteria

1. `curl` examples in §5 run against the dev cloud with the documented responses (health, register, login, session, logout, claim, push, pull) — they are the contract tests to formalize in docs/35-TESTING.md.
2. No endpoint outside CANON §14 exists; each returns the documented status codes and the `{ error, code? }` envelope on failure.
3. Push is idempotent: replaying a batch yields `duplicate` for already-processed `op_id`s with byte-identical stored outcomes.
4. Each result status (`applied`, `duplicate`, `conflict`, `rejected`, `number_reassigned`) is produced by the scenario in §6.2 and handled by the engine as CANON §9 prescribes.
5. Entity/action pairs outside §6.1 are rejected; FINALIZED/PAID invoices reject `upsert`/`delete`; `cancel` with payments is blocked with an explanatory error.
6. Pull returns only the caller's workspace rows, paged by `cursor`/`limit`, with `next_cursor` usable directly for the next request.
