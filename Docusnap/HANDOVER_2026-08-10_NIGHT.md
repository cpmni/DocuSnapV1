# HANDOVER — 2026-08-10 overnight (autonomous) — VAT fixed, six security holes closed, and a misfile defect found twice

**Branch `feat/teach-side-overnight`. HEAD `bc157d9`. ALL PUSHED.**
Owner asleep from ~22:30; standing instruction was "run on auto", with agents and Oracle authorised.

---

## READ THIS FIRST — the one thing that matters most

**One ordinary confirm put the wrong company's name on 18 other companies' documents, at 95%
confidence, and filed one of them into the wrong folder.**

A customer imports 200 scans and confirms ONE Quillstone purchase order. That confirm creates a
template whose `supplier_name` is frozen to `'Quillstone Print & Packaging'`. The template then
matches **Oakhaven Electrical delivery notes** — different company, different document type — and
stamps Quillstone as the issuer at 95% on pages whose own letterhead says Oakhaven in 24-point type,
and whose VAT number the app reads correctly off that same letterhead.

Chris confirmed one as any user would. It filed to
`Output/Quillstone-Print-&-Packaging/2025/January/Delivery-Note.13-01-2025.OED26662.pdf`, with
Oakhaven's VAT number in the XML beside Quillstone's name.

**Found twice the same night, independently** — Chris at the screen, the harness in the database.
Full chain, four candidate directions, and why the guard that exists for this class was inert:
`pendingfeatures.md`, top entry. **Deliberately NOT fixed.** It crosses four subsystems that are each
individually defensible, and it needs an advisor round and an Oracle pass, not a threshold nudge at
4am. It is the first thing to do next.

---

## What shipped (12 commits, all pushed, all default OFF unless stated)

### The VAT fix you asked for — `92c7013`
Your report: *"the VAT number isn't reading properly when there are multiple correct crops — I drew
a target and reprocessed and it still got it wrong."*

**Cause: `vat_no` had no format at all.** It had no shipped entry, so the app fell back to a generic
"reference code" rule — `[A-Za-z0-9][A-Za-z0-9-/.]{2,20}` — which is a length check, not a format.
It accepts `VAT`, `3PL`, `1RE` and every OCR garble at full marks. Your taught box landed a few
millimetres off, read a fragment, and nothing downstream could argue.

**Two independent causes, two fixes:**
1. **The format.** `vat_no` is now a real field with real UK patterns and its own label bank. The
   Review window's on-blur check got the same rule, or the UI would keep accepting values the reader
   now refuses.
2. **The freeze** (`TEMPLATE_FREEZE_QUALIFY`, OFF). 21 of the 26 wrong values were the literal string
   `'VAT'` at 95% — a template's frozen value is the printed CAPTION. The teach wizard's box read is
   written as permanent truth with nothing looking at what it says.

**Measured, 200 documents:** `vat_no` **100 ok / 26 wrong / 54 empty → 171 / 0 / 9**. Every other
lane byte-identical.

International VAT is designed and HELD (UK-only today; an EU supplier gets an empty field and a
review, which is the safe direction). No checksum: the corpus is synthetic and its VAT numbers fail
the real UK checksum, so arming it would reject 92 correct values.

### Six security holes, closed — `4ef1d1c`, `c45ff27`, `bdb0325`, `ab246f5`
1. **`LICENSE_PINNED_KEYS=0` was a complete offline licence bypass** — one environment variable made
   the app read its verification keys from an editable file shipped beside it. Ignored in packaged
   builds now.
2. **A five-minute, endlessly repeatable free trial** — the app found `reg.exe` via `%SystemRoot%`,
   which the person launching it chooses. Fake `reg.exe` + fake `SystemRoot` = a brand-new machine
   identity on demand, no admin needed. Verified fixed.
3. **A packaged build now refuses to start with `--remote-debugging-port`/`--inspect`.**
4. **The licence brake was permanently locking out paying customers** — 13 mistyped keys froze that
   internet address out of activation FOR EVER while promising "try again in 15 minutes". Every
   office, hotel and mobile network shares one address.
