# 33. Validation

> Derived from `docs/_CANON.md` — §4 (**money & quantity rules — non-negotiable**), §5 (GST domain & GSTIN regex), §7 (entity fields), §9.2 (server Zod validation), §12 (lifecycle rules), §16 (Zod both ends). `_CANON.md` wins on any conflict. Money engine: docs/06 + `src/lib/domain/documents.ts`; error UX taxonomy: docs/34-ERROR-HANDLING.md.

---

## 1. Purpose

Define the single validation layer of InvoiceFlow: the shared Zod schemas in `src/lib/domain/schemas.ts` consumed by three call sites (forms via react-hook-form `zodResolver`, API route handlers, and the sync server), the per-entity rule tables, the cross-field document rules, server-side revalidation with total recomputation, and the resulting error UX. One schema set means a value rejected on-screen can never reappear in the cloud.

## 2. Scope

**In scope** — schema organization, field-level formats and ranges, cross-field rules, state-transition validation hooks, server recompute pipeline, validation error presentation.

**Out of scope** — computation formulas themselves (CANON §4 is definitive; `computeDocumentTotals` implements them), conflict resolution (docs/18), API envelopes (docs/30).

## 3. Business requirements

| # | Requirement |
|---|---|
| BR1 | **One source of truth**: identical Zod schemas run in the browser (forms), in API handlers, and on the sync server (CANON §9.2, §16). |
| BR2 | Financial integrity: integer paise/milli/bps only — floats and NaN are structurally impossible for validated inputs (CANON §4). |
| BR3 | India-specific formats are enforced everywhere: GSTIN regex (CANON §5), 10-digit phone, 6-digit PIN. |
| BR4 | Documents are complete before finalization: ≥ 1 item, customer, place of supply (CANON §12 supporting rules). |
| BR5 | The server **revalidates everything and recomputes every total**, overwriting client numbers (CANON §4, §9.4) — validation is a gate, recomputation is the guarantee. |
| BR6 | Errors are actionable: inline field errors in forms; document-level problems as toasts/banners (docs/31 §15). |

## 4. Schema architecture (`src/lib/domain/schemas.ts`)

- **Layering**: `metadataSchema` (id UUID, workspace_id UUID, created_at/updated_at ISO, deleted_at nullable, version int ≥ 1, sync_state enum, origin_device_id) extended by each entity schema; `documentItemSchema` shared by quotation/invoice items; `docChargeSchema` for charges.
- **Numeric contracts** (Zod `z.number().int()` everywhere money/qty/rates appear — CANON §4): `*_paise ≥ 0`, `qty_milli > 0`, `discount_bps 0–10000`, `gst_rate_bps` in the configurable set, `base_version ≥ 1`.
- **Date strings**: `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` for all financial dates (CANON §3); timestamps are ISO-8601 strings.
- **Refinements**: cross-field rules (§6) attached via `.superRefine` so both client and server get identical messages.
- **Consume sites**: forms — `useForm<z.infer<typeof schema>, resolver: zodResolver(schema)>`; API/sync — `schema.safeParse(req.body)` before any state change (CANON §9.2); ops also validate `payload` against the entity schema *plus* the action/state rules (§6.3).
- **Schema versioning**: schemas are additive-only within `schema_version: 1`; a breaking change bumps the version and triggers the sync guard (CANON §9).

## 5. Per-entity rule tables

Common for all synced entities: `id` UUID, `workspace_id` UUID, `version ≥ 1`, `deleted_at` null-or-ISO; soft-delete only (CANON §3).

### 5.1 Customer

