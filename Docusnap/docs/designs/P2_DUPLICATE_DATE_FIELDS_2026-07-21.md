# P2 — Irrelevant date fields all filled with the same value (DIAGNOSIS ONLY)

**Status:** DIAGNOSED, not built (owner-set scope for the 2026-07-21 night run = *diagnose P2 only*).
**Author:** night run 2026-07-21 (Opus 4.8). **Advisors:** none yet — this doc is the input to an Oracle vet + owner decision before ANY build.
**Evidence:** read-only probe of the live DB (`%APPDATA%\ScanFinder\docusnap.db`, migration 52, 185 confirmed docs). Probe script: `scratchpad/p2_probe.js`.

---

## 1. The report

Learning Repair on `IronbridgeFabrication_delivery_docket_04.pdf` (live doc **#7**) showed a **Delivery Note** carrying **Delivery Date, Invoice Date, Order Date AND Po Date**, all four = `12-06-2026`, while the *real* Delivery Date had read as the garbled `2 12/06/2026` (conf 30) and was flagged. Two separate faults:
- **(a)** a delivery note carries invoice/order/po date fields *at all*.
- **(b)** one date value is copied into every one of them, which then feeds learning as if corroborated.

Per the handover, **(b) is the fault that matters** — bad DATA stored + learned, distinct from the display-only "per-template field hiding" item.

## 2. What the live DB actually shows (proof)

Every one of the 20 Ironbridge delivery dockets has the same signature. Doc #7 (the reported one):

| field | raw | conf | method |
|---|---|---|---|
| delivery_date | `2 12/06/2026` | 30 | **anchor_crop** |
| invoice_date | `12-06-2026` | 94 | **keyword** |
| order_date | `12-06-2026` | 94 | **keyword** |
| po_date | `12-06-2026` | 94 | **keyword** |

- The type's **own** date field (`delivery_date`) is read **positionally by anchor** — and here it garbled.
- The three **foreign** date fields (invoice/order/po) are all **`method=keyword`, conf 94, identical**.
- Incidence across the type: **20 / 81 delivery notes** carry a date repeated across ≥2 date fields; the duplicated cells are **`keyword`×60** (= 3 foreign fields × 20 docs), plus the type's own anchor/inline read that coincides because it is the same real date.

Per-type date-field *definitions* (each type defines exactly ONE):

```
delivery_note   delivery_date   (date)
invoice         invoice_date    (date)
purchase_order  po_date         (date)
sales_order     order_date      (date)
service_worksheet  date         (date)
```

So the foreign fields are **not** defined on the delivery-note type — they appear only because **extraction runs against the UNION of every installed type's field keys** (CLAUDE.md records this union; it is load-bearing for the "add a type later without re-reading" flow).

## 3. Root cause of fault (b) — the exact mechanism

The generic Stage-1 date patterns in `config/keyword_patterns.json` carry a **bare `"Date"` label**:

```
invoice_date : labels ["Invoice Date", "Date", "Date of Invoice", "Tax Date", "Issue Date", ...]
po_date      : labels ["PO Date", "Order Date", "Date of Order", "Printed On", "Issue Date", "Date"]
order_date   : labels ["Order Date", "Date", "Sales Order Date", "Issue Date", "Date of Order", "Dated"]
delivery_date: labels ["Delivery Date", "Dispatch Date", "Ship Date", "Shipped Date", ...]   ← NO bare "Date"
due_date     : labels ["Due Date", "Payment Due", ...]                                        ← NO bare "Date"
```

A delivery docket prints a plain **`Date:`** caption next to the delivery date. Stage 1, iterating the union of keys, matches that one caption for **invoice_date, order_date AND po_date** (they all list bare `"Date"`), each grabbing the same value. `delivery_date` does **not** list bare `"Date"`, so it does not match at Stage 1 — it is instead read by its learned anchor position (which, on doc #7, garbled).

So:
- **Fault (a)** — foreign fields are *attempted at all* — is the **enabler** (the key union).
- **Fault (b)** — the bare `"Date"` label catches the single page date for three foreign fields — is the **mechanism**.

The bare `"Date"` label is **load-bearing for the types it belongs to**: a real invoice / PO / SO very often prints only `Date:`, so `invoice_date`/`po_date`/`order_date` genuinely need it. It cannot simply be deleted — that would lose the primary date on many real documents of those types.

## 4. Harm (why (b) matters)

1. **Learning-scope pollution.** On confirm, invoice_date/order_date/po_date become confirmed extractions **scoped to `delivery_note`**. Format learning (`getFieldFormats` from confirmed docs) and supplier_hints then learn those foreign fields under the wrong type. Mostly inert (they are not delivery-note fields) but it is junk in the learned model and pollutes any future cross-field date logic.
2. **Masks the real failure.** On doc #7 the operator sees three clean dates at conf 94 and may not notice that the *actual* `delivery_date` garbled at conf 30. The foreign fields lend false confidence.
3. **False corroboration risk.** The handover's "as if corroborated" concern: no *current* confidence-boost loop consumes cross-date-field agreement (checked `engine.py`/`anchor.py`/`validator.py` — the corroboration code is anchor/template-identity only). But the po_date-corroboration backlog item would consume exactly these, so the duplicates are a latent trap for that feature.

## 5. Candidate fix layers (NOT built — for Oracle + owner to choose)

Each is kill-switchable and must be byte-identical when off. Ordered by increasing blast radius.

### Option A — persist/learn only the doc-type's own fields (storage/confirm seam) — **RECOMMENDED starting point**
At the persistence/confirm seam (`processing/handler.js` import-store and/or `reviewService`/`review/handler.js` confirm), drop extractions whose `field_key` does not belong to the document's assigned type (keep the three structural roles). Extraction still computes the union (the add-type-later flow is untouched); only *storage + learning* is type-scoped.
- **Pro:** directly kills fault (b)'s HARM (nothing foreign is stored → nothing foreign is learned or displayed). Lowest extraction blast radius — `realdoc_regression` (which spawns `process_docs.py`) is *blind* to a storage-seam change, so a green corpus proves nothing here; the gate must be a JS/DB test.
- **Con / trap:** the union-for-add-type-later flow. CLAUDE.md's known trap — "add-type → auto-select rebuilds rows by key and every field goes BLANK, needs a reprocess". If we DROP foreign fields at storage, then a doc whose type is later *changed* to (say) invoice would have no stored invoice-specific fields and must be reprocessed. But that reprocess path already exists and already forces `needs_review`. Must verify: does anything read foreign stored fields *before* a type change? (The detected-type-nudge "Add '<type>'" path already triggers a re-read — consistent.)
- **Scope decision needed:** drop at import-store, at confirm, or both? Confirm-only is safest (a reviewer can still see everything pre-confirm); but then the display confusion in Review persists. Import-store is cleaner but interacts with the nudge/add-type flow.

### Option B — type-scope the Stage-1 keyword date match (extraction) — **higher blast radius**
When the doc has a confident detected/assigned type, restrict the date field keys Stage 1 attempts to that type's date field (+ structural date role). Fixes (a) and (b) at source.
- **Pro:** the value is never even produced, so no downstream cleanup.
- **Con:** real extraction change → `realdoc_regression` M=0/accuracy gate is load-bearing and MUST be run; collides with the union design when the type is unknown/low-confidence at extraction time (then you cannot scope, and the union must stand). Needs a careful "type known & confident" predicate. This is exactly the class the night-run hard rules say to be conservative about. **Do not start without a corpus baseline + Oracle.**

### Option C — kill the bare `"Date"` cross-type bleed only (config + a guard) — **narrowest**
Keep the bare `"Date"` label but make a *bare-label* date match ineligible for a field key that is **foreign to the detected type**. i.e. a specific-label match ("Invoice Date") is always allowed; a **bare generic "Date"** match is only allowed for the type's OWN date field (+ structural date role). This is a targeted version of B that only touches the *generic* label, leaving specific labels (and all non-date fields) untouched.
- **Pro:** surgically removes the exact bleed (one page date → three foreign fields) while a genuinely-labelled foreign date ("Invoice Date" printed on a delivery note — rare but real, e.g. a combined docket) still reads.
- **Con:** still an extraction change (corpus gate required); needs the "is this label the bare generic vs a specific one" distinction threaded into `keyword.py`'s match, and the detected-type known at Stage 1.

## 6. Recommendation for the owner

**Option A (storage/learning scope), confirm-seam first**, is the smallest change that removes the real HARM (bad data stored + learned) with zero extraction risk and a JS/DB-testable gate. Options B/C are the "prevent it at source / clean the display too" upgrades and both require the corpus gate + Oracle because they change extraction. Decision the owner/Oracle must make:
1. Is display-in-Review of foreign fields acceptable (⇒ Option A confirm-seam), or must Review also stop showing them (⇒ Option A import-seam, or Option C)?
2. Confirm the add-type-later reprocess path is the accepted cost of type-scoped storage.

**Do NOT build until that decision is made** (night-run scope = diagnose only). The evidence and mechanism above are complete; the remaining work is a design choice, not more investigation.
