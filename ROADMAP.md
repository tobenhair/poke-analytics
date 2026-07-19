# Roadmap

Where this goes from a personal tool toward a product other people can rely on.
Not a commitment or a schedule — a prioritised backlog. The ordering reflects
one deliberate decision: **the data stays manually entered by the maintainer
for now** — though a viable automated path has now been identified (see
"Automated ingestion", below) — so everything else is sequenced to make that
hand-curated data as useful, trustworthy, and easy to act on as possible.

## North star

Answer one question faster than any other tool: **is this sealed product
fairly priced for the set value it contains — and is now a good time to buy?**

That answer is now explicit on the page: a **fair price in euros** per product
(the expected-for-age fit inverted, R²-gated), a plain-language verdict on the
board, and alerts that fire on it. The current phase makes those numbers
*trustworthy* — visibly and verifiably right, with every failure mode around
them guarded. Every feature below is judged against that north star; anything
that doesn't help someone find a fairly-priced product earns its place some
other way or doesn't ship.

## Done

Condensed history — details live in the git log and `CLAUDE.md`.

- **Foundations** — CI (workbook validator + unit tests + Playwright smoke
  test on every push/PR); guard skills (`data-integrity`, `metrics-review`,
  `verify-app`, `design-review`) in `.claude/skills/`.
- **Protect & surface the manual data** — Data Entry delta warnings (fat-finger
  guard), data-driven "last updated" + staleness flag, server-side staleness
  email reminder (Supabase `pg_cron` + Resend). One person's hand-entered
  numbers are the single source of truth; the reliability of *that* process is
  the product's credibility.
- **Quality & the reason to log in** — pure metrics extracted to `metrics.js`
  (one source of truth for the browser and the `node --test` suite); faster
  monthly entry loop (pre-fill, keyboard flow, bulk paste, completeness state);
  signed-in **Portfolio** (private RLS-scoped holdings, unrealised P&L) and
  **Price Alerts** (buy-below targets, in-app flags); pre-login demo page.
- **The fair-price verdict** — the whole phase shipped: **Fair Price (€)** per
  product (the age-fit line inverted to euros, R²-gated confidence); the
  plain-language **Board verdict** (sortable, text-first); the **product
  drill-down** (one product, one screen, fair-price band overlaid); **fair-price
  alerts** (*"≥10% below fair"*, recompute as the fit moves) plus server-side
  **alert emails** for fixed € targets (`supabase/alert-emails.sql` — fair
  alerts stay in-app since the fit is computed client-side); **board search &
  verdict filters**; **multi-series set/product comparison** with set roll-ups;
  the global **type filter** across all views; and the signed-in portfolio's
  **concentration balancer**, **value-over-time chart**, and **display
  currency** (€ canonical, FX display-only).
- **Metrics extraction finished** — every derived number now lives in
  `metrics.js` as a pure, unit-tested function: momentum/drawdown (the verdict's
  ingredients), peer residuals, the board trend arrow and 💰 buy signal, the
  fair-alert target, and the Scenario Explorer math (which also gained the
  product's true booster count instead of a back-calculation from rounded
  data). Rule going forward: **no derived number ships without a test.**
- **Error monitoring** — runtime errors are reported to an insert-only Supabase
  `client_errors` table (early-capture handlers + a deduped, session-capped
  beacon; explicit reports at the cloud-load/save and demo catches). Anyone may
  insert, only the admin reads, nothing is updatable via the API; a no-op in
  static mode. No new vendor. Plus a **daily email digest**
  (`supabase/error-digest.sql`, the proven `pg_cron` + Resend pattern) that
  summarises new errors grouped by message — and sends nothing when the table
  is clean, so the email itself is the alarm.
- **Data-quality guards, extended** — the delta warning already covered set
  values as well as prices (30 % inline nudge, 80 % confirm-block); added the
  two missing guards as pure, unit-tested `metrics.js` functions surfaced in
  Data Entry **and** as non-blocking warnings in the workbook validator:
  **snapshot gap detection** (silently skipped months — it immediately caught a
  real 77-day gap) and a **same-set SV/Booster consistency check** that flags a
  product whose type/booster count disagrees with its price pattern.