5. **One person could take new-customer signups offline worldwide** — a single global 500/day trial
   counter. Now per network, with the global figure as an alarm.
6. **`ANCHOR_HMAC=0`** — same env-kill-switch pattern, same fix.

### Customer data on disk — `ab246f5`
- **`processing.log` was recording your customers' data** on every install, with no toggle and no
  mention in the UI: supplier and customer names, VAT numbers, totals, full paths — 1,139 money
  amounts and 685 user paths on this machine. It now keeps the shape of every line and drops the
  content; Diagnostic Logging (admin, off by default) restores full detail.
- **The LAN add-on's server key** was plaintext beside a properly-protected CA key. Now protected the
  same way.
- **`recovered_inbox/` and `templates/`** held real scanned customer PDFs and 99 supplier names,
  untracked but not ignored — one `git add -A` from being committed. Now ignored.

### Reachability — `56bf62d`, and the letterhead reader
**Five flags that were built, measured and unreachable** because they are read from the environment
and `npm start` injects none: `STAGE05_REF_CODE_GATE`, `KEYWORD_GENERIC_CAPTION_EXCLUSIVE`,
`TYPE_TITLE_OWNER_PRECEDENCE`, `FILING_VALUE_SANITY_FLAGS`, and `LETTERHEAD_ISSUER`. All now have
plain-English Settings rows. All still default OFF — bridging is not approval.

`LETTERHEAD_ISSUER` is the cold-start sender reader: on a fresh install with 200 documents from three
unseen suppliers, the sender came out blank on all 60, on pages whose first line is the company's own
name. It suggests and never asserts. Measured: correct on 20 of 60; silent on the rest (20 of those
are purchase orders where the letterhead is legitimately our own company; 20 are a supplier whose
logo initials occupy the first line — a real gap, recorded not fixed).

### The measurement you actually asked for — `f636820`
`stress_test/readable_census.py` answers *"how are we doing on values that are actually PRINTED?"*,
because the ordinary scorer counts columns whose value is not on the page. **The account number is
printed on 60 of 200 documents.** Scored the old way that lane looks like a field that half works;
scored honestly it is **60 printed, 60 found — 100%** — with a separate, real defect: it invents a
value on 40 pages that carry none.

**Where the app actually stands, on printed values (200 documents):**

| field | printed | found | wrong | missed | not on page | invented | score |
|---|---|---|---|---|---|---|---|
| customer | 180 | 179 | 1 | 0 | 0 | 0 | **99%** |
| total | 160 | 155 | 1 | 4 | 0 | 0 | **97%** |
| vat_no | 178 | 171 | 0 | 7 | 2 | 0 | **96%** |
| account_no | 60 | 60 | 0 | 0 | 140 | **40** | **100%** |
| po_ref | 40 | 37 | 3 | 0 | 0 | 0 | **92%** |
| issuer | 180 | 140 | 0 | 40 | 0 | 0 | **78%** |
| serials | 19 | 13 | 2 | 4 | 19 | **19** | 68% |

The issuer's 40 misses are the three suppliers that were never taught. The two "invented" columns are
the remaining real defect: a confident value with no source on the page.

---

## Oracle vetted everything and sent one thing back — `f636820`

**REVERTED on his ruling:** I had armed the Electron tamper fuses in `npm run build`. He was right:
the first armed build ever produced would have been a release build, and — the part I had missed —
electron-builder signs during packaging while the fuse script runs after, so the day you sign, that
line would produce a signed-then-modified executable whose signature no longer verifies. Reverted.
The correct layer is electron-builder's own `electronFuses`, which flips before signing.

**He also found a dead guard nobody had looked at, and it is not mine:** `config/keyword_patterns.json`
is NOT inside `app.asar` — it ships beside it. Two modules loaded it with a repo-relative path, which
in a packaged build points inside the asar where it does not exist. So `trust.js`'s strict-type
re-check has **never once fired in a customer's install**, and two of my three freeze-guard arms were
inert exactly where the customer is. Both fixed; verified the guard now answers `false` where it used
to answer `true`.

