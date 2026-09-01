# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page dashboard for tracking Pokémon TCG **sealed-product** (Booster Box / Elite Trainer Box / Booster Bundle) prices and deciding when to buy. The app is one self-contained `index.html` (markup, CSS, and JavaScript inline) plus `metrics.js`, the pure analytical core it imports. There is **no build step, no framework, and no bundler**; a Node-based dev-only test harness (unit + validator + Playwright) guards it in CI.

Repo contents:
- `index.html` — the whole application (~5,200 lines).
- `metrics.js` — the scoring/derivation math as pure functions (unit-tested).
- `pokemon_data.xlsx` — the tracked data workbook (auto-loaded at runtime).
- `README.md` — user-facing overview and data-file format.
- `docs/architecture.svg` — **start here.** One picture of the moving parts: the three data sources, the load path (`boot()` → `loadFromSupabase()`/`tryAutoLoad()` → `applyNewData()` → `recomputeScores()` → the render functions), `metrics.js` as the shared pure core, the four tabs, and the Supabase side jobs. `docs/architecture.mmd` is the editable Mermaid source it is rendered from — edit that, re-render, commit both.

## Running / developing

The page `fetch()`es `pokemon_data.xlsx`, so it **must be served over HTTP** — opening `index.html` via `file://` blocks that request and it falls back to the hardcoded sample data. Serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

External libraries load from CDNs at runtime (no install step): **Chart.js 4.4.1**, **SheetJS/xlsx 0.18.5**, **chartjs-plugin-zoom 2.2.0** + **Hammer.js 2.0.8** (pan/zoom for the full-screen chart view only), and Google Fonts. An internet connection is required on first load; if the zoom libs fail to load the charts still render — only the in-dialog pan/zoom is lost.

The app itself has no build/bundle step — it's still one static `index.html`. There is, however, a lightweight CI harness (Node, dev-only) that guards against regressions:

