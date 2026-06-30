# Scan Finder — Opt-in Diagnostics & Error Reporting — Implementation Plan

> Status: PLAN (not yet implemented). Phase 0 first.
> Governing rule: **customer safety is paramount.** This feature exists ONLY to find and
> diagnose bugs. It transmits **zero company/document data** — no field values, no masked or
> pseudonymised document data, no document content, no OCR text, no file paths, no names,
> references, totals or dates. If a data point is even *on the edge* of identifying a customer
> or their documents, it is NOT collected. Opt-in only, off by default, fully explained.

---

## 1. Non-negotiable data policy (the foundation)

### 1.1 What IS sent — the COMPLETE allowlist (nothing else is ever transmitted)
Every transmitted field is a **fixed, enumerated, typed** value from this list. There is **no
free-form text capture** anywhere in the pipe — so nothing derived from a customer document
can ride along even by accident.

**Device & build (identifies the install, never the person/company):**
- `fp_hash` — the existing pseudonymous device id (SHA-256; raw machine id never leaves the
  device). Already sent today for licensing; reused so we add no new identifier.
- `app_version`, `build_rev` — which build is running.

**Environment (the "works on my machine" support matrix):**
- `os_version` (e.g. "Windows 11 10.0.26200"), `arch` (x64), `electron_version`,
  `python_version`. Generic platform facts, no personal data.

**Event types — a fixed enum (the ONLY events that exist):**
| event | safe fields it carries |
|---|---|
| `app_start` / `app_exit` | app/env fields only |
| `main_crash` / `renderer_crash` | `error_class` (exception TYPE name), `file`, `line`, `stage` |
| `unhandled_error` | `error_class`, `file`, `line` |
| `python_exit` | `exit_code` (number), `stage` |
| `extraction_error` | `stage` (enum), `error_class`, `file`, `line` |
| `ocr_error` / `render_error` / `filing_error` | `error_class`, `file`, `line` |
| `drain_failure` | `error_code` (enum: EBUSY/EPERM/EXDEV/…) |
| `migration_failure` | `migration_version` (number) |
| `dependency_missing` | `name` (enum: tesseract / python / better_sqlite3 / …) |
| `processing_mode_used` | `mode` (fast/smart) |

**Per-event safe fields — typed/enumerated only:**
- `error_class` — the **exception type name** (e.g. `AttributeError`, `TypeError`). A type name,
  never a message, never data.
- `file` + `line` — a location in **OUR OWN source** (e.g. `anchor.py:412`). Our code, not the
  customer's.
- `stage` — pipeline stage enum (`stage0_template`, `stage2_anchor`, `ocr`, `render`, `filing`,
  `drain`, …).
- `exit_code`, `error_code`, `migration_version` — numbers / fixed enums.
- `mode` — fast/smart.
- `ts` — event timestamp (coarse; see §1.3).

