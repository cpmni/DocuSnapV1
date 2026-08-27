'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Audit M4: Chromium's default action for a file dropped on the page is to NAVIGATE to
// file://<dropped>, which would load a page that keeps this preload (privileged IPC) but
// loses the per-page <meta> CSP. No window accepts drag-drop, so swallow both events for
// every window uniformly (the preload shares the page DOM). Pairs with the main-process
// will-navigate guard. SECURITY (Stage 2 — M9): ALWAYS on — a security boundary must not
// carry an environment kill switch (the old NAV_GUARD_DISABLED=1 could be set by a local
// attacker to re-open the drop-a-local-HTML → privileged-preload-with-no-CSP path).
try {
  window.addEventListener('dragover', (e) => e.preventDefault(), false);
  window.addEventListener('drop', (e) => e.preventDefault(), false);
} catch { /* window unavailable in an odd context — the main-process guard still applies */ }

// Diagnostic completeness (2026-08-02): forward every window's uncaught errors and unhandled
// promise rejections to the main-process log, so "the red text in a screenshot" is in
// processing.log by itself. Fire-and-forget send; main caps per-window volume. The preload
// runs in every window, so no per-window wiring is needed. Never throws.
try {
  const _fwd = (message, stack) => {
    try { ipcRenderer.send('renderer-error', { message: String(message).slice(0, 500), stack: stack ? String(stack).slice(0, 1500) : null, href: location && location.href }); } catch {}
  };
  window.addEventListener('error', (e) => _fwd(e.message || e.type, e.error && e.error.stack), true);
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    _fwd(`unhandledrejection: ${r && (r.message || r)}`, r && r.stack);
  });
} catch { /* diagnostics must never break a window */ }

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
  verifyAuditChain:     ()           => ipcRenderer.invoke('verify-audit-chain'),
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
  // Advisory update banner (slice 1): resolved "is a newer version available?" + open the
  // backend-supplied update URL (validated main-side against a scheme allowlist).
  getUpdateInfo:         ()   => ipcRenderer.invoke('get-update-info'),
  openUpdateUrl:         ()   => ipcRenderer.invoke('open-update-url'),
  updateLockQuit:        ()   => ipcRenderer.send('update-lock-quit'),   // forced-update lock: Quit
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
  // De-pathed opens: the main process resolves the filed copy from the doc row —
  // no renderer ever supplies a path (returns {success,error}).
  openDocumentFile:        (docId) => ipcRenderer.invoke('open-document-file', docId),
  showDocumentInExplorer:  (docId) => ipcRenderer.invoke('show-document-in-explorer', docId),

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
  openSearchWindowAt:  (view)   => ipcRenderer.send('open-search-window-at', view),
  openExportWindow:    ()       => ipcRenderer.send('open-export-window'),
  // Export-data window IPC (admin; read-only pull of confirmed doc data)
  exportOptions:       ()        => ipcRenderer.invoke('export-options'),
  exportPreview:       (payload) => ipcRenderer.invoke('export-preview', payload),
  exportRun:           (payload) => ipcRenderer.invoke('export-run', payload),
  getSearchTarget:     ()       => ipcRenderer.invoke('get-search-target'),
  getSearchViewTarget: ()       => ipcRenderer.invoke('get-search-view-target'),
  onSearchSetQuery:    (cb)     => ipcRenderer.on('search-set-query', (_e, q) => cb(q)),
  onSearchGoto:        (cb)     => ipcRenderer.on('search-goto', (_e, v) => cb(v)),
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
  getStampedViewerTarget: ()    => ipcRenderer.invoke('get-stamped-viewer-target'),
  onStampedViewerLoad:  (cb)    => ipcRenderer.on('stamped-viewer-load', (_e, id) => cb(id)),
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
  listImportFolder:   (folder) => ipcRenderer.invoke('list-import-folder', folder),
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
  // Teach-time issuer plausibility (warning only; Chris round 2). Answered by the ONE shared
  // predicate in learning.js so the teach surfaces cannot grow their own copy of it.
  checkIssuerRead:     (value)      => ipcRenderer.invoke('check-issuer-read', value),
  checkIdentityNearMatch: (value)   => ipcRenderer.invoke('check-identity-near-match', value),
  checkTypeSplit:      (p)          => ipcRenderer.invoke('check-type-split', p),   // A3: {supplier_name, document_type_slug}
  getFieldPatterns:      ()         => ipcRenderer.invoke('get-field-patterns'),
  getFieldSuggestions:   (docId, key) => ipcRenderer.invoke('get-field-suggestions', docId, key),

  // ── Review queue ─────────────────────────────────────────────────────────────
  getReviewQueue:              ()        => ipcRenderer.invoke('get-review-queue'),
  getDeferredQueue:            ()        => ipcRenderer.invoke('get-deferred-queue'),
  getReviewCount:              ()        => ipcRenderer.invoke('get-review-count'),
  getReviewSplit:              ()        => ipcRenderer.invoke('get-review-split'),
  devSwitchesUnlock:           (pw)      => ipcRenderer.invoke('dev-switches-unlock', pw),
  getDeferredCount:            ()        => ipcRenderer.invoke('get-deferred-count'),
  getFieldRules:               ()        => ipcRenderer.invoke('get-field-rules'),
  getRecentAutoFiled:          ()        => ipcRenderer.invoke('get-recent-auto-filed'),
  getQuietRereadStatus:        ()        => ipcRenderer.invoke('get-quiet-reread-status'),
  cancelQuietReread:           (jobId)   => ipcRenderer.invoke('cancel-quiet-reread', { jobId }),
  clearRecentAutoFiled:        ()        => ipcRenderer.invoke('clear-recent-auto-filed'),
  reprocessAutocommitAccept:   ()        => ipcRenderer.invoke('reprocess-autocommit-accept'),
  getAutoFileReason:           (docId)   => ipcRenderer.invoke('get-auto-file-reason', docId),
  getGraduatedSuppliers:       ()        => ipcRenderer.invoke('get-graduated-suppliers'),
  getScopeReadiness:           ()        => ipcRenderer.invoke('get-scope-readiness'),
  getTeachFollowup:            (docId)   => ipcRenderer.invoke('get-teach-followup', { docId }),
  setGraduationOptout:         (p)       => ipcRenderer.invoke('set-graduation-optout', p),
  getFieldValueHistory:        (scope)   => ipcRenderer.invoke('get-field-value-history', scope),
  getDocumentsForFieldValue:   (scope)   => ipcRenderer.invoke('get-documents-for-field-value', scope),
  purgeFieldValue:             (scope)   => ipcRenderer.invoke('purge-field-value', scope),
  getAnchorsForScope:          (scope)   => ipcRenderer.invoke('get-anchors-for-scope', scope),
  deleteFieldAnchor:           (p)       => ipcRenderer.invoke('delete-field-anchor', p),
  renameFieldValue:            (scope)   => ipcRenderer.invoke('rename-field-value', scope),
  acceptNameValue:             (p)       => ipcRenderer.invoke('accept-name-value', p),
  acceptIssuer:                (p)       => ipcRenderer.invoke('accept-issuer', p),
  resolveIssuer:               (p)       => ipcRenderer.invoke('resolve-issuer', p),
  // Tell main the render widget's keyboard focus is now SUSPECT (call right after a native
  // confirm()/alert() returns) so the next text-field press does the real blurWebView() repair
  // even if the window's own 'blur' event didn't fire for the dialog. See focusRepair.js.
  markFocusSuspect:            ()        => ipcRenderer.send('mark-focus-suspect'),
  // Proactively drive the same widget-level focus transition the pointerdown repair uses
  // (main → blurWebView(false)→wc.focus(true), a real page-focus edge; never an OS window
  // activation). Called at draw/zone-OCR completion so the caret is re-established onto the
  // just-filled input BEFORE the user clicks — the click's own repair races the Python-spawn
  // desync and loses (eric, 2026-07-10).
  ensureWindowFocus:           ()        => ipcRenderer.send('ensure-window-focus', { pageHasFocus: document.hasFocus() }),
  // Awaitable variant of the same widget-focus edge — lets a PROGRAMMATIC el.focus() be
  // ordered AFTER the edge (the fire-and-forget send above can't be sequenced, which is the
  // exact race the pointerdown chokepoint warns about). Used by shared/dialogFocus focusField.
  ensureWindowFocusAsync:      ()        => ipcRenderer.invoke('ensure-window-focus', { pageHasFocus: document.hasFocus() }),
  getDocumentWithExtractions:  (id)      => ipcRenderer.invoke('get-document-with-extractions', id),
  // Projected detail (no paths/ocr_text — the /v1 DTO shape): the Search/mailbox surfaces' read.
  getDocumentDetail:           (id)      => ipcRenderer.invoke('get-document-detail', id),
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
  restoreAllDeleted:           ()        => ipcRenderer.invoke('restore-all-deleted'),
  purgeDocument:               (id)      => ipcRenderer.invoke('purge-document', id),
  purgeAllDeleted:             ()        => ipcRenderer.invoke('purge-all-deleted'),
  deleteAllReview:             ()        => ipcRenderer.invoke('delete-all-review'),
  deleteAllDeferred:           ()        => ipcRenderer.invoke('delete-all-deferred'),
  reprocessDocument:           (data)    => ipcRenderer.invoke('reprocess-document', data),
  reprocessBatch:              (docs, opts) => ipcRenderer.invoke('reprocess-batch', docs, opts),
  getReprocessStatus:          ()           => ipcRenderer.invoke('get-reprocess-status'),
  consumeReprocessCompletion:  ()           => ipcRenderer.invoke('consume-reprocess-completion'),
  getStuckCount:               ()        => ipcRenderer.invoke('get-stuck-count'),
  getStuckDocs:                ()        => ipcRenderer.invoke('get-stuck-docs'),
  promoteToTemplate:           (data)    => ipcRenderer.invoke('promote-to-template', data),
  linkDocumentToTemplate:      (data)    => ipcRenderer.invoke('link-document-to-template', data),
  checkTemplateMatch:          (id)      => ipcRenderer.invoke('check-template-match-for-document', id),
  reextractFieldsFast:         (docId)   => ipcRenderer.invoke('reextract-fields-fast', { docId }),
  // Catch-up Filing (consent-gated scope sweep) — candidates is READ-ONLY; accept is the only writer.
  sweepScopeCandidates: (supplier, typeSlug)                       => ipcRenderer.invoke('sweep-scope-candidates', { supplier, typeSlug }),
  sweepQueueCandidates: ()                                         => ipcRenderer.invoke('sweep-queue-candidates'),
  classFixUndo:         (batchId)                                  => ipcRenderer.invoke('class-fix-undo', batchId),
  classFixResolveAsk:   (payload)                                  => ipcRenderer.invoke('class-fix-resolve-ask', payload),
  sweepScopeAccept:     (supplier, typeSlug, accepts, untickedIds) => ipcRenderer.invoke('sweep-scope-accept', { supplier, typeSlug, accepts, untickedIds }),
  sweepScopeUndo:       (docIds)                                   => ipcRenderer.invoke('sweep-scope-undo', { docIds }),
  notifyReviewComplete:        ()        => ipcRenderer.send('notify-review-complete'),

  // ── Zone OCR & learning ──────────────────────────────────────────────────────
  ocrRegion:           (b64)      => ipcRenderer.invoke('ocr-region', b64),
  ocrRegionBoxes:      (b64)      => ipcRenderer.invoke('ocr-region-boxes', b64),
  ocrPageWords:        (b64)      => ipcRenderer.invoke('ocr-page-words', b64),
  getPageDeskew:       (b64, minAngle) => ipcRenderer.invoke('get-page-deskew', b64, minAngle),
  testTemplateMapping: (pageB64, mapping, landmarks) => ipcRenderer.invoke('test-template-mapping', pageB64, mapping, landmarks),
  saveFieldAnchor:     (data)     => ipcRenderer.invoke('save-field-anchor', data),
  getTaughtFieldKeys:  (scope)    => ipcRenderer.invoke('get-taught-field-keys', scope),
  scopeConfirmedCount: (scope)    => ipcRenderer.invoke('scope-confirmed-count', scope),
  resolveFieldVisibility: (payload) => ipcRenderer.invoke('resolve-field-visibility', payload),
  saveFieldRule:       (data)     => ipcRenderer.invoke('save-field-rule', data),
  extractLogoHash:     (b64)      => ipcRenderer.invoke('extract-logo-hash', b64),
  matchLogoHash:       (b64)      => ipcRenderer.invoke('match-logo-hash', b64),
  saveLogoFingerprint: (data)     => ipcRenderer.invoke('save-logo-fingerprint', data),
  // Correction ripple (identity text-first slice 2): find same-sender siblings by page text,
  // then pin the chosen ones so a reprocess re-reads them under the corrected supplier.
  findIssuerSiblings:  (docId, value)   => ipcRenderer.invoke('find-issuer-siblings', { docId, value }),
  applyIssuerRipple:   (docIds, value)  => ipcRenderer.invoke('apply-issuer-ripple', { docIds, value }),

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
  previewDuplicateName:    (suffix)    => ipcRenderer.invoke('preview-duplicate-name', suffix),

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
    counts:     () => ipcRenderer.invoke('get-workflow-counts'),
    recipients: () => ipcRenderer.invoke('workflow-recipients'),
    assign:     (documentId, toUserId, actionRequired, comment, resubmitOf) =>
                   ipcRenderer.invoke('workflow-assign', { documentId, toUserId, actionRequired, comment, resubmitOf }),
    claim:      (id, version) => ipcRenderer.invoke('workflow-claim', { id, version }),
    resolve:    (id, decision, comment, version) =>
                   ipcRenderer.invoke('workflow-resolve', { id, decision, comment, version }),
    recall:     (id, version) => ipcRenderer.invoke('workflow-recall', { id, version }),
    // E1 admin cancel-route (admin) + the open-route reads that surface stuck routes
    adminCancel: (id, version, reason) => ipcRenderer.invoke('workflow-admin-cancel', { id, version, reason }),
    docRoutes:   (documentId)  => ipcRenderer.invoke('workflow-doc-routes', { documentId }),
    openRoutes:  ()            => ipcRenderer.invoke('workflow-open-routes'),
    docHistory:  (documentId)  => ipcRenderer.invoke('workflow-doc-history', { documentId }),
    stampedPages:  (routeId)   => ipcRenderer.invoke('workflow-stamped-pages', { routeId }),
    exportStamped: (routeId)   => ipcRenderer.invoke('workflow-export-stamped', { routeId }),
    openStampedViewer: (routeId) => ipcRenderer.send('open-stamped-viewer', routeId),
    // Routing rules — the Workflow settings area (admin)
    rulesList:  ()           => ipcRenderer.invoke('workflow-rules-list'),
    ruleCreate: (p)          => ipcRenderer.invoke('workflow-rule-create', p),
    ruleUpdate: (p)          => ipcRenderer.invoke('workflow-rule-update', p),
    ruleToggle: (id, active) => ipcRenderer.invoke('workflow-rule-toggle', { id, active }),
    ruleDelete: (id)         => ipcRenderer.invoke('workflow-rule-delete', { id }),
    ruleDryRun: (p)          => ipcRenderer.invoke('workflow-rule-dry-run', p),
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
  getMergeCandidates:         ()                  => ipcRenderer.invoke('get-merge-candidates'),
  planTemplateBackfill:       ()                  => ipcRenderer.invoke('plan-template-backfill'),
  applyTemplateBackfill:      ()                  => ipcRenderer.invoke('apply-template-backfill'),
  mergeTemplateCluster:       (canonId, memberIds) => ipcRenderer.invoke('merge-template-cluster', canonId, memberIds),
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
  setTemplateHiddenField:     (id, key, hidden)   => ipcRenderer.invoke('set-template-hidden-field', id, key, hidden),
  getSenderFieldEditor:       (payload)           => ipcRenderer.invoke('get-sender-field-editor', payload),
  setSenderFieldHidden:       (payload)           => ipcRenderer.invoke('set-sender-field-hidden', payload),
  onReviewVisibilityChanged:  (cb)                => ipcRenderer.on('review-visibility-changed', (_e, p) => cb(p)),
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
  // Filing Slips — printable separator-sheet pack (opens via openFile/showInExplorer)
  generateFilingSlips:        (count)        => ipcRenderer.invoke('generate-filing-slips', count),
  // Document printing through the customer's printer driver (Print-Slice 1 + preview)
  printDocument:              (payload)      => ipcRenderer.invoke('print-document', payload),
  printAvailable:             ()             => ipcRenderer.invoke('print-available'),
  listPrinters:               ()             => ipcRenderer.invoke('list-printers'),

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
  findDuplicateSuppliers: ()     => ipcRenderer.invoke('find-duplicate-suppliers'),
  // "Fix a document type" recovery (scope reset + document set-aside)
  recoveryOverview:    (scope)   => ipcRenderer.invoke('recovery-overview', scope),
  recoveryApply:       (payload) => ipcRenderer.invoke('recovery-apply', payload),
  recoveryRestoreDocs: (ids)     => ipcRenderer.invoke('recovery-restore-docs', ids),
  // Learning Repair (browse/preview/suspects/send-to-review)
  repairOverview:      (scope)   => ipcRenderer.invoke('repair-overview', scope),
  repairDocFields:     (id)      => ipcRenderer.invoke('repair-doc-fields', id),
  repairDeconfirm:     (id, opts) => ipcRenderer.invoke('repair-deconfirm', id, opts),
  repairDelete:        (id)      => ipcRenderer.invoke('repair-delete', id),
  // Learning Repair v2 (2026-08-26): the scope selector + console + "start fresh" (DARK)
  learningScopes:        (opts)   => ipcRenderer.invoke('learning-scopes', opts),
  learningRepairDryRun:  (scope)  => ipcRenderer.invoke('learning-repair-dry-run', scope),
  learningRepairForget:  (scope)  => ipcRenderer.invoke('learning-repair-forget', scope),
  learningRepairUndo:    (p)      => ipcRenderer.invoke('learning-repair-undo', p),
  learningRepairSnapshots: ()     => ipcRenderer.invoke('learning-repair-snapshots'),

  // ── Advanced (Settings tab) — keyword label overrides ───────────────────────
  getLabelOverrides:   ()        => ipcRenderer.invoke('get-label-overrides'),
  addLabelOverride:    (data)    => ipcRenderer.invoke('add-label-override', data),
  // Teach a LIST field = teach its caption (owner 2026-08-27): the wizard/⊕ write the printed caption
  // beside the drawn value as a doc-type-wide keyword for that field (Admin+Edit gated, list-typed only).
  teachListCaption:    (data)    => ipcRenderer.invoke('teach-list-caption', data),
  addLabelOverrides:   (data)    => ipcRenderer.invoke('add-label-overrides', data),
  diagTeach:           (data)    => ipcRenderer.send('diag-teach', data),
  deleteLabelOverride: (id)      => ipcRenderer.invoke('delete-label-override', id),

  // ── Events from main → renderer ──────────────────────────────────────────────
  onThemeChanged:        (cb) => ipcRenderer.on('theme-changed',          (_e, t) => cb(t)),
  onDocTypesChanged:     (cb) => ipcRenderer.on('doc-types-changed',      ()      => cb()),
  onDashboardCardsChanged: (cb) => ipcRenderer.on('dashboard-cards-changed', ()   => cb()),
  // Child-window dock (main window only — main-side sender guard enforces it): the list of
  // minimised child windows, so the shell can show a chip to bring each one back.
  getDockedChildren:     ()   => ipcRenderer.invoke('get-docked-children'),
  restoreChildWindow:    (n)  => ipcRenderer.send('restore-child-window', n),
  onChildDockChanged:    (cb) => ipcRenderer.on('child-dock-changed',     (_e, l) => cb(l)),
  onReviewCountChanged:  (cb) => ipcRenderer.on('review-count-changed',  (_e, n) => cb(n)),
  onDeferredCountChanged:(cb) => ipcRenderer.on('deferred-count-changed', (_e, n) => cb(n)),
  // Workflow invalidation ping (Slice 1) — carries NO data; listeners re-pull counts.
  onWorkflowCountsChanged:(cb) => ipcRenderer.on('workflow-counts-changed', () => cb()),
  // Recycle-bin change signal (2026-08-16): no payload — the subscriber re-pulls its own
  // role-gated get-deleted-queue. See main.js notifyBinChanged.
  onBinChanged:           (cb) => ipcRenderer.on('bin-changed', () => cb()),
  onReprocessProgress:   (cb) => ipcRenderer.on('reprocess-progress',    (_e, m) => cb(m)),
  // Import/watch activity (broadcast to ALL windows) so Review can show WHY reprocess is paused.
  onProcessingActivity:  (cb) => ipcRenderer.on('processing-activity',   (_e, s) => cb(s)),
  getProcessingActivity: ()   => ipcRenderer.invoke('get-processing-activity'),
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
  onScopeAutoFiled:    (cb) => ipcRenderer.on('scope-auto-filed', (_e, info) => cb(info)),   // Slice 1: a sender's ready docs filed by itself
  // B1 (activity strip): the review activity ledger — event-id addressed, the renderer never sends doc ids
  getReviewEvents:       ()          => ipcRenderer.invoke('get-review-events'),
  onReviewEvent:         (cb)        => ipcRenderer.on('review-event', (_e, ev) => cb(ev)),
  markReviewEventsSeen:  (uptoId)    => ipcRenderer.invoke('review-events-seen', { uptoId }),
  getReviewEventDocs:    (eventId)   => ipcRenderer.invoke('get-review-event-docs', { eventId }),
  undoReviewEvent:       (eventId)   => ipcRenderer.invoke('review-event-undo', { eventId }),
  recordFileAllOutcome:  (payload)   => ipcRenderer.invoke('record-file-all-outcome', payload),   // File All kept-back receipt
  getAutofiledGrid:      (eventId)   => ipcRenderer.invoke('get-autofiled-grid', { eventId }),        // batch-audit "Quick check" grid
  batchAuditCorrect:     (payload)   => ipcRenderer.invoke('batch-audit-correct', payload),           // { eventId, edits:[{docId,fields}] }
  onQuietReprocess:    (cb) => ipcRenderer.on('quiet-reprocess', (_e, info) => cb(info)),   // Slice 3: the quiet re-read lane's progress (never reprocess-progress)
  onStuckCountChanged: (cb) => ipcRenderer.on('stuck-count-changed', (_e, n) => cb(n)),
  onProcessTrace:      (cb) => ipcRenderer.on('process-trace',    (_e, m) => cb(m)),
  devGetSessionDocs:   ()        => ipcRenderer.invoke('dev-get-session-docs'),
  devGetSessionDoc:    (key)     => ipcRenderer.invoke('dev-get-session-doc', key),
  devGetSlice:         (path)    => ipcRenderer.invoke('dev-get-slice', path),
  // SFDEV bulk debug-table: read the queue-wide field grid / save it + slices to disk.
  devDebugTableData:   ()        => ipcRenderer.invoke('dev-debug-table-data'),
  devDebugTableSave:   (payload) => ipcRenderer.invoke('dev-debug-table-save', payload),
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
    // Deliberately EXCLUDE <select>: a native dropdown has no text caret to repair, and the
    // repair's blurWebView() / el.focus() would CLOSE its just-opened popup (the "dropdown
    // flashes open and shut" regression). Only real text-editing controls need caret repair.
    const el = t && t.closest && t.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
    if (!el) return;                    // only repair when actually entering a text field
    const pageHasFocus = document.hasFocus();
    // SYSTEMIC keyboard-focus cure (eric, 2026-07-10) — the ONE chokepoint every text-field
    // press flows through, so it heals the render-widget desync (page-focus lost while the
    // window still claims focus) regardless of what triggered it (Confirm & File, ⊕ draw,
    // Learning-History modal, … all showed the identical pageHasFocus=false state). It gives
    // the universal path the two things the per-site draw-fix has and the old code lacked:
    //
    // (A) In the DESYNCED state only, make the pressed control the pending focused element
    //     BEFORE the page-focus edge runs, so SetPageFocus(true) restores focus TO IT, not to
    //     <body> (the reason the edge fired but the caret never landed). Gated on !pageHasFocus
    //     → a healthy click is byte-identical to the native focus/caret path, and <select> is
    //     already excluded above. This pre-edge focus is what makes the heal correct even though
    //     the invoke reply and the SetPageFocus messages ride different mojo pipes.
    if (!pageHasFocus && document.activeElement !== el) { try { el.focus(); } catch {} }
    // (B) Deterministic edge: main runs blurWebView()→wc.focus() and REPLIES; then re-assert the
    //     caret past the cross-process transition with a double rAF. invoke (not send) is what
    //     orders the re-focus AFTER the edge — the old single-rAF send RACED it and every
    //     re-click re-lost. The listener stays synchronous (we chain .then, never await), so
    //     event dispatch is not blocked and the click's native default focus still runs.
    ipcRenderer.invoke('ensure-window-focus', { pageHasFocus }).then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          if (document.activeElement !== el) el.focus();
          const ae = document.activeElement;
          try {
            console.log(`[focus] after: active=${ae && ae.tagName}#${ae && ae.id} `
              + `hasFocusNow=${document.hasFocus()} activeStillEl=${document.activeElement === el}`);
          } catch {}
          // (C) VERIFIED one-shot self-heal (no 2nd user click): the page STILL lacks focus a
          //     frame after a completed repair pass — a PROVEN-stuck page (categorically unlike
          //     the removed capture-phase at-rest read: a healthy click's rAF read is true, so
          //     this branch is unreachable from a healthy path). Re-issue ONCE with
          //     forceEdge:true — the flag main actually honours (eric, 2026-07-10 night: the
          //     old pageHasFocus:false payload was deliberately ignored post-revision, leaving
          //     this self-heal TOOTHLESS and unarmed-trigger desyncs permanent — the 17-press
          //     telemetry runs). forceEdge exists ONLY on this line; capped at one; no recursion.
          if (!document.hasFocus()) {
            ipcRenderer.invoke('ensure-window-focus', { pageHasFocus: false, forceEdge: true }).then(() => {
              requestAnimationFrame(() => requestAnimationFrame(() => {
                try { if (document.activeElement !== el) el.focus(); } catch {}
              }));
            }).catch(() => {});
          }
        } catch {}
      }));
    }).catch(() => {});
  } catch { /* never let focus repair break a click */ }
}, true);