- `npm run test:unit` — `node --test` unit tests (`tests/unit/`). `metrics.test.mjs` covers the pure metrics module `metrics.js` (scoring/derivation, the age fit + fair price + verdict, momentum/drawdown, peer residuals, trend/buy signals, scenario math, set roll-ups, portfolio helpers); `index.html` imports the *same* file, so these assertions guard the live page's numbers, not a copy. `repo-invariants.test.mjs` covers the other kind of failure — two files that must agree with nothing relating them: the admin UUID in `supabase/schema.sql`'s `is_admin()` vs `SUPABASE_CONFIG.adminUserId`, and the all-blank-or-all-filled rule for that config. `cardmarket-lib.test.mjs` pins the automated-ingestion core (`scripts/cardmarket-lib.mjs`) — name-matching (singularisation, `nameHint`/`idProduct` pins) and the derive (Box Price = `(trend + avg)/2` blend, with the avg fallback when trend runs far below avg, Set Value = `avg30` singles sum, `priceOverride`, the `low_liquidity` flag, and the day-over-day `guardSetValue` Set Value guardrail) — the same numbers the scheduled job writes to Supabase. No build step, no extra dependency. Rule: no derived number ships without a test here.
- `npm run validate` — parses `pokemon_data.xlsx` and asserts the exact contract `parseXlsx()` + `deriveProducts()` enforce (sheet/column names, Types, dates, cross-references, usable latest price/set value). Catches the *silent* fallback-to-sample-data that a malformed workbook would otherwise cause. Keep `scripts/validate-workbook.mjs` in sync with `parseXlsx()`.
- `npm run test:e2e` — the Playwright specs, no cloud credentials needed. `tests/smoke.spec.mjs` loads the real page over HTTP against the real workbook and asserts every tab renders without runtime errors (the automated backstop for bugs like a missed `recomputeScores()` before first render); it blanks `SUPABASE_CONFIG` at request time to force the static/xlsx path. `tests/signed-in.spec.mjs` covers the Supabase surface — the logged-out demo scope, auth-driven UI gating, the snapshot pivot, portfolio/alert auto-save payloads, the admin Data Entry → cloud-save loop, and the error beacon — by intercepting the SDK request and serving `tests/fake-supabase-sdk.js`, an in-memory stand-in that logs every write to `window.__sbWrites` for assertions (it proves the client's behaviour; the real RLS policies stay server-side in `supabase/schema.sql`). Both specs are fully hermetic: `tests/local-cdn.mjs` routes Chart.js/SheetJS (and the chartjs-plugin-zoom + Hammer.js pan/zoom libs) to the `node_modules` copies and stubs Google Fonts, and it asserts the installed versions match the CDN tags in `index.html` — so a version bump on one side fails loudly instead of testing a library the page doesn't ship. (`scripts/measure-scale.mjs` uses the same helper; `forceStaticMode()`, which blanks `SUPABASE_CONFIG` at request time, lives there too and is shared by the smoke and a11y specs.) Without it a blocked CDN surfaces as an unrelated-looking click timeout: the page's missing-library guard is an overlay that swallows pointer events. `tests/a11y.spec.mjs` is the **accessibility gate** (`@axe-core/playwright`): no serious/critical WCAG violation on any tab, plus the behaviour axe cannot see — opening the drill-down from the keyboard, the dialog focus trap and focus return, the tab list's arrow-key navigation, a visible focus ring on every tab stop, 320 px reflow, and the phone status line. **Never sample colours mid-animation**: `reducedMotion: 'reduce'` is not enough (durations collapse to 0.001ms, and switching tabs restarts the pane fade), so every sweep first awaits `settle()`, which waits on `document.getAnimations()`. Sampling early measures `var(--muted)` at ~1.83:1 instead of its resting 5.9:1 and invents contrast failures — the trap recorded in `docs/ux-expert-review.md`. Sweeps taken while a dialog is open are scoped to the dialog (`.include()`), since the overlay dims the inert page behind it. `tests/pwa.spec.mjs` is the **installable-app gate**: it validates the web manifest and that every icon resolves, that the service worker **registers → activates → precaches the shell** (read out of Cache Storage, so it doesn't depend on a flaky offline reload), and the header install button's flow (hidden until a synthesised `beforeinstallprompt`, then it drives the prompt and retires). It is the one spec that runs with the service worker **enabled** (`test.use({ serviceWorkers: 'allow' })`); every other spec runs with `serviceWorkers: 'block'` set in `playwright.config.mjs`, so the SW's offline cache can never serve one spec stale content from another or sit between the page and Playwright's request routing.
- `npm run check:design-tokens` — `scripts/check-design-tokens.mjs` is the
  aggregate view no reviewer has: it fails on a hex colour literal outside
  `:root` and on any `font-size` that isn't a scale step. It exists because the
  build had grown a **second palette** hard-coded in the chart JS (`#4fc3f7`
  beside the token's `#5cc7f2` on the same screen) and **36 font sizes** where a
  scale should have ~11 — drift that is invisible one literal at a time. Genuine
  exceptions live in `ALLOWED_COLOURS` with a written reason each (the three
  extra comparison-series hues, message-text tints, the scrollbar hover). Like
  the dead-code checker it only ever *reports*.
- `npm run check:dead-code` — `scripts/check-dead-code.mjs` reports CSS classes, element IDs and functions declared in `index.html` and referenced nowhere. In one 5,200-line file dead weight is invisible; the Jul 2026 audit found 14 such items by hand, and this keeps the count at zero. **Its one blind spot is deliberate and documented in the file**: names assembled at runtime (`type-${p.type}` → `.type-BOX`, `'tab-' + btn.dataset.tab` → `#tab-portfolio`) look unreferenced to any textual scan, so they live in an explicit `CONSTRUCTED` allowlist with a note saying where each is built. The tool only ever *reports* — deleting is a human decision, and a false positive is a bug in the checker, not a licence to delete.
- `npm test` runs all five. `.github/workflows/ci.yml` runs them on every push/PR.

Further scripts are **tools, not checks** — deliberately outside `npm test`, since they need network, a browser, or machine-dependent timings and would flake as a gate:

- `node scripts/gen-pwa-icons.mjs` — rasterises the app's three-bar logo mark into the PWA PNG icons (`icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) via headless Chromium. Deterministic; the maskable variant scales the mark to ~0.72 so the OS mask never clips it. The hues are the design tokens — keep them in sync with `:root` and the inline SVG favicon if the palette moves. Re-run and commit the PNGs whenever the mark changes.
- `npm run scale:fixture` (`scripts/gen-scale-fixture.mjs`) — generates a contract-valid workbook of arbitrary size, deterministic per `--seed`. Two axes: `--products N` (board/chart row count) and `--snapshots M` (series length per product, `--cadence monthly|weekly|daily`). Set Value is modelled **per set**, not per product — every product sharing a release shares its Set Value, which is what the real workbook contains and what `typeOutliers()` assumes; modelling it per-product produces a fixture that trips the data-quality guards.
- `npm run scale:measure` (`scripts/measure-scale.mjs`) — serves a temp copy of the page against a generated fixture and reports cold-load and interaction timings. It patches the served `index.html` to blank `SUPABASE_CONFIG` (static path, as the smoke spec does) and to wrap the render functions in `performance.now()` timers, keyed off a `TIMED` list of function names — **renaming a render function makes it throw**, by design, rather than silently measuring nothing. Interactions are dispatched *inside* `page.evaluate` and force a style+layout flush inside the timed region; without that flush the numbers are meaningless (innerHTML writes return in microseconds and the real cost lands in the next layout pass). Latest results live in `ROADMAP.md`.
- `npm run cardmarket:spike` (`scripts/cardmarket-spike.mjs`) — validates the Cardmarket bulk-file ingestion route (see ROADMAP "Automated ingestion") before any scheduled job depends on it. `discover` name-matches the tracked products against `products_nonsingles_6.json` and drafts each product's `idProduct`/`idExpansion` into `cardmarket-map.draft.json` (gitignored) for human review; `compare` derives today's Price (from `price_guide_6.json`) and Set Value (sum of the expansion's singles) and prints them beside the workbook's latest values so coverage and the Set Value sum-definition can be calibrated. Reads only — it never writes Supabase or the workbook. Needs `downloads.s3.cardmarket.com` reachable (CI or a dev machine; some sandboxes block it by egress policy). The allowlist mapping tracked product → Cardmarket ids lives in `cardmarket-map.json`; adding a set is one entry. Field-name assumptions are confirmed by the first run (the spike prints the detected schema).
- **Automated ingestion = precompute + Edge Function** (production; the spike above is the read-only calibration tool). The tracked set is **DB-driven** — the Supabase `products` table (seed via Data Entry), not `cardmarket-map.json`. Each product's **`cardmarket_product_id`** (the Cardmarket `idProduct`, entered in the Data Entry "CM ID" column) **pins the catalogue match exactly**; a product with no id falls back to name-matching. `cardmarket-map.json` is now just *overrides* (`nameHint` / `priceOverride`) plus the offline allowlist that `--dry-run` uses when there are no DB creds. The work is split so the daily job can run **inside Supabase** despite the Edge runtime's ~256 MB memory limit:
  - **Daily snapshot — `supabase/functions/cardmarket-daily/index.ts`** (Deno Edge Function, scheduled by `pg_cron` via `supabase/cardmarket-cron.sql`). It reads the products + the precomputed catalog from the DB, fetches **only** the smaller `price_guide` bulk file (keeping just the ids it needs as it parses, so memory stays bounded), derives, and upserts today's `snapshots` row with the auto-injected service-role key. Box Price = `(trend + avg)/2` (the 50/50 blend — thin boxes' true price sits between Cardmarket's smoothed trend and the sales avg; liquid boxes have trend ≈ avg; **but when `trend` runs > `trendFallbackGap` (default 30%) below `avg` it uses `avg` instead of the dragged-down blend — a stale/thin low trend was producing wrong daily prices needing manual fixes**; **skipped when `products.price_locked`**), Set Value = `avg30` all-cards singles sum, `promo_value` = the **sum** of the `avg30` of the product's bundled promo single(s) (`cardmarket_promo_product_ids`, a `bigint[]` — some products bundle more than one promo; the few ids are kept while parsing the same guide and summed into one scalar, since we track only the combined amount to exclude, not individual card values — no extra fetch), each row carries `low_liquidity` + the `price_avg`/`price_low` reference prices. **A day-over-day Set Value guardrail** (`guardSetValue`, `SV_MAX_DAILY_JUMP` default 50%) protects that sum: a Set Value is ~250 singles added up, so a large single-day **rise** is almost always a data artefact — one mis-tagged high-value card entering the expansion's singles list (the real case: a promo Gengar ~€2,500 tagged into Cardmarket's Sword & Shield base expansion 5×'d that set overnight, €635 → €3,132). When today's computed Set Value is >`SV_MAX_DAILY_JUMP` above the product's previous tracked value the job **holds the previous value** instead of writing the spike and reports it (`setValueHeld` in the response). It's **one-directional** — a *fall* passes through, because that's how a fixed artefact self-corrects (a down-guard would trap the set at the inflated value). The daily function fetches each product's most recent prior Set Value (a short paginated window) to run it. Its derive math + the guard **mirror `scripts/cardmarket-lib.mjs`** (pinned by `cardmarket-lib.test.mjs`), so they can't drift from the Node path.
  - **Resolve ids — `supabase/functions/cardmarket-resolve-ids/index.ts`** (Deno Edge Function, triggered from Data Entry's **Resolve ids** button, admin-only). For every product missing a `cardmarket_product_id` and/or `cardmarket_expansion_id` it name-matches against the (small) nonsingles catalogue and writes the ids back — **NULLs only**, never overwriting a manual pin — so bulk-adding products never needs a hand-sourced id. Its `norm`/`score`/0.6-threshold matching mirrors `scripts/cardmarket-lib.mjs` (pinned by `cardmarket-lib.test.mjs`).
  - **On-demand catalog refresh — `supabase/functions/cardmarket-catalog-refresh/index.ts`** (Deno Edge Function, triggered from Data Entry's **Sync catalog** button, admin-only — gated server-side by `is_admin()`). It caches, per `products.cardmarket_expansion_id`, the single-card ids that make up Set Value into **`public.cardmarket_expansion_singles`**, so the daily function never loads the huge singles file. It **streams** that file (`streamArray` reads the HTTP body chunk by chunk, one record at a time) so it stays inside the memory limit at any file size, and reports each set's card count + max single price as a contamination guardrail. **It drops any id in `public.cardmarket_excluded_singles` before caching** — the durable cause-fix for a card Cardmarket mis-tags into a tracked expansion but that must never be summed into a Set Value (a promo Gengar, idProduct 895476, ~€2,500, wrongly tagged to the Sword & Shield base expansion 5×'d that set; the exclusion means a re-sync can't re-add it). The admin enters both ids by hand in Data Entry — **CM ID** (`cardmarket_product_id`) and **Exp ID** (`cardmarket_expansion_id`), the `productCmIds` / `productExpIds` buffers saved by `saveToSupabase()`.
  - **Local fallback — `scripts/cardmarket-ingest.mjs`** mirrors both halves on the command line (`--dry-run`, `--backfill-ids`, `--refresh-catalog`, or a direct snapshot) for offline preview / one-offs; production needs no GitHub Action (there is none — the daily job is `pg_cron`, the refresh is the button).
  Schema: `products.cardmarket_product_id` + `products.cardmarket_expansion_id` + `products.cardmarket_promo_product_ids` (`bigint[]`) + `products.price_locked`, `snapshots.low_liquidity` + `snapshots.price_avg`/`price_low` (the guide's avg/low, shown in the Data Entry thin-liquidity review) + `snapshots.promo_value` (the summed daily avg30 of the bundled promo single(s)), the `cardmarket_expansion_singles` cache, and the `cardmarket_excluded_singles` exclusion list (admin-managed, honoured by the catalog refresh) in `supabase/schema.sql`; operator setup (deploy the three functions, click Resolve ids → Sync catalog, schedule `pg_cron`) in `SUPABASE.md`.
  - **Thin-liquidity review + price lock (Data Entry).** A product whose latest snapshot is `low_liquidity` (trend and avg diverge ≥20%) is badged "⚠ thin" with its `auto €trend · avg €… · low €…` spread on the row, and listed in the `#entry-quality` advisory strip (unless already locked). Each row has a **🔒 price-lock toggle** (`.lock-btn`, the `productLocked` buffer → `products.price_locked`): locked → the daily job leaves the price to the admin's manual entry (Set Value still updates). The toggle is buffered like the rest of Data Entry and applied on **Save to cloud**. `productPriceRef` (name → latest snapshot's `{lowLiq, avg, low}`) is read in `loadFromSupabase()`.

Beyond CI, still verify UI changes by hand: serve locally and exercise the tabs in a browser (data auto-load, charts, Portfolio, Data Entry, export).

## Data model — two sources

There are **two** data sources; the workbook wins when it loads:

1. **Hardcoded fallback** in `index.html`: the `products` array, the `historicalData` object, and `histDates`. Used only if the workbook fails to load. Keep them mutually consistent if you touch the sample data.
2. **`pokemon_data.xlsx`** (the real data), auto-loaded by `tryAutoLoad()` and applied via `applyNewData()`. In Supabase mode this is only the offline fallback (loaded if cloud init fails); the drag-drop/browse upload UI has been removed, though `parseXlsx()`/`exportXlsx()` remain for the fallback and for exporting a backup.

The workbook has two required sheets — `Summary` (one row per product) and `Historical Data` (one row per product per snapshot) — plus an optional `Links` sheet (Cardmarket URLs). Exact column names are validated in `parseXlsx()` and documented in the in-app "Format Guide" modal and the README. `exportXlsx()` writes these sheets back out.

**To change the tracked data, edit the workbook — not the HTML.**

### Optional third source — Supabase (cloud sync + auth)

A third, **opt-in** source exists. It is active only when both `window.SUPABASE_CONFIG.url` and `.anonKey` (a `<script>` block near the top of `index.html`) are filled in. While they are blank the app behaves exactly as the static/xlsx version — no login, no new network requests — so the default GitHub Pages deployment is unaffected.

When configured, `boot()` (replacing the old bare `tryAutoLoad()` IIFE) loads the Supabase JS SDK from CDN, gates the UI behind a sign-in overlay (`#auth-overlay`, a direct child of `<body>` so it shows regardless of active tab), and on sign-in calls `loadFromSupabase()`. That function reads the `products`/`snapshots`/`user_settings` tables, **pivots** the normalized snapshot rows back into the aligned `price[]`/`setVal[]`/`promo[]` arrays, and feeds them through the same `applyNewData()` path as the workbook. **The `snapshots` read MUST be paginated** (`fetchAllRows()` → the `allSnapshots()` helper, used by both `loadFromSupabase()` and `loadDemo()`): PostgREST caps a single response at the project's *Max rows* (1000 by default), and the table is well past that, so a plain `select('*')` silently returned a truncated, arbitrarily-ordered subset — dropping many products' most recent daily rows and leaving the short price-change windows (1d/7d) empty. `fetchAllRows()` pages via `.range()` under an explicit total order (`snapshot_date`, `product_id`) until a short page. (The fake SDK's query builder implements `.range()` for the specs; any future large per-user table needs the same treatment.) `saveToSupabase()` (the **☁ Save to cloud** button, `#save-cloud-btn`, shown only when signed in) upserts the Data Entry buffers (`entryData`, `pendingProducts`, `productUrls`, `productCmIds`, `productExpIds` and `productPromoCmIds` — the per-product Cardmarket `idProduct` / `idExpansion` / promo `idProduct`s that drive the automated ingestion, entered in the Data Entry "CM ID", "Exp ID" and "Promo IDs" columns (→ `products.cardmarket_product_id` / `cardmarket_expansion_id` / `cardmarket_promo_product_ids` — the promo column is a comma-separated list of ids, a `bigint[]`) — and `productLocked` → `products.price_locked`, the per-row 🔒 price-lock) plus the age threshold. Product data (`products`/`snapshots`) is a **single shared dataset**: any signed-in user can read all of it, but only the **admin** — the account whose UUID equals `SUPABASE_CONFIG.adminUserId` — may write. `setAuthedUI()` adds `sb-authed` (sign-out + change-password, all signed-in users) to `<html>`, but adds `is-admin` (revealing Data Entry and cloud-save) **only** for the admin. This is UI gating only; the actual write boundary is enforced by the RLS write policies in `supabase/schema.sql` (a `public.is_admin()` function comparing `auth.uid()` to the admin UUID), so a non-admin who forced the UI open still cannot save. `user_settings` and `holdings` stay private per user. A signed-in user can change their password via the header **Change password** button (`#change-pw-btn`), which opens `#account-overlay` and calls `sbClient.auth.updateUser({ password })`. A **non-admin** can also **delete their own account** from the profile menu (`#delete-account-btn`, `.not-admin-only` so it is CSS-hidden for the admin): it opens `#delete-account-overlay`, which enables its destructive confirm only once the user retypes their account email, then invokes the **`supabase/functions/delete-account`** Edge Function and signs out. That function identifies the caller from *their* JWT (never a request body — a user can only delete themselves), **refuses the admin** (`is_admin()` → 403; deleting the admin would cascade-wipe the admin-owned shared `products`/`snapshots`), and otherwise calls `auth.admin.deleteUser`, letting the per-user tables' `on delete cascade` FKs remove all their private rows. The fake SDK grows a `functions.invoke` stub and `tests/signed-in.spec.mjs` pins the confirm-gating, the invoke→sign-out, and the admin-hidden rule.

Any signed-in user (not just the admin) can keep a private **Portfolio** and **Price Alerts**, which live together in their own signed-in-only top-level tab (`#tab-portfolio`, revealed by the `.tab-btn.sb-only[data-tab="portfolio"]` button) — the shared product data plus their own holdings/targets. `loadFromSupabase()` also reads the per-user `holdings` and `alerts` tables into the module-level `holdings` map (name → `{ quantity, costBasis }`) and `alerts` map (name → the user's buy target, of **two kinds**: `fixed`, a euro `target_price`; or `fair`, a `below_pct` meaning "≥ N% under the fair price"). `renderPortfolio()` renders holdings as a **responsive card grid** (`#portfolio-cards`, `holdingCard()`) — 1-up on a phone, `auto-fill minmax(280px)` on wider screens — replacing the old 9-column table that forced a sideways swipe on mobile and buried the value/P&L mid-row. Each `.holding-card` carries the same figures (name — a `.row-open` button opening the drill-down — + `typeBadge`, **Value** as the hero figure, coloured **P&L** + %, `qty × now · cost/u`, edit/remove) plus a **fair-price chip** (`under/over fair`, shown only when `fairPriceTrusted()` — a chip on an ignored fair price would mislead). **When a portfolio holds more than `MOST_VALUABLE_N` (4) products the Holdings list defaults to a condensed "Most Valuable" list** (`mostValuableList()`, state `portfolioShowAll`, `.mv-list`/`.mv-row`) — the top 4 by current value (rows are value-sorted), each a `.row-open` drill-down row showing name · `typeLabel` · value · coloured P&L% — so a big portfolio doesn't push Concentration / Alerts / Transaction Log off-screen. A `.board-more-btn` footer toggle ("View all N holdings" ⇄ "Show most valuable only") flips `portfolioShowAll` and re-renders to the full `holdingCard()` grid; with ≤4 holdings the condensed and full lists would be equivalent, so it renders the grid directly. `.holding-grid.mv-collapsed` switches the grid to a block list for the condensed layout. It derives unrealised P&L = (latest price − cost basis) × quantity, and shows the basket's **trailing 1d / 7d / 30d value change** as a sub-line on the *Current value* summary tile (the per-holding card carries the same 1d/7d/30d strip) — the pure `portfolioValueChange(holdings, historicalData, histDates)` values the current holdings at every snapshot (`portfolioValueSeries`) and applies the same date-windowed rule as the Momentum table (`pctChangeOverDays`), so it survives the mixed monthly/daily cadence and is `—` until a window is covered (the 1d window needs the two latest daily snapshots, which is why the **snapshots load must be complete** — see the pagination note below); the %s are FX-neutral; `renderAlerts()` flags a product as triggered when its latest price is at or under the target — the euro figure for `fixed`, the recomputed fair-price threshold for `fair` — and `alertFlag()` surfaces a 🔔 on the Analysis All Products board via `updateTable()`. Fair alerts move as the age fit moves, which is why they are evaluated in-browser: the server-side email job (`supabase/alert-emails.sql`) can only cover `fixed` targets. Both render functions are wired into `INIT` and `applyNewData()`. The Portfolio tab also carries a **concentration balancer** (`renderBalancer()`, called from `renderPortfolio()`): it groups current holding value by set / release-year / product-type via the pure `concentrationShares()` in `metrics.js`, flags over-exposure (≥ `OVER_EXPOSED_SHARE`), and lists fair-price-aware rebalance buys — under-fair-price products in sets/types you underweight — via `rebalanceSuggestions()`. **Each concentration group leads with its top `CONC_TOP_N` (4) buckets by value** (`concentrationShares()` sorts by value, so any over-exposed bucket — always among the highest-share — stays visible) and a per-group `.board-more-btn`/`.conc-more` "Show all N ⇄ Show top 4" toggle (state `balancerShowAll = {set,era,type}`, re-renders via `renderBalancer()`) — so a portfolio spread across many sets/years doesn't turn the section into a long scroll. The rebalance shortlist is already capped (`limit: 5`). A **value-over-time** chart (`renderPortfolioValueChart()`, pure `portfolioValueSeries()`) plots the current holdings valued at every snapshot against the flat cost basis. All derived client-side; no new stored data. A **global display currency** (`displayCurrency`; € is canonical and the only *stored* unit) converts **every price on the page** at render time via `money()` and a single live FX rate fetched once from a key-less API (`fetchFxRates()`); the choice persists in `user_settings.currency` (`persistCurrency()`, per-user RLS, read in `loadFromSupabase()`). The picker lives in the page **header** (`#display-currency`), not the Portfolio tab, and drives the board, the Where-to-start shortlist, momentum, the drill-down (stats, scenario sliders, price-history chart), the §05 Price-History comparison, and the Portfolio tab alike. **Only absolute-money figures convert** (price, fair price, per-booster price, set value, P&L, alert targets); the ranking metrics — **SV/Booster and Wtd. Score** — are ratios of two € amounts, so a positive FX rate cancels out of them and they (and the scatter / SV-trend / Relative-Value views) are left untouched, staying comparable across users. **Everything the user *types* stays €** — Data Entry, the portfolio cost basis, and the fixed alert target are canonical-€ inputs (their placeholders still say €); conversion is display-only. Two formatters split the work: `money(vEur, dec)` takes a € amount and converts+labels it (the everywhere formatter for values read from the € data model); `symFmt(n, dec)` labels an *already-converted* number and is used in chart axes/tooltips, where Chart.js hands back values already in display-currency space (the plotted data is converted in the dataset builders, keyed on `fxRate()`). A currency switch calls `renderCurrencySensitive()`, which re-renders only the money-bearing views. **The picker only ever offers € plus the currencies it holds a live rate for**, so a €-only picker always means the FX fetch failed, never a missing feature: `FX_ENDPOINTS` tries Frankfurter's current host (`api.frankfurter.dev/v1/latest?base=…&symbols=…`) then the legacy one (`api.frankfurter.app/latest?from=…&to=…` — the two hosts spell the parameters differently, and on the new API `from`/`to` mean a *date range*, so the URLs are not interchangeable). If both fail the app stays in €, but says so: a `#fx-note` line next to the picker, a `console.warn`, and a `reportClientError()` beacon. Silently swallowing that failure was a real reported bug; `tests/fx-currency.spec.mjs` pins all three outcomes. The portfolio editor supports **buy-more** (adds quantity and blends cost basis to a weighted average via `commitHolding()`) and **edit-in-place** (`startPortfolioEdit()` overrides exact values). Its product picker is a **searchable typeahead** — an `<input id="portfolio-product-select" list="portfolio-product-options">` over a `<datalist>` (`populatePortfolioSelect()` fills the options, `.pe-holdings` styles the compact one-row editor), not a scroll-through `<select>`, since the catalogue is long; `commitHolding()` validates the typed name against `analysisProducts()` (a free-text miss is rejected with "Pick a product from the list."). The quantity field is a 3-digit numeric text input (`maxlength=3`, `inputmode=numeric`), sized small on purpose. **The Price Alerts editor uses the same `.pe-holdings` compact, searchable layout** — `#alert-product-select` is now the same `<input list="alert-product-options">` typeahead (`populateAlertSelect()` fills the datalist, `addOrUpdateAlert()` validates the typed name the same way), with the alert-type `<select>` (`.pe-atype`) and the target beside it. **The summary/holding/drill-down labels spell out "Profit & Loss"** (not the "P&L" abbreviation); `money()`-based figures and the €-typed inputs are unchanged. There are **no Save buttons** — every add/edit/remove auto-saves a single row (`persistHolding`/`deleteHoldingRow`, `persistAlert`/`deleteAlertRow`: `upsert` on `onConflict: 'user_id,product_id'`, `delete` on removal), with feedback in the tab's own `#portfolio-status`. RLS scopes every row to `auth.uid()`; both maps reset on sign-out.

The portfolio also tracks the **closed side** — realised P&L. A **Sell** button on each holding card (`startPortfolioSell()`) reuses the same editor DOM in *sell mode* (the cost field is relabelled to the sale price); `commitSale()` records a disposal at the holding's current weighted-average cost basis, then draws the holding down — removing it when fully sold — with the remainder's cost basis unchanged (a partial sale doesn't move the average). Sales are an **append-only** per-user `sales` table (no `unique(user_id, product_id)` — a product can be sold many times; each row is a distinct disposal with a client-generated `id`, so `deleteSaleRow(id)` removes just that one). The module-level **`sales`** array (loaded by `loadFromSupabase()` — a **defensive** read, so an older deployment without the table just leaves the list empty, never throwing) feeds the pure **`realisedPnL(sales)`** in `metrics.js` (→ `{ realised, proceeds, cost, units }`, canonical €), which drives a **Realised Profit & Loss** summary tile (a permanent tile — shown whenever the summary is, i.e. any holdings or sales, reading €0 / "no sales yet" until the first disposal). **There is no separate "Closed Positions" list** — it was removed as redundant with the Transaction Log, whose **sell** lines already carry each disposal's realised P&L (`buildLedger` maps every `sales` row to a `kind:'sell'` ledger line); the closed side is now the tile (the lifetime total) plus those sell lines (per-disposal). Currency-correct like the rest (only €-absolute figures convert). `sales` resets on sign-out.

The **Transaction Log** section (`#tab-portfolio`, kept **last** on the tab — it's the append-only record, read occasionally, so it sits below the live positions/alerts) is the **full buy/sell ledger**. It's **condensed to the most recent `LEDGER_TOP_N` (5)** rows by default with a `.board-more-btn` **"View all N transactions" ⇄ "Show recent 5"** toggle (module state `ledgerShowAll`; the footer button is a `<tr class="ledger-more-row">` inside `#ledger-tbody`, the same collapse pattern as Holdings' Most-Valuable list and the Concentration groups), so a long history doesn't dominate the bottom of the tab. Its buy half needed its own store: `holdings` keeps only the *current aggregate* per product (quantity + a blended weighted-average cost), so `commitHolding()`'s blend **loses the individual purchase events**. A per-user **append-only `purchases`** table (mirroring `sales` — no `unique(user_id, product_id)`, a client-generated `id`, RLS-scoped) records each **buy** as its own row: `commitHolding()`'s buy-more path pushes to the module-level **`purchases`** array and `persistPurchase()`, while **edit-in-place** (a *correction*, not an event) deliberately does **not** append — so **`holdings` stays the source of truth** for the current position / unrealised P&L and the log is an event record beside it (the accepted boundary of the parallel-log model). `loadFromSupabase()` reads `purchases` **defensively** (older deployment without the table → empty) and, for any current holding with **no** purchase row (a position that predates the log), synthesises **one `opening` reconstruction row** (full current qty × blended cost, dated the holding's `created_at`) — display-only, never persisted, not individually removable (removing would desync from the holding). The pure **`buildLedger(purchases, sales, latestByName)`** in `metrics.js` merges both into one newest-first history, each line carrying its P&L — a **sell** shows *realised* `(salePrice − costBasis) × qty`, a **buy** shows *unrealised* mark-to-market `(latest − unitPrice) × qty` (null when the latest price is unknown); `renderLedger()` (`#ledger-tbody`) renders it (Date · Product · Type · Qty · Unit price · P&L) and `exportLedgerCsv()` offers the whole ledger as a `text/csv` download (canonical €, one row per transaction — the same client-side one-function pattern as the xlsx export). Currency-correct (only €-absolute figures convert); `purchases` resets on sign-out. Schema/RLS: `public.purchases` + the "own purchases" policy in `supabase/schema.sql`; the fake SDK serves `purchases` and `tests/signed-in.spec.mjs` pins the buy → purchase-insert payload, the ledger render (buy line + the opening row), and the condensed-to-5 / "View all" expand toggle.

Logged-out visitors see a **pre-login demo** (`#demo-page`, a `<body>` child shown by `setAuthedUI(null)` instead of a hard login gate). `loadDemo()` queries products/snapshots as the anonymous role — RLS `"demo read …"` policies expose only the rows in the 3 newest release dates (via the `public.demo_product_ids()` SECURITY DEFINER function) — then derives metrics with the shared `deriveProducts()` and renders read-only panels grouped by set (`renderDemo()`/`demoSetName()`). A **Sign in** button opens `#auth-overlay` (now dismissible via `#auth-close`); the full catalogue still requires login. See *The pitch lives once* below for what that page is and what it deliberately withholds.

Runtime errors are reported to an insert-only **`client_errors`** table (error monitoring): an early inline script near the top of `index.html` buffers `window.onerror`/`unhandledrejection` events from the first script tick, and the module drains the buffer via `reportClientError()`/`initErrorReporting()` once `sbClient` exists — deduped, capped at 10/session, fire-and-forget, a no-op in static mode. Anyone may insert (RLS blocks spoofing another `user_id`), only the admin may read; an optional daily `pg_cron` + Resend digest (`supabase/error-digest.sql`) emails a grouped summary and stays silent when the table is clean.

**Privacy-friendly analytics (G4.4)** are self-rolled on the same insert-only beacon pattern — no third-party script, no cookie. `recordView(view)` inserts an **anonymous** row into the insert-only **`page_views`** table (`{ view, created_at }` — *no* user id, IP, referrer or user agent), **once per surface per session** (a module-level `viewsRecorded` Set), fire-and-forget and a no-op in static mode. It fires from `activateTab()` (the tab name) and `loadDemo()` (`'demo'`). RLS: anon + authenticated may insert (`with check (true)`), only the admin may `select`, immutable via the API (no update/delete). Because it stores no personal data it needs no consent banner (disclosed in the Privacy dialog). Included in both backup paths (`ALL_TABLES`, `downloadFullBackup()`).

A **news feed** (Pokémon TCG — priority — plus TCG investing and Pokémon-business/owner-company headlines) is an opt-in companion. Browsers can't fetch third-party RSS (no CORS), so ingestion is server-side, mirroring the Cardmarket split: **`pg_cron` (hourly) → the `news-fetch` Edge Function** (`supabase/functions/news-fetch/index.ts`, scheduled by `supabase/news-cron.sql`) fetches the feeds, parses RSS **and** Atom, keyword-filters (broad sources only), dedupes by normalised URL, and upserts into the **`news`** table. Its parse/relevance/dedupe logic **mirrors the pure `scripts/news-lib.mjs`** (pinned by `tests/unit/news-lib.test.mjs`), and `scripts/news-fetch.mjs` is the Node CLI mirror for previewing feeds off-cloud. `news` is **public-read** (anon + authenticated), **service-role-write only** (no client write policy). Only **headline + link + source + timestamp** is stored, never article bodies. The v1 sources (`NEWS_SOURCES`): **PokéBeach** (TCG — the dedicated TCG news site via a **GitHub Pages mirror** `feed.xml`, static-hosted so no datacenter 503 / UA sensitivity; the reliable non-Google primary; with a Google News `"Pokemon TCG"` query as a same-category safety net), **r/PokeInvesting** (investing), and a **Google News** Pokémon-business query (business — broad Pokémon/TPC/Nintendo terms, not earnings-only, since earnings news is rarely fresh; every clause names Pokémon so it stays on-topic despite `scoped:true`). The **User-Agent is per-source** (`ua`, default a browser string): Reddit needs the descriptive bot UA (it 429s browser agents) while Google News needs a browser UA (it 503s bot agents from datacenter IPs) — the fix for the "Google News HTTP 503 from Edge" symptom. Client side: `loadNews()` reads the table in `loadFromSupabase()` (signed-in) — **not** on the logged-out demo, which no longer lists news (it teases News as one of the "What a free account unlocks" tiles instead); `renderNews()` fills the grouped list into the **News tab** pane's `.news-full` (`#tab-news`, its own top-level tab between Welcome and Analysis) and reveals the **`#tabbtn-news`** tab once rows load. External feed text is escaped (`escHtml`) and links are `http(s)`-guarded (`safeUrl`) + `target=_blank rel=noopener`, since titles/URLs are untrusted. The **News tab** stays `hidden` until the table returns rows (static/xlsx builds have none, so no dead tab; the arrow-key nav already skips a hidden tab via its `offsetParent` test). (The old demo-only `#news-modal` + `.news-teaser` and the header `#news-btn` were removed — News is the tab only.) `tests/fake-supabase-sdk.js` serves `news` rows (public-read) and `tests/signed-in.spec.mjs` pins the signed-in News tab → grouped list → safe-link flow. Operator setup (run `schema.sql`, deploy the function, schedule the cron) is in `SUPABASE.md`.

**`histDates` is chronological (ascending) in every loader** — `latest = last index`, `snapshotGaps()`, the date-windowed momentum (`pctChangeOverDays`), and the time-axis charts all assume it. The hardcoded fallback is authored sorted and the Supabase loader `.sort()`s its distinct snapshot dates; **`parseXlsx()` sorts `dateSet` too** (ISO `YYYY-MM-DD` → lexicographic = chronological) rather than trusting the workbook's row order — a workbook with rows out of date order used to leave `historicalData[*]` arrays aligned to a non-chronological axis (the category chart hid it by drawing in array order; a real time axis drew it as a zig-zag).

Only **raw** inputs are stored in the DB (name/type/release/url + per-snapshot price/set-value + age threshold); derived metrics are recomputed client-side. Metric derivation is shared by both the xlsx and Supabase paths via the **`deriveProducts(newProducts, newHistoricalData)`** helper (and `boostersFromType()`), so the two loaders can never drift. These pure functions live in the standalone ES module **`metrics.js`**, imported by `index.html` (its main `<script type="module">`) and by the unit tests — one source of truth, no copy. Schema + RLS live in `supabase/schema.sql`; setup is documented in `SUPABASE.md`.

## Metrics & scoring (the analytical core)

The pure math lives in **`metrics.js`** (imported by `index.html` and unit-tested in `tests/unit/`). The functions take every dependency as a parameter — no DOM, no app globals — so `index.html` passes its live state (`products`, `ageThreshold`) in at each call site. Change a formula or constant *here*, once.

- Boosters per product type: **BOX = 36, ETB = 9, BUNDLE = 6**, plus the pack-count variants **ETB10 = 10, ETB8 = 8, BUNDLEDISPLAY = 60, PACK = 1** — all read from the **`PRODUCT_TYPES`** registry in `metrics.js` (`boostersFromType()`). A new product form is a registry entry (booster count + `category`), not a code change scattered across the app. **`COLLECTION` is the exception to the fixed-count rule** — a Premium/Special Collection ships a *varying* number of packs, so its count is **per-product**: a product's own `packs` field overrides the type default via **`resolveBoosters(product)`** (used by `deriveProducts()` and the `recomputeFit()` fallback, and mirrored in `scripts/validate-workbook.mjs`). `boostersFromType('COLLECTION')` returns a fallback default (4) only; the real value comes from `packs`. The `packs` override works for any type (a harmless manual correction) but only COLLECTION *requires* it. `typeCategory()` maps each type to its filter/colour **bucket** (`BOX`/`ETB`/`BUNDLE`/`COLLECTION`/`PACK`) — the ETB variants group under ETB, the Bundle variants under BUNDLE, COLLECTION is its own bucket (purple `--accent5`/`COLOR.purple`) — and `typeLabel()` gives the short badge text. Filtering and per-type chart colour always go through `typeCategory(p.type)`, never a raw `p.type` compare; `index.html`'s `typeBadge()` / `CATEGORY_COLOR` are the single render helpers.
- **Price / Booster** = (price − promo) ÷ boosters. A **promo card** bundled into a product (an ETB's stamped promo, say) isn't part of the set's singles, so its value inflates the price against the boosters it's judged on — and a promo card has its own *moving* market price, so it is **tracked per snapshot, not typed once**. The admin enters the promo single's Cardmarket id — or a **comma-separated list of ids** when a product bundles more than one promo (`products.cardmarket_promo_product_ids`, a `bigint[]`, the Data Entry "Promo IDs" column); the daily ingestion job fetches each card's **avg30** (the same basis as Set Value) and writes their **sum** into **`snapshots.promo_value`** (a single scalar — we track only the combined amount to exclude, not per-card values), which the loaders pivot into a `hist.promo[]` series (the workbook mirrors it as an optional per-snapshot `Promo Value (€)` column in *Historical Data*). `deriveProducts()` takes the **latest** non-null promo from that series and **subtracts it from price for the pack economics**. `appliedPromo(promoValue, price)` in `metrics.js` normalises it to `[0, price)` so a bad/oversized value can never zero the boosters; `p.price` stays the full price (portfolio/alerts/display) and `p.promoValue` holds the applied latest promo. `fairPrice()` inverts the ex-promo fit then **adds the promo back**, so the fair price stays comparable to the full live price (a fairly-priced product reads gap 0). **SV / Booster** = Set Value ÷ (Price/Booster) — the core value-density metric (higher is better), on the ex-promo basis. *(This replaced the old static `products.promo_value`, which went stale as the promo card's price moved.)*
- **Age Weight** = `calcAgeWeight(age, ageThreshold)`, a 0–1 penalty for products younger than `ageThreshold` (default **1 year**; slider range 0.5–3).
- **Wtd. Score** = SV/Booster × Age Weight — the primary ranking metric.

`recomputeScores(products, ageThreshold)` recomputes each product's `ageWeight` and `score` from the current `ageThreshold`, and **must run before the first render** in both the `INIT` block and `applyNewData()` — otherwise the initial view uses the scores baked into the source data (this was a real, fixed bug). `svPerBooster` is threshold-independent.

**Buy / sell momentum flags** — two mirror signals off the last two tracked snapshots, both pure in `metrics.js`. `buySignal(hist)` (the 💰 board flag, `i-deal`, gold `.buy-flag`) fires when price dropped ≥5% while set value held (a possible mispricing *down*). `sellSignal(hist)` (the sell-caution flag, `i-trend-up`, red `.sell-flag`, `isSellSignal()` also requires `!buySignal`) is the exact inverse — price **rose** ≥5% while set value did **not** follow (an un-backed run-up, a possible mispricing *up*). Both are momentum-only and make **no fair-price claim**, so they stay honest when the fit is weak/suppressed — the sell-side mirror of the buy signal's honesty rule. The "meaningfully over fair price" sell case is already carried by the **verdict** (tone `bad` → "Over fair price" / "Overpriced for age"); `sellSignal` covers the run-up the verdict can't see. `verdict()` takes an optional `runUp` flag (default false, so existing callers are unchanged) that adds an "un-backed run-up" clause to a `bad` verdict, or surfaces a neutral "Un-backed run-up" label when there's no trusted fair anchor. The drill-down's `renderDrillIngredients()` shows a "Momentum signal" line only when one of the two fires.

`metrics.js` also carries the **data-quality guards** — `snapshotGaps()` (skipped months in the snapshot cadence) and `typeOutliers()` (same-set SV/Booster consistency; a product far off its release siblings likely has the wrong Type). They surface as an advisory strip above the Data Entry table (`renderEntryQuality()`, `#entry-quality`) and as non-blocking warnings in `scripts/validate-workbook.mjs` — advisory in both places, never blocking.

## UI architecture

Five tabs (Welcome / News / Analysis / Portfolio / Data Entry) are `.tab-pane`s toggled by `.tab-btn[data-tab]` — News (revealed by `renderNews()` once the `news` table returns rows, via the `hidden` attribute), Portfolio (`.sb-only`, signed-in) and Data Entry (`.admin-only`) are conditionally shown. The Analysis tab opens with the unnumbered **Where to start** shortlist (see below), then a single vertically-stacked column of full-width sections, each introduced by a numbered `.section-eyebrow` (01–04) — on-screen title first, internal name second: **01 The Board** (one table, three lenses — see *The board is one panel with three lenses* below), **02 Age vs Value** (the scatter, with a fitted "expected value for age" line), **03 Price History**, **04 Trend Over Time**. What used to be three more sections — Relative Value and Momentum & Drawdown (now **lenses of §01 The Board**) and a "Value Per Booster" Top-10 bar chart (**retired** — redundant with the Where-to-start *Best value* lens, the Board's SV/Booster sort, and the §02 scatter, which plots the same metric against age) — are gone. The **What If / Scenario Explorer** is no longer a tab section either — it lives inside the product drill-down (see below), always scoped to the product on screen. The Portfolio tab has its own sections: **Your Portfolio** (the overview — the summary tiles `#portfolio-summary` and the value-over-time chart `#portfolio-value-chart` together at the top, the headline numbers beside the trajectory that plots them), **Holdings** (the add/buy editor + the `#portfolio-cards` grid), **Concentration & Rebalance**, **Price Alerts**, and last **Transaction Log** (the full buy/sell ledger — `#ledger-tbody`, `renderLedger()`; kept at the bottom as the occasional-reference record, condensed to the most recent `LEDGER_TOP_N` (5) with a `.board-more-btn` "View all" toggle on `ledgerShowAll`, like the Holdings and Concentration collapses). (The summary and value chart used to be in separate sections with the holdings editor wedged between them; they were merged into one top overview panel so the numbers and their trend read together.)

Rendering follows a **state + render-function** pattern: module-level state (`activeType` — the global type filter, a *category* (`BOX`/`ETB`/`BUNDLE`/`PACK`, or `ALL`) so an ETB pill scopes to every ETB variant, `sortKey`, `ageThreshold`, …) plus render functions (`updateTable`, `updateKPIs`, `renderOverview`, `renderScatterChart`, `renderRelativeValue`, `renderMomentum`, `initScenario`, …). Chart.js instances live in module-level vars and are **destroyed and recreated** on each re-render. Any new render function must be wired into both `INIT` and `applyNewData()` so it runs on first load and after a data file loads. The Price History (§03) and SV/Booster Trend (§04) comparison views are built by a shared `createCompareView()` controller (instances `cmpHist`/`cmpSvb`) — a **Products ⇄ Sets ⇄ Eras** mode toggle, a capped multi-series picker (chips + a legend that toggles series). **Set and Era are both roll-up modes** (`mode !== 'product'`): a selection's line is `meanSeries()` over its members, so one line per set (`groupSets()`) or per era (`groupEras()` via `eraForRelease`, newest era first) — the catalogue-scale navigation view the collapsed tree can't give as a *chart*. Product mode is the leaf line (and the only one with the single-product Set-Value overlay), and in Product mode the selection **is the shared cross-filter** `selectedProducts` (see below), so both charts always plot the same products. Each instance is `init()`ed in `INIT` and `refresh()`ed in `applyNewData()` and on type-filter change; `syncSelection()` re-pulls the shared selection. *(Only **era** exists as a chart *scope filter*; see `activeEra` below.)* `activeType` scopes the board plus every analytical chart/comparison view via the `visibleProducts()` helper (`applyTypeFilter()`). **`activeEra`** is a **second global scope axis** beside it — an `ERAS` key (or `ALL`) from the `#era-filter` dropdown (`populateEraFilter()` fills it from the eras present in the data, newest first) — also applied in `visibleProducts()`, so "only Scarlet & Violet" narrows the board, scatter, overview, momentum/relative lenses and comparison views alike. `getFiltered()` (the board's Value lens) now starts from `visibleProducts()` so the board shares that exact type+era scope. The era filter deliberately does **not** touch the age-fit (fair prices stay computed over the whole `analysisProducts()` catalogue — scoping the *display* never moves a fair price) nor the Welcome KPI strip (a dataset teaser). Its change handler re-runs `applyTypeFilter()`. **`visibleProducts()` now applies more than type+era** — every scope facet (type, era, **set** `activeSet`, **price range** `priceMin`/`priceMax`, **age range** `ageMin`/`ageMax`) flows through a single `passesScope(p, skip)` predicate; see *Faceted filtering* below. The board is also **Top-N by default** (`boardShowAll`/`renderBoardList`), and `applyTypeFilter()` calls `refreshFacetCounts()` first so the live facet counts follow every change.

**Cross-filtering — one shared product selection drives every chart (PowerBI-style).** A `.sel-check` checkbox on **every board row** (all three lenses — `selCheckbox()` inside `.pn-head`, a custom `appearance:none` box sized to a 24×24 hit target for WCAG 2.5.8) toggles a product in the module-level **`selectedProducts`** `Set`, the single source of truth for the selection. Every mutation goes through **`toggleSelection()`** (or `clearSelection()`), then **`refreshSelectionViews()`** re-syncs all surfaces in one place: the row checkboxes (`syncSelectionCheckboxes()`), **both comparison charts** (their Product mode reads `selectedProducts` via `syncSelection()`/`pullSharedSel()` — so ticking a row adds a line to *both* §03 and §04 at once), and the **§02 scatter cross-highlight** (`renderScatterChart()` lights the selected points and dims the rest — a highlight, not a filter, so the age-fit line keeps its whole-catalogue context). The chart pickers edit the *same* set (the add-dropdown → `toggleSelection`, a chip's ✕ → remove), so the board checkboxes and the chart chips are two views of one selection. It's **capped at `COMPARE_CAP` (6)** — the palette length — so the selection can never exceed what the charts can legibly draw (a 7th tick is refused with a `flashSelectionNote()`); the `#chart-selection` bar in the filter row shows the count + a **Clear**. Session-only and **starts empty** — no product is pre-marked on first paint, so the board shows no pre-ticked row, the scatter no cross-highlight, and both comparison charts their "No products selected — tick a board row…" empty state until the user picks one; `pruneSelection()` drops names no longer in the data. (An earlier `seedSelectionIfEmpty()` that pre-selected a default product was removed — the clean, unhighlighted default is deliberate.) The delegated `change` listener on `.sel-check` survives every board re-render. Set/Era roll-up modes keep their own per-chart selection (a row checkbox can't express a roll-up).

### Loose packs are reference, not ranked

Loose single boosters are tracked per set as **`PACK`** products (one per set,
Cardmarket-ingested like everything else — see the DB, ~32 of them), but they are
deliberately kept **out of the analysis**. A loose pack carries none of a sealed
box's premium, so on **SV/Booster** it beats every box and would always top the
rankings ("always the recommended purchase") — a real concern that motivated this.
So every analytical pool derives from **`analysisProducts()`** (`products` minus
the `PACK` category): the board (`getFiltered()`), the charts/overview/relval/
momentum/comparison (`visibleProducts()`), `updateKPIs()`, the Where-to-start
shortlist, the
age fit (`recomputeFit()` — packs would wreck the fit, so they get no fair
price/verdict stamped), the `kpi-total` count, the rebalance shortlist, the alert
and portfolio product pickers, and the demo. The board's **Single Pack** filter
pill was removed with them. Packs stay in `products`/`historicalData` (so they
round-trip through the same load/save path and appear in Data Entry for
management), and they surface in exactly one place: **`loosePackFor(p)`** finds the
`PACK` of a sealed product's set (by `setLogoKey()` — the SKU suffix stripped, so
twin sets like Black Bolt / White Flare stay distinct) and `renderDrill()` shows
its latest price as a **Loose pack price** stat tile (with the per-booster
sealed-vs-loose %), plus a **Sealed premium** tile — the absolute € a buyer pays
to go sealed vs the same booster count bought loose (`price − loose × boosters`;
negative = sealed cheaper than the loose equivalent, highlighted green). The
drill-down **price chart** also overlays a dashed **Loose equivalent (N×)** line —
the loose pack's own price history × boosters, on the same € axis as the sealed
Price, so the gap between the two lines is the sealed premium over time (it fills
in as the pack accrues daily snapshots). Reference only — never a ranked buy.
Nothing in `metrics.js` changed; the exclusion is purely presentational.

### Accessibility structure (don't undo it)

The July 2026 conformance pass made the page operable without a mouse; the
pieces are load-bearing and `tests/a11y.spec.mjs` fails if they are removed:

- **The tab bar is an ARIA tablist.** `.tab-bar` carries `role="tablist"`, each
  button `role="tab"` + `aria-selected` + `aria-controls`, each pane
  `role="tabpanel"`. `activateTab()` maintains a **roving tabindex** (only the
  selected tab is a tab stop; ←/→/Home/End move between the *visible* ones).
  The wiring is scoped to **`.tab-bar .tab-btn`** on purpose: two CTA buttons on
  the Welcome tab reuse `.tab-btn` for styling, have no `data-tab`, and merely
  forward a click — the old unscoped listener threw on them and blanked the tab
  state.
- **Account actions live in a profile menu** (`#profile-btn` → `#profile-menu`),
  not spread across the header — the signed-in email + *Change password* +
  *Sign out* row overflowed a phone (clipped off the right edge). The trigger is
  now an **icon-only** button (`.icon-btn`, the `#i-user` glyph, `aria-label`
  "Account menu"), sitting in a compact `.header-controls` row beside the
  **symbol-only currency picker** (`#display-currency` shows just `€`/`$`/`£`/`kr`
  — `populateCurrencySelect()` sets the option text to the symbol; the select's
  `aria-label` carries the meaning). It's a
  **disclosure, not a modal**: `wireProfileMenu()` (inside `wireAuthControls()`)
  toggles `aria-expanded`, moves focus into the menu on open, and closes on
  Escape (focus returns to the trigger) / an outside click / choosing an item.
  The email span and both action buttons keep their ids (`#auth-user-email`,
  `#change-pw-btn`, `#auth-signout-btn`), so their existing wiring is untouched.
  **Load-bearing z-index:** `.fade-in` ends on `transform: translateY(0)` (fill
  `both`), so the header is a persistent stacking context; it carries
  `z-index: 60` **so the menu can drop over the sticky `.tab-bar` (z-index 50)**
  instead of painting behind it. Don't remove it. `tests/signed-in.spec.mjs`
  pins the open/close/focus behaviour and that the phone header no longer scrolls
  sideways.
- **Board rows open the drill-down from a real `<button>`** (`.row-open`, wrapped
  in `.pn-head` inside the product-name cell), not from `tabindex` on the `<tr>`:
  `role="button"` on a row would strip the table's row semantics. The row's own
  click handler stays for the mouse; the button's handler calls
  `stopPropagation()` so the drill-down isn't built twice. `.pn-head` is a
  nowrap flex line with `min-width: 0` — without it the cell's `text-overflow`
  cannot ellipsis *part* of an inline-block, and a long name beside a buy/alert flag
  disappears entirely.
- **The drill-down opens from every product surface, not just the board.** The
  Where-to-start shortlist builds the same `.row-open` button; the board's
  Relative and Momentum lenses do too (whole row clickable
  + the named button as the keyboard target, `#relval-tbody`/`#momentum-tbody`
  carry `cursor: pointer`); the Age-vs-Value scatter (§03) opens a point's
  product via Chart.js `onClick`/`onHover` (the age-fit line's points carry no
  `name`, so the line is inert). Any new product listing should keep this — open
  `openDrill(name)` from a real control.
- **`openDrill()` shows the overlay *before* it builds the body.** Order matters:
  it sets `#drill-title` (the accessible name focus lands on), calls
  `openOverlay('drill-modal')`, then `renderDrill()`. The two `responsive`
  Chart.js canvases must be created against a *visible* container — one built
  while the dialog is still `display:none` measures 0×0, and from some entry
  points (opening off the scatter's own canvas click) never gets a resize
  callback, so it renders blank. Rendering after the overlay is visible sizes
  every chart. Don't move the render back ahead of the open.
- **The drill-down header is an always-on set-identity block (`#drill-identity`),
  with the set logo (TCGdex) as a best-effort upgrade.** `renderDrillIdentity(p)`
  (formerly `renderDrillLogo`) *always* renders a designed identity — a
  category-tinted left accent (`categoryColor(p.type)`, set inline exactly as
  `.drill-verdict` sets its tone colour), the **set name** as a mono label
  (`#drill-set-name`), and the **type badge** (`#drill-type-badge`, via
  `typeBadge()`) — so a product is **never a blank title** and the block carries
  **zero third-party-image rights** (Phase 0 of the sealed-photos item — see
  `docs/sealed-product-photos-research.md`). The **logo swaps in over the
  set-name text** only when it loads: `ensureSetLogos()` fetches
  `api.tcgdex.net/v2/en/sets` once per session (lazily, on the first drill-down),
  caches a normalised `set name → logo base URL` map, and swallows every failure;
  the set name is derived from the **product's own name** (`setLogoKey()` strips
  the SKU suffix — *not* a release-date grouping, which would merge twin sets
  sharing a date like **Black Bolt / White Flare** into one mislabelled group
  matching no logo). `#drill-logo`'s `src` is set to `base + '.png'` and un-hidden
  only on `onload` (which also hides the set-name text) — guarded on
  `drillProduct` so a late fetch can't paint onto another product. A set whose app
  name differs from TCGdex's (or that TCGdex hasn't added yet) is pinned in
  **`SET_LOGO_ALIASES`** (normalised app name → normalised TCGdex name) — the one
  place to fix a future mismatch. Any miss (offline, blocked, CORS, unmatched set,
  404) leaves the **set-name text identity** as the fallback — **never a broken
  image**. Logos are **hotlinked, not re-hosted** (a deliberate licensing choice);
  the footer carries the non-affiliation + TCGdex attribution notice. Tests stub
  `api.tcgdex.net` → `[]` in `tests/local-cdn.mjs` (hermetic; the smoke spec pins
  `#drill-logo` hidden **and** the set-name + type badge visible). Sealed-product
  *photos* (a real box photo, Phase 1) remain unbuilt — no source cleanly licenses
  the images for commercial redisplay, so the path is a self-hosted, admin-uploaded
  photo per product (see `docs/sealed-product-photos-research.md` and
  `IMPLEMENTATION.md` #9).
- **The What-If sandbox lives in the drill-down**, always scoped to the product
  on screen — it is *not* an Analysis section. The markup (same ids: `sv-slider`,
  `price-slider`, `out-svb`/`out-score`/`out-signal`, `scenario-reset`, …) sits
  in a `.modal-section` of `#drill-modal`; `renderDrill()` sets `scenarioProduct
  = p.name` then calls `initScenario()`. There is no product picker (the old
  `#scenario-product-select` and `populateScenarioSelect()` are gone). The
  `scenarioOutcome()` math in `metrics.js` is unchanged.
- **The dialog's `.modal` is its own compositing layer (`transform:
  translateZ(0)`).** The overlay behind it is `backdrop-filter`-blurred; without
  the layer promotion the blurred backdrop re-samples on every scroll frame of
  the scrollable `.modal`, which reads as the background flickering while you
  scroll inside the dialog. Don't remove it.
- **Every `.modal-overlay` is a real dialog.** Markup carries
  `role="dialog"`/`aria-modal`/`aria-labelledby`; behaviour comes from the shared
  `openOverlay(id, focusSelector)` / `closeOverlay(id)` helpers plus one global
  keydown handler that traps Tab in the topmost open overlay and dismisses it on
  Escape. `OVERLAY_CLOSERS` maps an overlay to a closer that does more than drop
  the class (the drill-down destroys its charts; `chart-zoom-modal` destroys its
  cloned chart). Open an overlay through the helpers, never with a bare
  `classList.add('open')` — that skips focus-in, the trap and focus return.
- **Time-series line charts are continuous — no default point markers.** The
  Price-History (§03) and SV/Booster-Trend (§04) comparison lines, the drill-down
  price + SV/Booster charts, and the Portfolio value chart all set
  `pointRadius: 0` with `pointHoverRadius: 5`: a clean line by default, and a
  point surfaces only where you hover a date (the interaction mode is `'index'`,
  so the whole date lights up with the tooltip — the Collectr pattern). The
  scatter (§02) is exempt — it *is* a point cloud (age vs value), where the marks
  are the data. Any new time-series line should follow the `pointRadius: 0` /
  `pointHoverRadius` convention.
- **The drill-down price chart carries a dashed 30-day moving average** — a faint
  gold `borderDash` "30-day avg" line (`renderDrillPriceChart()`), the slow
  smoother the Aug-2026 derivative-indicator study validated (daily box returns
  are anti-persistent noise, so a mean is the right filter and short-horizon
  oscillators over-fit). It reads whether today sits rich/cheap vs its own
  trailing month, on the same series the board ranks. The math is the pure,
  unit-tested **`movingAverageSeries(prices, dates, windowDays=30, minPoints=10)`**
  in `metrics.js`: a **calendar-defined** trailing window (like `pctChangeOverDays`,
  so it survives the mixed monthly/daily cadence), emitting a point only where the
  window holds ≥`minPoints` samples spanning ≥ half the window — so it never draws
  a fake-smooth mean across the sparse monthly backfill or off a handful of
  just-started daily points, and fills in as daily history deepens (absent on the
  6-snapshot static workbook, which the smoke spec pins). **Average-of-an-average,
  by design and disclosed:** the daily price it smooths is *already* Cardmarket's
  `(trend+avg)/2` blend, and `trend` is an EMA-like smoother — so this is a second
  smoothing (extra lag), acceptable for a slow *reference* line but the reason it
  stays presentational. It must **not** be folded into the stored/ranked price
  (a mean of a blend compounds lag into the number everyone reads — the
  maintainer-gated Phase B in `IMPLEMENTATION.md` item 16, deliberately not built).
  Currency-correct like the other price series (converted in the dataset builder).
- **Time-series charts use a real time x-axis, not a per-sample category axis.**
  The snapshot history mixes a monthly backfill (large day gaps) with the daily
  Cardmarket ingest, so a category axis — one evenly-spaced slot per sample —
  squashed the early months and stretched the recent days. The same four charts
  (§03/§04 comparison lines, the drill-down price + SV/Booster charts, the
  Portfolio value chart) instead plot **`{x: timestamp, y}` points on a `linear`
  x-axis** via the shared `timePoints()`/`timeXScale()`/`timeTooltipTitle()` +
  `fmtDateTick()` helpers (defined once, above `createCompareView`), so spacing is
  proportional to the actual days between samples and a long gap draws a straight
  (interpolated, `spanGaps:true`) line to the next sample. `bounds:'data'` pins
  the first/last sample to the edges; the linear ticks/tooltip are date-formatted
  by the callback (no date-adapter library needed). The data arrays carry no
  category `labels`, so **every dataset on these charts must be `{x,y}` points**
  (a plain number array would be indexed 0,1,2… on a linear axis) — including the
  drill-down's flat fair-price/band lines and the chart-zoom clone (it copies the
  options + datasets, so the time axis comes along for free). The scatter (§02, x
  = age) and the board-lens bar chart are not time series and are untouched. This
  relies on **`histDates` being chronological** (see the data-model note below).
- **On a phone the Portfolio value chart drops its axes (Collectr pattern) but
  stays inside its card — drill-down charts keep their axes.** Below 680px only
  the **Portfolio value chart** loses its axis labels: it's the hero "what's my
  collection worth" chart, its current-value tiles sit right above it, so the axis
  is redundant. Axes off is done in JS: `chartAxelessOnMobile(scales)` (a helper
  beside `renderPortfolioValueChart`) returns the same `scales` object with every
  scale `display:false` when `isNarrowViewport()`
  (`matchMedia('(max-width:680px)')`), and passes it through unchanged on desktop.
  It wraps the `scales:` literal in **only `renderPortfolioValueChart`**. A
  `display:false` scale takes no layout space, so the plot fills the card's width
  (the mobile wrap also drops its side padding to 0). The destroy-recreate pattern
  re-evaluates it on every render, so rotating across the breakpoint picks up the
  right axes on the next re-render. The scatter/compare charts and the two
  drill-down charts are **not** wrapped — they keep axes at every width (and the
  zoom-clone test reads `chart-zoom-canvas.scales`, so those must stay). The
  **drill-down price + SV/Booster charts deliberately keep their axes** — they're
  analytical (read a price on a date) and there is **no hover on touch**, so with
  axes gone a phone user had nothing to read the values against (the reported
  "looks odd / can't read them" regression); they stay within the modal padding
  (on a phone the modal's **horizontal** padding is the `--pad-x` token = 12px
  and the overlay gutter 8px — the design-token side padding, not a bespoke
  value — which already gives them near-full width; the drill-down's nested
  cards `.set-identity` / `.drill-verdict` / `.drill-stat` use `--pad-x-tile`,
  and `.set-identity` reserves a `padding-right` on a phone so its type badge
  never slides under the ✕) with no `.drill-chart` bleed. **A full-viewport bleed was
  tried and reverted** on both surfaces: the chart's opaque plot area, pushed
  outside its card onto the differently-toned page background, read as an odd
  floating block — and the only scrollbar-safe way to reach the viewport edge
  (negative margins cancelling the `.wrapper`/modal padding, never `100vw`, which
  includes the scrollbar and trips the 320px reflow contract) still left that
  seam. Keep charts inside their card/modal. The portfolio wrap's desktop
  `padding`/`max-height` live in CSS (`#portfolio-value-chart-wrap` /
  `#portfolio-value-chart`), not inline styles, so the media query can override
  them.
- **Charts expand to a full-screen, zoomable dialog.** The dense §03 scatter and
  the §05/§07 comparison charts are hard to read inline (worst on a phone), so
  each panel header carries a `.chart-expand-btn` (the `#i-expand` sprite),
  offered at **every** width — the enlarged view is useful on desktop too.
  `openChartZoom(key)` (`ZOOM_SOURCES` maps `scatter`/`hist`/`svb` → the live
  Chart.js instance — `scatterChart` directly, the compare views via the
  `getChart()` on `createCompareView`'s return) builds a clone into
  `#chart-zoom-modal`: same `type`, the labels reused and each dataset
  shallow-copied (so the two charts' per-chart `_meta` can't collide, while the
  read-only data arrays are shared), `maintainAspectRatio:false` so it fills the
  70vh `.chart-zoom-body`, and `onClick`/`onHover` stripped so the enlarged chart
  never opens a nested overlay. `.chart-zoom-body canvas { max-height:none }`
  escapes the global 220px canvas cap. Build the clone *after* `openOverlay`
  (same visible-container rule as the drill-down charts).
  **Pan/zoom lives only on the clone:** the clone's options add a `zoom` plugin
  block (wheel + pinch zoom, drag/touch pan, `mode:'xy'`) — `chartjs-plugin-zoom`
  + Hammer.js, two more pinned CDN libs loaded after Chart.js (Hammer first; the
  plugin UMD auto-registers against the global `Chart`). Inline charts carry no
  `zoom` config, so they never hijack page scroll; `.chart-zoom-body` sets
  `touch-action:none` so the gesture goes to the plugin, and `#chart-zoom-reset`
  calls `zoomChart.resetZoom()`. **The clone's `zoom` block also sets `limits`**
  (`x`/`y` both `min:'original', max:'original'`) so a pan/zoom can never expose
  axis space beyond the data — these charts hold no negative prices/values, and a
  negative or empty axis just reads as confusing when zooming. You can still zoom
  *in* freely; you just can't pan/zoom *out* past the original data extent. Because
  zoom sets fractional axis bounds, the
  scatter's y-tick callback rounds (`Math.round(v)+'×'`) so a zoomed view can't
  show `214.99999…×`. `tests/smoke.spec.mjs` pins open→tall-canvas→plugin-
  registered→`zoom()` narrows the range→reset→Escape-close; `tests/local-cdn.mjs`
  serves both libs from `node_modules` and asserts their versions match the CDN
  tags (like Chart.js/xlsx). The service worker caches them for free (cdnjs is
  already a `CACHEABLE_HOST`).
- **Headings and landmarks.** `.section-eyebrow` is an `<h2>`, `.panel-title` an
  `<h3>`, and the panes sit inside one `<main>`. The classes still carry the
  whole look (they reset the UA `font-weight`/`margin`), so keep using the class
  when adding a section — but keep the element a heading.
- **Names and non-colour cues.** Every input/select has a label or `aria-label`
  (the Data Entry grid builds `"<product> — new price"` from its row data); the
  buy-signal and alert icons carry `role="img"` + `aria-label` on their wrapper; the board's trend arrow ships a `.sr-only`
  word beside it. A new control with no visible label needs an `aria-label`.
- **One focus rule** covers everything focusable (`a/button/input/select/
  textarea/[tabindex]:focus-visible`), written as a type+pseudo-class list so it
  beats the class rules that set `outline: none`. Don't use `transition: all` on
  a control — it animates the ring's width from 0, so the indicator arrives
  ~250 ms late.

### The board is a grouped Era → Set → Product tree

`updateTable()` renders §01 The Board as a **collapsible Era → Set → Product
tree**, not a flat list — as coverage grew (XY → present) a flat board became a
wall to scan. `getFiltered()` still does the type/search/verdict filtering and the
sort; the tree only nests the result.

**Top-N + "show all" is the default.** The board leads with the best
**`BOARD_TOP_N` (12)** products flat, in the active sort order — the quick-scan
leaderboard, generalising the "Where to start" shortlist — and a `board-more-btn`
footer row expands to the full Era→Set→Product tree (`boardShowAll` toggle). When
expanded the tree opens as a **pure era overview** (every era collapsed —
`expandedEras`/`expandedSets` start empty): ~5 era headline rows, expand an era to
its sets, a set to its products. A **live search bypasses the cap** (the tree
force-expands so every match is visible). This is a shared behaviour:
**`renderBoardList(tbody, products, ctx)`** is the body renderer for all three
lenses — it either lays out the flat Top-N + footer or delegates to
`renderGroupTree()`, so the Top-N/tree switch is identical everywhere.

- **Era is derived, not stored.** `eraForRelease(release)` (in `metrics.js`) maps
  a release date to a named era via the `ERAS` boundary table (Mega Evolution /
  Scarlet & Violet / Sword & Shield / Sun & Moon / XY, newest first) — no column,
  nothing to hand-maintain. A new era is one `ERAS` entry.
- **Headline rows show `groupStats()`** (pure, in `metrics.js`): count, mean
  SV/Booster, how many are under fair, price range — currency-correct (only the
  €-absolute range converts; the SV/Booster mean is a ratio and stays put). Sets
  group by `setLogoKey()` (SKU suffix stripped, so twin sets like Black Bolt /
  White Flare stay distinct) via `boardSets()`, newest release first; products
  keep `getFiltered()`'s sort order within a set.
- **Group rows are real disclosures.** `groupRow()` builds a `<button
  class="grp-toggle" aria-expanded>` in a colspan cell; the whole row toggles for
  the mouse, the button is the keyboard/AT target, and toggling re-renders
  (destroy-recreate, like the charts). Product rows (`productRowTr()`, class
  `grp-product`) are the unchanged nine-column leaf and open the drill-down. The
  `.grp-era`/`.grp-set` classes are built as `grp-${level}` (in the dead-code
  `CONSTRUCTED` allowlist). Tests reveal product rows with `expandBoard()` in
  `tests/local-cdn.mjs`.
- **A live search force-expands every group** so matches are visible, then returns
  to the collapsed state when cleared.
- **The grouping is a shared helper, not the board's alone.**
  `renderGroupTree(tbody, products, ctx)` does the era→set→product nesting and
  headline rows; `renderBoardList()` (the Top-N wrapper) calls it, and
  `updateTable()` and the two analytical tables (below) all call `renderBoardList`.
  `ctx` carries everything table-specific: the headline `colspan`, the pair
  of expand-state `Set`s, the `rerender` to run on toggle, whether a live
  `searching` forces every group open, an optional era `tail` summariser, and the
  `leaf` builder for a product row. `groupRow()` reads its colspan/state/rerender
  off `ctx` too. Products passed in must carry `release`/`svPerBooster`/`fairGap`/
  `price` — `groupStats()` reads them for the headline aggregates.

### Faceted filtering: combinable scope facets, live counts, saved views

The filter bar is **faceted** — every facet combines, and each discrete one shows
a live match count.

- **One predicate, one scope.** `passesScope(p, skip)` applies every *scope*
  facet — **Type** (a category), **Era** (an `ERAS` key), **Set** (a
  `setLogoKey`), and the **price / age ranges** (canonical € / years) — and
  `visibleProducts()` is just `analysisProducts().filter(p => passesScope(p, null))`.
  So a facet narrows the board *and* every chart alike (the scatter, overview,
  comparison views), not just the board. Search + verdict stay **board
  refinements** layered on in `getFiltered()`, not scope facets. The age-fit still
  reads the whole `analysisProducts()` catalogue, so scoping the display never
  moves a fair price. The `skip` argument names one facet to ignore — that's what
  powers the counts.
- **Live counts** (`refreshFacetCounts()`): each pill/option shows how many
  products it would match *given the other active facets* — `passesScope` with
  that one dimension skipped. It writes the Type pills' `.pill-count` spans, the
  `(N)` on every Era/Set/Verdict option, the "More filters" badge (count of active
  advanced facets) and the Reset control's visibility. Called from
  `applyTypeFilter()` (every facet change) and `populateEraFilter()` (data load —
  now a thin wrapper that also validates a still-selected era/set survived).
- **Two filter rows, split by what a control scopes.** **Type** and **Era** — the
  two catalogue-wide scope axes (they narrow *every* analytical surface at once via
  `passesScope`/`visibleProducts`) — are a `.filters` row at the **top of the
  Analysis tab**, above the Where-to-start answer they scope. The **board's own**
  controls — age-threshold, search, verdict, sort, and the More-filters disclosure
  — are a second `.filters` row down by the board, where they act. Only the DOM
  position differs; the ids and handlers (`#type-filters .pill`, `#era-filter`) are
  unchanged, and both rows reuse the same `.filters`/`.pill`/`.sort-select`
  components. (`.age-control` leads the board row now, so it carries **no**
  left-separator rule — a border-left with nothing before it read as a stray line.)
- **Advanced facets live behind a disclosure.** The board row keeps
  age-threshold/search/verdict/sort; **Set**, the **price/age ranges** and
  the **saved-views** control sit in `#advanced-filters`, toggled by the **More
  filters** button (`setMoreFilters()`). Kept off the primary row for
  `design-review` restraint. **`#advanced-filters` is excluded from the
  reveal-on-scroll targets** (the `targets()` filter, beside modals/`.desc-toggle`)
  — it's shown *after* the reveal ran, so as an `.rv` target it would open
  invisible; it must appear the instant it's toggled.
- **Saved views** persist a whole filter combo (type/era/set/verdict/ranges/sort/
  search/lens) to **`localStorage` under `sta-saved-views`**. `captureView()` reads
  state, `applyView()` writes it back and re-`reflectFilterControls()` + re-renders
  (opening the disclosure if the view carries an advanced facet), `renderSavedViews()`
  fills the picker. Save (name → replace-by-name), load (the picker is an action,
  not a persistent selection — it resets to blank after), delete. **Reset all
  filters** (`resetFilters()`) clears every facet + search + `boardShowAll`.
- The two ranges are canonical **€ / years** like every typed input; nothing here
  is currency-sensitive (a €-range facet compares against the stored € price), so
  `renderCurrencySensitive()` needn't refresh counts.

### The board is one panel with three lenses (Value / Relative / Momentum)

§01 The Board used to be three lookalike sections — the value board, §04
Relative Value and §06 Momentum. A first-time visitor couldn't tell which of the
three answered their question. They are now **one panel with a Value / Relative /
Momentum pill toggle** (`#board-lens`), extending the "Where to start" lens
pattern. Only the presentation changed — nothing in `metrics.js`, and each lens
keeps its own `<tbody>` (`product-tbody` / `relval-tbody` / `momentum-tbody`) and
its own render function (`updateTable` / `renderRelativeValue` / `renderMomentum`),
so all three still go through the same `renderGroupTree()` and their existing
wiring is intact.

- **`boardLens`** (`'value' | 'relative' | 'momentum'`) is the state.
  `applyBoardLens()` reflects the pills, shows the active lens's `.table-wrap`
  (the other two carry the boolean `hidden` attribute — `[hidden]{display:none
  !important}` beats `.table-wrap`'s `display`) and hides the Value-only filter
  controls (`.value-lens-ctrl` — the verdict + sort selects; Relative and
  Momentum have a fixed ranking), then calls **`renderBoard()`**, which renders
  **only the active lens** (the two hidden tables aren't pre-rendered — switching
  is a cheap re-render). Every path that re-renders the board now calls
  `renderBoard()`/`applyBoardLens()` instead of the three functions separately:
  `INIT`, `applyNewData()`, `applyTypeFilter()`, `renderCurrencySensitive()`, and
  the age-threshold handler.
- **The shared header.** One `#board-badge` and one `#board-lens-hint` line serve
  all three — each render function writes them (value: "N products"; relative:
  the age-fit `age trend …/yr · R²`; momentum: "By deepest dip"), so the retired
  `#count-badge` and `#relval-fit-badge` ids are gone.
- **Search scopes every lens.** The `#board-search` box (and the Type filter)
  apply to all three now — `renderRelativeValue()`/`renderMomentum()` filter their
  pool by `searchTerm` and force-expand the tree when searching, matching the
  Value board. Verdict + sort stay Value-only (they're `.value-lens-ctrl`). The
  input handler sets `searchTerm` + `updateFilterChrome()` synchronously but runs
  the expensive `renderBoard()` (an O(N) tree rebuild) through a **leading+trailing
  `debounce()` (160 ms)** — so a burst of keystrokes coalesces into one rebuild
  while the first keystroke after idle stays instant; `renderBoard()` reads the
  module-level `searchTerm`, so the debounced call is never stale.
- **The Relative/Momentum lenses carry a set-vs-product comparison chart**
  (`renderBoardLensChart()`, canvas `#board-lens-canvas`, hidden on Value via
  `applyBoardLens()`). It's the set-level view the collapsed tree can't give — a
  diverging horizontal bar chart of the active lens's metric, **Sets by default**
  with a `#board-chart-mode` Sets ⇄ Products toggle (`boardChartMode`). Relative
  plots **Δ vs peers** (SV/Booster minus the age-expected value, in ×, from
  `peerResiduals`); Momentum plots the **30-day price change** (%, from
  `momentum().change30d`). Sets roll up by set key (`boardSets`, matching the
  tree); positive is green, negative red — the tables' sign convention. It's
  **capped to the `BOARD_CHART_CAP` (12) biggest movers by magnitude** (dropping
  the near-zero middle so the chart shows extremes, not a wall of stubs) inside a
  height-from-row-count wrapper (`#board-lens-wrap`) in a capped scroll area
  (`.lens-chart-scroll`); the `#board-chart-cap` line captions the metric/mode.
  It re-renders inside `renderBoard()` (so it follows the type filter, search,
  currency and age-threshold like the table). Nothing new in `metrics.js` — it
  reuses `peerResiduals`/`momentum`/`boardSets`.

Each lens still keeps its own independent expand state
(`relvalExpandedEras`/`relvalExpandedSets`, `momentumExpandedEras`/
`momentumExpandedSets`, and the board's own `expandedEras`/`expandedSets`), also
leading with the flat Top-N and opening the tree (once "show all" is clicked) as a
pure era overview, and feeds the tree **product objects** (so
`groupStats()`/`boardSets()` work unchanged) plus a `leaf` builder
(`relvalRowTr()` / `momentumRowTr()`). The sort each already computed is preserved
*within* a set — for Relative Value, `peerResiduals()` returns bare `{name,…}`
objects with no release, so they're mapped back to their products for grouping via
a name→product map and a name→residual lookup keys the leaf; Momentum's rows
already carry the product, so a name→momentum map keys its leaf. Group toggles
re-render via `ctx.rerender`.

**Each lens gets the board's phone column-priority.** The `.table-wrap` mobile
rules (frozen first column + `.col-detail { display:none }` below 680px) are
general, so all three froze the product name; the Relative and Momentum lenses
also mark their non-headline columns `.col-detail` on the `<th>` **and** the leaf
`<td>` (via the `cls` arg `momentumRowTr`'s `pctCell` takes), collapsing a phone
to **Product · Δ vs peers** (Relative) and **Product · 30d · vs Peak** (Momentum).
Everything hidden stays in the drill-down these rows open. The `scroll-hint`
(`#board-scroll-hint`) is toggled by `applyBoardLens()` — shown only on the wide
9-column Value lens (Price + Fair Price can overflow a hair); the two-column
Relative/Momentum lenses fit without a swipe, so it stays hidden there.

**Momentum's columns are date-windowed, not position-windowed.** The table shows
`Price · 7d · 30d · Set Val since 1st · vs Peak`, where **7d/30d** are the price
change over the trailing 7 / 30 **calendar days** — `momentum(hist, dates)`'s
`change7d`/`change30d` (in `metrics.js`), which `computeMomentum()` feeds the
shared `histDates`. This has to be date-aware because the snapshot history mixes
a **monthly** XY/SM backfill with the **daily** Cardmarket ingest: a positional
"7 snapshots back" would be 7 days in the daily region and 7 months in the
backfilled one. `pctChangeOverDays()` picks the tracked snapshot (not the
endpoint) nearest to `latest − Nd` and accepts it only within `N/2` days, so a
monthly-only product shows `—` for 7d rather than a mislabelled month-long
change; a window renders `—` until enough history accrues. The old positional
`Δ last` (change vs the previous snapshot) and the `sinceFirst` price column were
retired — a 1-day tick is noise under daily ingest. The drill-down carries the
same pair as one **30d change** tile (7d in its subtext). `momentum()` still
returns `sinceFirst` (unused in the UI now) and remains the source of `drawdown`
+ `svSinceFirst`, two of the three Board-verdict ingredients.

### The board on a phone (column priority)

Below 680px the All Products table drops its six **`.col-detail`** columns
(Type, Set Value, €/Booster, SV/Booster, Age, Wtd. Score), freezes the product
name (`position: sticky; left: 0`), and shows a `.scroll-hint` line. This holds in
both board states: the default **flat Top-N** rows carry the same `.col-detail`
column priority, and when expanded the grouped **Era/Set headline rows wrap** on a
phone (`.grp-stats` becomes a block) so even the era overview never forces a
two-dimensional swipe. Reasons a future change should preserve:

- The measurement it fixes: 9 columns are **1,098px wide in a 356px window**, so
  a phone saw only the name and type, with **Fair Price — the north-star answer
  — starting at x=392** and no hint the table scrolled. With the detail columns
  gone the swipe is 448px, and Fair Price lands beside the frozen name.
- **Adding a board column means deciding whether it is `.col-detail`** — mark it
  on *both* the `<th>` and the `<td>` in `updateTable()`, or the columns
  misalign on a phone. Everything hidden must stay reachable in the drill-down.
- **Stacking order is load-bearing**: the sticky header row is `z-index: 2`, so
  frozen body cells must be `1` and the frozen header cell `3`. Equal values let
  the first body cell paint over the column labels.
- **There is no click-to-sort on `thead th`** — there never was. The `cursor:
  pointer` and hover highlight that implied one are gone, and the board's
  explainer no longer promises it. Sorting is `#sort-select`. If you add header
  sorting, restore both affordances with it.
- **Two more phone tweaks live in the `≤460px` block.** (1) The type scale's two
  smallest steps are lifted a notch by *redefining the tokens*
  (`:root { --text-2xs; --text-xs }`) — the ~10px mono stat/eyebrow labels were
  below comfortable reading; redefining the tokens (not per-element `font-size`)
  keeps everything on-scale and past `check:design-tokens`. (2) The Where-to-start
  pick name is let to **wrap** instead of truncating — the `.row-open` button
  carries its own `white-space:nowrap`/ellipsis (right for the board), so the
  override is scoped to `.pick-name .row-open`, and the competing rank/score
  numbers drop a step so the name wins the row.
- **The biggest display headings step down on a phone** so they read as headings,
  not billboards: `.modal h2` (drill-down + chart-zoom + the info dialogs) goes to
  `--display-md` at ≤680px — modals are effectively full-screen there — and the
  header `h1` and demo `.hero-title` each drop a step at ≤460px (the hero then
  fits on one line). Only the largest Bebas headings were touched; body/label
  type is unchanged.

### The "Where to start" block leads the Analysis tab

`renderOverview()` renders the **Where to start** shortlist above the seven
numbered sections — the tab's single answer, with the sections as its evidence.
It replaced two rival top-lists (a "Best deals" overview ranked by fair-price gap
and a §01 "Top Picks" ranked by score): a first-time user couldn't tell which to
trust, and for a *settled* product the two are identical anyway (age weight 1, so
`score == SV/Booster`). It derives nothing new and follows `activeType` (via
`visibleProducts()`), so it is wired into `INIT`, `applyNewData()` **and**
`applyTypeFilter()`.

One shortlist, four **lenses** (`startLens`, a pill toggle at `#start-lens`) —
three buy-side and one exit-side: **Safe pick** (age-weighted `score`, the default
and conservative pick), **Best deal** (`fairGap`, headline **% under fair**),
**Best value** (`svPerBooster`, headline **× multiple**), and **Consider selling**
(the sell-side mirror, see below). Every buy card shows all three buy signals with
the active lens lit (`startMetrics`), and the headline figure follows the lens
(`startPrimary`) so a fair-price % and a value multiple never share a slot. A **new
set** (age weight < 1) is flagged ⚠ with its `age weight → score` inline
(`.pick-flag` + the `.is-new` accent rule) wherever a *buy* lens ranks it — under
**Safe** it appears only if its *penalised* score still earns a top-`START_COUNT`
spot, which is exactly what the age penalty is for; under **Deal/Value** it
surfaces the raw-signal leaders it naturally tops. Both `renderOverview` and
`startCard` live above the `INIT` block (temporal-dead-zone rule).

Its one honesty rule survives: **when `fairPriceTrusted()` is false the Deal lens
must not rank by the fair price** — it falls back to Safe and says so in the lead.
A ranking built on a number the rest of the page disregards would be the most
damaging kind of wrong here.

**The Consider-selling lens** is the exit-side "Where to start" — the sell
shortlist, ranked worst-first (most sell-worthy at the top) by the pure
**`sellStrength(p, fairTrusted)`** in `metrics.js`. It blends the two exit signals
the app already derives: how far a product sits **over** fair price (`fairGap`,
counted only when trusted and ≥ `SELL.OVER_FAIR_MIN` = `VERDICT.OVER_SOFT`) plus an
**un-backed run-up** (`SELL.RUNUP_WEIGHT × change30d`, counted only when the
`sellSignal` run-up flag is set and the 30-day move is positive). `recomputeFit()`
stashes each product's `runUp`/`change30d` so the sort comparator needn't recompute
momentum. It is **catalogue-wide** (ranks `visibleProducts()`, not just holdings)
and lists **only genuine candidates** (`sellStrength > 0`) — a fairly-priced, quiet
product doesn't belong on a "consider selling" list, so the lens shows an explicit
empty state when nothing qualifies. Its **honesty rule mirrors the buy side**: when
`fairPriceTrusted()` is false the over-fair term drops to 0 inside `sellStrength`,
so the ranking falls back to run-ups alone (never asserting a fair claim) and the
lead says so — the same stance as `sellSignal` and the Deal→Safe fallback. Two
render differences from a buy card, both in `startCard`: the **medal tint is
dropped** (rank 1 is the most sell-worthy, not a "best pick" winner) and the young-
set ⚠ flag is suppressed (it's a buy-side note about the score); the card body uses
`sellMetrics(p)` (over/under fair · 30d move · the run-up tag) and a red
(`--accent2`) headline via `startPrimary`. Guarded by unit tests on `sellStrength`
and an a11y case that pins the lens copy, the candidates-or-empty-state branch, and
the no-medal rule.

### The pitch lives once — demo page vs Welcome tab

Two surfaces used to explain the app, and only one of them was reachable by the
people who needed it. The split is now by **role**, and the rule is that no
explanation exists in two places:

- **`#demo-page` is the pitch** — the only "what this is / how to read it"
  surface. Order is the argument: the question (`.hero-title`), then the three
  ideas needed to read an answer (`.steps`), then the animated "See how it reads
  a product" panel, then **"What a free account unlocks"**, then the sample rows.
  Prose goes here, not on Welcome. It is **deliberately slim**: a Where-to-start
  ranking teaser and a live news list were both tried and **removed** — the demo's
  job is the argument for signing in, not a second working app, so the concrete
  features live as the unlock grid below rather than as interactive widgets a
  logged-out visitor would poke at.
- **"What a free account unlocks" is the feature grid** (`.unlock-grid` /
  `.unlock-tile` + sprite icons) — the eight things an account buys: fair price,
  buy/avoid verdict, sell signals, price history, portfolio & P&L, transaction
  log, price alerts, and the **News feed**. Static markup, one standalone section
  — the concrete "why make an account". (This replaced the old locked
  Where-to-start lenses, whose `renderDemoStart()`/`demoPickCard()` and the
  `#news-modal` teaser were removed with them.) The `.signin-open` handler stays
  **delegated** (one document listener) so every sign-in button — the CTA, the
  header — opens the auth overlay.
- **The demo has an animated "See how it reads a product" panel** —
  `mountDemoVizzes()` injects three **sample** SVG charts (`scatterVizSVG` value
  vs age + fit, `fairPriceVizSVG` actual vs fair-price line, `momentumVizSVG`
  30-day diverging bars) into `#demo-viz-scatter/-fair/-momentum` and reveals them
  on scroll via its own IntersectionObserver (the tab-pane reveal handler doesn't
  cover `#demo-page`). The build is **CSS-driven**, gated on `.in-view` — the
  classes `viz-draw`/`viz-fade`/`viz-pop`/`viz-grow`/`viz-pulse` map to keyframes,
  timed per element by the inline `--d` custom property, with unhurried durations
  so each step reads — and every animation collapses under
  `prefers-reduced-motion` (elements shown in their final state). **The data
  is illustrative and every chart is badged `Sample`**, so no real product's fair
  price is shown (the demo honesty rule holds). Token-only (var() colours, scale
  font-sizes; chart-internal text uses SVG `font-size` attributes, not CSS, so the
  design-token check is satisfied). Layout/timing notes worth not re-learning:
  - The three charts sit in a **2-up grid** (`.demo-viz-grid` — scatter +
    fair-price side by side, momentum full-width; one column ≤720px).
  - **The build *replays on a loop* so a mid-scroll visitor still catches it.**
    The loop is **JS-driven, not CSS `infinite`**: `mountDemoVizzes()` arms a
    per-panel `setInterval` (`_vizTimer`, `VIZ_REPLAY_MS`) that removes `.in-view`,
    forces a reflow, and re-adds it — each iteration is a *finite* animation that
    resolves its `getAnimations()` finished promise, so it never hangs the a11y
    `settle()` helper the way an infinite CSS animation would (the same reason the
    attention `viz-pulse` runs a fixed iteration count, not `infinite`). The timer
    is **skipped under reduced motion** and **paused while the panel is
    off-screen** (cleared when the observer reports it non-intersecting). The
    reduced-motion `@media` block matches `.in-view` too (equal specificity to the
    play rules) so it genuinely wins and holds the finished charts static.
    `tests/signed-in.spec.mjs` asserts the timer is armed after reveal.
- **`#tab-welcome` is a signed-in landing** — where to go, and links to the same
  explanations. It must not grow a second pitch; if you find yourself writing
  what the app is *for* on this tab, it belongs on the demo page.
- **The "At a glance" KPI strip lives on Welcome, not Analysis.** The four-tile
  `.kpi-row` (Products Tracked · Top Score age-weighted · Best Value/Booster ·
  Newest Release) is a *dataset teaser*, not the answer — two of its tiles just
  restate the Where-to-start Safe/Value #1 — so it sits under the Welcome hero
  behind an **"At a glance"** `.section-eyebrow`, and Analysis opens straight on
  the Where-to-start shortlist with no KPI row above it. `updateKPIs()` fills the
  tiles **by id** (location-independent), so the move needed no wiring change;
  `kpi-total` is set separately from `analysisProducts().length`. The strip's
  `.kpi-intro` points at the shared **What the numbers mean** glossary (the
  `.glossary-open` button lower on the tab) rather than defining a term twice —
  keep it that way (shared-explanation rule). Don't restore a KPI row above the
  Analysis answer.
- **The explanations are shared dialogs.** `#method-modal` (the methodology —
  *how the numbers work*) and `#glossary-modal` (every term) are opened by
  **class**, not id — `.method-open` / `.glossary-open` — precisely so a third
  caller costs nothing and no surface can define SV/Booster its own way.
  `#fair-fit-note` on the board is one of the `.method-open` callers, and the
  page **footer** carries both as an app-wide trust surface (reachable from every
  tab, not just the demo/Welcome). `#method-modal` is the launch **methodology
  doc** (G4.1): beyond the fair-price fit + confidence it covers *Where the
  numbers come from* (the Cardmarket `(trend+avg)/2` box blend, the `avg30`
  all-cards Set Value, promo subtraction) and *Where it's weakest* (thin
  liquidity, the one-time US→EU Set-Value basis step, "not financial advice") —
  consolidated from README/ROADMAP, not re-authored. The footer also opens two
  more launch dialogs (same class-wired pattern): **`#privacy-modal`**
  (`.privacy-open`) — a plain-language privacy summary (what's stored + why,
  cookies/storage, EU hosting + Cloudflare backups, GDPR rights) — and
  **`#changelog-modal`** (`.changelog-open`, "What's new") seeded from ROADMAP →
  Done, with a best-effort-uptime + support line. Both carry a `[set a contact
  email]` placeholder and a DRAFT/`review-before-launch` HTML comment; the
  privacy copy is a starting point, not legal advice.
- **Signing in lands on the Welcome tab** — the signed-in landing (the
  where-to-go map; news is now its own tab, not a Welcome teaser), which is also
  the markup default
  (`tabbtn-welcome` is `active`/`aria-selected`), so first paint and post-login
  agree. It is wired in the `uid !== sbLoadedUserId` branch of
  `onAuthStateChange` on purpose: a token refresh fires that handler too, and
  switching tabs under a reading user would be a bug. It dispatches a **click**
  (`tabbtn-welcome`) rather than calling `activateTab()`, so the reveal-on-scroll
  handler (which listens for clicks) replays. (This reversed an earlier choice to
  land on Analysis; news lives on Welcome, so the landing shows it.)

**What the demo must not do: show a fair price or a verdict.** Both are read off
`linearFit()` across *every* product's age, and the anon RLS scope is three
release dates — a fit over that slice would render a number the signed-in board
contradicts. The page says so instead, and names it as what sign-in buys. If a
future change wants real fair prices there, the honest route is a
SECURITY&nbsp;DEFINER function returning only the fit coefficients
(`regr_slope`/`regr_intercept`/`regr_r2` over all products), not a client-side
fit on the visible rows.

Two smaller things worth not re-learning: the demo's set tables carry
`tabindex="0"` on their `.table-wrap` (nothing inside is focusable, so without
it a keyboard user cannot scroll them on a phone), and `.glossary td` sets
`white-space: normal` to opt out of the board's global `tbody td { white-space:
nowrap }` — inherited, it ran every definition out of the dialog.

### Where the numbers came from

`dataSource` is `'sample' | 'workbook' | 'cloud'`, and while it is `sample` the
`#data-source-banner` strip says so under the header on every tab. This exists
because the hardcoded fallback is *indistinguishable* from tracked data once
rendered — a silent `return` on a missing workbook made the whole page fiction.
Any new path that leaves the fallback on screen must call
`setDataSource('sample', why)` with a reason; any path that replaces it must
call `setDataSource('workbook'|'cloud')`.

Base rule that came out of it: **`[hidden] { display: none !important }`**. A
class that sets `display` beats the UA's `[hidden]` rule on specificity, so a
component can otherwise stay visible while claiming to be hidden.

**The boot splash hides the transient, not the honesty.** `dataSource` starts at
`sample` (the hardcoded fallback renders first), so for the split second before
the workbook/cloud data arrives the "sample data" banner would flicker in and
out — and the old `Loaded N products…` / `Auto-loaded pokemon_data.xlsx` status
pills read as noise. `#app-loader` (a `<body>`-level opaque logo splash, in the
markup so it covers the *first* paint; `z-index: 2000`, above the auth overlay
and demo page, below the missing-library guard) sits over all of it until the
initial data resolves. **`window.__hideAppLoader()`** — defined in a small
classic (non-module) inline script right after the splash, the same
buffer-then-drain pattern as the early error reporter — fades it out; the app
calls it at every terminal load state (`tryAutoLoad` **finally**,
`loadFromSupabase` success **and** the empty-account branch, `loadDemo` end), and
an **8s failsafe timeout** in that same script guarantees it never hangs even if
a load path throws. The two success status pills were removed with it (the splash
*is* the "loading → ready" signal now); the honest **sample-data banner stays** —
if a load genuinely falls back to sample, the splash clears to reveal it, no
longer a flicker but a real state. Reduced-motion stills the bar pulse and snaps
the fade. `tests/smoke.spec.mjs` pins show-on-first-paint → clear-on-ready.
The same flicker recurs on a *later* transition — **signing in from the demo**,
after the splash is already hidden: `setAuthedUI()` reveals the app on the still-
`sample` fallback for a beat before `loadFromSupabase()` swaps in the cloud data.
So **`window.__showAppLoader()`** (the counterpart in that inline script) re-shows
the splash, called at the top of the `uid !== sbLoadedUserId` branch of
`onAuthStateChange`; `loadFromSupabase()` (and every fallback it leads to) hides
it again when the real data lands, and `__showAppLoader` re-arms its own 8s
failsafe since the original has long since fired by sign-in time. It un-hides
while removing `--out` in the same tick, so the splash paints opaque with no
fade-in (a `display:none`→`flex` change doesn't run the opacity transition) and
nothing shows through. `tests/signed-in.spec.mjs` pins the sign-in re-show →
clear.

### Fair price, and how it says what it's worth

`fitConfidence(r2)` in `metrics.js` turns the age fit's R² into a band —
**strong fit / moderate fit / rough estimate**. Two rules hold it together:

- **The board shows the word, the drill-down shows the number.** A bare
  "R² 0.39" reads as more authoritative than a weak fit deserves.
- **`fitConfidence().trusted` must mean exactly what `fairPriceTrusted()` means**
  (both are `r2 >= FAIR_PRICE_MIN_R2`), or the board could label a price
  "moderate fit" while the verdict is quietly ignoring it. A unit test pins the
  boundary from both sides.

The word is a button opening `#method-modal` — the method has to be reachable
without a hover, which a `title` never is on touch.

**Old sets get *no* fair price — a moving, fit-derived age limit.** `fitConfidence`
is a *global* trust gate (is the whole fit good enough?); separately, the fair
price is the fit **inverted** (`setVal × boosters ÷ expected SV/Booster`), and for
the oldest sets — where the downward fit has decayed toward zero — that division
amplifies ordinary fit noise into a meaningless figure (a €5k vintage box showing
a €50k "fair price"; ~28% of the live catalogue sits in this zone). Vintage sealed
is collector-priced and genuinely off the value-density line, so **`fairPrice()`
suppresses the number rather than guess** once the fit's expected SV/Booster falls
below `FAIR_PRICE_MIN_EXPECTED_FRAC` (0.25) of its **intercept** (the value at the
young, reliable end). Crucially the threshold is a fraction of the *current* fit,
**not a hardcoded age** — and `recomputeFit()` re-runs on every data load — so the
implied age limit **moves automatically as the catalogue grows and the fit
refits**. `fairPriceMaxAge(fit)` exposes that limit in years (pure, derived from
the fit); the drill-down's Fair Price tile shows `beyond age model (~N yr)` in
place of a number for a suppressed product, and the board/verdict fall back to the
momentum signals (fairGap is null, so no fair claim is made). This is deliberately
*suppression, not a clamp*: an unreliable number we don't show beats a plausible-
looking one we can't stand behind.

**Data maturity — the per-product companion, and where we stop.** `fitConfidence`
is a *global* signal (one age fit for the whole catalogue); it says nothing about
whether *this* product's own inputs have settled. A new release's set value is
typically elevated just after launch and drifts down until the set leaves print,
so its fair price is both less settled and biased a little high — and until now
nothing flagged that. The **`dataMaturity(hist, dates)`** pure helper reports the
raw facts a buyer needs — snapshot depth, tracked span, and the peak-to-trough
**swing** of price and set value (peak-to-trough, not net, so a value that ran up
and back still reads as unsettled) — rendered by `renderDrillMaturity()` in the
drill-down's *"How settled is this data?"* section. **The deliberate design
decision: this informs, it does not adjust.** It never feeds the verdict or the
fair price (unlike the weak-fit path, which does neutralise the verdict) — the
call on how much risk a young product carries is the buyer's, so we give the true
data and let them make it. A directional maturity haircut on the fair price was
considered and explicitly deferred for that reason.

### Passwords: two ways into one form

`openPasswordForm(isRecovery)` is module-level because it has two callers: the
header's **Change password** button, and the `PASSWORD_RECOVERY` branch in
`onAuthStateChange` — Supabase fires that when a user returns through a reset
link, and the call site is outside `wireAuthControls()`'s scope. The heading and
intro switch with the flag; the form is otherwise identical.

The reset request replies the same way whether or not the address exists (the
endpoint is deliberately quiet about it), and `redirectTo` strips any existing
fragment — the recovery token arrives in one.

### Collapsible explainers

`initSectionDescriptions()` gives every `.section-desc`/`.kpi-intro` on the
Analysis and Portfolio tabs a toggle, plus one global control
(`#desc-toggle-all`) in the Analysis header. Things that are load-bearing:

- **The text is hidden (`hidden`), never removed** — a first-time visitor and a
  screen reader must still be able to read it.
- **The toggle is `.inline` (inside the `<p>`) when expanded** and moves out
  when collapsed. This is not decoration: 14 buttons on their own rows added
  ~550px to the page, which is exactly the cost the feature exists to remove.
  Move the button *before* hiding the paragraph — one still inside it would
  vanish with it.
- **On desktop the inline toggle is `opacity: 0` until hover or focus** — once
  the text is showing, "Hide explanation" needn't be in view at all times. It
  stays opacity (not `display`) so it remains focusable and announced, and the
  header's always-visible control means the function is never undiscoverable.
  The `:focus` reveal is `transition: none` on purpose: a 200ms fade means the
  control is invisible at the moment focus lands, the same defect as animating
  a focus ring in.
- **Collapsed is the default at every width** — the explainers are reference
  material, read once, and the page is what someone came for. A stored choice
  always wins over the default; it persists in `localStorage` under
  `sta-desc-collapsed` as an array of positional ids (`desc-0`…). Positional means inserting a section mid-page shifts the ids
  after it; the worst case is a remembered choice landing on a neighbour once.
- **The toggles are excluded from the reveal-on-scroll targets** (they are
  direct children of the pane, so they matched by default). A collapsed
  toggle *is* the section's only visible affordance — fading it in separately
  would hide it. Relatedly, `.rv:focus-within` reveals a section instantly:
  Tab scrolls a below-the-fold control into view but the IntersectionObserver
  fires a frame later, so focus could otherwise land on something mid-fade.
- **The block must stay above the `INIT` block.** INIT runs inline at module
  evaluation and calls `initSectionDescriptions()`; module-level `const`s
  declared below INIT are in the temporal dead zone at that point, and the throw
  takes the rest of INIT's wiring with it. The smoke test catches this — it
  showed up as the drill-down not opening.

A separate script near the end of `<body>` drives **reveal-on-scroll animations** via IntersectionObserver (`.rv` → `.rv-in`), replayed when a tab becomes active. It is a progressive enhancement — if IntersectionObserver is unavailable, nothing is hidden.

## Design consistency (required)

This app has a deliberate, minimalist dark aesthetic, and it must stay that way. **Any time you add or change UI** (markup, CSS, a new section/view/component, a modal, table, cards, colours, or copy), follow the **`design-review` skill** (`.claude/skills/design-review/SKILL.md`): reuse the existing design tokens and components rather than inventing new ones, and actively question whether each new element earns its place and keeps the page easy to navigate. Load it before writing UI code and review the result against its checklist before committing. Don't let the design quietly drift — when in doubt, less.

## Skills (load the relevant one before you change that area)

Project skills live in `.claude/skills/`. Each encodes the invariants and
failure modes for one area — load the matching one *before* editing, and run its
checklist before committing:

- **`design-review`** — any UI change (markup, CSS, components, copy).
- **`data-integrity`** — the workbook, `parseXlsx`/`exportXlsx`, the hardcoded
  fallback, or the Supabase schema/RLS. Keeps the loading contract from silently
  breaking.
- **`metrics-review`** — the scoring math, booster constants,
  `recomputeScores`/`deriveProducts`, or any render function. Guards number
  correctness and the recompute-before-render ordering invariant.
- **`verify-app`** — before committing any change: how to actually verify here
  (serve over HTTP, `npm test`, exercise the tabs by hand). The pure math *is*
  unit-tested; everything else — rendering, wiring, loading — is only proven by
  running the page.

## Documentation (required)

The project has grown past what one file's comments can carry, so documentation
is part of the definition of done: **a change ships with its documentation in
the same commit/PR — and no document may keep claiming something the code no
longer does.** (This is the docs counterpart of the metrics rule "no derived
number ships without a test"; the `verify-app` pre-commit bar checks it.)

Each document has one audience — update the ones your change touches:

| Document | Audience | Update when… |
|---|---|---|
| `README.md` | users & visitors | user-visible behaviour, workflow, project layout, the checks |
| `SUPABASE.md` | the maintainer operating the cloud setup | schema, RLS, email jobs, anything run in the Supabase dashboard |
| `CLAUDE.md` (this file) | the next contributor / coding session | architecture, invariants, data model, notable new files or functions |
| `ROADMAP.md` | product direction | an item ships (condense into **Done**) or the plan changes |
| `IMPLEMENTATION.md` | the contributor executing the backlog | an item's plan changes; delete an item's section when it ships |
| `.claude/skills/*` | the pre-commit guard checklists | an invariant, check, or fact in that skill's area changes |
| `docs/visual-design-review.md` | whoever touches styling | the visual system drifts or is reconciled — audits the build against `design-review`'s declared tokens/fonts/components. A dated snapshot: supersede, don't patch |
| `docs/ux-expert-review.md` | whoever picks up an accessibility/design item | the authoritative UX document — WCAG 2.2 conformance, heuristics, cognitive walkthrough. Supersedes and corrects `ux-assessment.md`. A dated snapshot: supersede it, don't patch it |
| `docs/ux-assessment.md` | historical | the earlier journey/density pass; kept for its density measurements, but where the two disagree the expert review wins |
| `docs/architecture.mmd` | anyone orienting in the codebase | the load path, a data source, or the module/tab structure changes — edit the `.mmd`, re-render the `.svg`, commit both |
| Code comments | the implementer reading the code | constraints the code itself can't show |

## Editing invariants

Markup, styles, and logic share one file, and the JS builds DOM from string templates, so:

- **Preserve element IDs and JS-referenced class names** (e.g. `product-tbody`, `overview-deals`, `start-lens`, `relval-tbody`, `momentum-tbody`, the `#*-chart` canvases, `.entry-input`, `.url-cell`, `.type-BOX/ETB/BUNDLE/COLLECTION/PACK`, `.pill`, `.tab-btn`/`.tab-pane`). Renaming them silently breaks rendering.
- **Preserve the CSS variable names** in `:root` (`--bg`, `--accent`, `--muted`, …) — inline styles throughout the markup reference them.
- **Icons come from the sprite**, not from emoji: one inline `<svg class="sprite">`
  of `<symbol id="i-…">` near the top of `<body>`, used as
  `<svg class="icon" aria-hidden="true"><use href="#i-bell"/></svg>`. Paths are
  stroke-only on `currentColor` so an icon inherits the colour of its label —
  that is what lets the active tab's icon go dark on gold. Adding one means
  adding a symbol, not a literal `<path>` at the call site. An icon that carries
  meaning alone needs `role="img"` + `aria-label` on its wrapper. Emoji survive
  in three places on purpose: Chart.js tooltips (canvas text), status strings
  written with `textContent`, and typographic ✓/✕/⚠ glyphs.
- **Colours and font sizes come from tokens, everywhere** — including the chart
  JavaScript, which resolves them at runtime into `COLOR` (and derives every
  fill from the same hue via `alpha()`, so a fill can't drift from its line).
  Type is an 11-step scale, `--text-2xs` … `--display-xl`; radii are
  `--radius-pill` / `--radius-sm` / `--radius` (the panel corner). Adding a
  literal instead fails `npm run check:design-tokens`.
- **Fonts come from role tokens, and the roles carry meaning.** Three faces:
  `--font-display` (Bebas Neue) for display headings, `--font-mono` (DM Mono) for
  **data** — figures, prices, %, ×, scores, the compact `.type-badge` tags,
  code/filenames, chart axes — and `--font-ui` (DM Sans) for **words** — body copy
  plus descriptive UI text (labels, eyebrows, sub-lines, hints, verdicts, control
  chrome). The rule is **words are `--font-ui`, numbers are `--font-mono`** — the
  "less technical" split (DM Mono also rendered rough at ~10px label sizes). Its
  reach is **one grouped rule at the end of the stylesheet** (search *"Font role:
  descriptive UI text"*): a surface uses the sans face iff it is listed there, so
  a figure can never accidentally lose its monospace and tuning the reach is
  adding/removing a selector. `check:design-tokens` guards colours and font-sizes,
  not font-family, so this split is a review-time invariant, not a scripted one.
- **Vertical rhythm is one token, `--section-gap`** (40px desktop, 30px on a
  phone via the 680px block). Every top-level section's content block sets its
  `margin-bottom` to it, so the gap between sections is identical on all four
  tabs and the demo page — edited in one place. Before this, the gap was
  per-surface and inconsistent (Analysis 44, Welcome 36–40, the demo 18, and
  Portfolio had no rule at all, so its panels nearly touched the next heading).
  A new section reuses the token; don't reintroduce a bespoke section margin.
- **Horizontal padding is two tokens, `--pad-x` / `--pad-x-tile`** (the x-axis
  companion to `--section-gap`). `--pad-x` (16px desktop, 12px phone) is the side
  padding of a section's content block that holds content directly (panel header,
  prose lead, chart panel, editor, pick row, welcome/step card, advisory strip);
  `--pad-x-tile` (12px both) is the side padding of a nested tile/card **and** of
  the grid container wrapping a row of them (`.portfolio-summary`,
  `.holding-grid`, `.balancer-grid`, `.portfolio-tile`, `.holding-card`,
  `.kpi`'s top rule inset). Both step down in the 680px block. Before this, side
  padding was per-surface (24/26px on section blocks, another 18px on the tiles
  inside them), so a value sat ~42px from the panel edge — bulky, worst on a
  phone; the tokens collapse the doubled portfolio gutter to one 12px inset (24px
  edge-to-value). Only the **horizontal** half of a `padding` shorthand comes
  from these tokens (`padding: 20px var(--pad-x)`) — vertical padding was left
  unchanged. A new surface reuses the token; don't hand-type a fresh 24px side
  padding, and pick `--pad-x-tile` when a surface nests inside another padded one.
- The All Products table's `.table-wrap` is a capped-height (`70vh`) scroll area with a sticky header; other tables use different wrappers. A `.table-wrap` with **no focusable content inside** needs `tabindex="0"` or it cannot be scrolled by keyboard (the board's Relative and Momentum lens wraps carry it; the Value lens doesn't need it — its rows have `.row-open` buttons).

## Workflow / deployment

Static hosting — deploy by committing `index.html` and `pokemon_data.xlsx`. The intended monthly loop (see README): open the dashboard → enter the month's prices and set values in **Data Entry** → **Export updated .xlsx** → replace `pokemon_data.xlsx` in the repo and commit. That manual loop still works, but in Supabase mode the **Cardmarket ingestion** writes the daily snapshot automatically — three Supabase **Edge Functions**: `cardmarket-daily` (the snapshot, scheduled by `pg_cron`), `cardmarket-resolve-ids` (auto-fill each product's CM ID / Exp ID, **Resolve ids** button) and `cardmarket-catalog-refresh` (the on-demand set-card-list cache, **Sync catalog** button). No GitHub Action; see `SUPABASE.md`. A per-product price-lock keeps anything you'd rather set by hand.

**Backups — an INTERIM free-tier solution (a commercial build must move to paid PITR + proper DR; see `SUPABASE.md` → Backup & restore and `ROADMAP.md` → Later). Supabase's managed PITR is paid, so the free-tier strategy is two things you own.** (1) **In-tool full backup** — the admin-only **⬇ Download backup** button in Data Entry (`downloadFullBackup()`, wired beside Save to cloud / Resolve ids / Sync catalog) reads every table the admin's session may read and downloads one timestamped `sealed-analytics-backup-<date>.json`. It is **bounded by RLS by design**: it captures the shared `products`/`snapshots`, public `news`, the admin's own `client_errors`/`cardmarket_excluded_singles`, and the admin's **own** portfolio (`user_settings`/`holdings`/`alerts`/`sales`/`purchases`) — **not** other users' private rows (per-user RLS blocks even the admin) nor the service-role-only `cardmarket_expansion_singles` cache (regenerable via Sync catalog); the file's `meta.note` records both exclusions. (2) **Weekly Action** — `scripts/export-backup.mjs` (service-role; pure `buildWorkbook()`/`buildFullDump()`, unit-tested in `tests/unit/export-backup.test.mjs`) run by `.github/workflows/backup.yml`, which uploads **two** artifacts: the re-importable tracked-data `.xlsx` (inverse of `supabase/migrate-xlsx.mjs`) **and**, via `--full-json`, a **complete whole-database `.json` dump — every table, every user's rows, including the per-user portfolios and the `cardmarket_*` caches** (the service-role key bypasses RLS, so this is the true full-DB backup the in-app button can't produce, and the one that scales as users grow). **The repo is PUBLIC, so the Action uploads NOTHING to a GitHub artifact — both files go to a private, off-site, S3-compatible bucket (Cloudflare R2 recommended) via `aws s3 cp --endpoint-url`. The dump is additionally gpg-AES-256-encrypted before upload (`.json.gpg`, `BACKUP_PASSPHRASE` secret) as defense-in-depth; the workflow fails before writing any dump if the passphrase or bucket secrets are unset.** Restore (download from the bucket → decrypt) + the admin-UUID-first ordering gotcha are in `SUPABASE.md` → *Backup & restore*. `tests/signed-in.spec.mjs` pins the in-tool backup (admin clicks → JSON download → the 10 table keys + RLS-caveat meta).

### Installable app (PWA)

The page is installable and works offline. Three static files carry it, deployed alongside `index.html` like everything else — **no build step**:

- **`manifest.webmanifest`** — name, colours (`#0a0b0f`, matching the `theme-color` meta and `:root --bg`), `display: standalone`, and the `icons/` PNGs (192 / 512 / maskable). Linked from `<head>` along with `apple-touch-icon` and the `apple-mobile-web-app-*` metas iOS reads instead of the manifest.
- **`sw.js`** — the service worker, registered by a small standalone `<script>` near the end of `<body>` (kept out of the ES module so a registration failure can't take the app down). Its strategy is deliberate: **same-origin GET is network-first** (the app is one frequently-edited file, so an online visitor must always get fresh code — the "PWA served a stale app for months" trap; the cache is only the *offline* fallback), the **pinned CDN libs + Google Fonts are cache-first** (versioned URLs, immutable — this is what makes charts render offline), and **Supabase + the FX API are bypassed entirely** (dynamic, per-user, auth-bearing — never cached, and writes must always hit the network). Bump `CACHE` in `sw.js` when the precached shell list changes. `icons/` is generated by `scripts/gen-pwa-icons.mjs`.
- **Install affordance** — a header **`#install-btn`** hidden until the browser fires `beforeinstallprompt` (Chromium), so it never shows a dead control. iOS Safari fires nothing (no install API), so the button stays hidden there; instead **`#ios-install-hint`** ("Install: tap Share, then Add to Home Screen") is revealed by the same script when it detects iOS Safari and the app isn't already running standalone — otherwise an iPhone user would see no install path at all.

The service worker is **blocked in the test suite** (`serviceWorkers: 'block'` in `playwright.config.mjs`) so its cache can't bleed across specs; only `tests/pwa.spec.mjs` re-enables it to prove the manifest, the register→activate→precache lifecycle, the install-button flow, and the iOS-Safari Share-sheet hint (via a spoofed iPhone user-agent).
