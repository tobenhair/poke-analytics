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

- `npm run test:unit` — `node --test` unit tests (`tests/unit/`). `metrics.test.mjs` covers the pure metrics module `metrics.js` (scoring/derivation, the age fit + fair price + verdict, momentum/drawdown, peer residuals, trend/buy signals, scenario math, set roll-ups, portfolio helpers); `index.html` imports the *same* file, so these assertions guard the live page's numbers, not a copy. `repo-invariants.test.mjs` covers the other kind of failure — two files that must agree with nothing relating them: the admin UUID in `supabase/schema.sql`'s `is_admin()` vs `SUPABASE_CONFIG.adminUserId`, and the all-blank-or-all-filled rule for that config. `cardmarket-lib.test.mjs` pins the automated-ingestion core (`scripts/cardmarket-lib.mjs`) — name-matching (singularisation, `nameHint`/`idProduct` pins) and the derive (Box Price = `(trend + avg)/2` blend, Set Value = `avg30` singles sum, `priceOverride`, the `low_liquidity` flag) — the same numbers the scheduled job writes to Supabase. No build step, no extra dependency. Rule: no derived number ships without a test here.
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
  - **Daily snapshot — `supabase/functions/cardmarket-daily/index.ts`** (Deno Edge Function, scheduled by `pg_cron` via `supabase/cardmarket-cron.sql`). It reads the products + the precomputed catalog from the DB, fetches **only** the smaller `price_guide` bulk file (keeping just the ids it needs as it parses, so memory stays bounded), derives, and upserts today's `snapshots` row with the auto-injected service-role key. Box Price = `(trend + avg)/2` (the 50/50 blend — thin boxes' true price sits between Cardmarket's smoothed trend and the sales avg; liquid boxes have trend ≈ avg; **skipped when `products.price_locked`**), Set Value = `avg30` all-cards singles sum, each row carries `low_liquidity` + the `price_avg`/`price_low` reference prices. Its derive math **mirrors `scripts/cardmarket-lib.mjs`** (pinned by `cardmarket-lib.test.mjs`), so it can't drift from the Node path.
  - **Resolve ids — `supabase/functions/cardmarket-resolve-ids/index.ts`** (Deno Edge Function, triggered from Data Entry's **Resolve ids** button, admin-only). For every product missing a `cardmarket_product_id` and/or `cardmarket_expansion_id` it name-matches against the (small) nonsingles catalogue and writes the ids back — **NULLs only**, never overwriting a manual pin — so bulk-adding products never needs a hand-sourced id. Its `norm`/`score`/0.6-threshold matching mirrors `scripts/cardmarket-lib.mjs` (pinned by `cardmarket-lib.test.mjs`).
  - **On-demand catalog refresh — `supabase/functions/cardmarket-catalog-refresh/index.ts`** (Deno Edge Function, triggered from Data Entry's **Sync catalog** button, admin-only — gated server-side by `is_admin()`). It caches, per `products.cardmarket_expansion_id`, the single-card ids that make up Set Value into **`public.cardmarket_expansion_singles`**, so the daily function never loads the huge singles file. It **streams** that file (`streamArray` reads the HTTP body chunk by chunk, one record at a time) so it stays inside the memory limit at any file size, and reports each set's card count + max single price as a contamination guardrail. The admin enters both ids by hand in Data Entry — **CM ID** (`cardmarket_product_id`) and **Exp ID** (`cardmarket_expansion_id`), the `productCmIds` / `productExpIds` buffers saved by `saveToSupabase()`.
  - **Local fallback — `scripts/cardmarket-ingest.mjs`** mirrors both halves on the command line (`--dry-run`, `--backfill-ids`, `--refresh-catalog`, or a direct snapshot) for offline preview / one-offs; production needs no GitHub Action (there is none — the daily job is `pg_cron`, the refresh is the button).
  Schema: `products.cardmarket_product_id` + `products.cardmarket_expansion_id` + `products.price_locked`, `snapshots.low_liquidity` + `snapshots.price_avg`/`price_low` (the guide's avg/low, shown in the Data Entry thin-liquidity review), and the `cardmarket_expansion_singles` cache in `supabase/schema.sql`; operator setup (deploy the three functions, click Resolve ids → Sync catalog, schedule `pg_cron`) in `SUPABASE.md`.
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

When configured, `boot()` (replacing the old bare `tryAutoLoad()` IIFE) loads the Supabase JS SDK from CDN, gates the UI behind a sign-in overlay (`#auth-overlay`, a direct child of `<body>` so it shows regardless of active tab), and on sign-in calls `loadFromSupabase()`. That function reads the `products`/`snapshots`/`user_settings` tables, **pivots** the normalized snapshot rows back into the aligned `price[]`/`setVal[]` arrays, and feeds them through the same `applyNewData()` path as the workbook. `saveToSupabase()` (the **☁ Save to cloud** button, `#save-cloud-btn`, shown only when signed in) upserts the Data Entry buffers (`entryData`, `pendingProducts`, `productUrls`, `productCmIds` and `productExpIds` — the per-product Cardmarket `idProduct` / `idExpansion` that drive the automated ingestion, entered in the Data Entry "CM ID" and "Exp ID" columns — and `productLocked` → `products.price_locked`, the per-row 🔒 price-lock) plus the age threshold. Product data (`products`/`snapshots`) is a **single shared dataset**: any signed-in user can read all of it, but only the **admin** — the account whose UUID equals `SUPABASE_CONFIG.adminUserId` — may write. `setAuthedUI()` adds `sb-authed` (sign-out + change-password, all signed-in users) to `<html>`, but adds `is-admin` (revealing Data Entry and cloud-save) **only** for the admin. This is UI gating only; the actual write boundary is enforced by the RLS write policies in `supabase/schema.sql` (a `public.is_admin()` function comparing `auth.uid()` to the admin UUID), so a non-admin who forced the UI open still cannot save. `user_settings` and `holdings` stay private per user. A signed-in user can change their password via the header **Change password** button (`#change-pw-btn`), which opens `#account-overlay` and calls `sbClient.auth.updateUser({ password })`.

Any signed-in user (not just the admin) can keep a private **Portfolio** and **Price Alerts**, which live together in their own signed-in-only top-level tab (`#tab-portfolio`, revealed by the `.tab-btn.sb-only[data-tab="portfolio"]` button) — the shared product data plus their own holdings/targets. `loadFromSupabase()` also reads the per-user `holdings` and `alerts` tables into the module-level `holdings` map (name → `{ quantity, costBasis }`) and `alerts` map (name → the user's buy target, of **two kinds**: `fixed`, a euro `target_price`; or `fair`, a `below_pct` meaning "≥ N% under the fair price"). `renderPortfolio()` derives unrealised P&L = (latest price − cost basis) × quantity, and shows the basket's **trailing 7d / 30d value change** as a sub-line on the *Current value* tile — the pure `portfolioValueChange(holdings, historicalData, histDates)` values the current holdings at every snapshot (`portfolioValueSeries`) and applies the same date-windowed rule as the Momentum table (`pctChangeOverDays`), so it survives the mixed monthly/daily cadence and is `—` until a window is covered; the %s are FX-neutral; `renderAlerts()` flags a product as triggered when its latest price is at or under the target — the euro figure for `fixed`, the recomputed fair-price threshold for `fair` — and `alertFlag()` surfaces a 🔔 on the Analysis All Products board via `updateTable()`. Fair alerts move as the age fit moves, which is why they are evaluated in-browser: the server-side email job (`supabase/alert-emails.sql`) can only cover `fixed` targets. Both render functions are wired into `INIT` and `applyNewData()`. The Portfolio tab also carries a **concentration balancer** (`renderBalancer()`, called from `renderPortfolio()`): it groups current holding value by set / release-year / product-type via the pure `concentrationShares()` in `metrics.js`, flags over-exposure (≥ `OVER_EXPOSED_SHARE`), and lists fair-price-aware rebalance buys — under-fair-price products in sets/types you underweight — via `rebalanceSuggestions()`. A **value-over-time** chart (`renderPortfolioValueChart()`, pure `portfolioValueSeries()`) plots the current holdings valued at every snapshot against the flat cost basis. All derived client-side; no new stored data. A **global display currency** (`displayCurrency`; € is canonical and the only *stored* unit) converts **every price on the page** at render time via `money()` and a single live FX rate fetched once from a key-less API (`fetchFxRates()`); the choice persists in `user_settings.currency` (`persistCurrency()`, per-user RLS, read in `loadFromSupabase()`). The picker lives in the page **header** (`#display-currency`), not the Portfolio tab, and drives the board, the Where-to-start shortlist, momentum, the drill-down (stats, scenario sliders, price-history chart), the §05 Price-History comparison, and the Portfolio tab alike. **Only absolute-money figures convert** (price, fair price, per-booster price, set value, P&L, alert targets); the ranking metrics — **SV/Booster and Wtd. Score** — are ratios of two € amounts, so a positive FX rate cancels out of them and they (and the scatter / SV-trend / Relative-Value views) are left untouched, staying comparable across users. **Everything the user *types* stays €** — Data Entry, the portfolio cost basis, and the fixed alert target are canonical-€ inputs (their placeholders still say €); conversion is display-only. Two formatters split the work: `money(vEur, dec)` takes a € amount and converts+labels it (the everywhere formatter for values read from the € data model); `symFmt(n, dec)` labels an *already-converted* number and is used in chart axes/tooltips, where Chart.js hands back values already in display-currency space (the plotted data is converted in the dataset builders, keyed on `fxRate()`). A currency switch calls `renderCurrencySensitive()`, which re-renders only the money-bearing views. **The picker only ever offers € plus the currencies it holds a live rate for**, so a €-only picker always means the FX fetch failed, never a missing feature: `FX_ENDPOINTS` tries Frankfurter's current host (`api.frankfurter.dev/v1/latest?base=…&symbols=…`) then the legacy one (`api.frankfurter.app/latest?from=…&to=…` — the two hosts spell the parameters differently, and on the new API `from`/`to` mean a *date range*, so the URLs are not interchangeable). If both fail the app stays in €, but says so: a `#fx-note` line next to the picker, a `console.warn`, and a `reportClientError()` beacon. Silently swallowing that failure was a real reported bug; `tests/fx-currency.spec.mjs` pins all three outcomes. The portfolio editor supports **buy-more** (adds quantity and blends cost basis to a weighted average via `commitHolding()`) and **edit-in-place** (`startPortfolioEdit()` overrides exact values). There are **no Save buttons** — every add/edit/remove auto-saves a single row (`persistHolding`/`deleteHoldingRow`, `persistAlert`/`deleteAlertRow`: `upsert` on `onConflict: 'user_id,product_id'`, `delete` on removal), with feedback in the tab's own `#portfolio-status`. RLS scopes every row to `auth.uid()`; both maps reset on sign-out.

Logged-out visitors see a **pre-login demo** (`#demo-page`, a `<body>` child shown by `setAuthedUI(null)` instead of a hard login gate). `loadDemo()` queries products/snapshots as the anonymous role — RLS `"demo read …"` policies expose only the rows in the 3 newest release dates (via the `public.demo_product_ids()` SECURITY DEFINER function) — then derives metrics with the shared `deriveProducts()` and renders read-only panels grouped by set (`renderDemo()`/`demoSetName()`). A **Sign in** button opens `#auth-overlay` (now dismissible via `#auth-close`); the full catalogue still requires login. See *The pitch lives once* below for what that page is and what it deliberately withholds.

Runtime errors are reported to an insert-only **`client_errors`** table (error monitoring): an early inline script near the top of `index.html` buffers `window.onerror`/`unhandledrejection` events from the first script tick, and the module drains the buffer via `reportClientError()`/`initErrorReporting()` once `sbClient` exists — deduped, capped at 10/session, fire-and-forget, a no-op in static mode. Anyone may insert (RLS blocks spoofing another `user_id`), only the admin may read; an optional daily `pg_cron` + Resend digest (`supabase/error-digest.sql`) emails a grouped summary and stays silent when the table is clean.

A **news feed** (Pokémon TCG — priority — plus TCG investing and Pokémon-business/owner-company headlines) is an opt-in companion. Browsers can't fetch third-party RSS (no CORS), so ingestion is server-side, mirroring the Cardmarket split: **`pg_cron` (hourly) → the `news-fetch` Edge Function** (`supabase/functions/news-fetch/index.ts`, scheduled by `supabase/news-cron.sql`) fetches the feeds, parses RSS **and** Atom, keyword-filters (broad sources only), dedupes by normalised URL, and upserts into the **`news`** table. Its parse/relevance/dedupe logic **mirrors the pure `scripts/news-lib.mjs`** (pinned by `tests/unit/news-lib.test.mjs`), and `scripts/news-fetch.mjs` is the Node CLI mirror for previewing feeds off-cloud. `news` is **public-read** (anon + authenticated — so the logged-out demo shows it too), **service-role-write only** (no client write policy). Only **headline + link + source + timestamp** is stored, never article bodies. The three v1 sources (`NEWS_SOURCES`): **PokéGuardian** (TCG, with a Google News `"Pokemon TCG"` query as a same-category fallback), **r/PokeInvesting** (investing), and a **Google News** `"Pokemon Company" earnings` query (business). Client side: `loadNews()` reads the table in **both** `loadFromSupabase()` and `loadDemo()` (fire-and-forget — a news failure never blocks the app); `renderNews()` fills a **TCG-first teaser** (`.news-teaser` on the Welcome tab + demo page) and a grouped **`#news-modal`** overlay (opened by the header `#news-btn` and every `.news-all` link, via `openOverlay`). External feed text is escaped (`escHtml`) and links are `http(s)`-guarded (`safeUrl`) + `target=_blank rel=noopener`, since titles/URLs are untrusted. The `#news-btn` and teasers stay hidden until the table returns rows, so static/xlsx builds show no dead controls. `tests/fake-supabase-sdk.js` serves `news` rows (public-read) and `tests/signed-in.spec.mjs` pins the teaser → grouped overlay → safe-link flow. Operator setup (run `schema.sql`, deploy the function, schedule the cron) is in `SUPABASE.md`.

Only **raw** inputs are stored in the DB (name/type/release/url + per-snapshot price/set-value + age threshold); derived metrics are recomputed client-side. Metric derivation is shared by both the xlsx and Supabase paths via the **`deriveProducts(newProducts, newHistoricalData)`** helper (and `boostersFromType()`), so the two loaders can never drift. These pure functions live in the standalone ES module **`metrics.js`**, imported by `index.html` (its main `<script type="module">`) and by the unit tests — one source of truth, no copy. Schema + RLS live in `supabase/schema.sql`; setup is documented in `SUPABASE.md`.

## Metrics & scoring (the analytical core)

The pure math lives in **`metrics.js`** (imported by `index.html` and unit-tested in `tests/unit/`). The functions take every dependency as a parameter — no DOM, no app globals — so `index.html` passes its live state (`products`, `ageThreshold`) in at each call site. Change a formula or constant *here*, once.

- Boosters per product type: **BOX = 36, ETB = 9, BUNDLE = 6**, plus the pack-count variants **ETB10 = 10, ETB8 = 8, BUNDLEDISPLAY = 60, PACK = 1** — all read from the **`PRODUCT_TYPES`** registry in `metrics.js` (`boostersFromType()`). A new product form is a registry entry (booster count + `category`), not a code change scattered across the app. `typeCategory()` maps each type to its filter/colour **bucket** (`BOX`/`ETB`/`BUNDLE`/`PACK`) — the ETB variants group under ETB, the Bundle variants under BUNDLE — and `typeLabel()` gives the short badge text. Filtering and per-type chart colour always go through `typeCategory(p.type)`, never a raw `p.type` compare; `index.html`'s `typeBadge()` / `CATEGORY_COLOR` are the single render helpers.
- **Price / Booster** = price ÷ boosters. **SV / Booster** = Set Value ÷ (Price/Booster) — the core value-density metric (higher is better).
- **Age Weight** = `calcAgeWeight(age, ageThreshold)`, a 0–1 penalty for products younger than `ageThreshold` (default **1 year**; slider range 0.5–3).
- **Wtd. Score** = SV/Booster × Age Weight — the primary ranking metric.

`recomputeScores(products, ageThreshold)` recomputes each product's `ageWeight` and `score` from the current `ageThreshold`, and **must run before the first render** in both the `INIT` block and `applyNewData()` — otherwise the initial view uses the scores baked into the source data (this was a real, fixed bug). `svPerBooster` is threshold-independent.

`metrics.js` also carries the **data-quality guards** — `snapshotGaps()` (skipped months in the snapshot cadence) and `typeOutliers()` (same-set SV/Booster consistency; a product far off its release siblings likely has the wrong Type). They surface as an advisory strip above the Data Entry table (`renderEntryQuality()`, `#entry-quality`) and as non-blocking warnings in `scripts/validate-workbook.mjs` — advisory in both places, never blocking.

## UI architecture

Four tabs (Welcome / Analysis / Portfolio / Data Entry) are `.tab-pane`s toggled by `.tab-btn[data-tab]` — Portfolio (`.sb-only`, signed-in) and Data Entry (`.admin-only`) are conditionally shown. The Analysis tab opens with the unnumbered **Where to start** shortlist (see below), then a single vertically-stacked column of full-width sections, each introduced by a numbered `.section-eyebrow` (01–07) — on-screen title first, internal name second: **01 The Board** (the All Products table), **02 Value Per Booster**, **03 Age vs Value** (the scatter, with a fitted "expected value for age" line), **04 Relative Value**, **05 Price History**, **06 Momentum & Drawdown**, **07 Trend Over Time**. The **What If / Scenario Explorer** is no longer a tab section — it lives inside the product drill-down (see below), always scoped to the product on screen. The Portfolio tab numbers its own sections independently (01–03: Your Portfolio, Value Over Time, Concentration & Rebalance).

Rendering follows a **state + render-function** pattern: module-level state (`activeType` — the global type filter, a *category* (`BOX`/`ETB`/`BUNDLE`/`PACK`, or `ALL`) so an ETB pill scopes to every ETB variant, `sortKey`, `ageThreshold`, …) plus render functions (`updateTable`, `updateKPIs`, `renderOverview`, `renderScatterChart`, `renderRelativeValue`, `renderMomentum`, `initScenario`, …). Chart.js instances live in module-level vars and are **destroyed and recreated** on each re-render. Any new render function must be wired into both `INIT` and `applyNewData()` so it runs on first load and after a data file loads. The Price History (§05) and SV/Booster Trend (§07) comparison views are built by a shared `createCompareView()` controller (instances `cmpHist`/`cmpSvb`) — a Products⇄Sets mode toggle, a capped multi-series picker (chips + a legend that toggles series), with set roll-ups via `groupSets()`/`meanSeries()` in `metrics.js`; each instance is `init()`ed in `INIT` and `refresh()`ed in `applyNewData()` and on type-filter change. `activeType` scopes the board plus every analytical chart/comparison view via the `visibleProducts()` helper (`applyTypeFilter()`).

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
  *Sign out* row overflowed a phone (clipped off the right edge). It's a
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
  Where-to-start shortlist builds the same `.row-open` button; the
  Relative Value (§04) and Momentum (§06) tables now do too (whole row clickable
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
- **The drill-down header shows the set logo (TCGdex), best-effort.**
  `ensureSetLogos()` fetches `api.tcgdex.net/v2/en/sets` once per session
  (lazily, on the first drill-down), caches a normalised `set name → logo base
  URL` map, and swallows every failure; `renderDrillLogo()` derives the set name
  from the **product's own name** (`setLogoKey()` strips the SKU suffix — *not* a
  release-date grouping, which would merge twin sets sharing a date like **Black
  Bolt / White Flare** into one mislabelled group matching no logo), looks it up,
  sets `#drill-logo`'s `src` to `base + '.png'`, and un-hides it only on `onload`
  — guarded on `drillProduct` so a late fetch can't paint onto another product.
  A set whose app name differs from TCGdex's (or that TCGdex hasn't added yet) is
  pinned in **`SET_LOGO_ALIASES`** (normalised app name → normalised TCGdex name)
  — the one place to fix a future mismatch. Any miss (offline, blocked, CORS,
  unmatched set, 404) leaves the text title as the fallback — **never a broken
  image**. Logos are **hotlinked, not re-hosted** (a deliberate licensing
  choice); the footer carries the non-affiliation + TCGdex attribution notice.
  Tests stub `api.tcgdex.net` → `[]` in `tests/local-cdn.mjs` (hermetic; the
  smoke spec pins `#drill-logo` hidden). Sealed-product *photos* are a separate,
  unbuilt problem — the card APIs don't carry them (see `IMPLEMENTATION.md` #9).
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
  calls `zoomChart.resetZoom()`. Because zoom sets fractional axis bounds, the
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
sort; the tree only nests the result. It opens as a **pure era overview** (every
era collapsed — `expandedEras`/`expandedSets` start empty), so the page leads with
~5 era headline rows; expand an era to its sets, a set to its product rows.

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
  headline rows; `updateTable()` and the two analytical tables (below) all call
  it. `ctx` carries everything table-specific: the headline `colspan`, the pair
  of expand-state `Set`s, the `rerender` to run on toggle, whether a live
  `searching` forces every group open, an optional era `tail` summariser, and the
  `leaf` builder for a product row. `groupRow()` reads its colspan/state/rerender
  off `ctx` too. Products passed in must carry `release`/`svPerBooster`/`fairGap`/
  `price` — `groupStats()` reads them for the headline aggregates.

### §04 Relative Value and §06 Momentum reuse the same tree

`renderRelativeValue()` (`#relval-tbody`, colspan 6) and `renderMomentum()`
(`#momentum-tbody`, colspan 7) render their rankings through the same
`renderGroupTree()` as the board, each with its own independent expand state
(`relvalExpandedEras`/`relvalExpandedSets`, `momentumExpandedEras`/
`momentumExpandedSets`), also opening as a pure era overview. Both feed the tree
**product objects** (so `groupStats()`/`boardSets()` work unchanged) and a `leaf`
builder that renders the ranking row: `relvalRowTr()` / `momentumRowTr()`. The
sort each table already computed is preserved *within* a set — for Relative Value,
`peerResiduals()` returns bare `{name,…}` objects with no release, so they're
mapped back to their products for grouping via a name→product map and a
name→residual lookup keys the leaf; Momentum's rows already carry the product, so
a name→momentum map keys its leaf. Neither table has a search box, so `searching`
is always `false` (no force-expand). Both are already wired into `INIT`,
`applyNewData()` and `applyTypeFilter()`; their group toggles re-render via
`ctx.rerender`.

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
name (`position: sticky; left: 0`), and shows a `.scroll-hint` line. The grouped
**Era/Set headline rows wrap** on a phone (`.grp-stats` becomes a block) so even
the collapsed era overview never forces a two-dimensional swipe. Reasons a
future change should preserve:

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
- The **`.svb-chart-wrap`** wrapper exists because Chart.js sizes a
  `maintainAspectRatio: false` chart to its *parent* — a height on the canvas is
  circular. The Top-10 bar chart is a fixed list of ten rows, so its height must
  come from the row count; at the default 2:1 ratio a phone gave it 166px and
  Chart.js silently dropped every other product label.
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

One shortlist, three **lenses** (`startLens`, a pill toggle at `#start-lens`):
**Safe pick** (age-weighted `score`, the default and conservative pick), **Best
deal** (`fairGap`, headline **% under fair**), **Best value** (`svPerBooster`,
headline **× multiple**). Every card shows all three signals with the active lens
lit (`startMetrics`), and the headline figure follows the lens (`startPrimary`) so
a fair-price % and a value multiple never share a slot. A **new set** (age weight
< 1) is flagged ⚠ with its `age weight → score` inline (`.pick-flag` + the
`.is-new` accent rule) wherever the active lens ranks it — under **Safe** it
appears only if its *penalised* score still earns a top-`START_COUNT` spot, which
is exactly what the age penalty is for; under **Deal/Value** it surfaces the
raw-signal leaders it naturally tops. Both `renderOverview` and `startCard` live
above the `INIT` block (temporal-dead-zone rule).

Its one honesty rule survives: **when `fairPriceTrusted()` is false the Deal lens
must not rank by the fair price** — it falls back to Safe and says so in the lead.
A ranking built on a number the rest of the page disregards would be the most
damaging kind of wrong here.

### The pitch lives once — demo page vs Welcome tab

Two surfaces used to explain the app, and only one of them was reachable by the
people who needed it. The split is now by **role**, and the rule is that no
explanation exists in two places:

- **`#demo-page` is the pitch** — the only "what this is / how to read it"
  surface. Order is the argument: the question (`.hero-title`), then the three
  ideas needed to read an answer (`.steps`), then the sample rows. Prose goes
  here, not on Welcome.
- **`#tab-welcome` is a signed-in landing** — where to go, and links to the same
  explanations. It must not grow a second pitch; if you find yourself writing
  what the app is *for* on this tab, it belongs on the demo page.
- **The explanations are shared dialogs.** `#method-modal` (the fair-price
  method) and `#glossary-modal` (every term) are opened by **class**, not id —
  `.method-open` / `.glossary-open` — precisely so a third caller costs nothing
  and no surface can define SV/Booster its own way. `#fair-fit-note` on the
  board is one of the `.method-open` callers.
- **Signing in lands on Analysis**, not Welcome — the pitch is read once, logged
  out, and Analysis opens on the answer. It is wired in the
  `uid !== sbLoadedUserId` branch of `onAuthStateChange` on purpose: a token
  refresh fires that handler too, and switching tabs under a reading user would
  be a bug. It dispatches a **click** rather than calling `activateTab()`, so
  the reveal-on-scroll handler (which listens for clicks) replays.

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

- **Preserve element IDs and JS-referenced class names** (e.g. `product-tbody`, `overview-deals`, `start-lens`, `relval-tbody`, `momentum-tbody`, the `#*-chart` canvases, `.entry-input`, `.url-cell`, `.type-BOX/ETB/BUNDLE/PACK`, `.pill`, `.tab-btn`/`.tab-pane`). Renaming them silently breaks rendering.
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
- The All Products table's `.table-wrap` is a capped-height (`70vh`) scroll area with a sticky header; other tables use different wrappers. A `.table-wrap` with **no focusable content inside** needs `tabindex="0"` or it cannot be scrolled by keyboard (§04 and §06 carry it; the board doesn't need it — its rows have `.row-open` buttons).

## Workflow / deployment

Static hosting — deploy by committing `index.html` and `pokemon_data.xlsx`. The intended monthly loop (see README): open the dashboard → enter the month's prices and set values in **Data Entry** → **Export updated .xlsx** → replace `pokemon_data.xlsx` in the repo and commit. That manual loop still works, but in Supabase mode the **Cardmarket ingestion** writes the daily snapshot automatically — three Supabase **Edge Functions**: `cardmarket-daily` (the snapshot, scheduled by `pg_cron`), `cardmarket-resolve-ids` (auto-fill each product's CM ID / Exp ID, **Resolve ids** button) and `cardmarket-catalog-refresh` (the on-demand set-card-list cache, **Sync catalog** button). No GitHub Action; see `SUPABASE.md`. A per-product price-lock keeps anything you'd rather set by hand.

### Installable app (PWA)

The page is installable and works offline. Three static files carry it, deployed alongside `index.html` like everything else — **no build step**:

- **`manifest.webmanifest`** — name, colours (`#0a0b0f`, matching the `theme-color` meta and `:root --bg`), `display: standalone`, and the `icons/` PNGs (192 / 512 / maskable). Linked from `<head>` along with `apple-touch-icon` and the `apple-mobile-web-app-*` metas iOS reads instead of the manifest.
- **`sw.js`** — the service worker, registered by a small standalone `<script>` near the end of `<body>` (kept out of the ES module so a registration failure can't take the app down). Its strategy is deliberate: **same-origin GET is network-first** (the app is one frequently-edited file, so an online visitor must always get fresh code — the "PWA served a stale app for months" trap; the cache is only the *offline* fallback), the **pinned CDN libs + Google Fonts are cache-first** (versioned URLs, immutable — this is what makes charts render offline), and **Supabase + the FX API are bypassed entirely** (dynamic, per-user, auth-bearing — never cached, and writes must always hit the network). Bump `CACHE` in `sw.js` when the precached shell list changes. `icons/` is generated by `scripts/gen-pwa-icons.mjs`.
- **Install affordance** — a header **`#install-btn`** hidden until the browser fires `beforeinstallprompt` (Chromium), so it never shows a dead control. iOS Safari fires nothing (no install API), so the button stays hidden there; instead **`#ios-install-hint`** ("Install: tap Share, then Add to Home Screen") is revealed by the same script when it detects iOS Safari and the app isn't already running standalone — otherwise an iPhone user would see no install path at all.

The service worker is **blocked in the test suite** (`serviceWorkers: 'block'` in `playwright.config.mjs`) so its cache can't bleed across specs; only `tests/pwa.spec.mjs` re-enables it to prove the manifest, the register→activate→precache lifecycle, the install-button flow, and the iOS-Safari Share-sheet hint (via a spoofed iPhone user-agent).
