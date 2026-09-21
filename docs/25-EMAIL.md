# 25 — Email

> **Extension point — not implemented in MVP.** Per CANON §19.3, email sending is a designed extension point (docs 24–27 series), not built in the MVP. This document specifies the complete future design: server-side sending with PDF attachment, templates, delivery log, and offline queue integration. The MVP's only document-distribution path is PDF download / Web Share (docs/24-WHATSAPP-SHARING.md).

> Derives from `docs/_CANON.md` (§9 sync protocol, §13 PDF, §16 security, §8 Supabase).

## Purpose

Enable "Email invoice/quotation" and "Send payment reminder" as first-class, offline-queueable actions that deliver the exact PDF the user sees, through a provider (Resend default, SES adapter) invoked **only from the server**, with a delivery log users can trust.

## Scope

- Designed (not implemented): send flow via Supabase Edge Function + provider, attachment handling, template system (`invoice_sent`, `payment_reminder`), `email_log` delivery table, outbox integration, SPF/DKIM setup, rate limits.
- Out of scope: WhatsApp (docs/24-WHATSAPP-SHARING.md), subscription/plan emails' billing logic (docs/26-SUBSCRIPTION.md reuses this pipeline for `trial_ending`), marketing campaigns (never in scope).

## Business requirements

1. BR-1 The user can email any finalized invoice/quotation PDF to the customer's email address in one action, from a browser or Electron, online or offline (queued).
2. BR-2 Reminders for overdue invoices are one-tap, pre-filled, and logged; the same invoice cannot be reminder-spammed (server-side throttle).
3. BR-3 The received email must render the same document as the in-app PDF (identical totals — the PDF is the artifact, not an HTML re-render of the invoice).
4. BR-4 Every send attempt is auditable: status, provider message id, error, timestamps.
5. BR-5 Provider credentials never reach the client (CANON §16).

## Technical design

### Sending pipeline (server-side)

- **Edge Function / API route** `POST /api/email/send` — the only place provider credentials exist.
- Provider adapter interface `MailProvider` (`send(msg) → {message_id}`) with `ResendProvider` (default) and `SesProvider` — swappable per CANON §8's provider-agnostic pattern.
- **Attachment path**: the client already renders deterministic PDFs offline (docs/14-PDF-GENERATION.md), so the client uploads the generated PDF to Supabase Storage (bucket `attachments`, path `{workspace_id}/email/{email_op_id}.pdf`, signed upload — docs/22-STORAGE.md) and passes only `attachment_path` in the request. The server fetches bytes with the service role and attaches them as base64 (Resend) or raw MIME part (SES). Fallback mode: no attachment, instead a 7-day signed URL in the body (`attachments_link: true` template variant) — used when the PDF exceeds provider size limits (~25–40 MB, far above our 2 MB cap, so attachment is the default).
- The server **renders the template** (subject + HTML + plain text) from server-side templates and validated merge fields — the client sends variables, never HTML. Variables are HTML-escaped; a plain-text alternative is always included.

### Email templates

| Template | Trigger | Merge fields |
|---|---|---|
| `invoice_sent` | User action on invoice detail | `{{company_name}}`, `{{customer_name}}`, `{{invoice_number}}`, `{{invoice_date}}`, `{{due_date}}`, `{{total}}`, `{{balance}}`, `{{pdf_note}}` |
| `payment_reminder` | User action (one-tap on overdue invoice) / future scheduler | `{{company_name}}`, `{{customer_name}}`, `{{invoice_number}}`, `{{balance}}`, `{{due_date}}`, `{{days_overdue}}` |
| `quotation_sent` | User action on quotation detail | `{{company_name}}`, `{{customer_name}}`, `{{quotation_number}}`, `{{valid_until}}`, `{{total}}` |
| `trial_ending` (docs/26) | System (day 10 of trial) | `{{company_name}}`, `{{plan}}`, `{{trial_ends_at}}` |

- Template storage: table `email_templates (id, workspace_id NULL = system default, key, subject, body_html, body_text, version, active, updated_at)`; workspace override falls back to system default; versioning keeps sent emails reproducible (`email_log.template_version`).
- Money/date values are pre-formatted server-side (`en-IN`, ₹) so client and server never disagree on rendering.

### Rendered example — `invoice_sent` (plain-text part shown; HTML mirrors it)

```
Subject: Invoice INV/2025-26/0042 from Acme Traders

Hello Sharma Electronics,

Please find attached invoice INV/2025-26/0042 dated 12 Aug 2025.
  Amount due: Rs. 1,23,456.00
  Due date:   11 Sep 2025

Thank you for your business.
— Acme Traders, GSTIN 27ABCDE1234F1Z5

Attachment: INV-2025-26-0042.pdf
```

HTML part: single-column, inline-CSS, company logo embedded as `cid:` attachment, no external images, no scripts — mail clients strip them anyway, and the XSS baseline (CANON §16) applies to what we generate too.

### Server render path (pseudocode)

```ts
async function applyEmailOp(op: EmailOp): Promise<EmailLog> {
  assertMembership(op.workspace_id, op.user_id);
  const tpl = loadTemplate(op.template, op.workspace_id);   // registry lookup, version pinned
  assertThrottle(op);                                       // 50/day/ws · 1 reminder / 7 days / invoice
  const vars = escapeAll({ ...tpl.defaults, ...op.merge, ...formatMoneyDates(op.merge) });
  const pdf = op.attachment_path ? await storage.fetch(op.attachment_path) : null; // service role
  const msg = render(tpl, vars, { attach: pdf, footer: senderFooter(op.workspace_id) });
  const res = await mailProvider.send(msg);                 // Resend | SES adapter
  return email_log.insert({ ...ids(op), status: 'sent', provider_message_id: res.message_id });
}
```