- **E2E coverage for the signed-in surface** — a second Playwright spec
  (`tests/signed-in.spec.mjs`) drives the Supabase surface with a stubbed
  in-memory SDK (`tests/fake-supabase-sdk.js`; no cloud credentials, fully
  hermetic): the logged-out demo scope, auth-driven UI gating, the snapshot
  pivot, portfolio/alert auto-save payloads, the admin Data Entry → cloud-save
  loop, and the error beacon's cloud path. Proves the client's behaviour; the
  RLS policies themselves stay server-side and schema-reviewed.

## Now — trustworthy numbers (stability & quality)

A tool that tells people what's fairly priced has to be *right*, visibly and
verifiably. This theme extends the correctness story CI started to every number
on the page and every failure mode around it.

- **Backup & restore.** Formalise beyond the manual xlsx export: scheduled
  Supabase backups plus a periodic automated xlsx snapshot, and — the part that
  actually matters — a documented, rehearsed restore path.
- **Performance at catalogue scale.** Measure the board and charts at several
  hundred products before it happens organically; cap, paginate, or virtualise
  the table only if the measurements say so.
- **Cleanup & refactor pass.** Pay down accumulated cruft: remove stale and
  obsolete comments and any dead code, reconcile the folder structure with what
  the project actually is today (`scripts/`, `tests/`, `supabase/`,
  `metrics.js`), and check that `CLAUDE.md`, the README, and the skills still
  describe reality. `index.html` stays one inline file by design, but pure logic
  keeps migrating to `metrics.js` — keep that boundary clean and the docs
  honest. A hygiene pass, not a rewrite; the no-build, single-file deployment
  model is deliberate and stays.
- **Architecture overview diagram.** A single image committed to the repo
  (alongside `CLAUDE.md`) that maps the moving parts at a glance — the data
  sources (hardcoded fallback, `pokemon_data.xlsx`, Supabase), the load path
  (`boot` → `loadFromSupabase`/`tryAutoLoad` → `applyNewData` → the render
  functions), `metrics.js` as the shared math, and the tab/render structure — so
  a human or a new contributor can navigate the codebase without
  reverse-engineering it from one ~5,200-line file. Kept in sync when the
  architecture moves.

## Then — design & usability at product level

The aesthetic is deliberate and stays (dark, minimalist, `design-review`-
enforced). This theme is about the page working as hard for a first-time
visitor on a phone as it does for the maintainer on a desktop.

- **UX assessment.** Before the individual fixes below, a structured pass over
  the whole experience end-to-end: walk the real journeys — a logged-out
  visitor landing on the demo, a first-time sign-in, the maintainer's monthly
  Data Entry loop, someone checking a price on a phone — and catalogue where
  each one stalls, confuses, or asks too much. The nine-section Analysis scroll,
  the tab model, and the Data Entry grid are the obvious suspects, but the point
  is to find the friction we've stopped seeing rather than assume it. Output is
  a prioritised list of concrete issues that feeds the bullets below (and may
  reorder them), not a redesign — the aesthetic stays; this is about whether the
  page *works*, judged against the north star: how fast can someone actually get
  to "is this fairly priced, and should I buy?"
- **Overview-first restructure.** With the verdict shipped, the top of the
  Analysis tab can *answer the question* — best deals now, each with its fair
  price gap — and the nine numbered sections become the supporting evidence a
  curious user drills into (progressive disclosure), rather than a wall to
  scroll. Less on screen, more answered.
- **Collapsible section descriptions.** Every Analysis section carries a
  `.section-desc` explainer — invaluable on first read, pure scroll once you
  know the page, and on mobile the nine of them dominate the viewport before a
  single number is visible. Add a show/hide toggle (per-section and a global
  "hide descriptions") that collapses each to a tappable "ⓘ" affordance and
  remembers the choice (localStorage), so a returning user isn't scrolling past
  prose every visit. The text stays in the DOM for first-timers and screen
  readers; it just starts collapsed on small screens. Important for mobile
  specifically, useful everywhere.
- **Mobile optimisation.** Verify and fix the real phone experience
  end-to-end: the 70vh table scroll, chart legibility, tap targets, the Data
  Entry grid, and the vertical density of nine full-width sections stacked with
  their descriptions (the collapsible-descriptions toggle above is the first
  lever). A price-checking tool gets used in shops, standing up — the phone
  layout has to answer "is this fairly priced?" without a desktop.