### 1.2 What is NEVER sent (explicit, for the consent screen + code review)
- Document content, OCR text, page images, thumbnails.
- ANY field value: supplier/customer **names**, invoice/PO/**ref numbers**, totals, dates, codes
  — **including any masked, hashed, bucketed, shape-preserved or pseudonymised form of them.**
  (We deliberately do **not** build the masking layer — there is no document-derived data to mask.)
- File paths, folder names, output-folder locations, filenames.
- **Error/exception MESSAGE STRINGS** (a message can quote a value) — we send the exception
  *type* + our *code location* only, never the message text.
- Machine name, Windows username, email, licence keys/tokens, `account_key_hash`, the raw
  fingerprint, the masking salt — none of these.
- Document counts tied to a customer's actual volume, or precise timestamps that could
  fingerprint a workflow (see §1.3).

### 1.3 Safety rules baked into the schema
- **Allowlist is the contract.** The collector rejects any event whose `name` is not in the
  enum, and any prop key not in that event's allowed set. A sloppy future `record()` call
  cannot leak — unknown keys are dropped, not sent.
- **No string field accepts free text.** `error_class` is matched against `^[A-Za-z_][A-Za-z0-9_]*$`;
  `file` against a basename allowlist of our own source files; everything else is a number or a
  fixed enum. Anything failing the shape is dropped.
- **Defence in depth:** the collector additionally strips any value that looks path-shaped
  (contains `\`, `/`, `:` drive, or a file extension) before it can be stored — a second net
  under the allowlist.
- **Coarse time:** timestamps are rounded to the hour to avoid workflow fingerprinting.
- **No IP profiling:** the backend must NOT persist the request IP alongside telemetry rows
  (it sees IP at the TLS layer transiently for rate-limiting only).

---

## 2. Consent & transparency (opt-in, fully explained)

- **Default OFF.** Nothing is collected, queued, or sent until the user explicitly turns it on.
- **First-run wizard:** one dedicated, *unticked, separate-from-terms* step explaining the
  feature in plain English (purpose + exactly what is/ isn't sent) with a link to the full list.
- **Settings → (Advanced/Privacy):** a permanent toggle, always visible, takes effect
  immediately. Turning it OFF **purges the local buffer** (deletes any unsent events).
- **"See exactly what's sent" view:** a screen that shows (a) the plain-English allowlist from
  §1.1/§1.2, and (b) a **live read-out of the actual events currently queued** on this machine,
  rendered verbatim — so the customer can literally inspect every byte before it leaves.
- **Privacy note:** a short, human-readable paragraph on the website + in-app + in `COMPLIANCE.md`,
  stating the "your documents, names and numbers never leave your PC" promise and that diagnostics
  is separate, opt-in, and document-data-free.

---

## 3. Architecture (per eric, trimmed to the airtight scope)

```
RENDERER (UI error/feature-context)        PYTHON child (proc exit / stage error)
   │ preload: telemetryEmit(name, props)        │ JSON stdout (existing handler)
   ▼                                            ▼
 ipcMain.on('telemetry-emit')  ─────►  telemetry.record({name, props})  ◄── main-process
 (allowlist name, drop if off)          error/crash hooks (uncaughtException,
                       │                 unhandledRejection, proc.on('close'))
                       ▼
        ┌───────────────────────────────────────────────┐
        │ src/modules/telemetry.js  (single collector)   │
        │ • consent gate (cached bool)                   │
        │ • validate name ∈ enum, props ∈ allowed keys,  │
        │   each value matches its typed shape/enum      │
        │ • defence-in-depth path/value strip            │
        │ • one synchronous INSERT (better-sqlite3)      │
        └───────────────────────────────────────────────┘
                       │
                       ▼
        telemetry_events(id, ts, name, props_json, event_uid, sent DEFAULT 0)
                       │  flush: timer (~hourly) + before-quit, with jitter
                       ▼  SELECT WHERE sent=0 LIMIT 100  →  POST /v1/diagnostics
        ──────────────────────────────  HTTPS (TLS, fp_hash, no signing)  ──────────────
                       ▼
        PHP /v1/diagnostics.php → validate fp_hash → rate_hit → INSERT IGNORE → 200{accepted}
                       │
                       ▼  admin/diagnostics.php (owner-only, read-only)
```

Key reuse: `src/lib/license/client.js` (`createClient`/`defaultTransport`), `fingerprint.js`
(`computeFpHash`), `learning.getSetting/setSetting`, the numbered-migration mechanism, and the
PHP `validate.php`/`db.php`/`ratelimit.php` skeleton. The collector is a **new** module, NOT an
extension of `diaglog.js` (diaglog deliberately logs sensitive values locally — opposite contract).

**Invariants:** best-effort, swallows every error, never throws into a caller, **never blocks**
processing or startup, no network in `record()`, payload capped (`LIMIT 100` + byte ceiling),
buffer hard-capped (≈5k rows, evict oldest `sent=1` then oldest `sent=0`).

---

## 4. Phased build order

### Phase 0 — the safe pipe, end-to-end (SHIP FIRST)
Smallest slice that proves everything with minimal surface and zero risk to customers.
- **Migration** `NN_telemetry_events.sql` (next free version): `telemetry_events(id, ts, name,
  props_json, event_uid, sent DEFAULT 0)` + index `(sent,id)`. Idempotent.
- **Setting** `telemetry_enabled` (default `'false'`), via `learning.getSetting/setSetting`;
  add to settings-broadcast so the cached gate refreshes.
- **`src/modules/telemetry.js`**: `record(name, props)` (consent gate → allowlist validate →
  shape/strip → INSERT), `flush()` (batch POST, mark `sent=1` on 200), `purge()` (on opt-out),
  cap/evict. The **event-name enum + per-event prop allowlist + value shapes live here** as the
  single source of truth.
- **Feeders (Phase 0 minimal):** main-process error hooks (`uncaughtException`,
  `unhandledRejection`, Python `proc.on('close', code)` / spawn error) + `app_start`/`app_exit`.
  (Renderer + Python stage-error feeders come in Phase 1.)
- **Transport:** `POST /v1/diagnostics` via the existing client transport, short timeout,
  fp_hash + TLS, no signing; treat anything but 2xx as "leave queued".
- **Backend:** `licensing-backend/public/v1/diagnostics.php` (clone `validate.php`: fp_hash
  regex, `rate_hit`, `INSERT IGNORE` batch, `200{accepted}`, try/catch+error_log) + the
  `telemetry_events` table in `schema.sql` + the Configure script. `INSERT IGNORE` fails soft if
  the table is absent.
- **Gate:** consent OFF by default → in Phase 0 the pipe is dormant; enable only via a dev
  setting for end-to-end testing. **No customer ever sends anything in Phase 0.**
- **Tests (Electron-as-Node + Python where relevant):**
  `src/modules/test_telemetry.js` — consent-off ⇒ nothing queued; unknown event name dropped;
  disallowed prop key dropped; free-text/path-shaped value stripped; cap/evict; `sent` flag
  idempotency; flush stub marks 200 rows sent, leaves non-200 queued; opt-out purges.
  `src/modules/api/test_v1_diagnostics.js` — fp_hash validation, rate-limit, `INSERT IGNORE`
  dedupe by `event_uid`, never 400s on unknown event names (forward-compat).

### Phase 1 — consent UI + the useful diagnostic events
- First-run wizard step + Settings toggle (off by default) + the **"See exactly what's sent"**
  view (allowlist text + live queued-events read-out) + the privacy note in `COMPLIANCE.md`/site.
- Add the remaining allowlisted events: `extraction_error` (stage + exception class + file:line,
  routed from the existing Python stdout handler in `processing/handler.js` — no Python change
  needed if the class/stage are already in the JSON; otherwise emit a structured error event,
  never a message), `ocr_error`/`render_error`/`filing_error`, `drain_failure(error_code)`,
  `migration_failure(version)`, `dependency_missing(name)`, `processing_mode_used`.
- Opt-out purge wired to the toggle.

### Phase 2 — owner-side visibility & hardening
- `licensing-backend/public/admin/diagnostics.php` (behind the existing admin session+CSRF):
  read-only, paginated, filter by `name`/date/`fp_hash`, simple counts. No charts.
- Retention pruning (drop `sent=1` older than N days; enforce the row cap), server-side
  `event_uid` dedupe hardening, optional flush backoff.

### Deferred / explicitly NOT building
- The masking / pseudonymisation layer (no document-derived data is collected, so it's moot).
- Usage analytics beyond what aids diagnostics, dashboards, per-event consent granularity,
  signed telemetry (fp_hash + TLS is sufficient for write-only pseudonymous ingest).

---

## 5. Legal / compliance checklist (airtight)
- [ ] Opt-in, off by default, separate from terms acceptance (UK GDPR + PECR — analytics needs
      consent; we don't rely on legitimate interest).
- [ ] Document-data-free by construction (allowlist + no free text). Re-confirmed in code review
      on every new event added.
- [ ] "See exactly what's sent" view ships with the toggle.
- [ ] Off takes effect immediately + purges the buffer.
- [ ] Backend does not co-store IP with telemetry rows.
- [ ] Privacy note published (site + in-app + `COMPLIANCE.md`); "documents never leave your PC"
      promise re-anchored and audited across marketing copy.
- [ ] The allowlist (§1.1) and the never-list (§1.2) are the literal text shown to the customer.
```