**And he caught me deleting evidence.** I had made the scorer skip the VAT column on purchase orders
(correctly — the expected value is not printed on the page, verified at the generator). But dropping
it silenced that lane for ever. The generator now carries the value that IS printed and the scorer
swaps to it, exactly as it already swaps issuer/customer.

**Still outstanding from his conditions (both need a run, not a decision):**
- **C2:** re-run the `TEMPLATE_FIXED_SEED_AGREEMENT_KEEP` arm with the presence veto forced armed
  (`TEMPLATE_NAME_PRESENCE_MIN_SAMPLE=1`) and count blanked suppliers. My "no supplier blanked"
  evidence was **vacuous** — the veto needs 3 confirms and the corpus had 1, so it could not fire.
- **C7:** record the non-GB VAT residual in `pendingfeatures.md` (an EU supplier's VAT number is now
  refused → empty → review).

---

## The ten minutes I need from you before you ship

**Build the installer once and open every window in it.** Not because of anything I changed — the
fuse arming is reverted — but because `HARDEN_FUSES` has never been smoked and it is the thing you'll
want on eventually. When you do arm it, use electron-builder's `electronFuses`, not the afterPack
script, and click through every window including the print ghost and the splash.

**And one query on the live licence server:** `SHOW TABLES LIKE 'rate_limits';` — if that returns
nothing, every rate limit and anti-abuse control on the backend is silently switched off right now.

---

## Decisions only you can make

1. **The offline grace is 7 days, including for the £299 lifetime licence.** A customer with no
   internet is locked out on day 8. Recommend 30–45 days for paid seats, keep 7 for trials.
2. **Code signing** — customers currently see "Windows protected your PC". Has lead time; start now.
3. **The XML files beside every filed document** contain every extracted value in clear text and land
   wherever the output folder points, often OneDrive. Nobody decided this. Recommend a setting plus
   one line of documentation.
4. **Encrypting the database** — my answer is "not yet, and here is honestly why":
   `docs/SECURITY_AND_DATA_REPORT_2026-08-10.md`.
5. **The trial cap is now per IP address, not per network range.** A farmer with 20 addresses gets
   what the old global cap allowed. That is the right trade — a stranger could previously switch your
   signup funnel off worldwide — but it is a business decision I made autonomously, so check it.
6. **`deskew_on_import` is TRUE in your live database again.** There is a standing ruling against it,
   and turning it on silently disables `TEACH_ANGLE_COMPOSE_SCAN` (+18 issuer / +36 customer when
   measured). If you did that deliberately, fine; if not, it is worth another look.

---

## Reports written for you

- `docs/SECURITY_AND_DATA_REPORT_2026-08-10.md` — security, licensing and data, in plain terms:
  what was wrong, what I fixed, what you must decide.
- `docs/CHRIS_FULL_APP_REVIEW_2026-08-10.md` — Chris's full vet with his warnings truth-table. His
  verdict: *"Yes — but only after finding 1 is fixed."* His praise for the teaching wizard and the
  filing is worth reading too.

---

## Gotchas earned tonight

- **Never measure against a database another agent is using.** Chris confirmed documents mid-run and
  the taught state changed underneath two arms; one comparison moved two variables and I nearly
  reported a regression that was his three confirms. Snapshot the database first
  (`TESTING/_measure/`), then run every arm against the snapshot.
- **A mutator arm inherits no environment** unless it is named in `ARM_ENV`. `freezequal` first ran
  without the `applive` set and 40 cells moved on scopes the mutator never touched.
- **A probe that cannot call Tesseract reports absence about everything.** A standalone script must
  set `pytesseract.pytesseract.tesseract_cmd`; without it every read returns empty and the obvious
  conclusion ("the taught box reads nothing on any document") is an artefact.
- `CAPTION_VALUE_REFUSE` shipped and is **INERT on this corpus** — 0 documents change. Recorded as
  inert rather than presented as a heal.
- The sandbox instance is still running on CDP 9223 with Chris's evidence in it; his screenshots are
  in `Desktop/TESTING/_chris/driver/`. Kill it whenever you like.
