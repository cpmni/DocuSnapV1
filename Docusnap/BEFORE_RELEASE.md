# BEFORE RELEASE — outstanding deploy + action checklist

> Living checklist of things that MUST be done before the next customer release / that are
> built-but-not-yet-live. Tick + date when done; delete an item only once it's confirmed live.
> Add to this whenever a change lands that needs a manual deploy step the code alone won't do.

---

## 🔴 Live licensing-server deploys (IONOS, behind Cloudflare)

The licensing backend is a SEPARATE deploy — owner uploads PHP to IONOS by hand.
NEVER upload `keys/` or the ps1's blank `set-env.php` (the server's real per-host
`set-env.php` holds DB creds and must stay put). Docroot = `licensing/public/`.
`php -l` every changed file before upload.

- [ ] **Cloudflare real-client-IP fix** — commit `1d4ba4a` (2026-09-19). Without it the /v1
      per-IP rate limiter buckets ALL customers behind one CF edge (spurious 429s if traffic
      grows) and every `audit_events.ip` records a useless CF edge instead of the real customer.
      **Files:** `lib/db.php` + `lib/ratelimit.php` (2 files, no DB change).
      **DEPLOY ORDER matters** (avoids a redeclare/undefined fatal transient on the live host):
      1. upload `lib/ratelimit.php` FIRST (its `client_ip()` is now `function_exists`-guarded — safe with the old db.php),
      2. THEN upload `lib/db.php`.
      (Or upload both together in a quiet window and accept a sub-second 500 risk.)
      **Verify after:** load the site (no 500); an admin page `audit_events` row shows a real
      customer IP, not 172.68.x/162.158.x/141.101.x; a /v1 call still works.
      Optional: if a NEW Cloudflare edge range ever appears (unlikely), patch it with no code
      deploy via `LICENSING_CF_IPS` in `set-env.php` (space/comma-separated CIDRs).

- [ ] **"New account + issue licence"** — commit `dd2d7aa` (2026-09-19). Direct (non-Polar)
      customer onboarding. **NOT DEPLOYED.** Files: `lib/admin_actions.php` + `public/admin/accounts.php`
      (no DB change). Run `lib/test_create_account.php` on WAMP/server first.

- [ ] **Part C — API-activity page + audit hygiene** — commit `dcb11b1` (2026-09-19).
      Owner ran the live-DB `ALTER` (both `audit_events` indexes confirmed) + was uploading
      `public/admin/api_activity.php` + the `lib/admin_auth.php` sidebar entry. **Confirm both
      files are live.** `scripts/prune_audit_events.php` is deliberately NOT web-served (above docroot).

- [ ] **Re-run `scripts/test_admin_throttle.php`** on WAMP or the server (dev MySQL was offline
      2026-09-19 so it self-skipped). Oracle traced it unaffected by the CF-IP change, but confirm green.

---

## 🟡 Legal / privacy

- [ ] **Privacy notice must disclose IP logging (GDPR transparency) — BEFORE this is customer-facing.**
      We now store each customer's real connecting IP in `audit_events` and, in the admin console, link
      it to the customer (fingerprint→seat→entitlement, + the "set up here" activation IP). IP + identity
      is personal data under UK-GDPR. Required before customers rely on it:
      - Privacy/Terms (`LEGAL.txt`, still DRAFT — solicitor items outstanding) must state we log the IP the
        licensed app connects from, the **purpose** (service security / licence-abuse detection / support —
        NOT curiosity; purpose limitation), and the **retention** (routine `license.validated` rows pruned
        after 90 days via `scripts/prune_audit_events.php`; activations kept for the licence life).
      - Keep a short **Legitimate Interests Assessment** note (purpose · necessity · balancing) on file.
      - Make NO "we do not log IP addresses" promise (none exists today).
      - Keep the admin IP↔customer view **admin-only** (it is) and the geo lookup **click-through** (it is —
        no customer IP is sent server-side to any third party).
      - Get a solicitor to bless the wording (this is not legal advice).

- [ ] **Deploy the admin API-activity update** (commit `b4755a3`): re-upload
      `public/admin/api_activity.php` (customer-per-IP column + geo click-through link). No DB change.
      Consider an Oracle vet of the PII join + the unindexed `ip IN (...)` query before the live upload.

---

## Notes
- Core/client installers are built per session under `dist\` / `client\dist\` — the latest
  TEST build + its HEAD are in the current `HANDOVER_*.md`. A customer build must be the
  HARDENED `build:release` road, not the plain `build`.
