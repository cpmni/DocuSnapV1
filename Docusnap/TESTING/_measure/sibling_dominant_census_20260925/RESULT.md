# issuer_sibling_dominant_hold (mig 218) — build gate (Oracle C5 census + C3 perf), 2026-09-25 — MET

**Change:** Tier C of the issuer near-match gate — `learning.findDominantSiblingIdentity` (queued + HUMAN-confirmed
documents that CONVERGE with the doc by layout: branding fingerprint 0.80 OR logo phash ≤ 13; the dominant spelling by
`count ≥ 2 AND > own`; a 1-2-edit / token-sub-run near-miss is asked, never adopted) at the confirm gate, the teach ask
(desktop + `/v1`), and the Review grouping. DARK `issuer_sibling_dominant_hold`. Design
`docs/designs/SIBLING_DOMINANT_HOLD_2026-09-25.md`; Oracle C1-C8 in `docs/oracle_log.md`.

## Census (`census.js`, read-only DB copies; switch forced ON by env for the run)
| copy | distinct spellings | arm Q (queued today) | arm R (REPLAY: every human-confirmed doc treated as queued) | perf |
|---|---|---|---|---|
| Chris 2026-09-24 sandbox | 10 | 136 docs → **holds EXACTLY 2 = docs 62 (sub-run, "Dairy Wholesale") + 69 (edit d=1, "Meadowyale…")**, offer "Meadowvale Dairy Wholesale", 18 siblings each; **0 of the 18** | 14 docs → **0 candidates** | avg 1.0 ms · max 12 ms · max 19 pair tests |
| the owner's LIVE DB copy (`live727.db`, 758 docs = the processed corpus + real papers) | 30 | 20 docs → **0 holds** | 256 human-confirmed docs → **0 candidates** | avg 1.2 ms · max 14 ms · 0 pair tests (no near fold anywhere) |

- **Positive control MET:** the switch would hold exactly the two odd Meadowvale reads Chris saw and none of the 18.
- **FALSE holds = 0 (C5):** the replay arm — each confirmed doc's own value is the truth — raised no candidate on either
  copy, so nothing needed hand adjudication. (No queued doc on the owner's copy has a near-named converging sibling.)
- **Perf (C3):** fold-first means a doc with no near-named sender exits after ONE aggregate query (0 pair tests); the
  exhibit pays 18-19 pair tests. Synthetic 2,000-row / 100-near-named-senders queue (`test_near_match_siblings.js` §7):
  one confirm **13 ms**, one `getReviewQueue` stamp **25 ms** — after the display slice's first draft measured **36 s**
  there (it evaluated every row of every near-named fold); fixed with the size pre-filter (a fold can only be dominated
  by a strictly larger one, human-confirmed siblings counted) + a 400-fold cap (fail open, no chip).

## Pins
- `database/modules/test_near_match_siblings.js`: switch semantics (explicit env, the EMPTY-as-ON trap) · the exhibit
  (a-d) · NEGATIVE CONTROL same names / disjoint layouts → not near; no signature → `no-siblings` · text budget
  (different company, too-short stored name, Ltd/Limited, a LONGER candidate never holds via sub-run) · the tie-break
  (1-vs-1 abstains = the pinned trade-off; 2-vs-1 asks; majority garble asks with the row byte-unchanged) · Oracle C2
  (3+1 with two human-confirmed → asks; machine-confirmed never count; 10/10 stays silent as docs file) · C3 perf +
  the budget fail-open · the queue stamp ON / OFF byte-identical rows.
- `src/services/test_reviewservice.js` Tier C section: OFF files the garble (the documented gap) · ON held with
  `source: 'siblings'` + the C8 audit + status unchanged · sub-run held · bulk held · acknowledge passes · "Use" passes ·
  one of the 18 files · Tier A outranks once 3 human confirms exist.
- `database/modules/test_migration218_issuer_sibling_dominant_hold.js`: seed / list / 16 keys / no force-ON / JS-only /
  manual ON survives + the SHAPE of every consumer (gate ordering + C8 metadata + code; teach ask on both roads; wizard
  docId ×2 + client copy; `/v1` 400 `nearMatch`; queue post-pass bounded + pre-filtered; group key + chip; hold copy
  never "already use").

## Owed before FLIP
- One live client confirm of Chris's doc 69 against a core with the switch armed → the 400 toast reads the server's
  self-sufficient text (Oracle C4); the client Use/Keep affordance is a `pendingfeatures.md` card.
- A Chris round on a fresh sandbox with the switch armed: confirm 69 FIRST → held with the "18 others" sentence → Use →
  ONE folder; File All → 18; 62 → sub-run hold → Use.
