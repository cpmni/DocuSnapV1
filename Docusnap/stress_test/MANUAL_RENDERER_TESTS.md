# Manual renderer-race test checklist

These verify fixes that live entirely in the Electron **renderer** (Review window,
dashboard) and can't be driven by a headless harness — they need real clicks. Each
step lists the action and the **expected** result. Run against a dev build (`npm start`).
Use throwaway/test documents (these file real docs into your output folder).

Automated coverage already proves the *backend* is race-safe (see
`concurrency_harness.js` — 4-staff /v1 confirm race, no lost/double-filed docs). These
scripts cover the *front-end* guards that harness can't reach.

---

## 1. File-All-Ready wrong-doc race (QA #5)
**Fix:** `expectId` guard in `confirmCurrentDoc` + Delete/×/row-click locked during the bulk run.

1. Get **≥8 docs** into the Review queue (import a folder of test scans), all with type +
   required fields filled so they're "ready".
2. Click **File All Ready**. While the progress banner is running, immediately try to:
   - click the single **🗑 Delete** button,
   - click a per-row **×** on a queue item,
   - click a different queue **row**.
3. **Expected:**
   - Delete / × / row-click are **ignored** during the run (buttons disabled / clicks no-op).
   - Every doc files to **its own** correct location — no doc is filed under another doc's
     values, and the queue drains cleanly.
   - No doc is skipped or double-filed. A blank-issuer doc is **skipped** (left in queue), not
     filed under "Unknown Company" (see #3).
4. **Fail signals:** a doc filed with the wrong doc's fields; a row removed but a *different*
   doc filed; a console error; the queue left with a "ghost" row.

---

## 2. Reprocess discards in-progress edits — warning (QA #3)
**Fix:** `hasPendingReviewEdits()` → confirm() before Reprocess / Reprocess-All.

1. Open a doc in Review. **Hand-edit** a field (e.g. change the reference), OR change the
   **document type** in the dropdown, OR draw a ⊕ teach box.
2. Click **Reprocess with Learned Data**.
3. **Expected:** a confirm dialog warns *"…your unsaved edits and type choice for this
   document will be lost. Continue?"* — clicking **Cancel** keeps your edits; **OK** proceeds
   and re-extracts.
4. With **no** pending edits, Reprocess should run **without** the prompt (no nag).
5. Repeat for **Reprocess all in queue** with the open doc having edits → same warning.
6. **Fail signals:** edits silently wiped with no prompt; or the prompt appears when nothing
   was edited.

---

## 3. Empty Document Issuer — warn-and-allow (QA #6)
**Fix:** amber note + a deliberate confirm in single mode; bulk skips a blank-issuer doc.

1. Open a doc in Review; **clear** the Document Issuer field. Fill the required Date/Reference.
2. **Expected (single):** an **amber note** appears ("Document Issuer is blank — this will file
   under 'Unknown Company'…"), but **Confirm stays enabled**. Clicking **Confirm** shows a
   confirm dialog ("…File it anyway?"). Cancel = not filed; OK = files under *Unknown Company*.
3. **Expected (bulk):** in **File All Ready**, a blank-issuer doc is **skipped** (left in the
   queue), not silently filed under Unknown Company.
4. **Fail signals:** doc files under Unknown Company with **no** prompt; or Confirm is hard-blocked.

---

## 4. No-reference / no-date type — Confirm not a dead-end (QA #2)
**Fix:** require a ref/date role only when the type actually assigns one.

1. In **Settings → Document Types**, create a custom type with a **Date** role but **no
   Reference** role (or use the "Service Worksh" type after clearing its Reference role).
2. Import/open a doc of that type in Review; fill the Issuer + Date.
3. **Expected:** **Confirm is enabled** and files the doc — it does **not** sit permanently
   disabled demanding a non-existent Reference field.
4. If a role IS set but points at a **deleted** field, the config note appears ("…Reference
   field isn't set up. Choose it in Settings → Document Types") — that's the intended dangling
   guard, distinct from the dead-end.
5. **Fail signals:** Confirm permanently greyed with nothing on screen to fill.

---

## 5. Dashboard Auto-import toggle vs card drag
**Fix:** exclude `label`/`.dash-switch` from the card drag trigger.

1. On the **Home** dashboard, find the **Auto-import** card.
2. Click the **on/off switch** in the card header.
3. **Expected:** the switch **toggles** (and prompts to pick a folder if none is set) — it does
   **not** grab the card for drag-to-reorder.
4. Grab the card **title/icon** area and drag → the card **reorders** normally.
5. **Fail signals:** clicking the switch starts a card drag; or the card can no longer be dragged.

---

_When a fix here is later automatable (e.g. via an Electron UI-automation harness), migrate the
corresponding case out of this file._