| Field | Rule |
|---|---|
| `type` | enum `BUSINESS \| INDIVIDUAL` (required) |
| `business_name` | required if `type = BUSINESS`; `contact_person` recommended |
| `email` | optional; valid email format when present |
| `phone` | optional; exactly **10 digits** Indian mobile/landline (`^[6-9]\d{9}$` for mobiles; plain 10-digit accepted for landlines) |
| `gstin` | optional; CANON §5 regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`; state code (first 2 digits) must exist in `INDIAN_STATES` |
| `state_code` | required; must be one of the 38 state/UT codes (`src/lib/domain/gst.ts` — the code file is authoritative, CANON §5) |
| `pincode` (in addresses) | optional; **6 digits** (`^\d{6}$`) |
| `code` | server/local generator `CUS-0001` style; immutable once set |

### 5.2 Product

| Field | Rule |
|---|---|
| `name` | required, non-empty |
| `sku` / `hsn_sac` | optional; `hsn_sac` alphanumeric, snapshot onto line items |
| `unit` | optional; default `NOS` |
| `selling_price_paise` | required, **int ≥ 0** |
| `cost_price_paise` | optional, int ≥ 0 |
| `gst_rate_bps` | must be in the workspace's configurable rate set `{0, 250, 500, 750, 1200, 1800, 2800}` (0/2.5/5/7.5/12/18/28%); default from company profile (CANON §5, §7) |
| `price_includes_tax` | boolean; falls back to company default |
| `active` | boolean (catalog visibility; prefer over delete) |

### 5.3 Company profile

| Field | Rule |
|---|---|
| `name` | required |
| `gstin` | optional but **required in practice** for tax invoices — validated with the §5.1 regex when present |
| `pan` | optional; `^[A-Z]{5}[0-9]{4}[A-Z]$` |
| `state_code` / `pincode` | as §5.1 (PIN 6 digits) |
| `email` / `phone` | as §5.1 |
| `logo_data` / `signature_data` | dataURL; PNG/JPEG, **≤ 1 MB** (CANON §16) |
| `bank_ifsc` | optional; `^[A-Z]{4}0[A-Z0-9]{6}$` |
| `invoice_prefix` / `quotation_prefix` | non-empty, default `INV` / `QT`; no `/` allowed (filename safety) |
| `default_gst_rate_bps` | in the configurable set (default `1800`) |
| `price_includes_tax`, `enable_round_off` | booleans (defaults `false`, `true`) |

### 5.4 Payment

| Field | Rule |
|---|---|
| `invoice_id` | required; must reference a FINALIZED+ invoice in the same workspace |
| `amount_paise` | **int > 0** and **≤ invoice balance** (`grand_total − paid_total`) — over-allocation rejected (cross-field refinement) |
| `paid_at` | required `YYYY-MM-DD`; not before `invoice_date` (warning-level, §6.2) |
| `method` | enum `CASH \| BANK_TRANSFER \| UPI \| CHEQUE \| CARD \| OTHER` |
| `reference`, `notes` | optional strings |

### 5.5 Document items (quotation/invoice lines)

| Field | Rule |
|---|---|
| `description` | required, non-empty |
| `qty_milli` | **int > 0** (2500 = 2.5 — CANON §4) |
| `unit_price_paise` | **int ≥ 0** |
| `discount_bps` | **0–10000** inclusive |
| `gst_rate_bps` | in the configurable set `{0, 250, 500, 750, 1200, 1800, 2800}` |
| `hsn_sac` | optional; snapshot from product |
| computed `*_paise` columns | **ignored as input** — server always recomputes (§7) |

## 6. Document-level rules

### 6.1 Structural (hard errors — block save/finalize)

| Rule | Applies |
|---|---|
| **≥ 1 line item** after removing empty rows | Save draft & finalize |
| **Customer required** (`customer_id` resolves to a non-deleted customer) | Save draft & finalize |
| **Place of supply required** (`place_of_supply_code` ∈ `INDIAN_STATES`) | Save draft & finalize |
| `invoice_date` / `quotation_date` valid `YYYY-MM-DD` | Always |
| Charges: `amount_paise` int ≥ 0; if `taxable` then `gst_rate_bps` in set | When charges present |

### 6.2 Cross-field (warnings — save allowed, finalize flagged)

| Rule | Behavior |
|---|---|
| `due_date ≥ invoice_date` | Earlier due date → **warning** ("Due date is before invoice date"), never a blocker |
| `valid_until ≥ quotation_date` | Same warning pattern for quotations |
| `paid_at ≥ invoice_date` | Warning on payment entry |
| Zero-value totals at finalize (grand total = 0) | Confirm dialog — possible mistake |

### 6.3 Lifecycle validation (state gates, CANON §12)

- Draft documents: full edit. **Finalized invoices: immutable** — `upsert`/`delete` rejected server-side (correction = duplicate → edit → reissue); `cancel` allowed only while `paid_total = 0`.
- Quotations: after SENT only status transitions; CONVERTED/EXPIRED terminal (duplicate allowed).
- Status transitions validated **locally** (before enqueue) **and** on the server (before apply) with identical checks.

## 7. Server-side revalidation & recomputation

Pipeline order for every push op (CANON §9): membership/role → idempotency check → **Zod parse of the envelope and each payload** → lifecycle/state checks → CAS on `base_version` → **recompute** → apply.

Recomputation rules (CANON §4, implemented once in `src/lib/domain/documents.ts`):

1. Per line: `gross → discount → taxable/taxCombined (exclusive vs inclusive mode) → cgst/sgst or igst` — half-up rounding on the paise.
2. Totals: sums, charges + charge tax, `grandTotalRaw`, configurable round-off to the rupee (`roundOff = grandTotal − grandTotalRaw`).
3. Server **overwrites** all `*_paise` totals and item snapshot columns with its results; client-supplied totals are treated as hints at best. A mismatch between client and server totals is therefore **not** an error — the client adopts the server record (`sync_state = synced`).
4. `payment` ops recompute the invoice's `paid_total` and status (`PARTIALLY_PAID`/`PAID`) server-side; `delete` of a payment reverses it.

## 8. Error UX

- **Inline field errors** (forms): zodResolver maps issues to fields; message shown under the control in red with `aria-invalid` + `aria-describedby`; first invalid field receives focus on submit.
- **Document-level toast** (editor): structural rule failures that are not field-bound (≥ 1 item, customer required) appear as an error toast + an inline alert banner listing all problems; **Save** still allowed for drafts where the rule permits (§6.2), finalize blocked until resolved.
- **Sync `rejected` results** surface verbatim in Settings → Sync → Failed ops with the schema message (never silently dropped — CANON §9); the fix is a user edit that re-enqueues a fresh op.
- Numbers never flash misleading values: live totals always come from the domain engine, so UI totals == server totals by construction.

## 9. Offline behavior

Validation is fully local (shared schemas run in the renderer), so offline users get identical error messages before an op ever enters the outbox (CANON §1). Lifecycle rules are enforced locally too (e.g., the UI simply won't offer edit on a finalized invoice). Server revalidation can only *add* rejections (concurrent changes), never invalidate correct offline work.

## 10. Online behavior

On push, the server re-runs §7; `applied` responses carry recomputed records which the client adopts (totals, number, version). `rejected` results map 1:1 to the same schema messages the user saw in forms when applicable, keeping the vocabulary consistent.

## 11. Security considerations

Validation is the first injection defense: types, lengths, enums, and regexes reject malformed payloads before persistence (docs/29 §4.3). Money recomputation neutralizes tampered totals (CANON §4). Uploads are additionally MIME/size-gated (PNG/JPEG ≤ 1 MB). No client-derived number ever reaches storage without revalidation.

## 12. Error-handling rules

| Layer | Failure | Result |
|---|---|---|
| Form | `zodResolver` issues | Inline errors; submit blocked |
| Editor | Structural refinement fails | Banner + toast; finalize blocked |
| Local op enqueue | Schema parse fails (shouldn't — pre-validated) | Op dropped at source, console + audit note |
| Push result | `rejected { error }` | Op → `failed`, visible with reason (CANON §9) |
| Push result | Lifecycle violation (e.g., edit finalized) | Same as above; message explains the correction workflow (docs/30 §6.2) |

## 13. Acceptance criteria

1. A single schema module (`src/lib/domain/schemas.ts`) is imported by forms, API handlers, and the sync server — no duplicate validation logic exists.
2. Every monetary/quantity/rate field is `int`-typed with the §5 ranges; entering `2.5` in a paise field is impossible at the type and schema level.
3. GSTIN, PAN, IFSC, 10-digit phone, 6-digit PIN, and `YYYY-MM-DD` regexes reject known-bad samples (test fixtures listed in docs/35-TESTING.md).
4. `gst_rate_bps` accepts only the configurable set `{0, 250, 500, 750, 1200, 1800, 2800}`; adding a rate requires the workspace `tax_rates` config, not a schema drift.
5. Document rules: finalize with 0 items, missing customer, or missing place of supply is impossible locally and server-side; `due_date ≥ invoice_date` and `valid_until ≥ quotation_date` produce warnings, not blockers.
6. Payment entry above the remaining balance is rejected with a clear message; server recomputes `paid_total`/status on every payment op.
7. Tampered client totals are always overwritten by server recomputation; final stored totals match `computeDocumentTotals` exactly (half-up on the paise).
8. All validation messages are user-readable English, shown inline (fields) or as toasts/banners (document-level), and reused verbatim in sync `rejected` errors.
