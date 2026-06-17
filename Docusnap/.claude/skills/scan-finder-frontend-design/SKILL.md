---
name: scan-finder-frontend-design
description: This skill helps Claude design and build distinctive, production-grade frontend interfaces for Scan Finder — an offline, privacy-first document-scanning, OCR, and intelligent field-extraction app. It turns loose requirements into a bold, coherent visual direction plus real working code for the marketing site, feature pages, pricing/licensing section, buy/checkout flow UI, and the admin content-management area, while enforcing royalty-free, legally safe assets. It is frontend-only: it defines backend integration seams (payments, license generation, auth, storage) but does not implement them.
license: MIT
---

# Scan Finder Frontend Design

This skill teaches Claude to act as a senior product/frontend designer for **Scan Finder**, a Windows desktop app that scans and imports documents, runs OCR, intelligently extracts fields (reference/invoice numbers, dates, totals, supplier and customer names), and auto-files them into an organized folder structure with metadata — all fully offline and private, with no cloud processing. Scan Finder learns per-supplier and per-layout templates over time so extraction gets more accurate with use; users confirm or correct results in a review queue, and filed documents become instantly searchable. It is sold as a free trial plus paid, device-bound seat licenses with activation.

This skill exists so every interface built for Scan Finder is intentional, memorable, and credible — never generic "AI slop." It commits to one bold aesthetic direction per project and executes it with precision in real, working code.

## When to Use This Skill

Use this skill when the work is **Scan Finder frontend design or implementation**, including:

- Designing or redesigning the Scan Finder **marketing site** and **product/feature pages** (how scanning, OCR, intelligent extraction, learning, and auto-filing are explained credibly).
- Building the **pricing and licensing section** that clarifies free trial vs paid, device-bound seat licenses.
- Designing the **buy/checkout flow UI and its states** — pricing → checkout → loading → success → failure → license-key reveal — including the handoff points where a backend issues a license key after successful payment.
- Designing the **admin content-management area** — login plus an intuitive UI so the owner can edit feature copy, pricing, testimonials, download links, and other site content.
- Building **reusable components** tailored to a scan/search/extract product: search inputs, filters, result cards, empty states, pricing/licensing cards, license-key states, dashboard widgets, forms, and tables.
- Turning loose or vague requirements into a **bold, coherent visual direction** plus production-grade code.

It is **NOT** for:

