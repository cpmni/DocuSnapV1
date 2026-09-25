"""Text-level census for TYPE_OWNER_UNINSTALLED_BLOCK (mig 217; Oracle C5 + the OFF-equivalence proof).

usage: py -3.12 census.py <db-copy.db> <label> [--known import|installed] [--ablate] [--old <keyword_old.py>]

For every non-deleted doc with stored ocr_text, runs keyword.detect_document_type under the product's default type
env (fold + owner-precedence + the other PROVEN_ON detection keys) twice: block OFF vs block ON. Reports:
  * CHANGED docs (winner / heading / confidence differ) with the doc's CONFIRMED type (document_type_id → name),
  * the THIRD-TYPE arm (ON winner is an INSTALLED type that is neither the OFF winner nor the uninstalled title),
  * with --ablate: the known set minus {Statement, Credit Note, Delivery Note, Receipt, Remittance Advice, Purchase Order}
    (the C5 proxy for "what if this customer had not installed the type") — every change's confirmed type ∈ the set,
  * with --old: the PRE-CHANGE keyword.py run under the SAME env with block unset must equal today's block-OFF result
    on every doc (the helper refactor is byte-identical; realdoc OFF is then vacuous by construction).
Read-only; the DB copy is opened in ro mode. Prints one summary block + the changed rows.
"""
import importlib.util, json, os, sqlite3, sys

REPO = r"C:\GIT Projects\Docusnap"
sys.path.insert(0, os.path.join(REPO, "python_backend"))
from extraction import keyword  # noqa: E402

PATTERNS = json.load(open(os.path.join(REPO, "config", "keyword_patterns.json"), encoding="utf-8"))
DEFAULT_ON = ["TYPE_UNINSTALLED_HEADING_FOLD", "TYPE_CAPTION_MENTION_ONLY", "TYPE_HEADING_ANY_SEGMENT",
              "TYPE_TIE_HEADING_PREF", "TYPE_TITLE_OWNER_PRECEDENCE", "HEADING_TITLE_GAP_COLLAPSE"]
BLOCK = "TYPE_OWNER_UNINSTALLED_BLOCK"
ABLATE = {"Statement", "Credit Note", "Delivery Note", "Receipt", "Remittance Advice", "Purchase Order"}
IMPORT_SET = ["Invoice", "Sales Order", "Purchase Order", "Quotation"]

args = sys.argv[1:]
db_path, label = args[0], args[1]
known_mode = args[args.index("--known") + 1] if "--known" in args else "installed"
ablate = "--ablate" in args
old_path = args[args.index("--old") + 1] if "--old" in args else None


def load_old(p):
    spec = importlib.util.spec_from_file_location("keyword_old", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


kw_old = load_old(old_path) if old_path else None


def set_env(block):
    for k in DEFAULT_ON + [BLOCK]:
        os.environ.pop(k, None)
    for k in DEFAULT_ON:
        os.environ[k] = "1"
    if block:
        os.environ[BLOCK] = "1"


con = sqlite3.connect(f"file:{db_path.replace(os.sep, '/')}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
cols = {r[1] for r in con.execute("PRAGMA table_info(documents)")}
del_clause = " AND deleted_at IS NULL" if "deleted_at" in cols else ""
types = [dict(r) for r in con.execute("SELECT id, name, enabled, title_aliases FROM document_types")]
by_id = {t["id"]: t["name"] for t in types}
installed = [t["name"] for t in types if t.get("enabled", 1)]
aliases = {}
for t in types:
    try:
        a = json.loads(t.get("title_aliases") or "[]")
    except Exception:
        a = []
    if a and t.get("enabled", 1):
        aliases[t["name"]] = a
known = list(IMPORT_SET) if known_mode == "import" else list(installed)
if ablate:
    known = [k for k in known if k not in ABLATE]
    aliases = {k: v for k, v in aliases.items() if k in known}
docs = [dict(r) for r in con.execute(
    f"SELECT id, original_filename, ocr_text, document_type_id, status FROM documents WHERE ocr_text IS NOT NULL AND length(ocr_text) > 50{del_clause}")]

changed, third, old_mismatch = [], [], []
for d in docs:
    set_env(False)
    off = keyword.detect_document_type(d["ocr_text"], PATTERNS, known, aliases or None) or {}
    if kw_old is not None:
        old = kw_old.detect_document_type(d["ocr_text"], PATTERNS, known, aliases or None) or {}
        if (old.get("type"), old.get("confidence"), old.get("heading"), old.get("all_scores")) != \
           (off.get("type"), off.get("confidence"), off.get("heading"), off.get("all_scores")):
            old_mismatch.append((d["id"], old.get("type"), off.get("type")))
    set_env(True)
    on = keyword.detect_document_type(d["ocr_text"], PATTERNS, known, aliases or None) or {}
    key = lambda r: (r.get("type"), r.get("confidence"), r.get("heading"))
    if key(off) != key(on):
        conf_name = by_id.get(d["document_type_id"])
        row = {"id": d["id"], "file": (d["original_filename"] or "")[:50], "off": key(off), "on": key(on),
               "confirmed_type": conf_name, "status": d["status"],
               "confirmed_in_ablated": (conf_name in ABLATE) if ablate else None,
               "on_winner_installed": on.get("type") in known}
        changed.append(row)
        if on.get("type") in known and on.get("type") != off.get("type"):
            third.append(row)
for k in DEFAULT_ON + [BLOCK]:
    os.environ.pop(k, None)

print(f"== {label}: {len(docs)} docs · known={'IMPORT' if known_mode == 'import' else 'installed'}{' ABLATED' if ablate else ''} ({len(known)} types) ==")
print(f"changed OFF→ON: {len(changed)} · third-type arm (ON winner INSTALLED, ≠ OFF winner): {len(third)}"
      + (f" · OLD-vs-NEW block-OFF mismatches: {len(old_mismatch)}" if kw_old is not None else ""))
if ablate and changed:
    bad = [r for r in changed if not r["confirmed_in_ablated"] and r["confirmed_type"]]
    print(f"ablated arm: changed docs whose CONFIRMED type is NOT in the ablated set (the regression class): {len(bad)}")
for r in changed:
    print("  ", json.dumps(r, ensure_ascii=False))
for m in old_mismatch[:10]:
    print("  OLD/NEW mismatch:", m)
