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

## Now — trustworthy numbers (stability & quality)

A tool that tells people what's fairly priced has to be *right*, visibly and
verifiably. This theme extends the correctness story CI started to every number
on the page and every failure mode around it.

Items are tagged **Bug** (something is wrong today), **Fix** (something is
right but poorly built) or **Feature** (something new).

_Nothing open in this theme — the remaining work is under **Then** and
**Later**. The **Backup & restore** item that used to live here is deferred by
maintainer decision; see **Later**._

## Then — design & usability at product level

The aesthetic is deliberate and stays (dark, minimalist, `design-review`-
enforced). This theme is about the page working as hard for a first-time
visitor on a phone as it does for the maintainer on a desktop.

The order below is the one the **expert UX & accessibility review** recommended
([`docs/ux-expert-review.md`](docs/ux-expert-review.md), which supersedes the
earlier journey pass in [`docs/ux-assessment.md`](docs/ux-assessment.md) and
corrects two of its findings). **Accessibility came first and has shipped** —
see *Done* — along with the three phone/reflow defects that preceded it. What
remains is the comprehension work, now led by **bringing the Welcome tab onto
the app's own section pattern**. Every accessibility finding from the expert
review is closed, the measured density problem is addressed, and the visual
system's token/scale drift is reconciled and now guarded by
`npm run check:design-tokens`.

- **Fix — bring the Welcome tab onto the app's own section pattern**, and stop
  using accent colours as decoration there. Welcome uses no `.section-eyebrow`
  while Analysis and Portfolio use it throughout, and its card titles are blue
  and green as arbitrary category tints — teaching a first-time visitor, on the
  first screen, that the colours are decorative, when everywhere else green
  genuinely means good.
- **Fix — how "Fair Price" presents its own confidence.** The board header renders
  a bare *"R² 0.39"*. R² is a term most buyers don't know, **0.39 is a weak fit**,
  and the whole product rests on the number it qualifies — while both explanations
  sit where a phone user cannot reach them (a `title` tooltip, and a ~200-word
  paragraph). Show confidence qualitatively on the board, keep the statistic for
  the drill-down, and put the method somewhere reachable without hover. Presenting
  a weak fit as a bare statistic reads as more authoritative than it is, which is
  a credibility risk for a tool whose pitch is trustworthiness.
- **Fix — edit the board's explainer paragraph.** ~200 words of accurate, dense
  prose sitting directly above the most important table, and the single largest
  contributor to the measured 16.4 % prose share on phone. Collapsing it (above)
  hides the scroll cost; this is the separate job of *shortening* it.
- **Fix — resolve the section-numbering collision.** Analysis numbers its sections
  01–09 and Portfolio independently numbers its own 01–03, so "section 05" is
  ambiguous app-wide — and the board's own explainer text refers to "section 05"
  by number. Prefix or renumber.
- **Overview-first restructure.** With the verdict shipped, the top of the
  Analysis tab can *answer the question* — best deals now, each with its fair
  price gap — and the nine numbered sections become the supporting evidence a
  curious user drills into (progressive disclosure), rather than a wall to
  scroll. Less on screen, more answered.
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
- **Password reset (new — from the UX assessment).** The sign-in overlay offers
  only *Sign in* and *Create an account*; `resetPasswordForEmail` appears nowhere
  in the app. A user who forgets their password has no route back, and since
  holdings and alerts are RLS-scoped to their account they lose their own
  portfolio with it. Easy to miss because signed-in users *can* change a password
  (`#change-pw-btn`) — the gap is only for the locked-out. Small: a "Forgot
  password?" link on the overlay, `sbClient.auth.resetPasswordForEmail()`, and a
  recovery-token branch that opens `#account-overlay`.
- **Set logos (drill-down first).** Give each set a visual anchor: the
  expansion logo, at least on the product drill-down view where there's room to
  frame a single product, and later a small mark on board rows and set
  groupings. An identity and scannability aid only — it stays subordinate to the
  numbers and honours the minimalist dark aesthetic (`design-review`). Needs a
  licensing-clean asset source, a consistent sizing/placement rule, and a
  graceful fallback when a set has no logo (never a broken image).

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
  real weight — this is the "how do we ship mobile" bet. Its prerequisite, the
  **Mobile optimisation** work, has now shipped (see *Done*), so the remaining
  dependency is the density work under "Then" — no point wrapping a page that
  still costs 10.7 screenfuls to read. Sequenced cheapest-first: (1) a **PWA** — installable, an
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
- **Coverage growth** — more sets and eras first (same model, more rows), then
  consider multi-currency/multi-region pricing and, much later, singles — each
  multiplies data-entry cost, so each waits on the ingestion question below.
  Past ~200 products the board performance fixes above come due with it.
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
