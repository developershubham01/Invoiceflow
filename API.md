# API.md

Concise reference for the InvoiceFlow dev-cloud HTTP API. Full contracts (request/response fields, validation rules, sequence diagrams) are in [docs/30-API-DESIGN.md](docs/30-API-DESIGN.md); the sync semantics in [docs/17-SYNC-ENGINE.md](docs/17-SYNC-ENGINE.md).

- **Base URL:** `http://localhost:3000` in development (the dev cloud runs inside the Next.js process). In the app, endpoints are called at relative `/api/*` paths.
- **Content type:** all request and response bodies are JSON.
- **Production note:** the sync endpoints are provider-agnostic; production swaps persistence to Supabase without changing the protocol ([docs/19-CLOUD-SYNC.md](docs/19-CLOUD-SYNC.md)).

## Authentication

- **Session cookie** (`if_session`): httpOnly, `SameSite=Lax`, 30-day expiry, backed by a random 32-byte token in the `Session` table.
- Passwords are hashed with **scrypt** (random 16-byte salt, 64-byte key, timing-safe comparison).
- **Every endpoint verifies workspace membership server-side**; writing requires role ≥ MEMBER.
- Auth routes are rate limited: **10 requests/min/IP** (in-memory token bucket).
- Production replaces this adapter with **Supabase Auth** (JWT) — the app never embeds service keys ([docs/07-AUTHENTICATION.md](docs/07-AUTHENTICATION.md)).

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness + connectivity heartbeat: `{ ok, time, version }` |
| `/api/auth/register` | POST | Create an account (auto-claims a guest workspace if one exists) |
| `/api/auth/login` | POST | Start a session (sets the `if_session` cookie) |
| `/api/auth/logout` | POST | Destroy the session |
| `/api/auth/session` | GET | Current user, or `{ user: null }` |
| `/api/auth/account` | DELETE | Delete the account and its server-side data (local data remains) |
| `/api/workspace/claim` | POST | Attach a local (guest) workspace to the authenticated account |
| `/api/sync/push` | POST | Apply a batch of local operations (outbox drain) |
| `/api/sync/pull` | GET | Fetch server changes since a cursor |

## Errors

All errors use the shape `{ "error": string, "code"?: string }` with the proper HTTP status:

| Status | Meaning |
|---|---|
| 400 | Validation failed (Zod) |
| 401 | Unauthenticated / session expired (client flags `needs_reauth` and pauses sync) |
| 403 | Forbidden — not a workspace member or insufficient role |
| 404 | Resource not found |
| 409 | Conflict — CAS/version mismatch, or `code: "schema_version"` on sync schema mismatch |
| 429 | Rate limited (auth routes) |
| 500 | Unexpected server error |

## Sync op envelope (quick reference)

**`POST /api/sync/push`** — request:

```json
{
  "device_id": "uuid",
  "workspace_id": "uuid",
  "schema_version": 1,
  "ops": [
    {
      "op_id": "uuid",
      "entity": "invoice|quotation|customer|product|company|payment|workspace",
      "entity_id": "uuid",
      "action": "upsert|finalize|cancel|delete",
      "base_version": 3,
      "payload": { "…full record, items embedded for documents…" }
    }
  ]
}
```

Response — one result per op, in order:

```json
{
  "results": [
    {
      "op_id": "uuid",
      "status": "applied|duplicate|conflict|rejected|number_reassigned",
      "record": { "…server record…" },
      "error": "…(on rejected/conflict)"
    }
  ],
  "server_time": "ISO-8601"
}
```

Server rules: idempotency via `ProcessedOp(op_id)`; Zod validation; CAS on `base_version` (→ `conflict` + server record); **totals recomputed server-side**; `finalize` allocates document numbers (server number always wins; collisions → `number_reassigned`); FINALIZED/PAID invoices reject `upsert`/`delete`; every apply appends a `ChangeLog` row and bumps `version`.

**`GET /api/sync/pull?workspace_id=…&cursor=<seq>&limit=500`** — response:

```json
{
  "changes": [
    { "seq": 41, "entity": "invoice", "op": "upsert", "record": { "…incl. items…" } }
  ],
  "next_cursor": 41,
  "server_time": "ISO-8601"
}
```

The cursor is the last seen `seq` from the server `ChangeLog`; the client persists it in `sync_metadata.pull_cursor`.

## Rate limits

- Auth endpoints (`register`, `login`): **10 requests/min/IP**, in-memory token bucket; exceeding it returns `429` with the standard error shape.
- Sync endpoints are bounded by batch size (`ops` batch of 25 per push; `limit` ≤ 500 per pull) rather than IP rate limits.

## curl quickstart

```bash
BASE=http://localhost:3000

# Health / connectivity heartbeat
curl "$BASE/api/health"

# Register an account (auto-claims a guest workspace if one exists locally)
curl -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Asha Sharma","email":"asha@example.com","password":"correct-horse-battery"}'

# Log in and keep the session cookie
curl -c cookies.txt -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"asha@example.com","password":"correct-horse-battery"}'

# (Optional) attach a guest workspace explicitly to the account
curl -b cookies.txt -X POST "$BASE/api/workspace/claim" \
  -H 'Content-Type: application/json' \
  -d '{"workspace_id":"<workspace-uuid>","name":"Asha Traders","device_id":"<device-uuid>"}'

# Push a batch of operations (drain the outbox)
curl -b cookies.txt -X POST "$BASE/api/sync/push" \
  -H 'Content-Type: application/json' \
  -d '{
    "device_id": "<device-uuid>",
    "workspace_id": "<workspace-uuid>",
    "schema_version": 1,
    "ops": [
      {
        "op_id": "<op-uuid>",
        "entity": "customer",
        "entity_id": "<customer-uuid>",
        "action": "upsert",
        "base_version": 1,
        "payload": {
          "id": "<customer-uuid>",
          "workspace_id": "<workspace-uuid>",
          "type": "BUSINESS",
          "business_name": "Gupta Electronics",
          "gstin": "27AABCU9603R1ZM",
          "state_code": "27"
        }
      }
    ]
  }'

# Pull server changes since a cursor
curl -b cookies.txt "$BASE/api/sync/pull?workspace_id=<workspace-uuid>&cursor=0&limit=500"
```

Values in `<…>` are placeholders for real UUIDs generated client-side (`crypto.randomUUID()`). A successful registration or login returns `200` and sets the `if_session` cookie; reuse it (`-b cookies.txt`) for all subsequent calls.