Every step maps to an `email_log` state or a rejected op — there is no path that sends mail without writing a log row (BR-4).

### Offline queue integration — email ops join the outbox

- The outbox (CANON §7 `sync_operations`) gains entity **`email`**, action **`send`** via a `schema_version` bump (1 → 2; the server validates against a versioned enum registry). Payload: `{ template, to_email, entity_type, entity_id, merge: {...}, attachment_path, idempotency_key = op_id }`.
- The client flow: render PDF → signed-upload it (only possible online; if offline, the op payload carries `attachment_needed: true` and the PDF bytes ride the op's `payload_json` — capped at 2 MB by docs/22 rules, so ops stay healthy) → enqueue op → engine pushes it like any op.
- Server processing of `entity='email', action='send'`: validate membership + template + throttle → send via provider → write `email_log` row → return `applied` with `record = email_log row` (mirrors the `record` contract of the push response). Email ops produce **no business ChangeLog mutation**; the `email_log` row itself is ChangeLog-logged as entity `email_log` for multi-device visibility.
- Retry/backoff and the `failed` terminal state reuse the engine semantics exactly (CANON §9); failed emails are visible and retryable in Settings → Sync (same table as other ops).

## Data models

### `email_log` (cloud table; mirrored locally via pull)

```
email_log:
  id uuid pk, workspace_id fk, op_id uuid (idempotency),
  entity_type ('invoice'|'quotation'), entity_id uuid,
  template text, template_version int,
  to_email text, subject text,
  status text ('queued'|'sent'|'failed'|'bounced'|'complained'),
  provider text ('resend'|'ses'), provider_message_id text?,
  error text?,
  created_at timestamptz, sent_at timestamptz?
  indexes: [workspace_id+created_at], [entity_type+entity_id], unique(op_id)
```

Statuses `bounced`/`complained` arrive via provider webhooks (future; per-recipient suppression list honored on send). Read UI: Settings → Sync gets an "Email log" section and each document page shows its share/email history.

### Local (future Dexie v2)

`sync_operations` rows with `entity='email'` (no new table — the outbox is the queue, per the design intent). PDF byte transport lives in the op payload (≤ 2 MB) or in storage via `attachment_path`.

## API contracts

```
POST /api/email/send                    # or pushed as entity='email' op via /api/sync/push
  req: { workspace_id, entity_type, entity_id, template, to_email, merge: {...},
         attachment_path?: "{ws}/email/{op_id}.pdf" }
  res: { op_id, status: 'applied'|'rejected', record?: email_log, error? }
  errors: 400 validation · 401 unauthenticated · 403 non-member · 429 throttled
POST /api/webhooks/email                # provider events (bounce/complaint), signature-verified
```

## Offline behavior

Email actions queue in the outbox exactly like document ops; the UI shows "Queued — will send when online" (docs/23-NOTIFICATIONS.md wording). PDF bytes are already local, so nothing is lost offline. On reconnect the engine drains email ops with the same backoff; a `rejected` result (bad address, throttled) surfaces like any rejected op — never silently dropped (CANON §9).

## Online behavior

Happy path: enqueue → push → provider send → `email_log('sent')` → pull applies the log row → toast "Email sent to {address}". Typical latency 1–3 s after the engine's post-mutation trigger.

## Security considerations

- **No SMTP/provider credentials client-side** — API keys live in Edge Function env only; the client cannot send email except through the membership-checked API.
- Sender identity: workspace's verified sending domain (DNS: **SPF** `include` for the provider, **DKIM** CNAME records the provider manages, **DMARC** `p=quarantine` recommended). Unverified workspaces send from the provider's sandbox domain with a footer note.
- Recipient validation (RFC-5322 syntax + MX sanity) server-side; template variables escaped (HTML + plain) to prevent injection; no raw HTML ever accepted from the client.
- Throttles: 50 emails/day/workspace (indicative, plan-gated in docs/26), 1 reminder per invoice per 7 days (server-checked via `email_log`). All limits return `429`/`rejected` with readable errors.
- `email_log` stores recipients and subjects (PII) — RLS-protected (member read, server write only), included in account deletion cascade (CANON §11).

## Error-handling rules

| Failure | Handling |
|---|---|
| Provider 5xx / network | Op retry with engine backoff; `failed` after 8 attempts (manual retry) |
| Invalid email address | Rejected immediately (400) — op marked failed with readable error, user edits the customer record |
| Throttle hit | Rejected with `429`; UI suggests trying tomorrow; never auto-drops |
| Bounce/complaint | Webhook flips `email_log.status`; address added to suppression list; user sees the status in history |
| Attachment missing at send time (storage GC edge) | Server re-requests the PDF from the client via op rejection with `reupload` notice, or falls back to link-only variant |
| Duplicate push (idempotency) | `duplicate` result with the stored `email_log` — the customer never gets two emails |

## Acceptance criteria (for the future feature)

1. AC-1 Emailing a finalized invoice offline queues it; reconnect delivers exactly one email with the PDF attached and byte-identical totals to the in-app preview.
2. AC-2 A second push of the same `op_id` returns `duplicate` and sends nothing.
3. AC-3 Reminder throttle: the second reminder for the same invoice within 7 days is rejected with a readable message.
4. AC-4 `email_log` shows the full lifecycle (queued → sent → delivered/bounced) and is visible from both the document page and Settings.
5. AC-5 No provider credential exists in any client bundle; a non-member's send request is 403.
6. AC-6 Templates render escaped customer names (a customer named `<b>X</b>` receives literal text, never bold HTML).
7. AC-7 SPF/DKIM verified domain shows `mailed-by` the customer's own domain; unverified domains fall back to the sandbox sender with a footer note.
