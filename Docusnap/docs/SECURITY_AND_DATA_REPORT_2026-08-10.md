# Scan Finder — security, licensing and data review

**Written 2026-08-10, overnight, before release. Plain terms throughout.**

Three separate reviews ran: the desktop app itself (Electron/Node), the licensing system front and
back, and everything the app leaves on disk in readable form. This is the summary you asked for:
what there is, what needs doing, and what I already did.

---

## The short version

The app is in better shape than most software of its size. The renderer windows are properly locked
down, passwords are hashed to a current standard, the audit log is genuinely tamper-evident, the
diagnostics cannot leak your customers' data because there is no field it could travel in, and the
licence server has no way for a stranger to mint themselves a licence.

**Six things were wrong enough to fix on the spot, and I fixed them all tonight.** Four things are
decisions only you can make. One thing — the build change — needs ten minutes of your time before
you ship, and I could not do it for you.

---

## What I fixed tonight

### 1. Anyone could have given themselves a free licence with a text editor
The app checks licences using cryptographic keys baked inside the program, precisely so nobody can
swap them. There was an environment setting that turned that off and made it read the keys from a
plain text file that ships beside the app instead. Set one variable, edit one file, sign yourself a
permanent licence. **That switch is now ignored in the shipped app** (it still works during
development, which is how the test proves the protection is real).

### 2. A five-minute, endlessly repeatable free trial
To recognise a machine, the app reads a Windows identifier by running `reg.exe`, and it found that
program via a Windows setting called `%SystemRoot%`. **That setting is chosen by whoever starts the
program.** So: write a fake `reg.exe` that prints a made-up identifier, start Scan Finder pointing
at it, and the server sees a machine it has never met — a fresh 14-day trial, on demand, for ever.
No admin rights needed, and it never touched the licensing code at all. **The app now finds
`reg.exe` in fixed, known locations.** I verified the fingerprint is now identical when a fake
directory is supplied.

### 3. The shipped program could be used as a debugging tool against itself
`ScanFinder.exe --remote-debugging-port=9222` gave anyone a full developer console inside the
running app: read all the code, pause it, and call its internal functions. It was not a way to steal
data they could not already reach, but it is a ready-made kit for taking the app apart. **A shipped
build now refuses to start with those switches.** Development builds are unaffected.

### 4. Your anti-tamper protections were built, tested — and switched off in every release
There is a script in the project that hardens the shipped `.exe` so it cannot be used as a general
purpose script runner. It only runs when a build flag is set, and the build command never set it.
**I have added the flag.** See "the ten minutes I need from you" below — this one needs your hands.

### 5. The licence brake was permanently locking out paying customers
If someone mistyped their licence key 13 times, the counter that slows down guessing **froze above
the limit for ever** — that internet address could never activate again, while the message on screen
promised "try again in 15 minutes". This hurts customers, not pirates: anyone who fat-fingers a key,
and every office, hotel or mobile network where everybody shares one address. **Fixed.**

### 6. One person could take new-customer signups offline worldwide
New trials were capped at 500 per day using a single global counter. About 50 computers for an hour
would have used it up, and every genuine new customer would then get "too many requests" until
midnight — while existing customers carried on working, so nothing would have looked wrong.
**The cap is now per network (25/day), with the global figure kept only as an alarm.**

### Also fixed, from the data review
- **The support log was quietly recording your customers' data.** `processing.log` runs on every
  install, with no setting and no mention anywhere in the app, and it was writing supplier and
  customer names, VAT numbers, references, totals and full file paths. On this machine: over a
  thousand money amounts and 685 user paths. **It now records the shape of every line — which
  field, which method, how confident, what failed — and not the content.** Turning on Diagnostic
  Logging (admin only, off by default, already warns what it holds) restores the full detail.
- **The LAN add-on's private key was stored in the clear.** Its certificate authority key was
  properly protected and the server key next to it was not — and the server key is the one that
  lets somebody impersonate your service to computers that already trust you. **Now protected the
  same way** (Windows DPAPI, so the file is useless on any other machine).
- **Two folders of real customer documents were one `git add -A` away from being committed.**
  `recovered_inbox/` and `templates/` held real scanned PDFs and 99 distinct supplier names.
  **Both are now ignored by git.**

---

## The ten minutes I need from you before you ship

