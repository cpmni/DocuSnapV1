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
      const script = path.join(path.dirname(ctx.backendScript), 'render', 'pdf_text.py');
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

  // Stage validated source paths into the MAIN-side token map; the renderer only ever sees tokens.
  function stagePaths(paths) {
    _sweep();
    const out = [];
    for (const p of (paths || [])) {
      const name = path.basename(String(p));
      const ext = fileKinds.normExt(p);
      if (!fileKinds.isIntake(ext) || fileKinds.isNeverOpen(ext)) { out.push({ name, ext, refused: 'unsupported_type' }); continue; }
      let st; try { st = fs.statSync(p); } catch { out.push({ name, ext, refused: 'unreadable' }); continue; }
      if (!st.isFile()) { out.push({ name, ext, refused: 'not_a_file' }); continue; }
      const token = _mint();
      _staged.set(token, { path: String(p), ext, size: st.size, mtime: st.mtimeMs, expires: Date.now() + TTL_MS });
      out.push({ token, name, ext, size: st.size });
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
    return { ok: true, files: stagePaths(res.filePaths || []) };
  });

  // The doc types a Quick File may use (reading_mode='none') + the Quick File presets to offer if none exist.
  ipcMain.handle('direct-intake-doctypes', () => {
    requireRole('admin', 'edit');
    const db = getDb();
    const installed = docTypes.getAllWithFieldsAll(db)
      .filter(t => String(t.reading_mode || 'read') === 'none')
      .map(t => ({ id: t.id, name: t.name, slug: t.slug }));
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

  // Test/introspection seam - never touches the DB.
  ipcMain.handle('direct-intake-staged-count', () => { requireRole('admin', 'edit'); _sweep(); return { count: _staged.size }; });
}

module.exports = { register, _staged };
