# Roadmap

Where this goes from a personal tool toward a product other people can rely on.
Not a commitment or a schedule — a prioritised backlog. The ordering reflects
one deliberate decision: **the data stays manually entered by the maintainer
for now** — though a viable automated path has now been identified (see
"Automated ingestion", below) — so everything else is sequenced to make that
hand-curated data as useful, trustworthy, and easy to act on as possible.

This file says *what and why*; the per-item **implementation plans** (files,
steps, decisions, verification, definition of done) live in
[`IMPLEMENTATION.md`](IMPLEMENTATION.md).

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

- **Sell signals — the exit-side momentum flag.** `sellSignal(hist)` (pure,
  unit-tested in `metrics.js`) mirrors the buy signal: an **un-backed run-up**
  (price rose ≥5% while set value didn't follow). Red board flag + a `runUp`
  clause folded into the verdict + a drill-down "Momentum signal" line;
  momentum-only, so it never asserts a fair price on a weak fit. The first of the
  three **sell-side** items (sold-item realised P&L and a sell shortlist remain).
- **Continuous time-series charts.** The Price-History (§03), SV/Booster-Trend
  (§04), drill-down and Portfolio value charts dropped their default point
  markers (`pointRadius: 0` + `pointHoverRadius`) — a clean line, a point only
  where you hover a date (the Collectr pattern). The full-screen zoom clone now
  pins both axes to `min/max: 'original'`, so a pan/zoom can't expose a negative
  or empty axis (these charts hold no negative values). *Still open — flagged
  for when the history deepens:* a **time-scale selector** on these charts
  (1D / 7D / 1M / 3M / 6M / MAX), which needs more daily snapshots to be worth
  the chrome.
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
  the global **type filter** across all views; the signed-in portfolio's
  **concentration balancer** and **value-over-time chart**; and a **global
  display currency** — a header picker that shows every price on the page (board,
  charts, drill-down, portfolio) in the chosen unit (€ canonical, FX
  display-only; the ratio metrics stay put since a rate cancels out of them).
  **⟳ Reopened then resolved (Aug 2026):** the fair price's core assumption — a
  **linear** age fit — was put back under review, then **validated**: a
  cross-validated investigation found no non-linear model that beats linear
  out-of-sample on the current catalogue without overfitting or double-counting
  the age weight, so the linear fit stays. See **Non-linear fair-price curve**
  under **Now — trustworthy numbers** for the full result and the one optional
  follow-up (outlier robustness).
- **Loose pack price (reference)** — loose single boosters are tracked per set as
  `PACK` products (Cardmarket-ingested like the rest), but held *out* of every
  ranking, chart and KPI: with no sealed-box premium they beat every box on value
  density and would always be "the recommended buy". They surface only as **Loose
  pack price** in the drill-down of the sealed products of the same set (matched by
  set name), with the sealed-vs-loose premium per booster. Exclusion runs through
  one `analysisProducts()` helper; the pairing through `loosePackFor()`.
- **Data-maturity readout (young-product risk)** — the age weight penalises a new
  release's *score*, but nothing signalled that its *fair price* is unsettled: set
  value is typically elevated at launch and drifts down until the set leaves print,
  so the fair anchor is biased high and moves. The drill-down now carries a *"How
  settled is this data?"* section (`dataMaturity()` → `renderDrillMaturity()`):
  age, tracked history depth, and the peak-to-trough swing of price and set value.
  A deliberate choice — it **reports, it does not adjust**: the verdict and fair
  price are untouched, and the risk call is the buyer's. (A directional fair-price
  haircut for young products was considered and deferred.)
- **News feed (Pokémon TCG priority · investing · business).** An opt-in
  companion feed: a header **News** button + a TCG-first teaser on the
  landing/demo open a grouped overlay of headlines that link out to the source.
  Because browsers can't fetch third-party RSS (no CORS), ingestion mirrors the
  Cardmarket split — **`pg_cron` (hourly) → the `news-fetch` Edge Function** parses
  RSS/Atom, dedupes and upserts the public-read **`news`** table; the client only
  reads it (so logged-out demo visitors see it too). Three sources chosen
  (**PokéGuardian** + a Google News TCG safety-net, **r/PokeInvesting**, a Google
  News *Pokemon Company / Nintendo earnings* query). Parse/relevance/dedupe is the
  unit-tested `scripts/news-lib.mjs` (mirrored by the Edge Function); external
  text is escaped and links are http(s)-guarded. Client + tests shipped; the
  cloud deploy (run schema, deploy the function, schedule the cron) and a live
  feed-URL verification are the operator steps in `SUPABASE.md`.
- **Grouped board + analytical tables — Era → Set → Product.** The flat
  All-Products board became a collapsible tree: it opens as a **pure era overview**
  (~5 era headline rows) and you expand an era → its sets → the product rows, so a
  catalogue that now spans XY → Mega Evolution reads as an overview instead of a
  wall. Era is **derived from release date** (`eraForRelease` + the `ERAS` boundary
  table in `metrics.js` — no new column), settling the "how to define an era"
  question; era/set headline rows show `groupStats()` aggregates (count · mean
  SV/Booster · N under fair · price range), currency-correct; sets group by
  `setLogoKey()` so twin sets stay distinct. `getFiltered()` still drives
  filter/sort; a live search force-expands. The **§04 Relative Value and §06
  Momentum tables** now use the **same tree** — a shared `renderGroupTree(tbody,
  products, ctx)` helper, each table with its own independent expand state, each
  keeping its own ranking (residual desc / deepest-dip) *within* a set. Pure
  helpers unit-tested; the smoke/a11y/signed-in specs expand via `expandBoard`
  and the phone spec pins the era rows wrapping so the overview never side-scrolls.
  Follow-ons (era/set-level *chart series*, era/set as a scope filter) stay under
  **Then**.