**Build the installer once, then open every window in it.** I turned on the hardening flags for
release builds (#4 above). Those flags are burned into the `.exe` and cannot be undone at runtime,
and a wrong one means an app that will not start with no error message. It has never been tested.
So: `npm run build`, install it, and click through — main window, Review, Settings, Search, Teach,
Help, About, and print something. If everything opens, you are done for ever. If anything fails to
start, remove `process.env.HARDEN_FUSES='1';` from the build script in `package.json` and tell me.

---

## The four decisions only you can make

### 1. The offline grace is 7 days — including for the £299 lifetime licence
A customer who buys outright and works on a machine with no internet is locked out on day 8. A
workshop PC, a locked-down office, a laptop on holiday. **My recommendation: keep 7 days for trials,
extend paid licences to 30–45 days.** One-line change; it is your call because it is a trade between
piracy risk and customer trust, and I think the customer side wins comfortably here.

### 2. Code signing the installer
Today Windows shows "Windows protected your PC → Run anyway" to every customer installing your
software. Signing removes that, and it is also what makes the anti-tamper work in #4 meaningful.
Cost is roughly £200–500 a year plus identity checks — and those checks will touch your personal
name, which sits awkwardly with keeping the proprietor's name off public material. Worth starting
now regardless, because certificates take time to issue.

### 3. The XML files written next to every filed document
Every filed document gets a small XML file beside it containing all the extracted values — totals,
VAT numbers, account numbers — in plain text. This is useful (it is how other systems read your
data) but it is unconditional, undocumented, and it lands wherever the customer points their output
folder, which is very often OneDrive or a shared drive. Nobody decided this; it just happens.
**Recommendation: add a setting (on by default) and one line in the documentation.**

### 4. Encrypting the database — my answer is "not yet", and here is why
The database holds the full text of every scanned document, every extracted value, and the list of
every company the customer deals with. It is not encrypted.

The obvious fix is to encrypt it. The hard question is *where the key lives*, because the app has to
open the database by itself when it starts, with nobody there to type a password. The standard
answer on Windows is DPAPI — which you already use for other secrets.

What that would actually buy: **if the file leaves the machine, it is useless.** A leaked cloud
backup, a copied user profile, a resold laptop — genuinely protected.

What it would not buy: **anything at all against someone using that Windows account.** DPAPI is
designed to hand the key back to that user; that is its whole job. So it defeats "the file walked
off" and nothing else.

It is not pointless, but it is narrower than it sounds, and it is a one-to-two-week job because the
monthly audit archives attach to the same database and would need the same treatment, and because an
encrypted database you cannot open is unrecoverable customer data. **Do the cheaper items first;
revisit this the first time a customer's IT department asks.**

Meanwhile the honest answer to "what if my laptop is stolen" is **BitLocker**, which protects
everything at once and costs you nothing to recommend. That belongs in your privacy page, not in
your code.

---

## What is genuinely good, and worth saying out loud to customers

- **Diagnostics cannot leak document data.** The telemetry only accepts a fixed list of event names
  and properties — app version, Windows version, architecture — and there is no free-text field
  anywhere for anything else to hide in. Most vendors cannot make that claim truthfully.
- **Your data folder is already private.** Windows restricts `%APPDATA%\ScanFinder` to your own
  account and administrators. Another ordinary user on the same PC cannot read it. No work needed —
  just say so in the documentation.
- **Nothing is uploaded.** There is no crash reporter and no document upload path anywhere.
- **Passwords are stored properly** (Argon2id at current recommended strength), and the audit log
  is chained so tampering shows up. Say "tamper-evident", not "tamper-proof" — the distinction is
  real and a technical customer will respect the honesty.
- **The extraction engine ships compiled, not as source.** Only the small entry scripts are readable.

---

## The rest, ranked, for when you have time

**This week, if you can (roughly a week of work):**
1. Retention and a "clear diagnostic data" button — the debug folder had 56 MB of document text
   with no expiry, and turning the setting off deletes nothing. Today you could not honestly answer
   a "delete my data" request.
2. Temp-file tidying — a 214 KB file of learned customer values was sitting in the Windows temp
   folder five days after the process that wrote it had gone. Cleanup happens on the happy path
   only, and nothing sweeps at startup.
3. The XML decision above.

**After release:**
4. Stronger storage for account keys on the licence server (they are single-round SHA-256 today).
5. Ten small server-side items — an already-used two-factor code stays valid for about 90 seconds,
   logout has no CSRF token, and similar.
6. Tamper-detection for the trial: a small signed local record that only ever moves forward, with a
   flag carried to your server at the next online check. **This is the one I would actually build**,
   because it never risks locking out an honest customer whose clock is wrong, and it gives you a
   list of the handful of people gaming the trial so you can decline to serve them.

**Do not bother with:** obfuscating the JavaScript or compiling it to bytecode (weeks of work, days
of protection, and it breaks your ability to debug customer problems); tightening folder permissions
that Windows already sets correctly; hardening the temp files against other users who cannot read
them anyway.

---

## One thing to verify on the live server

The whole anti-abuse layer on the licence server switches itself off silently if one database table
(`rate_limits`) is missing. Worth a single check on the live host:

```sql
SHOW TABLES LIKE 'rate_limits';
```

If that returns nothing, every limit described above is inert right now.
