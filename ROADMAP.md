# Roadmap

Where this goes from a personal tool toward a product other people can rely on.
Not a commitment or a schedule — a prioritised backlog. The ordering reflects
one deliberate decision: **the data stays manually entered by the maintainer
for now** (see "Parked", below), so everything else is sequenced to make that
hand-curated data as useful, trustworthy, and easy to act on as possible.

## North star

Answer one question faster than any other tool: **is this sealed product
fairly priced for the set value it contains — and is now a good time to buy?**

The dashboard already computes everything needed to answer that (SV/Booster,
the expected-for-age fit, drawdowns, trends), but today the answer is spread
across nine sections the user has to synthesise in their head. The next phase
turns that implicit answer into an explicit one: a **fair price in euros** per
product, a plain-language verdict on the board, and alerts that fire on it.
Every feature below is judged against that north star; anything that doesn't
help someone find a fairly-priced product earns its place some other way or
doesn't ship.

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

## Now — the fair-price verdict

The core product feature: make "is this a fair price?" a number and a sentence,
not a judgment call. All derived math lands in `metrics.js` as pure, unit-tested
functions first; UI follows the `design-review` skill — this phase adds *answers*,
not visual noise.

- **Fair Price (€) per product.** Invert the expected-for-age fit line that
  sections 04/05 already compute: the fit predicts an expected SV/Booster for a
  product's age, and since `svPerBooster = setVal × boosters ÷ price`, the
  expected value implies a concrete fair price —
  `fairPrice = setVal × boosters ÷ expectedSvPerBooster`. Show it next to the
  live price as a signed gap: *"€89 now vs €112 fair → 21% under"*. The
  existing R² badge is the honest confidence signal for how much to trust the
  fit; surface it wherever the fair price appears, and grey the number out when
  the fit is weak. This is the single highest-leverage feature in the backlog:
  it converts the dashboard's central insight into the unit users actually
  think in (euros), and everything below builds on it.
- **A verdict on the Board.** One plain-language state per product on the All
  Products table, synthesising the three signals a buyer cross-references by
  hand today: gap to fair price (new), drawdown vs peak (section 07), and set
  value trend (section 08). E.g. *"Under fair price · near tracked low"* /
  *"Overpriced for its age"* / *"Fair — no edge"*. Text-first (a non-colour
  cue by construction), built from existing pills/tokens, sortable — so
  "sort by best deal" becomes the board's default story.
- **Product drill-down.** Click any row to open a single-product view that
  assembles what's already computed but currently scattered: price history
  with a fair-price band overlaid, SV/Booster trend, momentum & drawdown KPIs,
  the verdict and its ingredients, plus your own holding and alert if signed
  in. One product, one screen, complete answer. This also becomes the natural
  home for future per-product depth without adding top-level sections.
- **Fair-price alerts.** Extend alerts beyond fixed € targets: *"alert me when
  X falls ≥10% below its fair price"*. Reuses the existing `alerts`
  infrastructure (RLS, auto-save, 🔔 board flag) with an alert-type column;
  fair-price alerts recompute automatically as the fit moves, which is exactly
  what a fixed target can't do.
- **Alert email delivery.** An in-app 🔔 only works if you have the page open.
  A Supabase `pg_cron` + Resend job (the pattern the staleness reminder already
  proved) checks triggered alerts after each data update and emails the owner —
  the feature that makes alerts, and therefore accounts, genuinely valuable.
- **Board search & filters.** Name/set search, filter by type and by verdict
  ("show me everything under fair price"). Cheap now, mandatory before the
  catalogue reaches hundreds of products; also the groundwork for the scale
  work in the next theme.
- **Expanded set/product comparison (beyond two).** The Trend Over Time view
  (section 08) and its ratio-compare dropdown currently pit one product against
  a single second — enough to check A vs B, not enough to weigh a whole shortlist
  at once. Let the comparison views hold several series: three-plus products, or
  rolled up to compare *sets* head to head (SV/Booster and its trend per set), so
  "which release is the best value right now?" is answerable on one chart instead
  of by flipping pairs. Keeping the chart legible as series grow — a capped
  palette, a legend that can toggle series — is the `design-review` constraint,
  not an afterthought.