- **Set logos (drill-down first).** Give each set a visual anchor: the
  expansion logo, at least on the product drill-down view where there's room to
  frame a single product, and later a small mark on board rows and set
  groupings. An identity and scannability aid only — it stays subordinate to the
  numbers and honours the minimalist dark aesthetic (`design-review`). Needs a
  licensing-clean asset source, a consistent sizing/placement rule, and a
  graceful fallback when a set has no logo (never a broken image).
- **Accessibility.** Keyboard navigation for tabs, tables and the drill-down;
  ARIA roles on the tab system; visible focus states; non-colour cues wherever
  green/red still carries meaning alone (the text verdict resolves the worst
  of it, then audit the rest).
- **First-class loading, empty, and error states.** Every async surface
  (boot, cloud load, demo, save) gets a designed state instead of a blank
  panel or a toast — including the currently-invisible "workbook failed,
  showing sample data" fallback, which must never masquerade as real data.
- **Onboarding & the demo as a pitch.** The section descriptions explain each
  chart; nothing yet explains the *method* — or, on the logged-out demo, even
  what the tool *is*. Lead the demo page with a plain statement of the tool's
  purpose and goal (what it tracks, the one question it answers, why sealed
  product and set value) before the demo cards, so a first-time visitor
  understands what they're looking at in one screen. Then a short first-visit
  walkthrough ("set value vs price, why age matters, what the verdict means")
  plus a glossary, and the rest of the demo reworked to tell the fair-price
  story — the logged-out page is the marketing site, and its job is to earn a
  sign-in.
- **Reconcile the Welcome tab with the demo page.** Do this *at the same time*
  as the demo rework above, rather than leaving two overlapping intros to drift.
  Decide the Welcome tab's fate: either fold the parts of it the logged-out demo
  lacks into the demo page and retire the tab, or make the Welcome page visible
  to logged-out visitors too so signed-in and signed-out users share one
  explanation instead of maintaining two. The goal either way is a single
  authoritative "what this is and how to read it" surface — not today's split
  where the pitch lives in one place for visitors and another for members.

## Later — reach & launch readiness

- **LLM assistant — data & portfolio assessment, reasoning, dialogue.** A
  conversational layer over everything the dashboard already computes: ask "is
  now a good time to buy Prismatic Evolutions?" or "how exposed is my portfolio,
  and what should I buy next?" and get a reasoned, plain-language answer that
  cites the underlying numbers — fair-price gap, drawdown vs peak, set-value
  trend, and (signed in) the user's own holdings and concentration. It reasons
  over the derived metrics rather than replacing them: the maths stays in
  `metrics.js` as the ground truth, the model explains and synthesises it and
  holds a dialogue, so it can never invent a price. Grounding it in structured
  values (not free-form scraping) is what keeps it honest. Depends on the
  fair-price verdict and the portfolio balancer being in place to reason about;
  gated behind sign-in, with clear "not financial advice" framing and a guard
  against over-confident calls on weak-fit products. A back-end call (the model
  runs server-side via an Edge Function, never exposing a key client-side) —
  the first feature that adds real per-use cost, so it lands late and behind
  accounts.
- **Mobile app / installable experience.** For a price-checking tool used in
  shops, a home-screen presence and a native-feeling mobile experience are worth
  real weight — this is the "how do we ship mobile" bet, and it depends on the
  **Mobile optimisation** work under "Then" landing first (no point wrapping an
  unoptimised page). Sequenced cheapest-first: (1) a **PWA** — installable, an
  app icon, offline shell, splash — is the natural fit for a single static
  `index.html` and buys most of the "feels like an app" value for the least
  work and no app-store overhead; (2) a thin **wrapper** (e.g. Capacitor) around
  the same page if an actual App Store / Play Store listing is wanted, reusing
  the web codebase; (3) a **native/React-Native rewrite** only if a real
  platform capability demands it — it abandons the deliberate no-build,
  single-file model and doubles the surface to maintain, so it needs a
  concrete reason beyond "native is nicer." Recommendation: PWA first, revisit
  the heavier options only if it falls short.
- **Privacy-friendly analytics** — know which views are actually used before
  investing further in them.
