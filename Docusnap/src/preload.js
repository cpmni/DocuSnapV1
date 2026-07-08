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
  auditQuery:           (filters)    => ipcRenderer.invoke('audit-query', filters),
  auditExportCsv:       (filters)    => ipcRenderer.invoke('audit-export-csv', filters),
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
  // Manual "re-check licence now": runs the authoritative gate (re-validate) and locks the
  // app if the licence was revoked/expired server-side. Returns the gate decision.
  licenseRecheck:        ()   => ipcRenderer.invoke('license-recheck'),
  // Detached search-client API hosting (admin-only; Settings → Search client access).
  clientApiGetStatus:  ()    => ipcRenderer.invoke('client-api-get-status'),
  clientApiSetEnabled: (on)  => ipcRenderer.invoke('client-api-set-enabled', on),
  clientApiCertStatus:   ()  => ipcRenderer.invoke('client-api-cert-status'),
  clientApiCertGenerate: ()  => ipcRenderer.invoke('client-api-cert-generate'),
  clientApiCertExport:   ()  => ipcRenderer.invoke('client-api-cert-export'),
  // Workflow add-on entitlement (drives the in-core enhanced Search).
  getEntitlement:      ()    => ipcRenderer.invoke('get-entitlement'),
  // Concurrent client-seat pool (admin): licensed seats + active leases, and release.
  licenseSeatsStatus:  ()    => ipcRenderer.invoke('license-seats-status'),
  licenseSeatRelease:  (id)  => ipcRenderer.invoke('license-seat-release', id),
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
  openFolder:         (p) => ipcRenderer.send('open-folder', p),

  // ── Window navigation ────────────────────────────────────────────────────────
  openReviewWindow:    ()       => ipcRenderer.send('open-review-window'),
  openReviewWindowAt:  (docId)  => ipcRenderer.send('open-review-window-at', docId),
  openSettingsWindow:  ()       => ipcRenderer.send('open-settings-window'),
  openSettingsWindowAtTemplate: (templateId) => ipcRenderer.send('open-settings-window-at-template', templateId),
  getSettingsTemplateTarget:    ()           => ipcRenderer.invoke('get-settings-template-target'),
  onNavigateToTemplate:         (cb)         => ipcRenderer.on('navigate-to-template', (_e, id) => cb(id)),
  openSettingsWindowAtSection:  (section)    => ipcRenderer.send('open-settings-window-at-section', section),
  getSettingsSectionTarget:     ()           => ipcRenderer.invoke('get-settings-section-target'),
  onNavigateToSection:          (cb)         => ipcRenderer.on('navigate-to-section', (_e, s) => cb(s)),
  openSearchWindow:    (q)      => ipcRenderer.send('open-search-window', q),
  getSearchTarget:     ()       => ipcRenderer.invoke('get-search-target'),
  onSearchSetQuery:    (cb)     => ipcRenderer.on('search-set-query', (_e, q) => cb(q)),
  getReviewTarget:     ()       => ipcRenderer.invoke('get-review-target'),
  onNavigateToDoc:     (cb)     => ipcRenderer.on('navigate-to-doc', (_e, id) => cb(id)),
  // User-guide / help window (optional section to jump to, e.g. 'review')
  openHelpWindow:      (section) => ipcRenderer.send('open-help-window', section),
  onHelpSection:       (cb)      => ipcRenderer.on('help-section', (_e, s) => cb(s)),

  // Teach-a-new-document wizard
  openTeachWindow:     ()       => ipcRenderer.send('open-teach-window'),
  openTeachWindowAt:   (docId)  => ipcRenderer.send('open-teach-window-at', docId),
  getTeachTarget:      ()       => ipcRenderer.invoke('get-teach-target'),
  onTeachLoadDoc:      (cb)     => ipcRenderer.on('teach-load-doc', (_e, id) => cb(id)),
  createDocTypeWithFields: (data) => ipcRenderer.invoke('create-doc-type-with-fields', data),

  // First-run setup wizard
  onboardingComplete:   ()       => ipcRenderer.send('onboarding-complete'),
  openOnboarding:       ()       => ipcRenderer.send('open-onboarding'),
  welcomeDone:          (action) => ipcRenderer.send('welcome-done', action),
  openWelcome:          ()       => ipcRenderer.send('open-welcome'),
  // Sandboxed practice run (Import→Review→Confirm on a bundled sample). The
  // file-sample call is the ONLY side-effect and writes only under TEMP.
  openTutorial:         ()       => ipcRenderer.send('open-tutorial'),
  // Legal / Terms — read the bundled text, open it externally, record/decline acceptance.
  getLegalText:         ()       => ipcRenderer.invoke('get-legal-text'),
  openLegal:            ()       => ipcRenderer.send('open-legal'),
  legalAccept:          ()       => ipcRenderer.send('legal-accept'),
  legalDecline:         ()       => ipcRenderer.send('legal-decline'),
  tutorialDone:         (action) => ipcRenderer.send('tutorial-done', action),
  tutorialFileSample:   (data)   => ipcRenderer.invoke('tutorial-file-sample', data),
  tutorialOpenFolder:   ()       => ipcRenderer.send('tutorial-open-folder'),
  tutorialCleanup:      ()       => ipcRenderer.invoke('tutorial-cleanup'),
  onWelcomeGotoImport:  (cb)     => ipcRenderer.on('welcome-goto-import', () => cb()),
  suggestedOutputFolder:()       => ipcRenderer.invoke('onboarding-suggested-folder'),
  validateOutputFolder: (folder) => ipcRenderer.invoke('onboarding-validate-folder', folder),

  // ── Folder processing ────────────────────────────────────────────────────────
  pickFolder:         ()     => ipcRenderer.invoke('pick-folder'),
  pickOutputFolder:   ()     => ipcRenderer.invoke('pick-output-folder'),
  processFolder:      (f, opts) => ipcRenderer.invoke('process-folder', f, opts),
  stagePdfForTeach:   ()     => ipcRenderer.invoke('stage-pdf-for-teach'),
  stopProcessing:     ()     => ipcRenderer.invoke('stop-processing'),
  onProgress:         (cb)   => ipcRenderer.on('process-progress', (_e, m) => cb(m)),
  removeProgress:     ()     => ipcRenderer.removeAllListeners('process-progress'),

  // ── Document types & fields ──────────────────────────────────────────────────
  getDocumentTypes:    ()           => ipcRenderer.invoke('get-document-types'),
  getAllDocTypes:       ()           => ipcRenderer.invoke('get-all-doc-types'),
  getAllDocTypesAll:    ()           => ipcRenderer.invoke('get-all-doc-types-all'),
  addDocumentType:     (data)       => ipcRenderer.invoke('add-document-type', data),
  updateDocumentType:  (id, ch)     => ipcRenderer.invoke('update-document-type', id, ch),
  getDoctypeCatalog:   ()           => ipcRenderer.invoke('get-doctype-catalog'),
  addDoctypePresets:   (slugs)      => ipcRenderer.invoke('add-doctype-presets', slugs),
  addField:            (data)       => ipcRenderer.invoke('add-field', data),
  updateField:         (id, ch)     => ipcRenderer.invoke('update-field', id, ch),
  deleteField:         (id)         => ipcRenderer.invoke('delete-field', id),
  getValidationPatterns: ()         => ipcRenderer.invoke('get-validation-patterns'),
  getFieldPatterns:      ()         => ipcRenderer.invoke('get-field-patterns'),
  getFieldSuggestions:   (docId, key) => ipcRenderer.invoke('get-field-suggestions', docId, key),

  // ── Review queue ─────────────────────────────────────────────────────────────
  getReviewQueue:              ()        => ipcRenderer.invoke('get-review-queue'),
  getDeferredQueue:            ()        => ipcRenderer.invoke('get-deferred-queue'),
  getReviewCount:              ()        => ipcRenderer.invoke('get-review-count'),
  getDeferredCount:            ()        => ipcRenderer.invoke('get-deferred-count'),
  getFieldRules:               ()        => ipcRenderer.invoke('get-field-rules'),
  getRecentAutoFiled:          ()        => ipcRenderer.invoke('get-recent-auto-filed'),
  clearRecentAutoFiled:        ()        => ipcRenderer.invoke('clear-recent-auto-filed'),
  getAutoFileEligible:         (ids)     => ipcRenderer.invoke('get-auto-file-eligible', ids),
  getGraduatedSuppliers:       ()        => ipcRenderer.invoke('get-graduated-suppliers'),
  setGraduationOptout:         (p)       => ipcRenderer.invoke('set-graduation-optout', p),
  getFieldValueHistory:        (scope)   => ipcRenderer.invoke('get-field-value-history', scope),
  getDocumentsForFieldValue:   (scope)   => ipcRenderer.invoke('get-documents-for-field-value', scope),
  purgeFieldValue:             (scope)   => ipcRenderer.invoke('purge-field-value', scope),
  renameFieldValue:            (scope)   => ipcRenderer.invoke('rename-field-value', scope),
  acceptNameValue:             (p)       => ipcRenderer.invoke('accept-name-value', p),
  getDocumentWithExtractions:  (id)      => ipcRenderer.invoke('get-document-with-extractions', id),
  notifyDocClosed:             (id)      => ipcRenderer.send('notify-doc-closed', id),
  reviewHeartbeat:             (id)      => ipcRenderer.invoke('review-heartbeat', id),
  getDocumentPages:            (id, fp, fn, scale) => ipcRenderer.invoke('get-document-pages', id, fp, fn, scale),
  getDocumentThumbnail:        (id, fp, fn) => ipcRenderer.invoke('get-document-thumbnail', id, fp, fn),
  getEnhancedPreview:          (data)       => ipcRenderer.invoke('get-enhanced-preview', data),
  confirmReview:               (payload) => ipcRenderer.invoke('confirm-review', payload),
  deferDocument:               (id)      => ipcRenderer.invoke('defer-document', id),
  restoreDeferred:             (id)      => ipcRenderer.invoke('restore-deferred', id),
  acknowledgeReview:           (id)      => ipcRenderer.invoke('acknowledge-review', id),
  deleteDocument:              (id, fp)  => ipcRenderer.invoke('delete-document', id, fp),
  getDeletedQueue:             ()        => ipcRenderer.invoke('get-deleted-queue'),
  restoreDocument:             (id)      => ipcRenderer.invoke('restore-document', id),
  purgeDocument:               (id)      => ipcRenderer.invoke('purge-document', id),
  purgeAllDeleted:             ()        => ipcRenderer.invoke('purge-all-deleted'),
  deleteAllReview:             ()        => ipcRenderer.invoke('delete-all-review'),
  deleteAllDeferred:           ()        => ipcRenderer.invoke('delete-all-deferred'),
  reprocessDocument:           (data)    => ipcRenderer.invoke('reprocess-document', data),
  reprocessBatch:              (docs)    => ipcRenderer.invoke('reprocess-batch', docs),
  getStuckCount:               ()        => ipcRenderer.invoke('get-stuck-count'),
  getStuckDocs:                ()        => ipcRenderer.invoke('get-stuck-docs'),
  promoteToTemplate:           (data)    => ipcRenderer.invoke('promote-to-template', data),
  linkDocumentToTemplate:      (data)    => ipcRenderer.invoke('link-document-to-template', data),
  checkTemplateMatch:          (id)      => ipcRenderer.invoke('check-template-match-for-document', id),
  notifyReviewComplete:        ()        => ipcRenderer.send('notify-review-complete'),

  // ── Zone OCR & learning ──────────────────────────────────────────────────────
  ocrRegion:           (b64)      => ipcRenderer.invoke('ocr-region', b64),
  ocrRegionBoxes:      (b64)      => ipcRenderer.invoke('ocr-region-boxes', b64),
  testTemplateMapping: (pageB64, mapping, landmarks) => ipcRenderer.invoke('test-template-mapping', pageB64, mapping, landmarks),
  saveFieldAnchor:     (data)     => ipcRenderer.invoke('save-field-anchor', data),
  saveFieldRule:       (data)     => ipcRenderer.invoke('save-field-rule', data),
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
  getOutputStructureInfo:  ()         => ipcRenderer.invoke('get-output-structure-info'),
  previewOutputPath:       (folderPattern, filenamePattern) => ipcRenderer.invoke('preview-output-path', { folderPattern, filenamePattern }),

  // ── Search ───────────────────────────────────────────────────────────────────
  searchDocuments:     (params)   => ipcRenderer.invoke('search-documents', params),
  getFiledCounts:      ()         => ipcRenderer.invoke('get-filed-counts'),
  getDashboardExtra:   ()         => ipcRenderer.invoke('get-dashboard-extra'),
  openExternal:        (url)      => ipcRenderer.send('open-external', url),

  // ── Mailbox / approval workflow (in-core; entitlement + role gated) ────────────
  workflow: {
    inbox:      () => ipcRenderer.invoke('workflow-inbox'),
    sent:       () => ipcRenderer.invoke('workflow-sent'),
    assigned:   () => ipcRenderer.invoke('workflow-assigned'),
    completed:  () => ipcRenderer.invoke('workflow-completed'),
    recipients: () => ipcRenderer.invoke('workflow-recipients'),
    assign:     (documentId, toUserId, actionRequired, comment) =>
                   ipcRenderer.invoke('workflow-assign', { documentId, toUserId, actionRequired, comment }),
    claim:      (id, version) => ipcRenderer.invoke('workflow-claim', { id, version }),
    resolve:    (id, decision, comment, version) =>
                   ipcRenderer.invoke('workflow-resolve', { id, decision, comment, version }),
    recall:     (id, version) => ipcRenderer.invoke('workflow-recall', { id, version }),
  },

  // ── Template Viewer / Anchor Mapping (admin-only, lives in Settings) ────────
  getTemplates:               ()                  => ipcRenderer.invoke('get-templates'),
  getTemplateDetail:          (id)                => ipcRenderer.invoke('get-template-detail', id),
  createTemplate:             (data)              => ipcRenderer.invoke('create-template', data),
  renameTemplate:             (id, name)          => ipcRenderer.invoke('rename-template', id, name),
  deleteTemplate:             (id)                => ipcRenderer.invoke('delete-template', id),
  getTemplateSampleCandidates:(id)                => ipcRenderer.invoke('get-template-sample-candidates', id),
  setTemplateSample:          (id, docId)         => ipcRenderer.invoke('set-template-sample', id, docId),
  reassignTemplateDocuments:  (fromId, toId)      => ipcRenderer.invoke('reassign-template-documents', fromId, toId),
  mergeTemplate:              (fromId, toId)      => ipcRenderer.invoke('merge-template', fromId, toId),
  setTemplateOcrAuto:         (id, enabled)       => ipcRenderer.invoke('set-template-ocr-auto', id, enabled),
  pickTemplateSampleFile:     ()                  => ipcRenderer.invoke('pick-template-sample-file'),
  importTemplateSampleFile:   (id, filePath)      => ipcRenderer.invoke('import-template-sample-file', id, filePath),
  regenerateTemplateLandmarks:(id)                => ipcRenderer.invoke('regenerate-template-landmarks', id),
  regenerateTemplateFingerprint:(id)              => ipcRenderer.invoke('regenerate-template-fingerprint', id),
  setTemplateLandmarks:       (id, lms)           => ipcRenderer.invoke('set-template-landmarks', id, lms),
  getTemplateLandmarks:       (id)                => ipcRenderer.invoke('get-template-landmarks', id),
  clearTemplateLandmarks:     (id)                => ipcRenderer.invoke('clear-template-landmarks', id),
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
  splitPdf:                   (file, ranges, outDir, docId, every) => ipcRenderer.invoke('split-pdf', file, ranges, outDir, docId, every),

  // ── Settings ─────────────────────────────────────────────────────────────────
  getSetting:          (key)      => ipcRenderer.invoke('get-setting', key),
  setSetting:          (key, val) => ipcRenderer.invoke('set-setting', key, val),
  getConcurrencyInfo:  ()         => ipcRenderer.invoke('get-concurrency-info'),
  getTelemetryInfo:    ()         => ipcRenderer.invoke('get-telemetry-info'),
  backupExport:        (password)        => ipcRenderer.invoke('settings-backup-export', { password }),
  backupPreview:       (password)        => ipcRenderer.invoke('settings-backup-preview', { password }),
  backupApply:         (path, password)  => ipcRenderer.invoke('settings-backup-apply', { path, password }),
  // Runtime flag for renderer dev-gating (e.g. the dev-only "Erase ALL data" tool).
  appIsDev:            ()         => ipcRenderer.invoke('app-is-dev'),

  // About box: version details + open the bundled third-party notice.
  getAppAbout:             ()    => ipcRenderer.invoke('get-app-about'),
  openThirdPartyLicenses:  ()    => ipcRenderer.invoke('open-third-party-licenses'),

  // ── Learning Recovery (Settings tab) ────────────────────────────────────────
  getLearningRecovery: (params)   => ipcRenderer.invoke('get-learning-recovery', params),
  getMemoryInventory:  ()         => ipcRenderer.invoke('get-memory-inventory'),
  resetAllLearning:    ()         => ipcRenderer.invoke('reset-all-learning'),
  resetFreshInstall:   ()         => ipcRenderer.invoke('reset-fresh-install'),
  clearLearningAnchors:(params)   => ipcRenderer.invoke('clear-learning-anchors', params),
  clearLearningHints:  (params)   => ipcRenderer.invoke('clear-learning-hints', params),
  clearLearningCorrections: (params) => ipcRenderer.invoke('clear-learning-corrections', params),
  clearLearningFieldRules: (params) => ipcRenderer.invoke('clear-learning-field-rules', params),
  getSupplierScopeCounts: (name)    => ipcRenderer.invoke('get-supplier-scope-counts', name),
  renameSupplier:      (payload)  => ipcRenderer.invoke('rename-supplier', payload),
  // "Fix a document type" recovery (scope reset + document set-aside)
  recoveryOverview:    (scope)   => ipcRenderer.invoke('recovery-overview', scope),
  recoveryApply:       (payload) => ipcRenderer.invoke('recovery-apply', payload),
  recoveryRestoreDocs: (ids)     => ipcRenderer.invoke('recovery-restore-docs', ids),
  // Learning Repair (browse/preview/suspects/send-to-review)
  repairOverview:      (scope)   => ipcRenderer.invoke('repair-overview', scope),
  repairDocFields:     (id)      => ipcRenderer.invoke('repair-doc-fields', id),
  repairDeconfirm:     (id)      => ipcRenderer.invoke('repair-deconfirm', id),
  repairDelete:        (id)      => ipcRenderer.invoke('repair-delete', id),

  // ── Advanced (Settings tab) — keyword label overrides ───────────────────────
  getLabelOverrides:   ()        => ipcRenderer.invoke('get-label-overrides'),
  addLabelOverride:    (data)    => ipcRenderer.invoke('add-label-override', data),
  addLabelOverrides:   (data)    => ipcRenderer.invoke('add-label-overrides', data),
  diagTeach:           (data)    => ipcRenderer.send('diag-teach', data),
  deleteLabelOverride: (id)      => ipcRenderer.invoke('delete-label-override', id),

  // ── Events from main → renderer ──────────────────────────────────────────────
  onThemeChanged:        (cb) => ipcRenderer.on('theme-changed',          (_e, t) => cb(t)),
  onDocTypesChanged:     (cb) => ipcRenderer.on('doc-types-changed',      ()      => cb()),
  onDashboardCardsChanged: (cb) => ipcRenderer.on('dashboard-cards-changed', ()   => cb()),
  onReviewCountChanged:  (cb) => ipcRenderer.on('review-count-changed',  (_e, n) => cb(n)),
  onDeferredCountChanged:(cb) => ipcRenderer.on('deferred-count-changed', (_e, n) => cb(n)),
  onReprocessProgress:   (cb) => ipcRenderer.on('reprocess-progress',    (_e, m) => cb(m)),
  removeReprocessProgress: ()  => ipcRenderer.removeAllListeners('reprocess-progress'),

  // Hidden dev inspector (read-only): request password unlock + subscribe to the
  // mirrored process telemetry. No privileged/mutating actions are exposed here.
  devInspectorUnlock:  (pw) => ipcRenderer.invoke('dev-inspector-unlock', pw),
  devInspectorRunning: ()   => ipcRenderer.invoke('dev-inspector-running'),
  // In-Review dev console: enable (with SFDEV password) / disable the per-field
  // extraction trace route to this window. No window is opened.
  reviewTraceSet:      (on, pw) => ipcRenderer.invoke('review-trace-set', on, pw),
  onProcessProgress:   (cb) => ipcRenderer.on('process-progress', (_e, m) => cb(m)),
  onWatchProgress:     (cb) => ipcRenderer.on('watch-progress',   (_e, m) => cb(m)),
  onDocAutoFiled:      (cb) => ipcRenderer.on('doc-auto-filed',   (_e, info) => cb(info)),
  onStuckCountChanged: (cb) => ipcRenderer.on('stuck-count-changed', (_e, n) => cb(n)),
  onProcessTrace:      (cb) => ipcRenderer.on('process-trace',    (_e, m) => cb(m)),
  devGetSessionDocs:   ()        => ipcRenderer.invoke('dev-get-session-docs'),
  devGetSessionDoc:    (key)     => ipcRenderer.invoke('dev-get-session-doc', key),
  devGetSlice:         (path)    => ipcRenderer.invoke('dev-get-slice', path),
});