- **Per-product-type filtering across the views.** Today the type control
  (`activeType`) scopes only the board table. Promote BOX / ETB / BUNDLE to a
  first-class filter that also applies to the charts and comparison views, so
  "show me only ETBs" holds everywhere, not just on one table. A natural
  companion to board search & filters above, and an increasing need as the
  catalogue and the product-type mix grow.
- **Portfolio balancer (concentration risk).** The signed-in Portfolio shows
  what you hold and its P&L, but not the risk hiding in it: concentration. Add a
  read on how the position is spread — share of portfolio value (and cost basis)
  per set, era, and product type — that flags "X% of your holdings ride on one
  set" so a single set's crash can't sink the whole position. Then make it
  actionable by pairing it with the fair-price gap above: when the balancer says
  you're over-exposed to one set, it points the next euro at *under-fair-price*
  products in the sets you underweight — turning "don't put all your eggs in one
  basket" from a proverb into a ranked, data-backed shortlist. Signed-in only,
  reads the existing `holdings` map; no new raw data, all derived client-side.
- **Portfolio value over time (change chart).** A chart of the signed-in user's
  total holdings value across snapshots — cost basis vs latest tracked value —
  so P&L reads as a trajectory, not just today's number. Reuses the pivoted
  snapshot history the portfolio already loads; pairs naturally with the
  balancer above (where the value sits) and the per-product P&L (how each
  holding moved). Signed-in only, derived client-side, one more Chart.js
  instance in the existing destroy-and-recreate pattern.
- **User-configured portfolio currency.** Let a signed-in user pick the currency
  their **portfolio** is shown in (€ stays the default and the canonical stored
  unit). Persist the choice as a per-user `user_settings` field (private, RLS-
  scoped, saved through the existing auto-save path) and convert the portfolio's
  displayed values — holdings value, cost basis, unrealised P&L, the value-over-
  time chart — at render time. Honest dependency: this needs an **FX rate**, the
  first bit of non-Cardmarket external data the app would carry, so it comes with
  its own questions — a rate source, a refresh cadence, and storing the rate used
  with each snapshot so historical P&L stays reproducible rather than silently
  re-based when rates move. Keep conversion **display-only** and confined to the
  portfolio: the shared catalogue, set values, and all the SV/Booster maths stay
  in € so the ranking metrics remain comparable across every user.

## Next — trustworthy numbers (stability & quality)

A tool that tells people what's fairly priced has to be *right*, visibly and
verifiably. This theme extends the correctness story CI started to every number
on the page and every failure mode around it.

- **Finish the metrics extraction.** The fit line, residuals (Δ vs peers),
  momentum, drawdown, and the new fair-price math still live partly inline in
  render functions. Move all of it into `metrics.js` as pure functions with
  unit tests — the same one-source-of-truth treatment `deriveProducts` got.
  Rule going forward: no derived number ships without a test.
- **Error monitoring.** Runtime errors are currently swallowed into a toast.
  Report them — Sentry, or a lightweight beacon into a Supabase `client_errors`
  table (no new vendor, RLS-scoped, queryable) if a full APM is overkill.
  A silent failure in a scoring path is a wrong buy signal.
- **E2E coverage for the signed-in surface.** The Playwright smoke test covers
  the static path; portfolio, alerts, and the Data Entry → cloud-save loop are
  untested. Cover them against a seeded test Supabase project (or stubbed
  client) so an RLS or pivot regression can't reach users.
- **Backup & restore.** Formalise beyond the manual xlsx export: scheduled
  Supabase backups plus a periodic automated xlsx snapshot, and — the part that
  actually matters — a documented, rehearsed restore path.
- **Data-quality guards, extended.** The delta warning catches price
  fat-fingers; add the equivalents experience says come next: set values that
  jump implausibly between snapshots, silently skipped months (snapshot gap
  detection), and a product whose type/booster count disagrees with its price
  pattern.
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
  reverse-engineering it from one ~2,900-line file. Kept in sync when the
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

## Parked — the pre-launch blocker

