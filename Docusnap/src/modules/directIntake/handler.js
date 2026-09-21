'use strict';
/*
 * modules/directIntake/handler.js - the Electron/IPC edge for "Quick File" (non-OCR direct intake).
 * QuickFile+Departments plan section 3 + eric B.1/B.5. The transport-agnostic logic lives in
 * services/directIntakeService.js (pinned); this owns only: the OS file picker, a MAIN-side staging
 * token map (paths never reach the renderer - the de-pathing rule), and wiring the real collaborators
 * (filing.commitDocument, processing.ensureWorkingCopy, filing.normaliseDate, the output root, the inbox).
 * DARK behind `direct_intake_enabled` - every IPC refuses when the switch is off.
 */

const svc = require('../../services/directIntakeService');
const fileKinds = require('../../lib/fileKinds');

const TTL_MS = 15 * 60 * 1000;
const _staged = new Map();   // token -> { path, ext, size, mtime, expires }
function _sweep() { const now = Date.now(); for (const [k, v] of _staged) if (v.expires < now) _staged.delete(k); }
function _mint() { return 'qf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }

function register(ctx) {
  const { ipcMain, getDb, app, fs, path, logger } = ctx;
  const { requireRole, getCurrentUser, logAudit } = require('../auth/handler');
  const learning = require('../../../database/modules/learning');
  const docTypes = require('../../../database/modules/document_types');
  const ooxmlText = require('../../lib/ooxmlText');
  const { dialog } = require('electron');

  const enabled = (db) => svc.enabled(db);
  const inboxDir = () => path.join(app.getPath('userData'), 'inbox');
  const CAP = 200000;
  const _clip = (s) => String(s || '').slice(0, CAP);

  // Born-digital PDF text via pypdfium2 - NO OCR (Q2). Best-effort, bounded, never throws.
  function _pdfText(srcPath) {
    try {
      const script = path.join(path.dirname(ctx.backendScript()), 'render', 'pdf_text.py');   // backendScript is a FN
      const res = require('child_process').spawnSync(ctx.pythonExe(), ctx.pythonArgs(script, '--file', srcPath),
        { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
      return (JSON.parse(res.stdout || '{}').text) || '';
    } catch { return ''; }
  }

  // Searchable body text for a Quick File doc - office/PDF/plain-text only, NEVER OCR. '' for images,
  // legacy binaries (.doc/.xls/.ppt), .msg, .rtf/.odt (metadata-only in v1). Title+notes still index those.
  function extractSearchText(srcPath, ext) {
    const e = fileKinds.normExt(ext || srcPath);
    try {
      if (e === '.txt' || e === '.md' || e === '.csv') return _clip(fs.readFileSync(srcPath, 'utf8'));
      if (e === '.docx' || e === '.xlsx' || e === '.pptx') return ooxmlText.extractOoxml(fs.readFileSync(srcPath), e);
      if (e === '.eml') {
        const raw = fs.readFileSync(srcPath, 'utf8');
        const sep = raw.search(/\r?\n\r?\n/);
        const head = sep >= 0 ? raw.slice(0, sep) : raw;
        const bodyPart = sep >= 0 ? raw.slice(sep) : '';
        const heads = (head.match(/^(Subject|From|To|Date):.*$/gim) || []).join('\n');
        return _clip((heads + '\n' + bodyPart).replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' '));
      }
      if (e === '.pdf') return _pdfText(srcPath);
    } catch { /* best-effort */ }
    return '';
  }

  // The Q-C10 validator options for THIS db (userData + filing output tree are off-limits; the size cap).
  function _validateOpts(db) {
    return {
      userDataDir: app.getPath('userData'),
      outputRoot: learning.getSetting(db, 'output_folder', null),
      maxMb: Number(learning.getSetting(db, 'direct_intake_max_mb', svc.DEFAULT_MAX_MB)) || svc.DEFAULT_MAX_MB,
    };
  }

  // Stage validated source paths into the MAIN-side token map; the renderer only ever sees tokens.
  // Every path — dialog OR renderer-supplied (drop) OR launch arg — goes through the ONE Q-C10 validator
  // (svc.validateIntakePath): canonicalise once, real-file, not inside the app's data/output, type, size.
  // A refused path returns a REASON so the caller can tell the user; it is never silently dropped.
  function stagePaths(db, paths) {
    _sweep();
    const opts = _validateOpts(db);
    const out = [];
    for (const p of (paths || [])) {
      const name = path.basename(String(p || ''));
      const v = svc.validateIntakePath(String(p || ''), opts);
      if (!v.ok) { out.push({ name, ext: v.ext || fileKinds.normExt(p), refused: v.refused }); continue; }
      const token = _mint();
      _staged.set(token, { path: v.path, ext: v.ext, size: v.size, minted: Date.now(), expires: Date.now() + TTL_MS });
      out.push({ token, name, ext: v.ext, size: v.size });
    }
    return out;
  }

  // Pick files (multi-select) -> stage -> return tokens. paths stay in MAIN.
  ipcMain.handle('direct-intake-pick', async () => {
    requireRole('admin', 'edit');
    const db = getDb();
    if (!enabled(db)) return { ok: false, error: 'disabled' };
    const win = ctx.getMainWindow && ctx.getMainWindow();
    const exts = [...fileKinds.INTAKE_EXTS].map(e => e.replace(/^\./, ''));
    const res = await dialog.showOpenDialog(win || undefined, {
      title: 'Quick File - choose documents',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: exts }, { name: 'All files', extensions: ['*'] }],
    });
    if (!res || res.canceled) return { ok: true, files: [] };
    return { ok: true, files: stagePaths(db, res.filePaths || []) };
  });

  // Stage renderer-supplied paths (drag-drop onto the Quick File pane). The renderer only ever hands us
  // PATHS (obtained in the preload via webUtils.getPathForFile) — it never keeps or displays them past
  // this call. Renderer-supplied strings are LOWER trust than a dialog result, so they run the SAME
  // Q-C10 validator (stagePaths). Same role + enabled gate as the picker.
  ipcMain.handle('direct-intake-stage-paths', (_e, paths) => {
    requireRole('admin', 'edit');
    const db = getDb();
    if (!enabled(db)) return { ok: false, error: 'disabled' };
    if (!Array.isArray(paths)) return { ok: false, error: 'bad_request' };
    return { ok: true, files: stagePaths(db, paths.slice(0, 100)) };
  });

  // The doc types a Quick File may use (reading_mode='none') + the Quick File presets to offer if none exist.
  ipcMain.handle('direct-intake-doctypes', () => {
    requireRole('admin', 'edit');
    const db = getDb();
    const installed = docTypes.getAllWithFieldsAll(db)
      .filter(t => docTypes.isQuickFileType(t))   // Slice 1 crossover: quick_file=1 OR reading_mode='none' (Oracle C1 parity)
      .map(t => ({ id: t.id, name: t.name, slug: t.slug,
        date_field_key: t.date_field_key || null, ref_field_key: t.ref_field_key || null,
        // Slice 0: the type's fields so the pane can render per-type CUSTOM inputs (it excludes the role keys).
        fields: (t.fields || []).map(f => ({ key: f.key, label: f.label, type: f.type, required: !!f.required })) }));
    const presets = (docTypes.getPresetCatalog(db) || [])
      .filter(p => p.quick_file)
      .map(p => ({ name: p.name, slug: p.slug, already_present: p.already_present }));
    return { ok: true, enabled: enabled(db), installed, presets };
  });

  // Add a Quick File preset type inline (admin) - the form offers this when no 'none' type exists yet.
  ipcMain.handle('direct-intake-add-type', (_e, slug) => {
    requireRole('admin');
    const db = getDb();
    const res = docTypes.addPresetTypes(db, [String(slug || '')]);
    const added = (res || []).find(r => r.status === 'added' || r.status === 'already_present');
    if (!added) return { ok: false, error: 'not_added', detail: res };
    const t = db.prepare('SELECT id, name, slug FROM document_types WHERE slug = ?').get(added.slug);
    return { ok: true, type: t };
  });

  // Submit ONE staged file as a typed document. meta = {documentTypeId, party, date, title, reference, notes}.
  ipcMain.handle('direct-intake-submit', async (_e, payload) => {
    requireRole('admin', 'edit');
    const db = getDb();
    if (!enabled(db)) return { ok: false, error: 'disabled' };
    const { token, meta } = payload || {};
    const staged = token && _staged.get(token);
    if (!staged || staged.expires < Date.now()) { if (token) _staged.delete(token); return { ok: false, error: 'expired' }; }
    const input = {
      srcPath: staged.path, ext: staged.ext, size: staged.size,
      documentTypeId: meta && meta.documentTypeId,
      party: meta && meta.party, date: meta && meta.date, title: meta && meta.title,
      reference: meta && meta.reference, notes: meta && meta.notes,
      customFields: meta && meta.customFields,   // Slice 0: {fieldKey: value} typed on the per-type custom inputs
    };
    const deps = {
      fs, path, outputRoot: learning.getSetting(db, 'output_folder', null),
      inboxDir: inboxDir(), logger,
      commitDocument: require('../filing/handler').commitDocument,
      normaliseDate: require('../filing/handler').normaliseDate,
      ensureWorkingCopy: require('../processing/handler').ensureWorkingCopy,
      extractSearchText,
      logAudit: (d, action, m) => { try { logAudit(d, { action, action_category: 'document', outcome: 'success', ...(m || {}) }); } catch {} },
    };
    let r;
    try { r = await svc.submit(db, getCurrentUser(), input, deps); }
    catch (e) { logger && logger.error && logger.error(`[quickfile] submit: ${e.message}`); return { ok: false, error: 'failed', detail: e.message }; }
    if (r && r.ok) { _staged.delete(token); try { ctx.notifyAllWindows && ctx.notifyAllWindows('direct-intake-changed'); } catch {} }
    return r;
  });

  // Edit a filed Quick File doc's details (company/date/title/reference/notes); re-files if a filing token
  // changed. patch = only the provided keys. DARK behind direct_intake_enabled.
  ipcMain.handle('direct-intake-update', async (_e, payload) => {
    requireRole('admin', 'edit');
    const db = getDb();
    if (!enabled(db)) return { ok: false, error: 'disabled' };
    const { docId, patch } = payload || {};
    const accessService = require('../../services/accessService');
    const deps = {
      fs, path, outputRoot: learning.getSetting(db, 'output_folder', null), logger,
      commitDocument: require('../filing/handler').commitDocument,
      normaliseDate: require('../filing/handler').normaliseDate,
      extractSearchText,
      canAccessDocument: (d, user, id) => (accessService.gateEnabled() ? accessService.canAccessDocument(d, user, id) : { allow: true }),
      logAudit: (d, action, m) => { try { logAudit(d, { action, action_category: 'document', outcome: 'success', ...(m || {}) }); } catch {} },
    };
    let r;
    try { r = await svc.update(db, getCurrentUser(), docId, patch, deps); }
    catch (e) { logger && logger.error && logger.error(`[quickfile] update: ${e.message}`); return { ok: false, error: 'failed', detail: e.message }; }
    if (r && r.ok) { try { ctx.notifyAllWindows && ctx.notifyAllWindows('direct-intake-changed'); } catch {} }
    return r;
  });

  // Preview a STAGED (not-yet-filed) file by token (Oracle IPC1) — for the multi-doc pane's filmstrip +
  // focused preview. Renders page-1 by TOKEN (staged files have no docId); the path stays in MAIN. Non-
  // renderable (office/email/text) or a gone file → {renderable:false} so the renderer draws an icon card
  // (never a broken image). getThumbnail(exact:true) resolves ONLY the exact staged path — no sibling
  // recovery to a stranger's filed doc (Oracle EXACT1). TTL renews on preview (TTL1) capped at mint+2h so a
  // careful multi-doc entry doesn't expire, without letting a token live forever.
  const PREVIEW_TTL_CAP_MS = 2 * 60 * 60 * 1000;
  ipcMain.handle('direct-intake-preview', async (_e, token) => {
    requireRole('admin', 'edit');
    const db = getDb();
    if (!enabled(db)) return { ok: false, error: 'disabled' };
    _sweep();
    const s = token && _staged.get(token);
    if (!s || s.expires < Date.now()) { if (token) _staged.delete(token); return { ok: true, renderable: false, kind: 'expired' }; }
    s.expires = Math.min(Date.now() + TTL_MS, (s.minted || Date.now()) + PREVIEW_TTL_CAP_MS);   // renew, capped
    if (!fileKinds.isRenderable(s.ext)) return { ok: true, renderable: false, kind: s.ext };
    const previewService = require('../../services/previewService');
    const renderScript = path.join(path.dirname(ctx.backendScript()), 'render', 'pages.py');
    const deps = { fs, path, spawn: require('child_process').spawn, pythonExe: ctx.pythonExe, pythonArgs: ctx.pythonArgs, renderScript, log: () => {} };
    let dataUrl = null;
    try { dataUrl = await previewService.getThumbnail(db, { docId: null, folderPath: path.dirname(s.path), filename: path.basename(s.path), exact: true }, deps); }
    catch { dataUrl = null; }
    return dataUrl ? { ok: true, renderable: true, dataUrl } : { ok: true, renderable: false, kind: s.ext };
  });

  // Test/introspection seam - never touches the DB.
  ipcMain.handle('direct-intake-staged-count', () => { requireRole('admin', 'edit'); _sweep(); return { count: _staged.size }; });
}

module.exports = { register, _staged };