- **XY + Sun & Moon backfill** — the catalogue now reaches back through the **XY
  era** (2014): every XY and Sun & Moon main-expansion product (**Booster Box /
  ETB / loose Pack** per set) plus the era's ETB-tracked special sets (Hidden
  Fates + Pack, Shining Legends, Dragon Majesty). Bulk-added via an idempotent
  SQL insert (`INSERT … SELECT … WHERE NOT EXISTS` on name), then the existing
  **Resolve ids → Sync catalog** pipeline filled the Cardmarket ids and the daily
  job prices them — no code change, the DB-driven tracked set doing its job.
  Follow-ons still open: **defining the era grouping** (XY/SM/SWSH/SV) for the
  hierarchical overview, and the **~200-product** performance/data-volume work —
  both under **Then**/**Later**.
- **Installable (PWA)** — the page is now installable to a home screen / desktop
  and works offline. Three static files, no build step: `manifest.webmanifest`
  (name, colours, icons), `icons/` (PNGs rasterised from the logo mark by
  `scripts/gen-pwa-icons.mjs`), and `sw.js` — a service worker that is
  **network-first for the same-origin app** (so an online visitor always gets
  fresh code — a single frequently-edited file must never be served stale),
  **cache-first for the immutable CDN libs/fonts** (what makes charts render
  offline), and **bypasses Supabase + the FX API** (dynamic, per-user, never
  cached). A header **Install app** button appears only when the browser offers
  an install. `serviceWorkers: 'block'` keeps the SW out of every spec but the
  new `tests/pwa.spec.mjs`, which pins the manifest, the lifecycle and the
  install flow. (Roadmap step 1 of the *Mobile app* bet, under **Later**.)
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
- **Performance measured at catalogue scale** — the answer is **numbers, not a
  fix**: two dev-only tools (`scripts/gen-scale-fixture.mjs`, a deterministic
  fixture generator; `scripts/measure-scale.mjs`, a Playwright timing harness —
  neither in `npm test`, since timings would flake as a gate) measured the real
  page across **two** axes, N products × M snapshots. Verdict: **comfortable to
  ~200 products, degraded by 400**, and the cost is almost entirely
  `updateTable()`, which is O(N) and re-runs on every board interaction. The
  headline numbers (median ms, Chromium, 7 repeats): board search **14.5 ms →
  50 ms → 92 ms** *per keystroke* at N = 36 → 200 → 400; type filter **47 →
  137 → 239 ms**; Data Entry grid **14 → 59 → 133 ms**. The M axis is benign on
  its own (36 × 365 daily snapshots barely moves anything except the drill-down
  chart, 9 → 45 ms) but compounds with N: at 400 × 365 the type filter reaches
  **329 ms** and the 28 MB fallback workbook takes **4.2 s** to load. Nothing
  was pre-fixed — the fixes are filed as their own items under **Later**, with
  ~200 products as the trigger.
- **E2E coverage for the signed-in surface** — a second Playwright spec
  (`tests/signed-in.spec.mjs`) drives the Supabase surface with a stubbed
  in-memory SDK (`tests/fake-supabase-sdk.js`; no cloud credentials, fully
  hermetic): the logged-out demo scope, auth-driven UI gating, the snapshot
  pivot, portfolio/alert auto-save payloads, the admin Data Entry → cloud-save
  loop, and the error beacon's cloud path. Proves the client's behaviour; the
  RLS policies themselves stay server-side and schema-reviewed.

- **Full code, comment & documentation audit** — the retroactive pass, done.
  Behaviour-preserving; `npm test` green before and after. What it removed:
  **14 dead things** that had accumulated invisibly — 7 unused CSS rules
  (`.nav-shell`, `.main-grid`, `.right-col`, `.bottom-row`, `.highlight-row`,
  `.tag-opt`, plus two empty rules and their media-query variants — mostly
  leftovers from the multi-column layout that became today's single stacked
  column), 7 element IDs referenced by nothing, two never-called validation
  helpers, and a filter still excluding `#xlsx-file-input`, an element deleted
  with the upload UI. What it corrected: comments describing a "file-upload
  bar" that no longer exists, and a schema comment naming the *wrong file*
  (`staleness-reminder.sql`) as the alert-email job. What it fixed in the docs:
  README still said "**the three tabs**" and omitted Portfolio entirely —
  the very drift this file elsewhere claims was already caught — plus a
  `CLAUDE.md` line calling this "an app with **no unit suite**" while the same
  file mandates that no derived number ships without one; `SUPABASE.md`'s data
  model was missing `user_settings.currency` and both of the `alerts` table's
  type columns. What it *didn't* find, which is the more useful half: **no
  functional bugs** — no duplicate element IDs, no `getElementById` pointing at
  markup that doesn't exist, no render function unreachable or wired
  asymmetrically between `INIT` and `applyNewData()` (the invariant that caused
  a real bug before). The pure math is all in `metrics.js` already; the inline
  arithmetic left in `index.html` is presentational. Two cleanups too
  churn-heavy to fold in are filed as **fixes** below.
- **Hermetic browser tests + a guard for cross-file facts** — `tests/smoke.spec.mjs`
  fetched Chart.js and SheetJS from cdnjs while its sibling served them locally,
  so it failed in any network-restricted environment — and failed *confusingly*,
  as a click timeout, because the page's missing-library guard is an overlay
  that eats pointer events. Both specs now share `tests/local-cdn.mjs`, which
  also asserts the `node_modules` versions match the CDN tags. Separately, the
  admin UUID lives in both `supabase/schema.sql` and `index.html` with nothing
  relating them; `tests/unit/repo-invariants.test.mjs` now fails loudly on
  drift, in either direction, instead of it surfacing as an admin who silently
  cannot save.
- **The audit's three follow-up fixes, plus the architecture diagram** — the
  last of the "Now" theme. **Dead code can no longer accumulate silently:**
  `scripts/check-dead-code.mjs` (`npm run check:dead-code`, in `npm test` and
  its own CI job) reports unused CSS classes, element IDs, functions and empty
  rules. Its blind spot is handled head-on rather than ignored — names built at
  runtime (`type-${p.type}`, `'tab-' + btn.dataset.tab`) are invisible to a
  textual scan and would be reported as dead, so they sit in an explicit
  `CONSTRUCTED` allowlist that records *where each is built*; the tool only
  reports, never edits. It was verified against planted dead code, not just
  observed to pass. **The legacy `.upload-status` name is gone** — the class is
  `.status-pill`, the Analysis element is `#analysis-status`, and the two
  near-identical helpers collapsed into one `setStatus(elId, msg, isError)`
  across 18 call sites. **And `docs/architecture.svg`** maps the whole system on
  one page — sources, load path, `metrics.js`, the four tabs, the side jobs —
  rendered from `docs/architecture.mmd`, which is now a row in the
  documentation table so it is kept in sync.

- **UX assessment** — the structured end-to-end pass, done and committed as
  [`docs/ux-assessment.md`](docs/ux-assessment.md): five journeys (logged-out
  demo, first sign-in, the monthly Data Entry loop, a phone price check, a
  first-time visitor answering the north-star question) at desktop and phone
  widths, with the friction *measured* rather than eyeballed. Headline numbers:
  the Analysis tab is **9.9 screenfuls on a phone** and the first product row sits
  **2,376 px down** (1,697 px on desktop); the nine `.section-desc` explainers
  occupy **16.4 % of the phone page**; **21–25 interactive elements per view** are
  under the 44 px tap floor; everyone — including a user who has just signed in —
  lands on Welcome rather than on an answer. It also found two outright **defects**
  (now under *Known bugs*) and one missing feature (**password reset**), and it
  recorded what already works: the drill-down fits the viewport exactly at both
  sizes with no inner scroll, so several findings reduce to "get people there
  sooner". The design items under **Then** are now in the order it recommended,
  which is not the order they were written in — mobile first (it stopped being
  polish), set logos last (no finding touched it).
- **Expert UX & accessibility review** — a second, deeper pass
  ([`docs/ux-expert-review.md`](docs/ux-expert-review.md)) applying the standard
  instruments: **WCAG 2.2 A/AA** conformance (axe-core plus manual probes for
  keyboard traversal, focus trap, reflow at 320 px, 200 % text resize and
  reduced motion), **Nielsen's ten heuristics**, and a **cognitive walkthrough**
  of the primary task. The finding that reorders the plan: **the app is not
  operable without a mouse** — board rows carry a click handler but no
  `tabindex`, so the drill-down, the best answer surface in the product, cannot be
  opened from the keyboard; the modal is not a dialog and never receives focus;
  72/72 Data Entry inputs are named by `placeholder` alone. Four Level-A
  failures, so **accessibility moved to the front** of the design theme, ahead of
  the mobile work the first pass had promoted. It also **corrected two of that
  pass's claims** — the phone sideways-scroll is `.tab-bar` (437 px at a 390 px
  viewport), not `.entry-table` (which has a working `overflow-x` wrapper); and
  the 44 px tap-target figure was AAA (2.5.5), where AA (2.5.8) is 24 px and only
  5 controls fail it. Verified *good*, from arithmetic rather than sampling: every
  colour token passes AA at every background, `prefers-reduced-motion` is
  honoured, and text resizes to 200 % without breaking. One trap recorded for
  whoever wires up an a11y gate: axe run before the reveal animations settle
  reports **27 contrast failures that do not exist**.
- **Visual design & consistency review** — the third July pass
  ([`docs/visual-design-review.md`](docs/visual-design-review.md)), covering what
  the other two excluded by name. Because the repo *documents* its own design
  system, this audits compliance rather than taste: the built product against
  `design-review`'s declared tokens, three fonts, components and colour meanings.
  The designed system holds up well — restrained palette, semantics that are
  rigorous in every data view, a genuinely good display/mono pairing. The build
  has drifted from it in one traceable way: **240 inline `style` attributes**
  (setting `color` 96×, `font-size` 75×, `font-family` 52×) and **a second,
  near-duplicate colour palette hard-coded in the chart JavaScript**, so a BOX
  badge and its own chart series are two different blues on the same screen.
  Also measured: **29 distinct font sizes** with no scale, **55 of 68** stylesheet
  colour literals off-token, a `--radius` token that is only the third most-used
  radius, and a fourth font family (Arial) on native form controls. Seven Fix
  items and one Feature decision filed; none is a redesign.
- **Accessibility conformance — the app is operable without a mouse.** The
  Level-A blockers the expert review found are closed, and the three defects that
  came before them in the plan went with the same pass. **F1:** every board row
  opens its drill-down from a real `<button>` around the product name — not a
  `tabindex` on the `<tr>`, which would have stripped the table's row semantics —
  so the product's best answer surface is now reachable by keyboard; the two
  read-only capped-height scroll regions took `tabindex="0"`. **F2:** every
  overlay is a genuine dialog — `role`/`aria-modal`/`aria-labelledby` in markup,
  and behaviour from one shared `openOverlay`/`closeOverlay` pair plus a single
  global handler that traps Tab in the topmost overlay, closes on Escape, and
  returns focus to whatever opened it (verified: 8 consecutive Tab presses stay
  inside, where 6/6 used to land on background controls). **F3/F4:** all 72
  Data Entry inputs are named from their own row data (`"Team Up Booster Box —
  new price"`), and every previously anonymous select, slider and icon-only
  button got a name. **F5:** one focus rule now covers everything focusable,
  written to beat the `outline: none` class rules — and the four `transition: all`
  declarations that were fading the ring in over 250 ms were narrowed to the
  properties they actually animate. **F9/F17:** the 14 section eyebrows are
  `<h2>`, the 16 panel titles `<h3>`, and the panes sit in a `<main>`, so the
  page finally has an outline to navigate. **F12:** the tab bar is an ARIA
  tablist with a roving tabindex and ←/→/Home/End navigation that skips hidden
  tabs. **F14:** 💰/🔔 carry text alternatives, as does the board's trend arrow.
  The type-filter pills became real buttons (as `<div>`s with click handlers they
  were the same 2.1.1 failure as the rows). Two things fixed on the way that
  nobody had filed: a latent crash — the Welcome tab's two CTA buttons reuse
  `.tab-btn`, so the old unscoped tab listener ran on them, threw on a missing
  `data-tab`, and left *no* tab active — and a genuine AA contrast failure from
  an inline `opacity: 0.6` on the board's "💰 = buy signal" hint.
  Also shipped, from *Known bugs*: the **phone tab bar** now wraps instead of
  scrolling the body sideways (four tabs at 390 px), the **status line** wraps
  and stays on screen instead of overflowing off the left edge — the bug that
  hid "✕ Cloud save failed" from the admin on a phone — and **320 px reflow**
  passes on every tab (the culprit was 8 px of margin/padding on the
  age-threshold group). And the gate that keeps all of it: **`tests/a11y.spec.mjs`**
  (`@axe-core/playwright`) — zero serious/critical violations per tab plus the
  journeys axe can't see. Its one hard-won lesson is recorded in the file:
  `reducedMotion: 'reduce'` is **not** enough to avoid the phantom-contrast trap
  the review warned about, because the durations collapse to 0.001ms rather than
  zero and a tab switch restarts the pane fade — every sweep must first await
  `document.getAnimations()`, or it measures `var(--muted)` at 1.83:1 instead of
  its resting 5.9:1.
- **Mobile optimisation — the phone can answer the question now.** Measured
  first, at 390×780: the board's 9 columns were **1,098 px wide in a 356 px
  window**, so the only things visible without a sideways swipe were the product
  name and its type — the price a shopper already knows and none of the
  judgement — with **Fair Price starting at x = 392** and nothing hinting it
  existed. Fixed with **column priority**, which is what the finding asked for
  rather than more scrolling: the six detail columns (all of them present in the
  drill-down) drop away below 680 px, the product name is **frozen** so a swipe
  can't lose the row you are reading, and a one-line hint says the table
  scrolls. The swipe is now **448 px of columns**, and Fair Price plus its gap
  ("€130 ▼ 38% under") sits beside the frozen name. The verdict line also wraps
  instead of clipping mid-word ("· near tracke…"). **F8, the last open
  accessibility finding, is closed**: every control now measures ≥ 24×24 (WCAG
  2.5.8) — the modal-close ✕ went from 11×15 to a 28 px hit area, the three
  range sliders from 16 px to 24, the comparison chips' × to 24, and the board's
  row button gained a 28 px hit area via padding cancelled by an equal negative
  margin, so the board didn't gain ~300 px of height. **Chart legibility** was
  measured rather than assumed: the line and scatter charts read fine at 390 px,
  but the Top-10 bar chart was silently dropping **every other product label** —
  a fixed list of ten rows given a 2:1 aspect ratio is 166 px tall on a phone, so
  Chart.js skipped labels; its height now comes from a wrapper (the
  `.drill-chart` pattern), 220 px on desktop and 265 px on a phone, and all ten
  bars are labelled again. Two false affordances went with it: `thead th` had
  `cursor: pointer` and a hover highlight, and the board's explainer promised
  *"or click any column header to sort"* — **there has never been a click-to-sort
  handler**. The copy and the hover now match the code; sorting is the Sort menu.
  Guarded by five new cases in `tests/a11y.spec.mjs` (the plan's instruction to
  extend that spec rather than add a second viewport test), including a 2.5.8
  sweep with a dialog open and a check that the desktop board keeps every column.
  **Deliberately not changed:** the board's 70 vh capped scroll area. It does trap
  a phone scroll for 37 rows, but the cap is what keeps the sticky header useful;
  removing it adds ~2,300 px to the page. Revisit with the overview-first
  restructure, which changes what the board is for.
- **Collapsible section explainers — the density lever, pulled.** The 14
  `.section-desc`/`.kpi-intro` blocks measured **1,478 px, 17.7 % of the phone
  page** — roughly 1.9 screenfuls of prose to scroll past on every visit after
  the first. Each now carries a toggle, with one control in the Analysis header
  that does all of them, and the choice persists in `localStorage`. The text is
  **hidden, never removed**, so a first-time visitor and a screen reader still
  reach it. They **start collapsed at every width** — the explainers are
  reference material, read once, and the page is what someone came for. Result:
  on a phone **10.7 → 9.4 screenfuls** with the first product row **473 px
  closer** (y = 2,436 → 1,963); on desktop **−586 px** with the first row **341
  px closer** (y = 1,695 → 1,354), so the KPIs and the first picks are the
  opening screen. The design detail that made it worth doing: the toggle
  **rides at the end of the explainer's last line** when expanded rather than
  taking a row of its own — 14 buttons on their own rows added ~550 px to the
  page, which is the very thing the item exists to remove — and on desktop it is
  invisible until you hover the explainer or Tab to it, since "Hide explanation"
  is not something to keep in view. Guarded by a case in
  `tests/a11y.spec.mjs` (collapsed-by-default on a phone, open on desktop, per-
  section and global toggles, persistence across a reload). Also caught here, by
  the smoke test rather than by inspection: module-level `const`s declared
  *after* the inline `INIT` block are in the temporal dead zone when INIT calls
  into them, which silently took out the rest of INIT's wiring — the block now
  sits above INIT with a comment saying why.
- **The visual system reconciled with itself.** Four fixes from
  [`docs/visual-design-review.md`](docs/visual-design-review.md), bundled because
  they touch the same surface. **V1, the palette:** the charts carried a *second*
  set of colours hard-coded in JS — `#4fc3f7`/`#81c784`/`#f5c842`/`#e8473f`,
  near-duplicates of `--accent3`/`--accent4`/`--accent`/`--accent2` — so a BOX
  badge and its own chart series were two different blues on one screen. The JS
  now resolves the tokens at runtime (`COLOR`, read once from `:root`), and an
  `alpha()` helper derives every chart fill from the same hue, so a fill can't
  drift from the line it belongs to. **30 further re-typed literals went with
  it** (`#8b8fa3` was `--muted`, `#f4c651` was `--accent`, and so on), and the
  values that genuinely had no token got one: `--chart-axis`, `--accent-hi`,
  `--accent-lo`, `--on-accent`, `--on-accent4`, `--medal-silver`,
  `--medal-bronze`. **V2, the type scale:** **171 declarations across 36 sizes**,
  mostly fractional (12.16, 13.12, 11.84 px …), because `rem` values were chosen
  one at a time. Eleven named steps now (`--text-2xs` … `--display-xl`), picked
  from the sizes actually doing work, with everything mapped to its nearest —
  **32 rendered sizes → 11**, and no shift larger than 0.48 px anywhere in the
  body range. **V5:** one `input, select, textarea, button { font: inherit }`
  rule removed **Arial**, the fourth family in a three-font system. **V4:** the
  radius tokens now describe the build — `--radius-pill` (233 uses) and
  `--radius-sm` alongside the `--radius` panel corner, which was documenting the
  *third* most-used value. And the thing that makes it stick: **`npm run
  check:design-tokens`** (`scripts/check-design-tokens.mjs`, in `npm test` and
  its own CI job), the guard the review itself recommended — it fails on any hex
  literal outside `:root` and any `font-size` that isn't a scale step, with an
  allowlist where every exception carries a written reason. Verified against
  planted violations, not just observed to pass; it only ever reports, like the
  dead-code checker. Also fixed on the way: a race in the smoke test, which
  measured the drill-down's canvas before Chart.js had sized it.
- **One icon language: an SVG set replaces the emoji.** The decision the visual
  review left open (V8) went to **SVG, for platform consistency** — maintainer's
  call. 👋📊✏️💼💰🔔🏆📋🔗✎☁⬇🎴📅 and the coloured signal dots are now **15
  symbols in one inline sprite**, referenced with `<use href="#i-name">`, drawn
  in-repo so there is no build step and no licence question. Every path is
  stroke-only on `currentColor`, which buys the thing emoji could never do:
  **an icon takes the colour of its label**, so the active tab's icon goes dark
  on the gold pill while the inactive ones stay `--muted`, and the buy-signal
  tag is `--accent` because it marks a signal. Meaning-carrying icons keep the
  accessible name on their wrapper (`role="img"` + `aria-label`); decorative
  ones beside a text label are `aria-hidden`. **Three places deliberately keep
  text:** Chart.js tooltips (canvas-drawn, so no markup can go there — the words
  carry it), status messages written with `textContent`, and the typographic
  ✓ / ✕ / ⚠ / ⤵ glyphs, which render in the page font rather than an emoji font.
  Guarded by a case in `tests/a11y.spec.mjs` — every `<use>` resolves to a real
  symbol, the sprite contains no baked colour, and the active tab's icon differs
  from the inactive ones. A test that asserted the literal `🔔` now asserts the
  alert's *accessible name* instead, which is both more robust and closer to
  what a screen reader gets.
- **Fair price says how much to trust it, in words.** The board header rendered a
  bare **"R² 0.39"** — a statistical term most buyers don't know, qualifying a
  *weak* fit, on the number the whole product rests on. Worse, both explanations
  sat where a phone can't reach them: a `title` tooltip (no hover on touch) and a
  ~200-word paragraph. Now the header carries the band in plain language —
  **strong fit / moderate fit / rough estimate** — derived by `fitConfidence()`
  in `metrics.js`, whose `trusted` boundary is unit-tested to agree exactly with
  the gate the verdict uses, so the board can never call a price "moderate" that
  the verdict is ignoring. The statistic itself stays in the drill-down. The word
  is a **button** opening *How the fair price works*, a short method dialog —
  reachable by touch and keyboard, and the seed of the launch checklist's
  "how the numbers work" page.
- **Welcome joins the rest of the app.** V6/V7 from the visual review: the tab
  now introduces its sections with `.section-eyebrow` like Analysis and
  Portfolio, and the hero uses the *same* display treatment as the page `h1`
  (they were two treatments for "the most important text on screen", 300px
  apart) — which also retired `#f5a623`, the last allowlisted colour literal in
  the guard. The card titles are `--text` instead of blue and green: those mean
  *neutral* and *positive* everywhere else, and using them as category tints on
  the first screen taught a first-time visitor that colour is decorative. The
  titles also became real buttons — the cards navigate, and a `<div>` with a
  click handler was the same Level-A gap the board rows had.
- **Password reset — a locked-out user has a way back.** The sign-in overlay
  offered only *Sign in* and *Create an account*; `resetPasswordForEmail`
  appeared nowhere. Since holdings and alerts are RLS-scoped to the account, a
  forgotten password meant losing the portfolio with it. Now: a *Forgot your
  password?* action that mails a recovery link (replying without revealing
  whether the address exists), and a `PASSWORD_RECOVERY` branch that opens the
  password form retitled *Set a new password* when the user returns through it.
  `SUPABASE.md` gained the step this needs — the app's URL must be listed under
  *Authentication → URL Configuration*, or Supabase refuses to mail the link and
  the button is silently useless. Covered end-to-end in `tests/signed-in.spec.mjs`
  against the fake SDK, including the no-address case and the redirect target.
- **Sample data can no longer pass itself off as real.** The page boots with a
  small hardcoded dataset so nothing is ever blank — convenient, and until now
  dangerous: a missing or unparseable workbook `return`ed silently, leaving
  those numbers on screen looking exactly like tracked prices. The board, the
  portfolio's P&L and every chart would have been fiction, with nothing saying
  so. Now the data source is **state** (`sample` / `workbook` / `cloud`), and
  while it is `sample` a persistent banner sits under the header on **every**
  tab, saying what the numbers are *and why* ("the tracked workbook didn't load:
  pokemon_data.xlsx returned HTTP 404"). It covers the other paths that leave
  sample data up too: a cloud load that fails, and a brand-new account with
  nothing saved yet. A `.status-pill` would not do — it scrolls away, and a
  warning you can lose is no warning. Guarded by a smoke case that 404s the
  workbook and asserts the banner appears, names the reason, and survives a tab
  change and a scroll. **Found while building it:** `[hidden]` was losing to any
  class that sets `display` — the banner stayed up after the workbook loaded —
  so `[hidden] { display: none !important }` is now a base rule.
- **The board's explainer, cut from 190 words to ~100.** It sat directly above
  the most important table and was the single largest contributor to the
  measured prose share. Most of it had also been overtaken: the fair-price
  method now has its own dialog, and the verdict says in words what three
  sentences used to explain. What remains leads with the verdict, points at the
  confidence word, and defers the column definitions to section 03 and the
  Welcome tab rather than restating them.
- **Section numbers mean one thing now.** Analysis numbered 01–09 and Portfolio
  independently numbered 01–04, so "section 05" was ambiguous app-wide — and the
  board's own copy cited sections by number. Rather than prefixing every eyebrow,
  the numbers were removed everywhere they were *not* cited: Portfolio, Welcome
  and the demo's set headings now use plain eyebrow labels, leaving Analysis as
  the only numbered surface. (The demo's numbers had a second problem — they
  enumerated sets in recency order, which reads as a ranking they are not in.)
- **Overview-first: the Analysis tab opens on the answer.** Measured before this,
  the first thing a buyer needed sat **1,354 px down on desktop and 1,963 px on a
  phone** — nothing that helps you decide was visible without scrolling. The tab
  now leads with **Best deals right now**: a line saying how many of the tracked
  products are currently under their fair price, then the three biggest gaps,
  each with its verdict and a name that opens the drill-down. It sits **418 px
  from the top**, above the fold, and the nine numbered sections below became
  what they should be — the evidence for the claim, not a wall to scroll before
  reaching one. It follows the global type filter like every other analytical
  view, and adds no new maths: `fairGap` and `verdict` were already derived.
  **The honesty rule it enforces:** when the age fit is too weak to trust, the
  verdict already ignores the fair price — so the overview refuses to rank by it
  either, falls back to the weighted score, and says which it used in the badge
  and the lead. Guarded by a case in `tests/a11y.spec.mjs` that checks whichever
  branch is live: ranked-by-gap must be ordered best-first with every row
  genuinely under fair, ranked-by-score must say so.

- **The logged-out page is the pitch, and the Welcome tab stopped being a second
  one.** A first-time visitor's opening screen was a table of Price / Set Value /
  €/Booster / SV/Booster with **no statement of what the tool is, what question
  it answers, or what a single column means** — six numbers and no argument. The
  explanations existed, but only on the Welcome tab, behind the login, where the
  person most likely to need them could never reach them. The demo now leads with
  the question — *Is this sealed box fairly priced?* — then the three ideas needed
  to read an answer (value not price, age moves the bar, what the verdict means),
  then the sample rows. **What it refuses to do is the point:** it does not show a
  fair price or a verdict, because both are read off a fit across the *whole*
  catalogue's ages and a three-set slice would produce a number the signed-in
  board disagrees with. It says so, and names that as the thing sign-in buys —
  a better pitch than a figure that would have to be walked back. The two
  explanations (*How the fair price works*, *What the numbers mean*) are **shared
  dialogs**, opened from the demo page and the Welcome tab alike, so there is one
  definition of SV/Booster in the build rather than one per surface — the glossary
  gained the fair price, fit confidence and the verdict, which it had never
  covered. **Welcome became a signed-in landing** (1,107 → 448 px): where to go,
  the two shared explanations, and — for the admin — the monthly loop. Signing in
  now lands on **Analysis**, which itself opens on the answer; the pitch is read
  once, logged out. Three defects fixed on the way, none of them filed: a
  non-admin got a *"How it works"* heading with nothing under it (the panel was
  `.admin-only`, the `<h2>` introducing it was not); **Portfolio was never
  advertised** on Welcome although every signed-in user has the tab; and the demo's
  set tables scroll sideways on a phone with nothing focusable inside, so a
  keyboard user could not scroll them at all — caught by a new 320 px case rather
  than by inspection.
- **Set logos (drill-down).** Each set now shows its expansion logo in the
  product drill-down header — an identity aid, subordinate to the numbers, hidden
  until the image loads (never a broken image; the text title is the fallback).
  Sourced from the free **TCGdex** API (`ensureSetLogos()` fetches the set list
  once, lazily, on the first drill-down and name-matches tracked sets;
  `renderDrillLogo()` renders with a guard so a slow fetch can't paint onto the
  wrong product). **Licensing stance:** the product sold is the *analysis tool*,
  not the trading-card products it tracks; logos are shown for identification /
  informational purposes only, hotlinked (not re-hosted), with a strengthened
  non-affiliation + attribution notice in the page footer. **Residual, still
  parked:** *sealed-product photos* (booster-box / ETB / bundle box art) have no
  clean automated source — the card APIs don't carry them and marketplaces
  restrict their images — so that half stays manual or unbuilt.

## Now — trustworthy numbers (stability & quality)

A tool that tells people what's fairly priced has to be *right*, visibly and
verifiably. This theme extends the correctness story CI started to every number
on the page and every failure mode around it.

Items are tagged **Bug** (something is wrong today), **Fix** (something is
right but poorly built) or **Feature** (something new).

- **Non-linear fair-price curve — investigated; keep linear.** *(Investigate →
  decided.)* The fair price inverts a **linear** OLS fit of SV/Booster vs age
  (`linearFit` → `expectedSvPerBooster` → `fairPrice` in `metrics.js`); the
  hypothesis was that an **initial-hype premium** (set value elevated at launch,
  decaying until the set leaves print) makes the true curve **steeper early,
  flatter later**, so a bend would fit better. Investigated on the 37-product
  analysis pool with **leave-one-out cross-validation** (not in-sample R²),
  comparing linear against log, √, quadratic and piecewise (knot at ≈ the
  age-weight threshold). Findings:
  - **The concavity is real but modest.** The linear residuals go
    **+46× → +13× → −25× → −10×** young→mid (young sets sit *above* the line —
    the hype signature), and the two simplest concave forms beat linear
    out-of-sample: **log** LOO-RMSE **59.3 vs 65.5** (MAE 42.4 vs 46.4). But the
    edge is **~9% RMSE on the full pool and only ~2% MAE once the two launch
    outliers are removed** (both *Ascended Heroes*, ~0.5 yr, 316×/395×) — i.e.
    most of the "win" is those two young points, not a broad curvature.
  - **The leading hypothesis (piecewise at the knot) failed.** It never beat
    linear out-of-sample (LOO-RMSE 69.8 full / 46.0 trimmed vs 45.2) — with only
    ~5–7 sub-1-yr points the early segment overfits, exactly the small-N trap.
    Quadratic overfits too (higher R², worse LOO).
  - **Decision: keep the linear fit.** The only forms that beat it (log/√) do so
    marginally and largely on two outliers, and a concave fair-price curve would
    **double-count** the youth adjustment the age weight already applies (and the
    data-maturity readout already flags). Not worth the added model risk on a
    thin, growing dataset. Re-open only if a much larger catalogue shows a
    broad-based (not outlier-driven) bend.
  - **The real lever the data points to is outlier/leverage robustness, not
    curvature** (matches the observation that the line is "fine if you disregard
    the extremes"). *Optional, low-risk follow-up:* a robust or launch-trimmed
    linear fit — e.g. down-weight/exclude very-young (< ~0.5 yr, still price-
    finding) products from the **fit** while still stamping them a fair price.
    On the trimmed set the linear fit already tightens (R² 0.39 → 0.44). Would
    stay pure + unit-tested in `metrics.js`, invertible and floored, with
    `fitConfidence()`/`fairPriceTrusted()` unchanged. Not yet scheduled.
  - **⟳ Old-set fair-price suppression — SHIPPED.** The related failure at the
    *old* extreme is fixed: inverting the decayed fit for vintage sets (age past
    the point where expected SV/Booster nears zero) produced absurd fair prices
    (on the live 185-product catalogue, Ancient Origins Booster Box read a €50,743
    fair price vs €4,910 live). `fairPrice()` now **suppresses** the number once
    the fit's expected SV/Booster falls below `FAIR_PRICE_MIN_EXPECTED_FRAC` (0.25)
    of its intercept — a fit-relative floor, **not a hardcoded age**, so the limit
    (`fairPriceMaxAge()`, ~8.5 yr / ~28% of the catalogue today) **moves on its own
    as the model refits** each load. Suppression, not a clamp: vintage sealed is
    collector-priced and off the value-density line, so a guessed number is worse
    than none. Pure + unit-tested; the drill-down shows `beyond age model (~N yr)`.
    (This also confirmed the catalogue already reaches back to 2014, which lifted
    the live fit to R² 0.51 — more old data helped the fit but can't fix the
    inversion, which is why the suppression is the right tool.)

- **Parallel-line price prognosis — a per-product forecast off the fit's slope.**
  *(Investigate — a research idea, not yet a feature.)* The fair price assumes
  **mean-reversion**: a product off the age-fit line is expected to move *toward*
  it. This item probes the **opposite** hypothesis — **persistence**: that an
  outlier tends to keep its **own level curve**, a line **parallel to the fair-fit
  slope but anchored at the product's *current* price point**, over its lifetime.
  Concretely: the age fit gives expected SV/Booster declining with age at slope
  `b` (`linearFit`); instead of reverting a product to the fit line, project it
  forward along `s(age) = s_now + b·(age − age_now)` — a parallel offset by the
  product's current residual to the fit — then invert (as `fairPrice()` does) to a
  **price-vs-age forecast** through today's price. It deliberately **may disagree
  with the fair price** (that's the point: fair price says "worth X"; this says
  "if it holds its level, it'll be near Y as it ages"). **The investigation, not
  the build, comes first:** backtest on the tracked history — for products with
  enough span, does the residual-to-fit stay roughly *constant* over life
  (supports the parallel-line/persistence model) or *shrink toward zero* (supports
  mean-reversion, i.e. the fair price already captures it)? Measure out-of-sample
  which forecast is closer to realised later prices, split young vs settled. Only
  if persistence holds does a forecast line (a dashed overlay on the drill-down
  price chart + a "projected at N yr" stat) earn its place — clearly labelled as a
  *trend projection, not the fair-price verdict*, gated on `fairPriceTrusted()`
  like everything fit-derived, and pure + unit-tested in `metrics.js`. Related to
  the robust-fit follow-up above (both hinge on how outliers behave over time).

_The only open threads in this theme are the two **investigations** above (the
robust/launch-trimmed fit and the parallel-line prognosis) — research first,
build only if the data supports it; the rest is under **Then** and **Later**.
The **Backup & restore** item that used to live here is deferred by maintainer
decision; see **Later**._

## Then — design & usability at product level

The aesthetic is deliberate and stays (dark, minimalist, `design-review`-
enforced). This theme is about the page working as hard for a first-time
visitor on a phone as it does for the maintainer on a desktop.

The order below is the one the **expert UX & accessibility review** recommended
([`docs/ux-expert-review.md`](docs/ux-expert-review.md), which supersedes the
earlier journey pass in [`docs/ux-assessment.md`](docs/ux-assessment.md) and
corrects two of its findings). **Everything the review raised has now shipped** —
accessibility, the three phone/reflow defects, mobile column priority, the
density work, the visual-system reconciliation (guarded by
`npm run check:design-tokens`), the two trust gaps (an unexplained R² and a
locked-out user with no way back), the overview-first restructure, and the
demo-as-pitch rework with the Welcome tab reconciled against it.

The **set-logo** half of the one remaining design item has now shipped (TCGdex,
drill-down — see **Done** and `IMPLEMENTATION.md` item 9 for the licensing
stance). What still stands unbuilt:

- **Sealed-product photos (booster-box / ETB / bundle box art).** *(Researched
  2026-08 — [`docs/sealed-product-photos-research.md`](docs/sealed-product-photos-research.md);
  a buildable path now exists.)* The card-image APIs (TCGdex, pokemontcg.io)
  carry *set logos* and *card* images, not sealed-product photos — confirmed, and
  TCGdex has **no product interface at all**. Sealed photos *do* exist
  automatically via **TCGplayer's catalogue (free TCGCSV mirror)**, but no
  reachable feed conveys redistributable **image** rights: data is licensable,
  the pictures are TPCi's (non-commercial only) or a marketplace's (not theirs to
  sublicense), so **there is no automated source that is clean for a commercial
  build.** The lever is that the catalogue is **small (~40–80 products)**, so
  automation isn't needed. Recommended phasing: **Phase 0 — ✅ SHIPPED:** the
  drill-down header is now an always-on **set-identity block** (`#drill-identity`,
  `renderDrillIdentity()`) — a category-tinted accent + set name + type badge, with
  the TCGdex set logo swapping in as a best-effort upgrade; a product is never a
  blank title and it carries **zero** third-party-image rights. **Phase 1 (open)** —
  a **self-hosted, admin-uploaded photo per product** (Supabase Storage,
  first-party/licensed imagery), never re-hosted publisher/marketplace art; a TPCi
  licensing enquiry stays the only clean route to *official* art in a paid tier.
  Full copyright/trademark + enforcement analysis in the research doc and
  `IMPLEMENTATION.md` item 9.

- **Navigation & overview at catalogue scale (breadth — the UX side).**
  *(Feature; approach decided later.)* The board is a flat list, so as coverage
  grows (see **Coverage growth** and the ingestion work under **Later**) scanning
  it means reading every row. "A lot of data" is really **two axes**, and they
  want different fixes — this item is the *usability* half of **breadth** (row
  count). Its *performance* half is **Board performance fixes** and its *payload*
  half is **Data volume at scale**, both under **Later**. Several ways to make many
  products navigable were investigated; **we'll pick a mix later**:
  - **Hierarchical roll-up (Era → Set → Product) — ✅ SHIPPED for the board
    and the analytical tables** (see **Done**). The board and the §04 Relative
    Value / §06 Momentum tables are now the collapsible tree with era/set headline
    aggregates (`eraForRelease` / `groupStats` in `metrics.js`, via the shared
    `renderGroupTree()`), opening as a pure era overview. Era was **derived from
    release date** (the `ERAS` boundary table — no new field), resolving the open
    "era definition" question. **The chart-series half now ships too:** the
    Price-History (§03) and SV-Booster-Trend (§04) comparison views gained an
    **Eras** roll-up level beside Sets (`groupEras()` in `metrics.js`, one line
    per era via `meanSeries`), so a **Products ⇄ Sets ⇄ Eras** toggle plots whole
    eras head to head (`tests/smoke.spec.mjs` pins it). **The era scope filter now
    ships too:** an **`#era-filter`** dropdown (`activeEra`, populated by
    `populateEraFilter()` from the eras present) is a second global scope axis
    beside the Type pills — applied in `visibleProducts()`, so "only Scarlet &
    Violet" narrows the board, scatter, overview, both analytical lenses and the
    comparison views alike (pinned in `tests/smoke.spec.mjs`). It deliberately
    leaves the age-fit (fair prices stay whole-catalogue) and the KPI strip alone.
    **Faceted filtering + Top-N now ship too** (see the two ✅ bullets below), so
    the usability half of this item is done; only the **perf win** (a collapsed
    group renders one row — cheap virtualisation) is left, and it's realised for
    the tables already. (The earlier "set-level scope filter dropped" note is
    superseded — a **Set** facet did ship, alongside price/age ranges.)
    - *Decided: era/set stay **derived**, not stored on the product row.* Era is a
      pure function of `release` (the `ERAS` boundary ranges), so a stored `era`
      column could only ever *duplicate* the date and drift from it — a silent
      wrong-group vector — while adding per-product data entry and load-path
      surface (schema/RLS, Data Entry, `parseXlsx`/`exportXlsx`, the hardcoded
      fallback) for zero correctness gain; a new era stays one `ERAS` entry that
      re-derives the whole catalogue. **Set** is the more fragile derivation
      (`setLogoKey()` parses the product *name*, so two products in one set with
      slightly different name stems could split), but the fix — *if* a real
      misgroup ever appears — is a proper **`sets` table** (`id` · `name` ·
      `release_date` · `cardmarket_expansion_id` · logo-alias, `products.set_id`
      FK) that would collapse three current name-heuristic paths (`setLogoKey()`/
      `setLabel()`, per-product `release`/`cardmarket_expansion_id`,
      `SET_LOGO_ALIASES`) into one authority — **not** a free-text `set` column,
      which reintroduces the same drift. Defer until a concrete misgroup (a set
      splitting in the tree, or a logo miss) motivates the full table.
  - **Faceted filtering with live counts + saved views — ✅ SHIPPED.** Combinable
    scope facets — **Type** pills, **Era** + **Set** dropdowns, and **price / age
    range** inputs — flow through one `passesScope()` predicate into
    `visibleProducts()`, so every one narrows the board *and* the charts. Each
    discrete facet shows a **live match count** given the other active facets
    (`refreshFacetCounts()` counts with that dimension skipped — the pill count
    span, the `(N)` on every era/set/verdict option). The Set + range facets and a
    **saved-views** control (name → `localStorage`; save / load / delete, reload
    re-applies the whole combo incl. lens & sort) live behind a **"More filters"**
    disclosure (`#advanced-filters`) so the primary row stays uncluttered; a badge
    counts active advanced facets and a **Reset all filters** clears everything.
    Price/age inputs are canonical € / years like every typed input. Pinned in
    `tests/smoke.spec.mjs` ("advanced facets combine and a saved view round-trips").
  - **Top-N + "show all" — ✅ SHIPPED.** The board leads with the best
    **`BOARD_TOP_N` (12)** products flat, in the active sort order, and a footer
    row expands to the full Era→Set→Product tree (`renderBoardList()` — the shared
    body renderer for all three lenses, generalising the "Where to start"
    shortlist). A live search bypasses the cap (the tree force-expands so every
    match shows). Pinned in `tests/smoke.spec.mjs` + the a11y phone-board spec.
  - *Constraints these met.* Aggregates ship as pure, unit-tested helpers
    (e.g. `setAverages()` / `eraAverages()`) over the `analysisProducts()` pool
    (loose packs excluded), and must be **currency-correct** — only absolute-€
    means convert; ratio metrics (SV/Booster, Wtd. Score) stay put. Keep it inside
    the existing dark table system — a group header is `thead`/`.panel`-weight, not
    a new component — and preserve the phone column-priority rules (`.col-detail`).
    The efficient source for the headline rows is server-side aggregation (a
    Supabase view/RPC) — see **Data volume at scale**.

- **Cross-filtering — a shared product selection drives the charts (PowerBI-style). ✅ SHIPPED.**
  Each comparison chart used to have its **own** add-a-series picker, so charting
  the same products in both meant finding them twice. Now a **`.sel-check` checkbox
  on every board row** (all three lenses) toggles a product in the module-level
  **`selectedProducts`** set — the single source of truth — and `toggleSelection()`
  → `refreshSelectionViews()` drives every surface at once: **both comparison
  charts' Product mode** read it (`syncSelection()`/`pullSharedSel()`, so a tick
  adds a line to §03 *and* §04), the **§02 scatter cross-highlights** (selected
  points lit, the rest dimmed — highlight, not filter, so the age-fit keeps its
  context), and the chart chip-pickers edit the *same* set (unified). Capped at
  `COMPARE_CAP` (6) so the selection never exceeds what the charts can legibly
  draw; a `#chart-selection` bar shows the count + **Clear**; session-only
  (`seedSelectionIfEmpty` / `pruneSelection`). The checkbox is a custom
  `appearance:none` box sized to a 24×24 hit target (WCAG 2.5.8). No new token;
  currency-correct like every chart path. Guarded in `tests/smoke.spec.mjs` +
  `tests/a11y.spec.mjs`. Set/Era roll-up modes keep their own per-chart selection.

- **"Where to start" teaser on the demo + summary-strip relocation.** *(Feature;
  **shipped** — demo teaser + KPI-strip relocation.)* The signed-in
  Analysis tab opens on the **Where to start** shortlist (Safe pick / Best deal /
  Best value — `renderOverview`, `startLens`). Two follow-ups pull that value onto
  the logged-out landing without breaking the demo's honesty rules:
  - **Demo teaser — value-live, two lenses locked. ✅ SHIPPED.** The three-lens
    block is now on `#demo-page` (`renderDemoStart()`): **Best value** (SV/Booster,
    fit-independent) ranks for real in non-interactive pick cards, while **Safe
    pick** and **Best deal** show a **locked "sign in to rank by…" state** (an
    `#i-lock` panel + `.signin-open`) — honouring the rule that the demo shows no
    fair price or verdict (the 3-set anon slice can't reproduce the catalogue-wide
    fit), and giving the concrete answer to *what an account buys*. The
    unlock-toolkit tiles (fair price, verdict, price history, portfolio, alerts)
    live **once**, in a standalone "What a free account unlocks" section rather
    than duplicated inside each locked lens. Reuses the pick-card components.
    Paired with an animated **"See how it reads a product"** panel — three
    *Sample*-badged SVG charts (value-vs-age scatter + fit, actual-vs-fair-price
    line, 30-day momentum diverging bars) that draw on when scrolled into view
    (CSS-only, reduced-motion safe; illustrative data, so the no-real-fair-price
    rule holds) — turning the "how to read it" pitch into show-don't-tell.
    Guarded in `tests/signed-in.spec.mjs`.
  - **Relocate the KPI summary strip. ✅ SHIPPED.** The Analysis KPI row (Products
    Tracked · Top Score · Best Value/Booster · Newest Release) is a *dataset
    teaser*, and two tiles (Top Score age-weighted, Best Value/Booster) merely
    restated the block's Safe/Value #1 — so it sat *above* the answer on the tab
    whose job is to open on the answer. It now lives on the **Welcome landing**
    under an **"At a glance"** eyebrow (same tile ids, so `updateKPIs()` fills it
    unchanged; `kpi-total` set from `analysisProducts().length`), and Analysis
    drops it entirely so the tab opens straight on **Where to start**. The KPI
    intro points at the shared **What the numbers mean** glossary rather than
    defining a term twice, honouring the shared-explanation rule and not growing a
    second pitch on Welcome. (A demo-page KPI variant was considered and skipped:
    the 3-set anon slice can't reproduce the age-weighted Top Score, and Best
    Value already leads the demo teaser.) Guarded in `tests/a11y.spec.mjs` (the
    Analysis explainer count drops 5→4) and the Welcome-landing spec.

## The sell side — knowing when to exit

*(Feature cluster; not yet designed.)* The whole tool currently answers one
half of the question — *when to **buy***: buy signals, "Where to start", the
fair-price gap as a buy gate, price alerts on a target below fair. The mirror
image is missing. These three items add the **exit** side, reusing the machinery
that already exists rather than inventing new maths — the same `momentum()`
(drawdown, 7d/30d change, set-value trend), `verdict`, `fairGap`/`fairPrice`
and the signed-in `holdings` map. Sequenced buy→hold→sell, they close the loop.

- **Sell signals (the inverse of the buy signal). ✅ SHIPPED.** The momentum
  half is built: `sellSignal(hist)` in `metrics.js` (pure, unit-tested) is the
  exact mirror of `buySignal` — price **rose** ≥5% on the last snapshot while set
  value did **not** follow (an un-backed run-up). It surfaces as a red board flag
  (`.sell-flag`, `i-trend-up`, `aria-label="Sell caution"`, a sibling of the 💰
  buy flag), folds into the plain-language **verdict** via an optional `runUp`
  flag ("… · un-backed run-up" on a `bad` verdict; a neutral "Un-backed run-up"
  when there's no trusted fair anchor), and shows a "Momentum signal" line in the
  drill-down. It makes **no fair-price claim** (momentum-only), so it stays honest
  on a weak/suppressed fit — the sell-side mirror of the buy honesty rule; the
  "meaningfully over fair price" case is already the verdict's `bad` tone. The
  original scope below is kept for reference:
  - _Original plan:_ flag when a product is
  **meaningfully above its fair price** (`fairGap` positive past a threshold,
  gated on `fairPriceTrusted()` exactly like the buy side), and/or shows
  **inverse momentum** (a strong recent run-up — `momentum().change30d` /
  `change7d` high, near its peak rather than in drawdown, with the set-value
  trend flat or falling so the price move isn't backed by fundamentals). Surface
  it the way the buy signal already is: a board flag (a sibling of `isBuySignal`
  / the 💰 icon, with its own non-colour cue + `aria-label`), folded into the
  plain-language **verdict** (an "overpriced — consider selling" tone already
  half-exists as the `bad` verdict), and a drill-down ingredient line. *Open
  questions:* the exact thresholds (reuse the verdict's `OVER_SOFT`/`SV_MOVE`
  constants vs. new ones); whether a sell signal only shows for **held**
  products (signed in) or catalogue-wide; and the honesty rule — a sell signal
  on a suppressed/weak fair price must fall back to momentum-only, never a fair
  claim, mirroring the buy side.
- **Sold-item tracking in the portfolio (realised P&L).** The portfolio tracks
  only *open* holdings and *unrealised* P&L. Add a **sold** state: record a
  disposal (quantity, sale price, date) so the portfolio can show **realised
  P&L** beside the unrealised, a lifetime/return figure, and a history of
  closed positions. Schema: either a `holdings.status` + sale fields, or a
  separate **`sales`** table (RLS-scoped per user like `holdings`), fed from the
  portfolio editor (a "Sell" action on a holding card that moves some/all of the
  quantity to a sale and blends nothing back). Feeds the value-over-time chart
  (realised gains as a floor) and the concentration view (sold items leave the
  live exposure). All derived client-side from raw inputs, like the rest of the
  portfolio. *Open question:* partial sales + cost-basis method (the buy editor
  already blends to a weighted-average cost via `commitHolding()`, so a sale
  draws down against that average — keep it consistent).
- **A sell-signal shortlist (the exit-side "Where to start").** The mirror of
  the Where-to-start buy shortlist: a top-list ranked by sell-signal strength —
  most over fair / strongest un-backed run-up — scoped, signed in, to the user's
  **own holdings** first (what *you* could take profit on), with a catalogue-wide
  view as a secondary lens. Reuses the `renderOverview` / lens-toggle pattern and
  the `startCard` layout, so it costs a render function and a metric, not a new
  component. Depends on the sell-signal definition above landing first. *Open
  question:* whether it's a fourth Portfolio section, a lens on the existing
  Where-to-start block, or its own small panel — decide once the signal exists.

Constraints (same as every analytical feature here): the new signal/realised-P&L
maths ships as **pure, unit-tested helpers in `metrics.js`** (no derived number
without a test), currency-correct (only absolute-€ figures convert; a ratio stays
put), and honest about a weak fit. Nothing here needs new external data — it's all
derivable from the prices, set values and holdings already tracked.

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
- **LLM weekly summary + news bulletin (RSS).** Two related, lighter-weight LLM
  features that share the assistant's server-side plumbing but ship as
  *scheduled digests*, not a live chat. **(a) Weekly summary** — a short,
  plain-language recap the model writes each week over the same structured,
  derived metrics the assistant reasons about: what moved (biggest fair-price
  gap changes, new buy signals, notable drawdowns), which sets are trending, and
  — signed in — how the reader's own portfolio shifted. Same honesty guardrails
  as the assistant: it summarises numbers from `metrics.js`, never invents them,
  and carries the "not financial advice" framing. Delivered where the existing
  cadence already runs — a Supabase `pg_cron` job composing an email via Resend
  (the proven staleness/alert/error-digest pattern), and/or an in-app "This
  week" panel. **(b) News bulletin** — pull a Pokémon-TCG news feed (e.g.
  Pokebeach.com's RSS) so set releases, reprints and market-moving announcements
  sit beside the price data instead of in a separate tab of the reader's
  browser. Two honest scoping decisions to settle: whether the LLM *summarises/
  filters* headlines to the sealed-product-relevant ones (adds per-use cost and a
  fabrication surface — must link the source article, never paraphrase a claim as
  fact) or the feed is shown **raw** as a plain reverse-chronological list (zero
  LLM cost, no hallucination risk — the cheaper first cut, and where this should
  start); and where the fetch lives (an Edge Function / `pg_cron` job caching the
  parsed feed server-side, never a client-side cross-origin fetch of a third-
  party feed). Respect the feed's terms and `ttl`/polite-cadence, attribute the
  source, and link out rather than republishing full articles. Sequenced after
  the conversational assistant since it reuses that server-side model call, but
  the raw-RSS bulletin (b, without the LLM filter) is independently shippable and
  a good low-cost first step.
- **Mobile app / installable experience.** For a price-checking tool used in
  shops, a home-screen presence and a native-feeling mobile experience are worth
  real weight — this is the "how do we ship mobile" bet. Sequenced cheapest-first:
  (1) a **PWA** — installable, app icon, offline shell — **shipped** (see *Done*):
  it was the natural fit for a single static `index.html` and bought most of the
  "feels like an app" value for the least work and no app-store overhead. What
  remains are the heavier options, to revisit only if the PWA falls short: (2) a
  thin **wrapper** (e.g. Capacitor) around the same page if an actual App Store /
  Play Store listing is wanted, reusing the web codebase; (3) a
  **native/React-Native rewrite** only if a real platform capability demands it —
  it abandons the deliberate no-build, single-file model and doubles the surface
  to maintain, so it needs a concrete reason beyond "native is nicer."
- **Custom app icon / brand mark.** The installed PWA, the browser-tab favicon
  and any future store listing currently wear the app's three-bar chart logo —
  clean and on-brand, but generic. A bespoke mark would give the product a
  stronger, recognisable identity where it matters most: a home-screen icon and a
  tab. Constraints that make it real work rather than a quick swap: it must
  survive the **maskable safe zone** (the OS circle/squircle crop — ~10% inset
  each side), stay legible from **16 px** (favicon) to **512 px**, sit on the
  dark `#0a0b0f` background, and honour the minimalist aesthetic
  (`design-review`) — no fine detail that muddies at small sizes. Keep the three
  surfaces in sync: regenerate the PNGs via `scripts/gen-pwa-icons.mjs` (or
  replace it if the new mark isn't cleanly SVG-buildable) **and** update the
  inline SVG favicon in `index.html`. Must be an **original, licensing-clean**
  mark — never a Pokémon / TPCi asset, since this is an unaffiliated fan project.
- **Privacy-friendly analytics** — know which views are actually used before
  investing further in them.
- **Legal/compliance for launch** — privacy policy, GDPR basics, cookie consent
  (EU-operated, stores emails in Supabase). The "not financial advice"
  disclaimer already exists.
- **Board performance fixes — measured, not speculative; trigger ≈ 200
  products.** The scale measurements (see **Done**) convict one function:
  `updateTable()` rebuilds every row on every interaction, so its O(N) cost
  lands on the board's hot paths. At today's 36 products it is invisible (8 ms)
  and **none of this is worth doing yet** — it becomes real if coverage growth
  or automated ingestion multiplies the catalogue. In priority order:
  - **Debounce the board search** (~150 ms). The worst of the three: the input
    handler rebuilds the whole table *per keystroke* — 92 ms each at 400
    products, so typing visibly lags. Cheapest fix, biggest felt win.
  - **Stop rebuilding the table wholesale.** Sort, filter and search each
    re-render every row (50–70 ms at 400). Update rows in place, or virtualise
    the capped-height scroll area, if the debounce isn't enough.
  - **Split the type filter's re-render.** It synchronously rebuilds the board
    *and* four charts (239 ms at 400, 329 ms at 400 × 365) — the charts could
    update off the critical path.
- **Data volume at scale (depth — snapshot history).** *(Fix/Feature; approach
  decided later; the companion to Board performance fixes above.)* That item is
  **breadth** (row count / per-render cost); this is **depth** — history grows
  forever with daily ingestion, and `loadFromSupabase()` currently does
  `snapshots.select('*')`, pulling *every* snapshot for *every* product and
  pivoting client-side. The scale harness already caught the tail of it: the
  400 × 365 fallback workbook takes **4.2 s** to load, and the cloud path has the
  same O(N×M) shape. Options investigated to bound it:
  - **Latest-only board load + lazy full history on drill-down — the biggest
    lever.** The board and every ranking need only each product's *newest*
    snapshot; fetch the full series only when a drill-down opens. Turns load from
    O(N×M) to ≈O(N). Wants a Supabase **`latest_snapshots`** view (one row per
    product) plus a per-product history query.
  - **Downsample old history** — daily for recent months, weekly/monthly beyond a
    cut-off, bounding both chart points and payload.
  - **Date-windowed history queries** — the drill chart requests a range, with
    "load full history" on demand.
  - **Server-side aggregates** — a `set_aggregates` / `era_aggregates` view or RPC
    so the roll-up headlines (see **Navigation & overview at catalogue scale**
    under **Then**) don't pull every row; index
    `snapshots(product_id, snapshot_date desc)`; keep RLS and the demo's
    `demo_product_ids()` scoping.
  - *Sequencing note (to decide later).* The cheap, high-impact start is **Phase
    1** — scoped-default board + debounced/fragment render (from **Board
    performance fixes**) + latest-only load — which removes both the keystroke lag
    and the load cliff before any hierarchy or virtualisation is built. **Phase 2**
    is the hierarchical overview with server-side aggregates; **Phase 3** is
    virtualisation, and only if a fresh `measure-scale.mjs` run says so — numbers,
    not a guess, consistent with how the scale work was originally filed.
- **Coverage growth** — more sets and eras first (same model, more rows), then
  consider multi-currency/multi-region pricing and, much later, singles — each
  multiplies data-entry cost, so each waits on the ingestion question below.
  Past ~200 products the board performance fixes above come due with it. **The
  XY → Sun & Moon backfill is done** (see **Done**); the next chunk down is the
  Black & White / earlier eras if/when wanted.
- **Backup & restore** — *deferred from "Now" by maintainer decision (Jul
  2026)*. Formalise beyond the manual xlsx export: scheduled Supabase backups
  plus a periodic automated xlsx snapshot, and — the part that actually matters
  — a documented, **rehearsed** restore path. Deferred because the rehearsal
  needs a throwaway destination to restore *into*, and spending the
  organisation's second free Supabase project on it isn't worth it yet (a local
  `supabase start` stack is the free alternative when this is picked up — see
  `IMPLEMENTATION.md`). **Standing risk while it waits:** the live database's
  only backup is the manual **⬇ Export updated .xlsx** button, so export after
  each monthly entry loop and keep the file — that is the interim backup.
  Revisit before launch, or sooner if the dataset grows past what hand
  re-entry could recover.
- **Complete DB backups & security audit — the pre-launch hardening gate.**
  *(Hardening; launch-gating.)* Two operational must-dos before opening the door
  wider, filed together because both are the same promise — *prove the cloud
  surface is safe to rely on*:
  - **Finish the backup story.** Complete **Backup & restore** (above): move off
    "the only backup is the manual **⬇ Export updated .xlsx** button" to scheduled
    Supabase backups plus a periodic automated xlsx snapshot, and — the part that
    actually matters — a documented, **rehearsed** restore into a throwaway
    target. Not done until a restore has actually been run, not just a backup
    taken.
  - **Audit the whole cloud surface, deliberately.** An end-to-end review of the
    Supabase boundary rather than trusting it feature-by-feature: every table's
    **RLS** (`products`/`snapshots` shared-read / admin-write,
    `user_settings`/`holdings`/`alerts` per-user, `client_errors` insert-only,
    `news` public-read / service-write), the **`is_admin()`** write boundary and
    the `demo_product_ids()` `SECURITY DEFINER` demo scope, the three **Edge
    Functions'** service-role usage (never exposed client-side) and their input
    handling, key/secret management (anon vs service-role, Resend/API keys), and
    the client's escaping of untrusted external text (news/RSS titles, error
    payloads). The signed-in Playwright spec proves the *client's* behaviour;
    this is the *server-side* counterpart — the policies verified directly, not
    inferred. Pairs with the `security-review` pass and the **Launch checklist**.
- **Launch checklist** — uptime expectations, support contact, versioned
  changelog, a public "how the numbers work" methodology page (the trust
  document for a tool that claims to know what's fairly priced).

## Automated ingestion — BUILT (Cardmarket bulk files; Tradera + TCGdex as fallback)

**Shipped (Jul 2026).** The server-side ingestion now exists, **DB-driven** (the
tracked set is the Supabase `products` table, seeded via Data Entry; each row's
`cardmarket_product_id` pins the catalogue match) and split **precompute +
Edge Function** so the daily job runs inside Supabase despite the Edge runtime's
~256 MB memory limit:
- **Daily snapshot** — `supabase/functions/cardmarket-daily` (Deno Edge Function,
  scheduled by `pg_cron` via `supabase/cardmarket-cron.sql`). Reads the products
  + precomputed catalog from the DB, fetches only the smaller `price_guide` file,
  and upserts today's `snapshots` row with the service-role key.
- **Resolve ids** — `supabase/functions/cardmarket-resolve-ids` (Edge Function,
  Data Entry's **Resolve ids** button). Name-matches every product missing a
  `cardmarket_product_id` / `cardmarket_expansion_id` against the small nonsingles
  catalogue and writes the ids back (NULLs only — manual pins survive), so
  bulk-adding products needs no hand-sourced id.
- **On-demand catalog refresh** — `supabase/functions/cardmarket-catalog-refresh`
  (Edge Function, Data Entry's **Sync catalog** button). It **streams** the large
  *singles* file (chunk by chunk, one record at a time, so it fits the memory
  limit at any size) and caches each expansion's single-card ids into
  `public.cardmarket_expansion_singles`, so the daily function never loads it.
  No GitHub Action.

Both Edge Functions derive via the same math as the unit-tested
`scripts/cardmarket-lib.mjs`, writing Set Value = `avg30` all-cards singles sum
and Box Price = `(trend + avg)/2` (the 50/50 blend — thin boxes' true price sits
between Cardmarket's smoothed trend and the sales avg, confirmed against
hand-tracked history; skipped when `products.price_locked`), flagging thin
liquidity (`snapshots.low_liquidity`). `scripts/cardmarket-ingest.mjs` mirrors
both halves on the command line (`--dry-run`, `--backfill-ids`,
`--refresh-catalog`) as a local fallback. The in-app **Data Entry price-lock
toggle** now ships too: each row has a 🔒 lock control, thin-liquidity rows are
badged with the trend/avg/low spread (`snapshots.price_avg`/`price_low`), and an
advisory strip lists flagged products for review. **Still to wire (fast follow):**
the box **rolling 30-day average** once ≥30 days of snapshots exist (interim:
`trend`). Design detail below is retained as the record of why each choice was made.

**Lead route: Cardmarket's official bulk catalogue downloads.**
The maintainer located Cardmarket's published productCatalog files — served
without auth from `downloads.s3.cardmarket.com` for idGame 6 (Pokémon):
`products_nonsingles_6.json` (sealed products), `products_singles_6.json`
(singles, grouped by expansion) and `price_guide_6.json` (daily **EUR** price
per `idProduct`). These are *published files*, not the website, so they sidestep
the GTC clause that blocked the parked routes (which barred spidering/crawling
*the site*). The payoff is bigger than Tradera + TCGdex: **one native-EUR source
supplies both halves** — Price from the price guide, and Set Value by summing the
expansion's singles from the same guide — so there is no SEK→EUR FX to store, no
C2C free-text noise to filter, and no cross-source currency-coherence problem.
Filtering is a curated allowlist keyed by `idProduct` (`cardmarket-map.json`,
seeded from the current Summary sheet); adding a set is one entry. A spike tool
(`scripts/cardmarket-spike.mjs`, `npm run cardmarket:spike`) validates the route
before anything depends on it: `discover` name-matches the tracked products to
the catalogue and drafts their ids for human review; `compare` derives today's
Price and Set Value and prints them beside the hand-entered values so coverage
and the **Set Value sum definition** (full singles-sum vs a holo/rare subset —
the same calibration question TCGdex raised) can be pinned. Two things still to
settle, both flagged as decisions, not blockers: (1) the exact JSON field names
(the spike prints the detected schema on first run); (2) the GTC's *reuse /
republishing* clause still bites a public price dashboard **regardless of how the
data was obtained** — access looks clean, publishing needs the terms re-read
before this becomes the source of record. Where a scheduled job **writes** —
straight into Supabase `snapshots` vs a PR against `pokemon_data.xlsx` for a
human merge — is deferred until the spike proves coverage. The Tradera + TCGdex
plan below stays as the fallback and as a local-Swedish-market cross-check.

**Spike results (validated Jul 2026, via the manual `cardmarket-spike.yml`
Action).** The route works end to end: schema confirmed (`products_nonsingles_6`
wraps a `products` array of 5,006 records with
`idProduct`/`name`/`categoryName`/`idExpansion`; `price_guide_6` wraps
`priceGuides`, 76,892 records, with `avg`/`low`/`trend`/…). Name-matching resolved
**37/37** tracked products (the two tricky ones needed help: singularising names
so "Mega Evolutions" stops colliding with the 2016 "Evolutions" set, and a
`nameHint` pinning Shrouded Fable Booster Bundle to its Version 1 SKU). End-to-end
`both` gives **37/37 price coverage**.

**Canonical field: `avg30` (the 30-day average).** Chosen over `trend` so a
short-term spike or dip can't jerk a value around; set once in
`cardmarket-map.json` (`priceField`). **Important data limit found in the spike:
Cardmarket populates the rolling averages `avg1`/`avg7`/`avg30` only for
SINGLES — sealed products (BOX/ETB/BUNDLE) carry only `avg`/`low`/`trend`
(their `avg1/7/30` are `null`).** So:
- **Set Value** (sum of singles) genuinely uses `avg30` — the smoothing the
  maintainer asked for applies here, where single-card outliers actually occur.
- **Sealed Price** has no 30-day average in the file, so it uses `trend`
  (Cardmarket's own smoothed trend indicator — already far steadier than a raw
  spot; not `avg`, which for sealed skews to older, staler sales). The **true
  30-day average for booster boxes must be computed from our own daily
  snapshots** once the scheduled job is ingesting — a rolling mean over the
  stored series, which also makes the window fully ours rather than Cardmarket's.
  Until 30 days of history accumulate, `trend` is the interim price.

Results on `avg30`:
- **Price** — median `avg30 ÷ hand` ratio **0.91** (Cardmarket sits a few % under
  the maintainer's hand prices but tightly, mostly 0.75–1.15). A solid,
  slightly-conservative price of record. (`trend` gave the same 0.91.)
- **Set Value** — median `singles-sum ÷ hand` ratio **1.17** on `avg30` (was
  **1.22** on `trend`; the 30-day average visibly damps outliers, e.g. Obsidian
  Flames 2.28→1.78). **Definition decided (maintainer, Jul 2026): Set Value is
  the sum of *all* cards in the set** (lower rarities barely move it), so the
  full expansion singles-sum *is* the canonical formula — **no subset, no scale
  factor**. The residual ~17% gap is a **market-basis difference**: the historical
  hand-entered Set Values were sourced from the **US market**, whereas
  Cardmarket's sum is **EU/EUR**. Going forward the canonical Set Value is the
  Cardmarket EUR all-cards `avg30` sum (`sum of avg30 over every single sharing
  the expansion`). **Basis validated** (`svcheck`, Jul 2026) against the
  alternatives and `avg30` **confirmed**: `trend` ≈ `avg30` (median 1.20 vs 1.17×
  the stored values — both carry the chase/graded-card pool, so `trend` is not a
  middle ground), while `low` is the raw *floor* (median 0.58×, i.e. the single
  cheapest copy of every card — it understates each set by ~half and is wrong for
  "what your raw pulls are worth"). No price-guide field lands between the floor
  and the average, so `avg30` (the typical raw-market price) is the defensible
  basis; trimming outlier cards was considered and declined. One consequence to design for: adopting the EU basis puts a
  **one-time ~15–20% step-change** in the Set Value (and therefore SV/Booster)
  **time series** at the switchover — old US-basis snapshots vs new EU-basis
  ones. The bulk files are current-day only (no history to backfill), so the
  honest options are: accept the discontinuity (everything is internally
  consistent from the switch date on) and optionally mark the switchover, or
  keep the old series frozen and start EU fresh. The same is true, but far
  milder, for **Price** (median 0.91 — a small basis shift, not a break).

**Thin-liquidity handling (decided Jul 2026).** All the price-guide fields are
sales-based, so for a low-volume product few sales move `trend`/`avg` and the
number goes stale — usually well below the current *listings*, which the bulk
files don't carry. The `kpi` check flags these as the products where `trend` and
`avg` **disagree by ≥20%**; on today's data only **2/37** trip it (Team Up,
Astral Radiance), and they fail in *opposite* directions (Team Up's `trend`
collapsed low, Astral's `avg` is stale-high), which is why no single field is
right for all. Handling is three parts, not an auto-pick:
1. **Flag + down-weight.** The scheduled job records a per-snapshot liquidity
   flag; the dashboard shows a "thin market — price unreliable" badge and the
   fair-price fit excludes/down-weights the row (reuse the existing
   `fairPriceTrusted` / advisory-guard machinery — a flagged value must never
   silently drive a verdict).
2. **In-app manual override (decided: this is the primary control).** The
   maintainer keeps control in the app, not a config file: a per-product **"price
   locked / manual"** toggle in **Data Entry**, stored in Supabase
   (`products.price_locked boolean`, admin-only RLS). When set, the admin types
   the box price by hand (the normal Data Entry → snapshot path) and **the
   ingestion job never overwrites that product's price** — Set Value still
   auto-updates (it's derived and reliable). The `kpi` liquidity flag surfaces
   *which* products to lock. The config `priceOverride` in `cardmarket-map.json`
   stays as a simpler secondary lever the spike already honours (`src=override`).
3. **Manual fetch (decided: yes).** The ingestion job is `workflow_dispatch`-
   triggerable on demand in addition to the daily cron, so the maintainer can
   refresh immediately — e.g. right after locking/correcting a price.
A real listings/asking-price source (eBay EU Browse API) stays the optional
future upgrade if this proves insufficient.

Ingestion-job build spec (when it ships): daily + manual `workflow_dispatch`
Action → fetch the 3 bulk files → filter via `cardmarket-map.json` → per tracked
product write a `snapshots` row (service-role key): **Set Value** = `avg30`
all-cards expansion sum; **Price** = `trend` today (→ rolling 30-day mean of our
own stored snapshots once ≥30 days exist), **unless** `products.price_locked` is
true, in which case the price is left to the admin's manual entry; also persist
the **liquidity flag**. Continues the existing series (accept the one-time
US→EU basis step, mark the switchover date).

The one workflow gotcha found and fixed: the Action's `both` must invoke the
script's own `both` subcommand (one process), not run `discover` then `compare`
as two processes — the second process starts with no discovered ids and reports
0 coverage.

The earlier unlock still holds for that fallback. The move was to stop forcing
the two hard sources
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

One measured consequence to design for (from the scale work under **Done**): a
daily cadence makes the *snapshot* axis explode, and while the app absorbs long
series well on its own, the **xlsx fallback does not** — 400 products × 365
daily snapshots is a **28 MB** workbook taking **4.2 s** to load. Daily
ingestion therefore wants either a windowed/downsampled fallback export or an
acceptance that the workbook is a backup format, not a load path.

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
  rather than silently re-based when SEK/EUR moves — a stricter discipline than
  the shipped **display currency** needs (that converts live at render time and
  stores nothing, so it never has to reproduce a historical rate). Feeds the
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

_Nothing open._ The four defects listed here in July 2026 are all fixed; see
the accessibility entry under **Done**. Kept below in short form because each
records something worth not re-learning.

_Previously fixed:_ **the phone tab bar overflowed the viewport when signed in.**
`.tab-bar` was a non-wrapping flex row measuring 437 px at a 390 px viewport, so
the body scrolled sideways on *every* tab for signed-in admins (the only state
with four tabs). It now wraps, with a squarer radius below 680 px so a two-row
bar doesn't read as a broken pill.
*This corrected an earlier mis-diagnosis:* the July journey pass blamed
`.entry-table` and reported it as having no `overflow-x` wrapper. It has one
(`.entry-table-wrap`) and it works — the table was never the cause. See
[`docs/ux-expert-review.md`](docs/ux-expert-review.md) → Correction 1.

_Previously fixed:_ **reflow failed at 320 px (WCAG 1.4.10 AA).** Analysis
forced two-dimensional scrolling at the conformance threshold (`scrollWidth` 342
vs 320). The whole 22 px was the age-threshold group's `margin-left: 8px` plus
its `padding-left: 16px` separator rule; both drop away below 680 px, where the
filter bar is wrapping anyway. Measured, not guessed — the element was found by
walking the DOM for boxes extending past `window.innerWidth`.

_Previously fixed:_ **the app could not be operated without a mouse (WCAG 2.1.1,
Level A).** Board rows had `cursor: pointer` and a click handler but no
`tabindex`, `role` or key handler. The fix was *not* to make the `<tr>` a button
— that strips the table's row semantics and trips `aria-required-children` —
but to wrap the product name in a real `<button>`, with the row click kept for
the mouse.

_Previously fixed:_ **on a phone, the status line was unreadable and
unreachable.** `#analysis-status` was a `white-space: nowrap` pill in a
`justify-content: flex-end` row; at 390 px it overflowed **left**, off-screen,
and negative overflow creates no scroll area. Not cosmetic: `setStatus()` is the
only channel for cloud feedback, so the admin saw neither "✓ Saved to cloud" nor
**"✕ Cloud save failed"** — a silent-failure path in the one flow that writes
data. The pill now wraps (`overflow-wrap: anywhere`, right-aligned) in a
wrapping row, and carries `role="status"` so the message is announced.

_Previously fixed:_ **the Portfolio currency picker offered only €.**
The picker itself was correct — it lists € plus every currency it holds a live
rate for — so "€ only" always meant the FX fetch had failed. A bare `catch {}`
swallowed the reason, leaving no console message and nothing in the UI, so a
failed network call looked indistinguishable from a feature that was never
built. Two changes: the request now tries Frankfurter's **current** host first
(`api.frankfurter.dev/v1/latest?base=…&symbols=…`) and keeps the legacy host as
a fallback — the committed URL used the legacy host with its legacy
`from`/`to` parameter spelling, which on the current API means a *date range*
— and a failure is now **visible** (a note beside the picker, a `console.warn`,
and a `client_errors` beacon) instead of silent. `tests/fx-currency.spec.mjs`
covers all three outcomes. Note the root cause of the original failure could
not be reproduced from the dev sandbox (its network policy blocks the FX host),
so the endpoint change is the best-supported hypothesis rather than a confirmed
diagnosis; the added visibility is what makes the *next* occurrence
self-diagnosing.

The Jul 2026 code/comment/documentation audit looked specifically
for defects — duplicate element IDs, dangling `getElementById` targets, render
functions unreachable or wired into only one of `INIT`/`applyNewData()` — and
found none. Everything it turned up was dead weight or documentation drift,
filed above as **fixes**. (Fixed earlier: the Format Guide modal opening far down the page instead of
centred — `#guide-modal` was `position: fixed` inside the transformed
`#tab-analysis`, so it anchored to that ancestor rather than the viewport; moved
to be a direct child of `<body>` alongside `#auth-overlay` / `#account-overlay`.)