- **Automated EU price ingestion.** Cardmarket has no open API, PriceCharting's
  numbers diverge too much to trust, and scraping is fragile / a ToS question.
  A July 2026 read of Cardmarket's General Terms and Conditions closed the door
  on the tempting "just fetch a small amount" workaround: the terms bar
  automated access *as a category, not by volume* — reportedly *"Spidering,
  crawling, or accessing the site through any automated means is not allowed"* —
  so a limited, polite footprint lowers **practical/detection** risk but is
  **not** a compliance basis; there is no small-amount carve-out to fit into.
  Separately, the GTC restricts reuse of listings/prices — the API *"may only be
  used for managing your own contents,"* and *"the presentation of the trading
  cards and their respective prices require prior written agreement"* — which
  bites on this app regardless of how the data was obtained, because it
  **publishes** prices. (Not legal advice; the primary text should be re-read at
  source before relying on it — Cardmarket even 403s automated fetches of the
  terms page itself.) The one genuinely ToS-clean route the terms point to is
  therefore **seeking that prior written agreement** — asking Cardmarket for
  permission — not staying small. Absent that, data stays **manually entered by
  the maintainer**. This is explicitly the *last* thing to solve before a public
  launch — deliberately: everything above makes the product worth launching,
  and the manual-data work keeps it trustworthy in the meantime. When it is
  solved, the payoff compounds: fair prices recompute daily instead of monthly,
  alerts fire the day a dip happens, and staleness stops being a failure mode.
  Design decisions above should quietly keep that door open (snapshots are
  already source-agnostic rows; nothing should assume a monthly cadence).
- **Candidate path — Tradera official API (local Swedish prices).** The most
  promising ingestion route found, and unlike every option in this section it is
  *sanctioned*. Tradera — Sweden's largest marketplace, and where the maintainer
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
  Swedish listings — carry-forward or manual fallback for those; (4) it moves the
  price unit from **EUR to SEK**, with a knock-on for set value below. Feeds the
  same source-agnostic snapshot rows via a GitHub Action or Supabase Edge
  Function — never coupled into the static page. A live liquidity spot-check
  (Jul 2026) confirmed healthy active listings for mainstream sets (Evolving
  Skies, Surging Sparks, Prismatic Evolutions); the coverage of the full 36 is
  the first thing a spike should measure.
- **Open sub-question — where "Set Value" comes from once prices are automated.**
  Tradera solves *product* prices but **not Set Value** (the summed singles value
  SV/Booster divides into), which stays hand-entered. Hard constraint the metric
  imposes: `SV/Booster = setVal ÷ (price ÷ boosters)` is only meaningful when
  **setVal and price share a currency** — so a Tradera (SEK) price path forces
  Set Value into SEK too (or everything normalised to one currency), or the ratio
  silently breaks. Candidate sources: **(a) getmint.app/sets** — "Mint", a TCG
  tracker that aggregates CardMarket/TCGPlayer and publishes every set's total
  value on one page, so a single fetch could cover all tracked sets. Attractively
  small footprint, but: it is an app-style **SPA**, so "download one page" likely
  yields an empty shell — the real data is a backing **JSON endpoint** to find
  and use instead of scraping rendered HTML; its values are EUR/USD (need
  conversion to the price currency); and because its numbers ultimately **derive
  from Cardmarket**, the reuse/publishing question this section already raises may
  travel with them, on top of Mint's own ToS (it 403s automated fetches today).
  **(b) Sum a free singles API per set** — e.g. TCGdex (free, no key, carries
  Cardmarket single-card prices) totalled across a set's cards: more requests but
  an official API and no scraping. Prototype getmint's JSON endpoint first for the
  one-request win; keep the TCGdex-sum as the robust fallback if Mint locks down
  or its ToS doesn't clear.
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

- **Format Guide modal opens far down the page, not centred in view.** Opening
  the 📋 Format Guide (`#guide-btn`) shows the modal well below the current
  scroll position instead of centred in the viewport where the page is. Likely
  cause: `#guide-modal` is `position: fixed` but lives inside `#tab-analysis`,
  and the page applies CSS `transform`s for its fade/reveal-on-scroll animations
  — a transformed ancestor makes `position: fixed` anchor to that ancestor
  rather than the viewport, offsetting the overlay downward. Probable fix: move
  the modal overlay to be a direct child of `<body>` (as `#auth-overlay` /
  `#account-overlay` already are), or otherwise ensure no transformed ancestor
  contains it. Verify per the `design-review` and `verify-app` skills.