- **Legal/compliance for launch** — privacy policy, GDPR basics, cookie consent
  (EU-operated, stores emails in Supabase). The "not financial advice"
  disclaimer already exists.
- **Coverage growth** — more sets and eras first (same model, more rows), then
  consider multi-currency/multi-region pricing and, much later, singles — each
  multiplies data-entry cost, so each waits on the ingestion question below.
- **Launch checklist** — uptime expectations, support contact, versioned
  changelog, a public "how the numbers work" methodology page (the trust
  document for a tool that claims to know what's fairly priced).

## Automated ingestion — now viable (Tradera + TCGdex)

The ingestion problem that sat parked as a pre-launch blocker now has a
concrete, **sanctioned, free** path — enough to move it out of "parked" and
treat it as a real plan. The unlock was to stop forcing the two hard sources
(Cardmarket's ToS-blocked prices; a paid, US-skewed PriceCharting) and instead
pair two official free APIs: **Tradera for product prices** — the maintainer's
actual Swedish market — and **TCGdex for set values**. Both are schedulable and
stay inside their free limits, both feed the existing source-agnostic snapshot
rows via a GitHub Action or Supabase Edge Function (never coupled into the
static page), and everything is stored canonically in **EUR**. Neither half is a
blocker any more — each is buildable now. Sensible sequencing: the correctness
guards under "Now" (data-quality guards, error monitoring) still come first, so
automated numbers are trustworthy the day they land, and each half starts as a
**spike** to validate coverage before the loop depends on it. When it ships the
payoff compounds — fair prices recompute daily instead of monthly, alerts fire
the day a dip happens, and staleness stops being a failure mode.

- **Product prices — Tradera official API (SEK → EUR).** The most
  promising ingestion route found, and unlike the now-parked Cardmarket-direct
  routes below it is *sanctioned*. Tradera — Sweden's largest marketplace, and where the maintainer
  actually trades — runs an official free Developer Program: register, accept the
  ToS, create an app for an Application Key; the SOAP `SearchService` (six SOAP
  services; a REST v4 also exists) does category + keyword search, and sealed
  products sit under their own category IDs (Booster boxes `1001340`, Other
  boxes/ETBs `1001341`, Booster packs `1001339`) so results filter cleanly
  instead of drowning in singles. Default rate limit is **100 calls/method/24h**
  — trivially inside budget for ~36 products, daily or weekly, no Cloudflare, no
  ToS grey area. This *reframes* the whole blocker: instead of fighting
  Cardmarket's automated-access prohibition for *pan-EU* prices, pull an official
  feed for the *local* market the maintainer buys in. (Tradera also publicly
  launched an "AI-adapted API" for agents in 2026, and a community MCP bridge
  *Begagnad* exists — signals they welcome this use.) Caveats to settle in a
  spike: (1) `SearchService` returns **active** listings (asking / current bid),
  not confirmed sold — median of active "Köp nu" is a clean proxy but it is
  asking, not sold; (2) C2C free-text noise (cases of 6, 2-packs, sleeved boxes,
  Pokémon Center exclusives, empty display boxes) needs price-bound + keyword
  filtering and a median-of-cleanest; (3) thin liquidity on old grails (Roaring
  Skies, Team Up) and speculative future sets means some weeks have few or zero
  Swedish listings — carry-forward or manual fallback for those; (4) Tradera
  prices are in **SEK**, but the database's canonical price unit stays **EUR** —
  so a SEK listing must be **converted to EUR at ingestion**, never stored as SEK.
  That adds an **FX dependency**: a rate source, a refresh cadence, and storing
  the rate used **with each snapshot** so historical prices stay reproducible
  rather than silently re-based when SEK/EUR moves — the same discipline the
  "User-configured portfolio currency" item already calls for. Feeds the
  same source-agnostic snapshot rows via a GitHub Action or Supabase Edge
  Function — never coupled into the static page. A live liquidity spot-check
  (Jul 2026) confirmed healthy active listings for mainstream sets (Evolving
  Skies, Surging Sparks, Prismatic Evolutions); the coverage of the full 36 is
  the first thing a spike should measure.
- **Set values — TCGdex singles-sum (preferred), getmint as a quick alternative.**
  Tradera solves *product* prices but **not Set Value** (the summed singles value
  SV/Booster divides into), which stays hand-entered. Hard constraint the metric
  imposes: `SV/Booster = setVal ÷ (price ÷ boosters)` is only meaningful when
  **setVal and price share a currency**. Since all stored prices are canonically
  **EUR** (Tradera's SEK converted on ingestion, per the FX note above), Set Value
  must be **EUR** too — which lands conveniently: getmint's Cardmarket-derived
  values are already EUR (no conversion), and a TCGdex singles-sum reads Cardmarket
  EUR as well, so SV/Booster stays coherent with no SEK anywhere in the stored
  data. Candidate sources, in preference order: **(a) sum a free singles API
  per set — the preferred route.** TCGdex is free, needs **no API key**, carries
  **Cardmarket (EUR) single-card prices**, and is an **official API with no
  scraping and no ToS ambiguity** — so with prices already normalised to EUR, a
  per-card sum drops straight in. The one design question is staying a polite
  citizen of a free service, and it is very controllable: TCGdex publishes **no
  hard rate limit** but asks callers to be considerate and **cache rather than
  refetch**. Use the **GraphQL endpoint** (`api.tcgdex.net/v2/graphql`) to pull a
  whole set's cards and prices in **one query** — ~30 queries covers every tracked
  set, not thousands of per-card calls; **cache and recompute on a slow cadence**
  (set values drift slowly — weekly, or monthly for older sets, is plenty),
  refreshing only the newest/volatile sets often; **self-throttle and stagger**
  across the run. A scheduled GitHub Action / Edge Function with those controls
  sits comfortably inside fair-use, which is what makes this the best long-term
  option. A spike must settle two things: whether the GraphQL response returns a
  usable **Cardmarket EUR price per card today** (per-variant Cardmarket IDs are
  still "in development"), and the **definition of the sum** that reproduces the
  hand-curated Set Value (every card's market price, or chase/holo-rare only) —
  pin that definition down once and it becomes the canonical formula. **(b)
  getmint.app/sets — the one-request convenience alternative.** "Mint" aggregates
  CardMarket/TCGPlayer and publishes every set's total on one page, so a single
  fetch could cover all sets — but it is an app-style **SPA** (the real data is a
  backing **JSON endpoint** to find, not the rendered HTML), use its **EUR
  (Cardmarket)** figure directly (its USD/TCGPlayer one would need conversion),
  and because its numbers ultimately **derive from Cardmarket** the
  reuse/publishing question this section already raises may travel with them, on
  top of Mint's own ToS (it 403s automated fetches today). Good for a fast
  prototype; **TCGdex is the one to build on.**
- **Optional secondary source — eBay Browse API (EU cross-check, active
  listings).** A free, official *second* price signal for later — not part of the
  core loop. eBay's **Browse API** (free developer account) covers the EU
  marketplaces — eBay.de, .fr, .it, .es… selected via the
  `X-EBAY-C-MARKETPLACE-ID` header — and at ~36 items its default rate limits are
  ample. Two honest limits keep it *secondary*: it returns **active** listings
  (Buy-It-Now asking prices), **not sold** — the same asking-not-sold shape as
  Tradera's `SearchService`, just pan-EU rather than the maintainer's local
  Swedish market; and eBay's **only** sold-data API, Marketplace Insights, is a
  partner-gated Limited Release an individual can't realistically obtain (checked
  2026). So its role is a **cross-check**, not a price of record: sanity-check a
  thin Tradera week against German/EU asking prices, or flag when the two markets
  diverge. Prices normalise to **EUR** like everything else. Worth building only
  after the Tradera + TCGdex core proves out. (Third-party "eBay sold" APIs exist
  but are paid scrapers, not eBay's own surface — same ToS/reliability questions
  as any scrape, so they stay out of scope.)

## Parked — superseded Cardmarket routes

Kept for reference and as a fallback if the Tradera + TCGdex path above doesn't
pan out — the original **Cardmarket-direct** approaches, still blocked on the
same Terms-of-Service problem. No longer the plan of record, but the analysis is
worth keeping: it is *why* the pivot to Tradera/TCGdex was the right call.

- **Automated EU price ingestion — why the Cardmarket-direct route stays blocked.**
  Cardmarket has no open API, PriceCharting's numbers diverge too much to trust
  (and its API is paid), and scraping is fragile / a ToS question. A July 2026
  read of Cardmarket's General Terms and Conditions closed the door on the
  tempting "just fetch a small amount" workaround: the terms bar automated access
  *as a category, not by volume* — reportedly *"Spidering, crawling, or accessing
  the site through any automated means is not allowed"* — so a limited, polite
  footprint lowers **practical/detection** risk but is **not** a compliance basis;
  there is no small-amount carve-out to fit into. Separately, the GTC restricts
  reuse of listings/prices — the API *"may only be used for managing your own
  contents,"* and *"the presentation of the trading cards and their respective
  prices require prior written agreement"* — which bites on this app regardless of
  how the data was obtained, because it **publishes** prices. (Not legal advice;
  the primary text should be re-read at source before relying on it — Cardmarket
  even 403s automated fetches of the terms page itself.) The one genuinely
  ToS-clean route the terms point to is **seeking that prior written agreement** —
  asking Cardmarket for permission. The Tradera + TCGdex path above sidesteps this
  entirely by not depending on Cardmarket's own surface; the snapshot table stays
  source-agnostic, so nothing assumes a monthly cadence or a single source.
- **Candidate path — a Cardmarket scraper.** The most likely concrete route to
  solving the above: a scraper that fetches sealed-product prices from
  Cardmarket on a schedule and writes the same source-agnostic snapshot rows the
  app already consumes. Clear-eyed about the caveats already listed — markup
  changes make it fragile, and its Terms-of-Service and legal standing is a
  question to answer *before* it ships, not after. Approach it as a low-key
  spike first (do the scraped numbers match the maintainer's hand-entered ones?
  how often does it break? what's the polite crawl rate?) before betting the
  launch on it, and keep it a separate ingestion service feeding the existing
  snapshot table — never coupled into the static page. If it proves out, it's
  what turns monthly manual entry into daily automated snapshots and makes
  staleness stop being a failure mode.
- **Candidate path — agent-assisted ingestion (recurring Claude Code).** A
  variation on the scraper that reuses infra already in play: a scheduled Claude
  Code session (the same Routines/triggers this repo already runs on) that, each
  month, fetches the prices, updates `pokemon_data.xlsx` or the `snapshots`
  table, runs `npm run validate` as a gate, and opens a **PR for the maintainer
  to review and merge** — semi-automation with a human at the merge, which
  preserves the credibility the manual model earns. Its real edge over a bespoke
  scraper is resilience (it adapts to page changes instead of breaking on a
  selector) and judgment (sanity-check against last month, flag implausible
  jumps, write the PR rationale). Be honest that it is *LLM-as-scraper*: it does
  **not** dissolve the source problem — whatever it fetches from carries the same
  ToS/legal and accuracy questions as the scraper above — and it adds one the
  scraper doesn't: an LLM can misread or fabricate a number, which for a
  trust-first tool is the worst failure, so strict grounding, the delta/
  implausible-jump guards, and human review of every PR are non-negotiable.
- **Candidate path — browser-capture helper.** The least-automated option, and
  the one that keeps the maintainer as the source: a small helper (bookmarklet
  or browser extension) that, while you're *already* browsing a product's
  Cardmarket page, grabs the price and set value and stages them for the monthly
  update — turning manual entry from typing into one click per product. It
  sidesteps the *automated-access* prohibition (a human is doing normal
  browsing, not spidering) and keeps a person in the loop by construction, at
  the cost of not being hands-off — it speeds the manual loop rather than
  replacing it. Note it does **not** clear the separate reuse restriction: the
  GTC's bar on presenting Cardmarket's prices without prior written agreement
  applies however the number was captured, since this app publishes them. A
  pragmatic middle rung between today's typing and full automation, but the
  written-agreement question above still stands.

## Known bugs

Defects to fix, separate from the forward-looking themes above. Newest first.

_None open._ (Fixed: the Format Guide modal opening far down the page instead of
centred — `#guide-modal` was `position: fixed` inside the transformed
`#tab-analysis`, so it anchored to that ancestor rather than the viewport; moved
to be a direct child of `<body>` alongside `#auth-overlay` / `#account-overlay`.)
