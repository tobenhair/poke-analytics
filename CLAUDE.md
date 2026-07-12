# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page dashboard for tracking Pokémon TCG **sealed-product** (Booster Box / Elite Trainer Box / Booster Bundle) prices and deciding when to buy. The entire app is one self-contained `index.html` — markup, CSS, and JavaScript are all inline. There is **no build step, no framework, no bundler, and no test suite.**

Repo contents:
- `index.html` — the whole application (~2,900 lines).
- `pokemon_data.xlsx` — the tracked data workbook (auto-loaded at runtime).
- `README.md` — user-facing overview and data-file format.

## Running / developing

The page `fetch()`es `pokemon_data.xlsx`, so it **must be served over HTTP** — opening `index.html` via `file://` blocks that request and it falls back to the hardcoded sample data. Serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

External libraries load from CDNs at runtime (no install step): **Chart.js 4.4.1**, **SheetJS/xlsx 0.18.5**, and Google Fonts. An internet connection is required on first load.

The app itself has no build/bundle step — it's still one static `index.html`. There is, however, a lightweight CI harness (Node, dev-only) that guards against regressions:

- `npm run test:unit` — `node --test` unit tests (`tests/unit/`) over the pure metrics module `metrics.js` (`boostersFromType`, `calcAgeWeight`, `recomputeScores`, `deriveProducts`). `index.html` imports the *same* file, so these assertions guard the live page's numbers, not a copy. No build step, no extra dependency.
- `npm run validate` — parses `pokemon_data.xlsx` and asserts the exact contract `parseXlsx()` + `deriveProducts()` enforce (sheet/column names, Types, dates, cross-references, usable latest price/set value). Catches the *silent* fallback-to-sample-data that a malformed workbook would otherwise cause. Keep `scripts/validate-workbook.mjs` in sync with `parseXlsx()`.
- `npm run test:e2e` — a Playwright smoke test that loads the real page over HTTP against the real workbook and asserts every tab renders without runtime errors (the automated backstop for bugs like a missed `recomputeScores()` before first render). It blanks `SUPABASE_CONFIG` at request time to force the static/xlsx path, so it needs no cloud credentials.
- `npm test` runs all three. `.github/workflows/ci.yml` runs them on every push/PR.

Beyond CI, still verify UI changes by hand: serve locally and exercise the three tabs in a browser (data auto-load, charts, Data Entry, export).

## Data model — two sources

There are **two** data sources; the workbook wins when it loads:

1. **Hardcoded fallback** in `index.html`: the `products` array, the `historicalData` object, and `histDates`. Used only if the workbook fails to load. Keep them mutually consistent if you touch the sample data.
2. **`pokemon_data.xlsx`** (the real data), auto-loaded by `tryAutoLoad()` and applied via `applyNewData()`. In Supabase mode this is only the offline fallback (loaded if cloud init fails); the drag-drop/browse upload UI has been removed, though `parseXlsx()`/`exportXlsx()` remain for the fallback and for exporting a backup.

The workbook has two required sheets — `Summary` (one row per product) and `Historical Data` (one row per product per snapshot) — plus an optional `Links` sheet (Cardmarket URLs). Exact column names are validated in `parseXlsx()` and documented in the in-app "Format Guide" modal and the README. `exportXlsx()` writes these sheets back out.

**To change the tracked data, edit the workbook — not the HTML.**

### Optional third source — Supabase (cloud sync + auth)

A third, **opt-in** source exists. It is active only when both `window.SUPABASE_CONFIG.url` and `.anonKey` (a `<script>` block near the top of `index.html`) are filled in. While they are blank the app behaves exactly as the static/xlsx version — no login, no new network requests — so the default GitHub Pages deployment is unaffected.

When configured, `boot()` (replacing the old bare `tryAutoLoad()` IIFE) loads the Supabase JS SDK from CDN, gates the UI behind a sign-in overlay (`#auth-overlay`, a direct child of `<body>` so it shows regardless of active tab), and on sign-in calls `loadFromSupabase()`. That function reads the `products`/`snapshots`/`user_settings` tables, **pivots** the normalized snapshot rows back into the aligned `price[]`/`setVal[]` arrays, and feeds them through the same `applyNewData()` path as the workbook. `saveToSupabase()` (the **☁ Save to cloud** button, `#save-cloud-btn`, shown only when signed in) upserts the Data Entry buffers (`entryData`, `pendingProducts`, `productUrls`) plus the age threshold. Product data (`products`/`snapshots`) is a **single shared dataset**: any signed-in user can read all of it, but only the **admin** — the account whose UUID equals `SUPABASE_CONFIG.adminUserId` — may write. `setAuthedUI()` adds `sb-authed` (sign-out + change-password, all signed-in users) to `<html>`, but adds `is-admin` (revealing Data Entry and cloud-save) **only** for the admin. This is UI gating only; the actual write boundary is enforced by the RLS write policies in `supabase/schema.sql` (a `public.is_admin()` function comparing `auth.uid()` to the admin UUID), so a non-admin who forced the UI open still cannot save. `user_settings` and `holdings` stay private per user. A signed-in user can change their password via the header **Change password** button (`#change-pw-btn`), which opens `#account-overlay` and calls `sbClient.auth.updateUser({ password })`.

