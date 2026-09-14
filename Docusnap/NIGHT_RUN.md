# NIGHT_RUN — 2026-09-14 → 15 (owner: "kick off the night run"; Chris tests teach + Quick File + client connect, fix pass, re-test)

Owner directive (going to bed): have Chris drive a THOROUGH test of the new **teach-over-client**, **Quick File**,
and **client connect** features; write a thorough report; do ONE pass to fix his findings; then run the EXACT
same test again and log the results. I choose the most useful actions; night-run autonomy protocol
(auto+safe proceed · approval-class → log for morning + skip · dangerous → stop that item · Chris sandboxed).

## Pre-work DONE (before Chris)
- Simpler-connection feature BUILT + pushed (S1 server card + code + QR + tip; S2 client verified-connect +
  cert-change; S3 client QR scan). Oracle SIGN-OFF-W/COND C1-C5 met; T1-T4 pinned. Full pin gate **370/370 green**.
  Commits `716e846` and earlier, all pushed.
- Sandbox set up for a REAL connect test: core bound `0.0.0.0` + TLS (cert covers the LAN IP), teach + Quick File
  on. Self-smoke PASSED (client typed the LAN IP → accept-cert modal showed the fingerprint → reached login).

## Sandbox facts (this run)
- Core: CDP **9223**, window PID 23580 (re-detect — it changes), at "ScanFinder — Sign in". TLS API
  **https://10.85.2.125:8765**. Admin **chris / Chris-Test-9**.
- Client: CDP **9224**, window PID 17832 (re-detect), fresh Connect screen. Connect to **10.85.2.125 : 8765,
  HTTPS ON**.
- 12 Northgate invoices in the core review queue (teachable); Demo Docs in the sandbox for Quick File.

## Ledger
- [ ] Chris ROUND A — thorough test (connect + teach + Quick File) → report appended to
      `docs/CHRIS_FULL_APP_REVIEW_2026-09-14.md`.
- [ ] Fix pass (safe/auto only; approval-class logged here + skipped; dangerous stopped). Pin gate stays green.
- [ ] Chris ROUND B — EXACT same test → results logged, compared to A.
- [ ] Morning summary + push.

### Approval-class / skipped (for the owner's morning vet)
- (none yet)
