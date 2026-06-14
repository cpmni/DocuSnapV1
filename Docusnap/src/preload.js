'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('docusnap', {

  // ── Authentication ───────────────────────────────────────────────────────────
  authGetStatus:        ()     => ipcRenderer.invoke('auth-get-status'),
  authGetCurrentUser:   ()     => ipcRenderer.invoke('auth-get-current-user'),
  authFirstRunSetup:    (data) => ipcRenderer.invoke('auth-first-run-setup', data),
  authLogin:            (data) => ipcRenderer.invoke('auth-login', data),
  authLogout:           ()     => ipcRenderer.invoke('auth-logout'),
  authChangePassword:   (data) => ipcRenderer.invoke('auth-change-password', data),
  authSetNewPasswordAfterReset: (data) => ipcRenderer.invoke('auth-set-new-password-after-reset', data),
  authRecoverAdmin:     (data) => ipcRenderer.invoke('auth-recover-admin', data),
  // User management (Admin only — also enforced in the main process)
  authListUsers:        ()           => ipcRenderer.invoke('auth-list-users'),
  authCreateUser:       (data)       => ipcRenderer.invoke('auth-create-user', data),
  authSetUserRole:      (data)       => ipcRenderer.invoke('auth-set-user-role', data),
  authSetUserActive:    (data)       => ipcRenderer.invoke('auth-set-user-active', data),
  authAdminResetPassword: (data)     => ipcRenderer.invoke('auth-admin-reset-password', data),
  authGetAuditLog:      (limit)      => ipcRenderer.invoke('auth-get-audit-log', limit),
  // Login ⇄ main-app window swap (the login window has no other window powers)
  authEnterApp:         () => ipcRenderer.send('auth-enter-app'),
  authShowLoginScreen:  () => ipcRenderer.send('auth-show-login'),
  onAuthSessionChanged: (cb) => ipcRenderer.on('auth-session-changed', (_e, user) => cb(user)),

  // ── Licensing ────────────────────────────────────────────────────────────────
  // Phase 1: read-only status + trial-start only. These return STATUS objects
  // (never the raw fingerprint) and perform NO gating — enforcement is OFF.
  // No gate signal is exposed yet; that arrives in Phase 2, where the MAIN
  // process re-decides and the renderer can never self-grant access.
  licenseGetStatus:   () => ipcRenderer.invoke('license-get-status'),
  licenseStartTrial:  (data) => ipcRenderer.invoke('license-start-trial', data),
  licenseActivate:    (data) => ipcRenderer.invoke('license-activate', data),
  licenseRevoke:      (data) => ipcRenderer.invoke('license-revoke', data),
  // Admin-only local activation TEST (Settings → Activation Test). Round-trips a
  // given backend with given credentials without mutating this device's real
  // license state. The account key is sent to main for the request only.
  licenseTestActivate: (data) => ipcRenderer.invoke('license-test-activate', data),
  // Staged-enforcement toggle (admin-only; Settings → Activation Test).
  licenseGetEnforcement: ()   => ipcRenderer.invoke('license-get-enforcement'),
  licenseSetEnforcement: (on) => ipcRenderer.invoke('license-set-enforcement', on),
  // Read-only diagnostic: what the gate sees on this device (enforcement + cached
  // token state + offline decision). No network call, no state change.
  licenseGetDiagnostics: ()   => ipcRenderer.invoke('license-get-diagnostics'),
  // Phase 2 — license window only: request entry (main re-decides; the renderer
  // cannot self-grant) and receive the blocked-state reason for display.
  licenseEnterApp:    () => ipcRenderer.send('license-enter-app'),
  onLicenseState:     (cb) => ipcRenderer.on('license-state', (_e, s) => cb(s)),

  // ── Window controls ─────────────────────────────────────────────────────────
  windowMinimise:     () => ipcRenderer.send('window-minimise'),
  windowMaximise:     () => ipcRenderer.send('window-maximise'),
  windowClose:        () => ipcRenderer.send('window-close'),
  showInExplorer:     (p) => ipcRenderer.send('show-in-explorer', p),
  openFile:           (p) => ipcRenderer.send('open-file', p),

  // ── Window navigation ────────────────────────────────────────────────────────
  openReviewWindow:    ()       => ipcRenderer.send('open-review-window'),
  openReviewWindowAt:  (docId)  => ipcRenderer.send('open-review-window-at', docId),
  openSettingsWindow:  ()       => ipcRenderer.send('open-settings-window'),
  openSettingsWindowAtTemplate: (templateId) => ipcRenderer.send('open-settings-window-at-template', templateId),
  getSettingsTemplateTarget:    ()           => ipcRenderer.invoke('get-settings-template-target'),
  onNavigateToTemplate:         (cb)         => ipcRenderer.on('navigate-to-template', (_e, id) => cb(id)),
  openSearchWindow:    ()       => ipcRenderer.send('open-search-window'),
  getReviewTarget:     ()       => ipcRenderer.invoke('get-review-target'),
  onNavigateToDoc:     (cb)     => ipcRenderer.on('navigate-to-doc', (_e, id) => cb(id)),

  // ── Folder processing ────────────────────────────────────────────────────────
  pickFolder:         ()     => ipcRenderer.invoke('pick-folder'),
  pickOutputFolder:   ()     => ipcRenderer.invoke('pick-output-folder'),
  processFolder:      (f)    => ipcRenderer.invoke('process-folder', f),
  stopProcessing:     ()     => ipcRenderer.invoke('stop-processing'),
  onProgress:         (cb)   => ipcRenderer.on('process-progress', (_e, m) => cb(m)),
  removeProgress:     ()     => ipcRenderer.removeAllListeners('process-progress'),

  // ── Document types & fields ──────────────────────────────────────────────────
  getDocumentTypes:    ()           => ipcRenderer.invoke('get-document-types'),
  getAllDocTypes:       ()           => ipcRenderer.invoke('get-all-doc-types'),
  getAllDocTypesAll:    ()           => ipcRenderer.invoke('get-all-doc-types-all'),
  addDocumentType:     (data)       => ipcRenderer.invoke('add-document-type', data),
  updateDocumentType:  (id, ch)     => ipcRenderer.invoke('update-document-type', id, ch),
  addField:            (data)       => ipcRenderer.invoke('add-field', data),
  updateField:         (id, ch)     => ipcRenderer.invoke('update-field', id, ch),
  deleteField:         (id)         => ipcRenderer.invoke('delete-field', id),

  // ── Review queue ─────────────────────────────────────────────────────────────
  getReviewQueue:              ()        => ipcRenderer.invoke('get-review-queue'),
  getDeferredQueue:            ()        => ipcRenderer.invoke('get-deferred-queue'),
  getReviewCount:              ()        => ipcRenderer.invoke('get-review-count'),
  getDeferredCount:            ()        => ipcRenderer.invoke('get-deferred-count'),
  getDocumentWithExtractions:  (id)      => ipcRenderer.invoke('get-document-with-extractions', id),
  getDocumentPages:            (id, fp, fn) => ipcRenderer.invoke('get-document-pages', id, fp, fn),
  getEnhancedPreview:          (data)       => ipcRenderer.invoke('get-enhanced-preview', data),
  confirmReview:               (payload) => ipcRenderer.invoke('confirm-review', payload),
  deferDocument:               (id)      => ipcRenderer.invoke('defer-document', id),
  restoreDeferred:             (id)      => ipcRenderer.invoke('restore-deferred', id),
  acknowledgeReview:           (id)      => ipcRenderer.invoke('acknowledge-review', id),
  deleteDocument:              (id, fp)  => ipcRenderer.invoke('delete-document', id, fp),
  deleteAllReview:             ()        => ipcRenderer.invoke('delete-all-review'),
  deleteAllDeferred:           ()        => ipcRenderer.invoke('delete-all-deferred'),
  reprocessDocument:           (data)    => ipcRenderer.invoke('reprocess-document', data),
  promoteToTemplate:           (data)    => ipcRenderer.invoke('promote-to-template', data),
  checkTemplateMatch:          (id)      => ipcRenderer.invoke('check-template-match-for-document', id),
  notifyReviewComplete:        ()        => ipcRenderer.send('notify-review-complete'),

  // ── Zone OCR & learning ──────────────────────────────────────────────────────
  ocrRegion:           (b64)      => ipcRenderer.invoke('ocr-region', b64),
  testTemplateMapping: (pageB64, mapping) => ipcRenderer.invoke('test-template-mapping', pageB64, mapping),
  saveFieldAnchor:     (data)     => ipcRenderer.invoke('save-field-anchor', data),
  extractLogoHash:     (b64)      => ipcRenderer.invoke('extract-logo-hash', b64),
  matchLogoHash:       (b64)      => ipcRenderer.invoke('match-logo-hash', b64),
  saveLogoFingerprint: (data)     => ipcRenderer.invoke('save-logo-fingerprint', data),

  // ── Processing mode ──────────────────────────────────────────────────────────
  getProcessingMode:         ()           => ipcRenderer.invoke('get-processing-mode'),
  setProcessingMode:         (mode)       => ipcRenderer.invoke('set-processing-mode', mode),
  checkFastModeSuggestion:   (supplier)   => ipcRenderer.invoke('check-fast-mode-suggestion', supplier),
  onProcessingModeChanged:   (cb)         => ipcRenderer.on('processing-mode-changed', (_e, m) => cb(m)),

  // ── Watch folder ─────────────────────────────────────────────────────────────
  pickWatchFolder:         ()        => ipcRenderer.invoke('pick-watch-folder'),
  getWatchFolderConfig:    ()        => ipcRenderer.invoke('get-watch-folder-config'),
  setWatchFolder:          (folder)  => ipcRenderer.invoke('set-watch-folder', folder),
  setWatchFolderEnabled:   (enabled) => ipcRenderer.invoke('set-watch-folder-enabled', enabled),

  // ── File naming ──────────────────────────────────────────────────────────────
  getFilenamePatternInfo:  ()         => ipcRenderer.invoke('get-filename-pattern-info'),
  previewFilenamePattern:  (pattern)  => ipcRenderer.invoke('preview-filename-pattern', pattern),

  // ── Search ───────────────────────────────────────────────────────────────────
  searchDocuments:     (params)   => ipcRenderer.invoke('search-documents', params),

  // ── Template Viewer / Anchor Mapping (admin-only, lives in Settings) ────────
  getTemplates:               ()                  => ipcRenderer.invoke('get-templates'),
  getTemplateDetail:          (id)                => ipcRenderer.invoke('get-template-detail', id),
  createTemplate:             (data)              => ipcRenderer.invoke('create-template', data),
  renameTemplate:             (id, name)          => ipcRenderer.invoke('rename-template', id, name),
  deleteTemplate:             (id)                => ipcRenderer.invoke('delete-template', id),
  getTemplateSampleCandidates:(id)                => ipcRenderer.invoke('get-template-sample-candidates', id),
  setTemplateSample:          (id, docId)         => ipcRenderer.invoke('set-template-sample', id, docId),
  reassignTemplateDocuments:  (fromId, toId)      => ipcRenderer.invoke('reassign-template-documents', fromId, toId),
  setTemplateOcrAuto:         (id, enabled)       => ipcRenderer.invoke('set-template-ocr-auto', id, enabled),
  pickTemplateSampleFile:     ()                  => ipcRenderer.invoke('pick-template-sample-file'),
  importTemplateSampleFile:   (id, filePath)      => ipcRenderer.invoke('import-template-sample-file', id, filePath),
  saveTemplateMapping:        (id, mapping)       => ipcRenderer.invoke('save-template-mapping', id, mapping),
  setTemplateMappingEnabled:  (id, key, enabled)  => ipcRenderer.invoke('set-template-mapping-enabled', id, key, enabled),
  deleteTemplateMapping:      (id, key)           => ipcRenderer.invoke('delete-template-mapping', id, key),
  recordTemplateMappingTest:  (id, key, result)   => ipcRenderer.invoke('record-template-mapping-test', id, key, result),
  setTemplateFieldFixed:      (id, key, value)    => ipcRenderer.invoke('set-template-field-fixed', id, key, value),
  // Template groups (v1: organisational metadata)
  getTemplateGroups:          ()             => ipcRenderer.invoke('get-template-groups'),
  createTemplateGroup:        (name)         => ipcRenderer.invoke('create-template-group', name),
  deleteTemplateGroup:        (id)           => ipcRenderer.invoke('delete-template-group', id),
  setTemplateGroup:           (tid, gid)     => ipcRenderer.invoke('set-template-group', tid, gid),
  getTemplateSiblings:        (id)           => ipcRenderer.invoke('get-template-siblings', id),
  // PDF splitting
  splitPdf:                   (file, ranges, outDir, docId) => ipcRenderer.invoke('split-pdf', file, ranges, outDir, docId),

  // ── Settings ─────────────────────────────────────────────────────────────────
  getSetting:          (key)      => ipcRenderer.invoke('get-setting', key),
  setSetting:          (key, val) => ipcRenderer.invoke('set-setting', key, val),

  // ── Learning Recovery (Settings tab) ────────────────────────────────────────
  getLearningRecovery: (params)   => ipcRenderer.invoke('get-learning-recovery', params),
  getMemoryInventory:  ()         => ipcRenderer.invoke('get-memory-inventory'),
  resetAllLearning:    ()         => ipcRenderer.invoke('reset-all-learning'),
  clearLearningAnchors:(params)   => ipcRenderer.invoke('clear-learning-anchors', params),
  clearLearningHints:  (params)   => ipcRenderer.invoke('clear-learning-hints', params),
  clearLearningCorrections: (params) => ipcRenderer.invoke('clear-learning-corrections', params),

  // ── Events from main → renderer ──────────────────────────────────────────────
  onThemeChanged:        (cb) => ipcRenderer.on('theme-changed',          (_e, t) => cb(t)),
  onReviewCountChanged:  (cb) => ipcRenderer.on('review-count-changed',  (_e, n) => cb(n)),
  onDeferredCountChanged:(cb) => ipcRenderer.on('deferred-count-changed', (_e, n) => cb(n)),
  onReprocessProgress:   (cb) => ipcRenderer.on('reprocess-progress',    (_e, m) => cb(m)),
  removeReprocessProgress: ()  => ipcRenderer.removeAllListeners('reprocess-progress'),
});
