# IP logging — privacy notice text + Legitimate Interests Assessment (DRAFT)

> **DRAFT for solicitor review — NOT legal advice.** Written to give a solicitor something to check
> and tighten rather than write from scratch. Fill the `[confirm …]` placeholders before use.
> Covers the personal data introduced by: storing the real connecting IP in `audit_events`
> (Cloudflare real-IP fix, 2026-09-19) and the admin console linking an IP to the customer
> (device fingerprint → seat → entitlement, plus the activation "set up here" IP).

Controller: **Six Mile Software** (trading name; sole trader), Office 1874, 92 Castle Street, Belfast,
BT1 1HE. Contact: **licensing@scanfinder.co.uk**. Product: **Scan Finder**. Seller of record: **Polar**
(merchant of record) — Six Mile Software remains the data controller for the processing described here.

---

## Part A — Privacy notice text (customer-facing)

> Add as a section of the Scan Finder / Six Mile Software privacy policy. Plain English on purpose.

**Connection and licensing data**

When your licensed copy of Scan Finder connects to our licensing service (at scanfinder.co.uk), we
record:

- the **public IP address** the connection comes from;
- a **device identifier** — a one-way fingerprint of your device (it cannot be reversed to identify your
  hardware, but it lets us tie a connection to the licence seat it belongs to);
- the **date and time** of the connection and which licensing action it was (for example activation or a
  routine licence check); and
- the **licence / account** the connection belongs to.

**Why we collect it.** We use this information to:

- verify your licence and manage seats (so a licence is used on the number of devices it was bought for);
- detect and prevent licence abuse, fraud and automated attacks, and keep the service secure; and
- provide support (for example, to diagnose a connection problem or identify which customer an issue
  relates to).

**Our lawful basis** is our **legitimate interests** in protecting, securing and supporting our software
licensing and preventing fraud and abuse (UK GDPR Article 6(1)(f)). Where verifying your licence is
necessary to provide the software you have bought, we also rely on **performance of a contract**
(Article 6(1)(b)).

**Who sees it.** This information is available only to authorised administrators at Six Mile Software.
We do **not** sell it, use it for marketing, or share it with any third party — it does not leave our
systems.

**How long we keep it.** Routine licence-check records are deleted after **90 days**. Activation records
are kept for the life of your licence and for a limited period afterwards, for licensing, fraud-prevention
and audit purposes.

**Your rights.** You can ask us to access, correct or delete your information, to restrict our use of it,
or to **object** to our use of it under legitimate interests. Contact licensing@scanfinder.co.uk. You can
also complain to the UK Information Commissioner's Office (ICO) at ico.org.uk.

**Where it is processed.** Our licensing service is hosted by [confirm host + region, e.g. IONOS, EU/UK].
[If any processing or transfer occurs outside the UK/EEA, describe the safeguards — otherwise state that
data stays within the UK/EEA.]

---

## Part B — Legitimate Interests Assessment (internal — keep on file)

> ICO three-part test. Not published; retained as the record that the balancing was done.
> Date of assessment: [confirm]. Reviewed by: [confirm].

### 1. Purpose test — is there a legitimate interest?

Yes. Six Mile Software has legitimate interests in:

- **enforcing its software licences** (binding a seat to a device so a licence is not used on more
  devices than were paid for) — protecting licensing revenue and the commercial model;
- **preventing fraud and abuse** (trial farming, licence-key guessing, sharing a single licence across an
  organisation, automated attacks on the licensing endpoint);
- **security of the service** (rate-limiting and anomaly detection depend on knowing the real source of a
  request); and
- **customer support** (identifying which customer a connection or fault relates to, and diagnosing
  connectivity issues).

These are real, present interests, not speculative, and are consistent with the customer's own interest
in a working, fairly-priced, secure product.

### 2. Necessity test — is the processing necessary for that purpose?

Yes, and it is minimised:

- Seat verification inherently requires a per-device identifier and a record of connections; the
  connecting IP is a standard, proportionate signal for abuse detection, rate-limiting and support.
- We collect only the IP, a non-reversible device fingerprint, a timestamp/action, and the account link —
  **not** document content, browsing, or any special-category data.
- Geo-location is **not** part of the service: no IP is sent to any external service, and the admin
  console shows counts and internal customer matches only. The data does not leave our systems.
- A less intrusive approach (not logging the IP at all) was considered and rejected: it would remove the
  ability to rate-limit per customer, to detect licence sharing/abuse, and to support connection issues.

### 3. Balancing test — do the individual's interests override the legitimate interest?

On balance, no:

- **Reasonable expectations:** a customer running licensed commercial software reasonably expects the
  vendor to verify the licence and to keep basic connection logs. This is standard and unsurprising.
- **Nature of the data:** an IP address plus a business/licence contact — ordinary personal data, not
  special category; low sensitivity.
- **Impact:** low. The data is not used for marketing or profiling, is not shared for others' purposes,
  and drives only licence verification, security and support.
- **Safeguards:** admin-only access behind authentication; 90-day retention for routine logs
  (`scripts/prune_audit_events.php`); no third-party transfer of the IP (geo is a click-through in the
  admin's own browser); the right to object is honoured.

**Conclusion:** the legitimate-interests basis is appropriate for this processing. The purpose is limited
to security, licence-abuse prevention and support (not general curiosity), it is disclosed in the privacy
notice, retention is bounded, and access is restricted.

---

### Open items for the solicitor

- Confirm the **hosting region** and whether any **international transfer** occurs; add the transfer
  mechanism if so.
- Confirm no wording elsewhere promises "we do not log IP addresses" (none exists today).
- Sanity-check the **automated licence-enforcement** angle: the licence gate blocks an app with an invalid
  licence. Confirm this is ordinary contractual enforcement rather than Article 22 automated
  decision-making with legal/similarly significant effect (human support is available; no profiling).
- Confirm the **retention** figures (90-day routine prune; activation kept for licence life + [period]).