Any signed-in user (not just the admin) can keep a private **Portfolio** and **Price Alerts** — the shared product data plus their own holdings/targets. `loadFromSupabase()` also reads the per-user `holdings` and `alerts` tables into the module-level `holdings` map (name → `{ quantity, costBasis }`) and `alerts` map (name → buy-below target €). `renderPortfolio()` (section 10) derives unrealised P&L = (latest price − cost basis) × quantity; `renderAlerts()` (section 11) flags a product as triggered when its latest price ≤ target, and `alertFlag()` surfaces a 🔔 on the All Products board via `updateTable()`. Both render functions are wired into `INIT` and `applyNewData()` and gated `.sb-only`. `savePortfolio()`/`saveAlerts()` (**☁ Save portfolio** `#portfolio-save-btn` / **☁ Save alerts** `#alerts-save-btn`) each replace the user's rows (delete-all + insert); RLS scopes every row to `auth.uid()`. Both maps reset on sign-out.

Logged-out visitors see a **pre-login demo** (`#demo-page`, a `<body>` child shown by `setAuthedUI(null)` instead of a hard login gate). `loadDemo()` queries products/snapshots as the anonymous role — RLS `"demo read …"` policies expose only the rows in the 3 newest release dates (via the `public.demo_product_ids()` SECURITY DEFINER function) — then derives metrics with the shared `deriveProducts()` and renders read-only cards grouped by set (`renderDemo()`/`demoSetName()`). A **Sign in** button opens `#auth-overlay` (now dismissible via `#auth-close`); the full catalogue still requires login.

Only **raw** inputs are stored in the DB (name/type/release/url + per-snapshot price/set-value + age threshold); derived metrics are recomputed client-side. Metric derivation is shared by both the xlsx and Supabase paths via the **`deriveProducts(newProducts, newHistoricalData)`** helper (and `boostersFromType()`), so the two loaders can never drift. These pure functions live in the standalone ES module **`metrics.js`**, imported by `index.html` (its main `<script type="module">`) and by the unit tests — one source of truth, no copy. Schema + RLS live in `supabase/schema.sql`; setup is documented in `SUPABASE.md`.

## Metrics & scoring (the analytical core)

The pure math lives in **`metrics.js`** (imported by `index.html` and unit-tested in `tests/unit/`). The functions take every dependency as a parameter — no DOM, no app globals — so `index.html` passes its live state (`products`, `ageThreshold`) in at each call site. Change a formula or constant *here*, once.

- Boosters per product type: **BOX = 36, ETB = 9, BUNDLE = 6** (`boostersFromType()`).
- **Price / Booster** = price ÷ boosters. **SV / Booster** = Set Value ÷ (Price/Booster) — the core value-density metric (higher is better).
- **Age Weight** = `calcAgeWeight(age, ageThreshold)`, a 0–1 penalty for products younger than `ageThreshold` (default **1 year**; slider range 0.5–3).
- **Wtd. Score** = SV/Booster × Age Weight — the primary ranking metric.

`recomputeScores(products, ageThreshold)` recomputes each product's `ageWeight` and `score` from the current `ageThreshold`, and **must run before the first render** in both the `INIT` block and `applyNewData()` — otherwise the initial view uses the scores baked into the source data (this was a real, fixed bug). `svPerBooster` is threshold-independent.

## UI architecture

Three tabs (Welcome / Analysis / Data Entry) are `.tab-pane`s toggled by `.tab-btn[data-tab]`. The Analysis tab is a single vertically-stacked column of full-width sections, each introduced by a numbered `.section-eyebrow` (01–09): Top Picks, All Products table, Value/Booster, Age vs Value scatter (with a fitted "expected value for age" line), Relative Value, Price History, Momentum & Drawdown, Trend Over Time, Scenario Explorer.

Rendering follows a **state + render-function** pattern: module-level state (`activeType`, `sortKey`, `ageThreshold`, `trendProduct`, `ratioProduct`, …) plus render functions (`updateTable`, `updateKPIs`, `updateTopPicks`, `renderScatterChart`, `renderRelativeValue`, `renderMomentum`, `renderTrendChart`, `renderRatioChart`, `initScenario`, …). Chart.js instances live in module-level vars and are **destroyed and recreated** on each re-render. Any new render function must be wired into both `INIT` and `applyNewData()` so it runs on first load and after a data file loads.

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
- **`verify-app`** — before committing any change: how to actually verify in an
  app with no unit suite (serve over HTTP, `npm test`, exercise the tabs).

## Editing invariants

Markup, styles, and logic share one file, and the JS builds DOM from string templates, so:

- **Preserve element IDs and JS-referenced class names** (e.g. `product-tbody`, `top-picks-list`, `relval-tbody`, `momentum-tbody`, the `#*-chart` canvases, `.entry-input`, `.url-cell`, `.type-BOX/ETB/BUNDLE`, `.pill`, `.tab-btn`/`.tab-pane`). Renaming them silently breaks rendering.
- **Preserve the CSS variable names** in `:root` (`--bg`, `--accent`, `--muted`, …) — inline styles throughout the markup reference them.
- The All Products table's `.table-wrap` is a capped-height (`70vh`) scroll area with a sticky header; other tables use different wrappers.

## Workflow / deployment

Static hosting — deploy by committing `index.html` and `pokemon_data.xlsx`. The intended monthly loop (see README): open the dashboard → enter the month's prices and set values in **Data Entry** → **Export updated .xlsx** → replace `pokemon_data.xlsx` in the repo and commit. Data updates are manual by design; there is no automated price feed.