- Implementing backend logic — payment-processor integration, license-key generation, activation servers, auth, or data storage.
- Writing API integration logic, server routes, or database code (the skill defines the frontend's integration *seams/contract* only).
- Generic Bootstrap/template theming, off-the-shelf admin dashboards, or any "drop in a UI kit" work that ignores aesthetic direction.

## What This Skill Does

- **Commits to and justifies one BOLD aesthetic direction per project.** Before writing code, it establishes purpose, audience, tone, constraints, and the single most differentiating idea — the thing someone remembers. It picks an extreme and executes it true to that direction. Scan-Finder-flavored examples: an *industrial scanning console* (utilitarian, monospace, signal-green-on-graphite, scanline motion); an *editorial document-intelligence site* (magazine layout, characterful serif display, generous columns and rules); a *refined privacy-first product page* (luxury restraint, deep ink palette, a single sharp accent, calm motion). Bold maximalism and refined minimalism both qualify — the rule is intentionality, not intensity, with implementation complexity matched to the vision.

- **Produces real, production-grade code** — HTML/CSS/JS, React, Vue, or the requested stack — that is functional, cohesive, visually striking, and meticulously refined. No placeholder "lorem" filler where real Scan Finder copy belongs.

- **Designs layouts around how people SCAN pages.** Marketing surfaces follow a deliberate hierarchy (hero → proof/features → how-it-works → pricing/licensing → CTA) using F/Z reading patterns, decisive headlines, and clear primary CTAs (**Start free trial** / **Buy** / **Download**). App-like surfaces (search, admin) are designed for fast scanning: prominent search inputs, filters, result cards, pagination, and considered empty/loading/error states — balancing information density against clarity.

- **Proposes complete design systems**: a typography system (distinctive display font paired with a refined body font), color tokens as CSS variables (dominant colors with sharp accents, not timid even palettes), a spacing/sizing scale, elevation/shadow language, and motion principles (favor one well-orchestrated staggered page-load moment over scattered micro-interactions).

- **Generates a tailored component library**: navigation, hero, feature blocks, "how it works" steps, pricing/licensing cards, the checkout and license-key reveal states, testimonials, trust/privacy callouts, admin dashboard widgets, forms, tables, and empty states — each styled to the chosen direction rather than to a generic kit.

- **Defines backend integration seams without implementing them.** For the buy flow it specifies the contract: where checkout posts, what success/failure payloads look like, the loading state during payment, and the license-key reveal (copyable, one-time emphasis, "save this key" guidance). For the admin area it specifies the auth boundary and content-read/write seams as typed props or fetch points — leaving real auth, payment, and storage to the backend.

- **Folds in accessibility and performance**: WCAG AA contrast, full keyboard operability, focus-visible states, semantic HTML and ARIA where needed, reduced-motion fallbacks, responsive layouts, and lean asset budgets.

- **Enforces royalty-free, legally safe assets as a HARD CONSTRAINT.** It uses only license-safe graphics — original CSS/SVG, generated geometric/abstract/mesh art, and explicitly royalty-free sources (public-domain/CC0). It never uses copyrighted or unlicensed imagery, fonts, or icons, and prefers self-hosted open-license fonts (e.g. SIL OFL) with attribution noted where required.

- **Carries Scan Finder's product story through the UI**: offline and private by design, intelligent extraction and hands-off auto-filing, "learns and gets more accurate with use," fast scanning and search, and simple licensing with a free trial — so the result never reads as a generic SaaS template.

- **Avoids generic AI aesthetics by rule**: no overused fonts (Inter, Roboto, Arial, system), no cliché schemes (especially purple gradients on white), no predictable layouts or cookie-cutter components. It varies meaningfully across generations (light/dark, fonts, tone) and never converges on the same default choices.

## How to Use

Provide as much of the following as possible: **purpose** (what the surface must achieve), **audience** (e.g. small-business owners, security-conscious buyers), **constraints** (framework, performance, accessibility, browser targets), any **existing brand or UX patterns** to respect, and whether the desired output is **design direction only, code only, or both**. If a bold direction is not specified, the skill will propose one (or several) and justify the pick.

**Basic usage**

> "Design the Scan Finder homepage and generate the HTML/CSS. It's an offline, private document-scanning app that auto-extracts invoice fields and files them. Lead with privacy and accuracy; include hero, features, a how-it-works section, a pricing/licensing block with a free trial and paid seat, and a Download CTA."

The skill commits to one aesthetic direction, lays out the page for fast scanning, defines design tokens, and returns working, royalty-free-asset code with real Scan Finder copy and clear CTAs.

**Advanced usage**

> "We want a dark, industrial 'scanning console' aesthetic for security-conscious small-business owners. Stack: Next.js + Tailwind. Give me two distinct concept directions first, then we'll refine one. Build the full marketing site, a pricing/licensing section (trial vs device-bound seat), and the buy flow — pricing → checkout → loading → success with a copyable license-key reveal → failure — wired to backend seams I'll fill in later. Also design the admin login and a content-management UI for editing feature copy, pricing, testimonials, and download links. All graphics must be royalty-free."

Here the skill presents multiple concept directions, supports a refinement loop, then implements the chosen direction across pages and states — defining the checkout/license-key and admin auth/content seams as typed props or fetch points while leaving payments, license generation, auth, and storage to the backend.

## Example

**User prompt**

> "Design and build the pricing + licensing section for Scan Finder's marketing site. Audience: bookkeepers and small firms who hate cloud tools. Plain HTML/CSS. It must make the trial-vs-paid-seat choice obvious, reinforce that everything stays offline, and lead into a buy flow where a license key is revealed after payment."

**Aesthetic direction chosen — and why**

A *refined privacy-first* direction: a deep graphite-and-ink palette with a single sharp signal-amber accent, a characterful display serif (Fraunces, OFL) paired with a precise grotesque body (Space Mono is overused — instead, IBM Plex Sans, OFL) and a monospaced numeral treatment for prices. The restraint signals trust and "your data stays on your machine," while the warm amber accent draws the eye decisively to the recommended seat and the primary CTA. No stock imagery — atmosphere comes from a CSS layered radial mesh plus a faint generated grain, all original and license-safe. This avoids the purple-gradient-on-white cliché and reads as calm, credible, and bought-not-rented.

**Illustrative code excerpt** (design tokens + a license card)

```html
<style>
  /* Self-hosted OFL fonts; no third-party CDN tracking, license-safe */
  :root {
    --ink:        #0d0f12;
    --graphite:   #15181e;
    --surface:    #1c2028;
    --line:       #2a2f3a;
    --text:       #e7e9ee;
    --muted:      #9aa3b2;
    --signal:     #f5a623;   /* lone sharp accent */
    --signal-ink: #1a1205;
    --r:          14px;
    --space:      clamp(1rem, 2vw, 1.75rem);
    --display:    "Fraunces", Georgia, serif;
    --body:       "IBM Plex Sans", system-ui, sans-serif;
  }

  .price-grid {
    display: grid;
    gap: var(--space);
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    background:
      radial-gradient(120% 80% at 80% -10%, #1d222c 0%, transparent 60%),
      var(--ink);
    padding: clamp(2rem, 6vw, 5rem);
    font-family: var(--body);
    color: var(--text);
  }

  .license-card {
    position: relative;
    border: 1px solid var(--line);
    border-radius: var(--r);
    background: linear-gradient(180deg, var(--surface), var(--graphite));
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    transition: transform .25s ease, border-color .25s ease;
  }
  .license-card:hover { transform: translateY(-4px); border-color: var(--signal); }

  .license-card[data-featured] {
    border-color: var(--signal);
    box-shadow: 0 0 0 1px var(--signal), 0 24px 60px -30px var(--signal);
  }
  .license-card[data-featured]::before {
    content: "Recommended";
    position: absolute; top: -.7rem; left: 1.5rem;
    background: var(--signal); color: var(--signal-ink);
    font: 600 .7rem/1 var(--body); letter-spacing: .08em; text-transform: uppercase;
    padding: .4rem .6rem; border-radius: 999px;
  }

  .license-card h3 { font-family: var(--display); font-size: 1.6rem; margin: 0; }
  .price { font-size: 2.6rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .price small { color: var(--muted); font-size: .85rem; font-weight: 400; }
  .feat { list-style: none; margin: 0; padding: 0; display: grid; gap: .6rem; color: var(--muted); }
  .feat li::before { content: "▸ "; color: var(--signal); }

  .cta {
    margin-top: auto; border: 0; cursor: pointer;
    background: var(--signal); color: var(--signal-ink);
    font: 600 1rem/1 var(--body);
    padding: .9rem 1.2rem; border-radius: 10px;
    transition: filter .2s ease;
  }
  .cta:hover { filter: brightness(1.08); }
  .cta:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; }
  .cta.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }

  @media (prefers-reduced-motion: reduce) {
    .license-card, .cta { transition: none; }
  }
</style>

<section class="price-grid" aria-label="Scan Finder licensing">
  <article class="license-card">
    <h3>Free Trial</h3>
    <p class="price">£0 <small>/ 14 days</small></p>
    <ul class="feat">
      <li>Full offline scanning &amp; OCR</li>
      <li>Intelligent field extraction</li>
      <li>Auto-filing &amp; search</li>
      <li>No card required</li>
    </ul>
    <button class="cta ghost" data-action="start-trial">Start free trial</button>
  </article>

  <article class="license-card" data-featured>
    <h3>Seat License</h3>
    <p class="price">£149 <small>/ device, one-time</small></p>
    <ul class="feat">
      <li>Everything in the trial, unlocked</li>
      <li>Device-bound activation</li>
      <li>Learns your suppliers — accuracy grows with use</li>
      <li>100% offline. Your documents never leave the machine.</li>
    </ul>
    <!-- Seam: posts to backend checkout; on success backend returns a license key -->
    <button class="cta" data-action="buy" data-plan="seat">Buy &amp; activate</button>
  </article>
</section>
```

**Buy-flow handoff (frontend seam only).** The `Buy & activate` button transitions the UI through explicit states — `idle → submitting (loading) → success | failure`. On success the design reveals a **copyable license key** in a one-time, high-emphasis panel ("Save this key — it activates Scan Finder on one device") with a copy button and a fallback for manual entry; on failure it shows a recoverable error with a retry. The skill wires these states and their callbacks (`onCheckout`, `onLicenseIssued`, `onError`) as the contract; the actual payment capture and key generation are implemented by the backend and are out of scope.
