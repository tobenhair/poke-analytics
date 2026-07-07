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

There are no lint/test/build commands. Verify changes by serving locally and exercising the three tabs in a browser (data auto-load, charts, Data Entry, export).

## Data model — two sources

There are **two** data sources; the workbook wins when it loads:

1. **Hardcoded fallback** in `index.html`: the `products` array, the `historicalData` object, and `histDates`. Used only if the workbook fails to load. Keep them mutually consistent if you touch the sample data.
2. **`pokemon_data.xlsx`** (the real data), auto-loaded on every visit by `tryAutoLoad()` and applied via `applyNewData()`. Users can also drag-drop or browse to a file.

The workbook has two required sheets — `Summary` (one row per product) and `Historical Data` (one row per product per snapshot) — plus an optional `Links` sheet (Cardmarket URLs). Exact column names are validated in `parseXlsx()` and documented in the in-app "Format Guide" modal and the README. `exportXlsx()` writes these sheets back out.

**To change the tracked data, edit the workbook — not the HTML.**

## Metrics & scoring (the analytical core)

- Boosters per product type: **BOX = 36, ETB = 9, BUNDLE = 6**.
- **Price / Booster** = price ÷ boosters. **SV / Booster** = Set Value ÷ (Price/Booster) — the core value-density metric (higher is better).
- **Age Weight** = `calcAgeWeight(age)`, a 0–1 penalty for products younger than `ageThreshold` (default **1 year**; slider range 0.5–3).
- **Wtd. Score** = SV/Booster × Age Weight — the primary ranking metric.

`recomputeScores()` recomputes each product's `ageWeight` and `score` from the current `ageThreshold`, and **must run before the first render** in both the `INIT` block and `applyNewData()` — otherwise the initial view uses the scores baked into the source data (this was a real, fixed bug). `svPerBooster` is threshold-independent.

## UI architecture

Three tabs (Welcome / Analysis / Data Entry) are `.tab-pane`s toggled by `.tab-btn[data-tab]`. The Analysis tab is a single vertically-stacked column of full-width sections, each introduced by a numbered `.section-eyebrow` (01–09): Top Picks, All Products table, Value/Booster, Age vs Value scatter (with a fitted "expected value for age" line), Relative Value, Price History, Momentum & Drawdown, Trend Over Time, Scenario Explorer.

Rendering follows a **state + render-function** pattern: module-level state (`activeType`, `sortKey`, `ageThreshold`, `trendProduct`, `ratioProduct`, …) plus render functions (`updateTable`, `updateKPIs`, `updateTopPicks`, `renderScatterChart`, `renderRelativeValue`, `renderMomentum`, `renderTrendChart`, `renderRatioChart`, `initScenario`, …). Chart.js instances live in module-level vars and are **destroyed and recreated** on each re-render. Any new render function must be wired into both `INIT` and `applyNewData()` so it runs on first load and after a data file loads.

A separate script near the end of `<body>` drives **reveal-on-scroll animations** via IntersectionObserver (`.rv` → `.rv-in`), replayed when a tab becomes active. It is a progressive enhancement — if IntersectionObserver is unavailable, nothing is hidden.

## Editing invariants

Markup, styles, and logic share one file, and the JS builds DOM from string templates, so:

- **Preserve element IDs and JS-referenced class names** (e.g. `product-tbody`, `top-picks-list`, `relval-tbody`, `momentum-tbody`, the `#*-chart` canvases, `.entry-input`, `.url-cell`, `.type-BOX/ETB/BUNDLE`, `.pill`, `.tab-btn`/`.tab-pane`). Renaming them silently breaks rendering.
- **Preserve the CSS variable names** in `:root` (`--bg`, `--accent`, `--muted`, …) — inline styles throughout the markup reference them.
- The All Products table's `.table-wrap` is a capped-height (`70vh`) scroll area with a sticky header; other tables use different wrappers.

## Workflow / deployment

Static hosting — deploy by committing `index.html` and `pokemon_data.xlsx`. The intended monthly loop (see README): open the dashboard → enter the month's prices and set values in **Data Entry** → **Export updated .xlsx** → replace `pokemon_data.xlsx` in the repo and commit. Data updates are manual by design; there is no automated price feed.