// ── Keyboard-focus repair (Windows) ────────────────────────────────────────────
// Electron on Windows can leave a window's render widget WITHOUT keyboard focus while
// the OS window still HAS focus — so clicking a text field shows no caret and won't
// type until you click out of the app and back in (which forces an OS focus re-sync).
// The window 'show'/'focus' grabFocus in main can't catch this: no OS focus change
// happens (e.g. after a native confirm()/alert() dialog, or a child window closes).
// Repair it from the renderer — which runs in EVERY window via this preload: when a
// pointer press lands on a text control while the document lacks keyboard focus, ask
// main to re-focus the webContents, then re-assert focus on the pressed control. The
// preload shares the page DOM (contextIsolation isolates JS scope, not the DOM). No-op
// when focus is already fine, so a normal click is untouched.
window.addEventListener('pointerdown', (e) => {
  try {
    const t = e.target;
    const el = t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    if (!el) return;                    // only repair when actually entering a field
    // ALWAYS re-assert webContents keyboard focus on a text-field press. document.hasFocus()
    // is UNRELIABLE here: after a native confirm()/alert() (the Review window uses these for
    // the digit/issuer/delete prompts) — or a child window closing — the window reports
    // focused while the render widget has lost keyboard focus, so the old `hasFocus()` guard
    // skipped the repair in exactly the case that needs it ("clicked the box, can't type
    // until I alt-tab out and back"). wc.focus() is cheap + idempotent on a normal click.
    ipcRenderer.send('ensure-window-focus', { pageHasFocus: document.hasFocus() });
    // Re-assert the caret next frame ONLY if the press didn't already focus the field — so a
    // normal click's caret position is never disturbed; the broken case gets its focus back.
    requestAnimationFrame(() => {
      try {
        const already = document.activeElement === el;
        if (!already) el.focus();
      } catch {}
    });
  } catch { /* never let focus repair break a click */ }
}, true);
