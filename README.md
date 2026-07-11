# Sealed TCG Analytics

A single-page dashboard for tracking sealed trading-card **product** (Booster Box, Elite Trainer Box, Bundle) prices over time and deciding when to buy. It currently tracks Pokémon TCG products. Everything runs in the browser from one `index.html` file, reading and writing a single Excel workbook you keep under version control — no server, no database, no build step.

> Investment Decision Dashboard · Prices in EUR

## What it does

- **Ranks every product** by an age-weighted value score so newer and older releases can be compared fairly.
- **Surfaces buy signals** (💰) when a product's price drops while its set value holds steady — a possible mispricing.
- **Charts price history, set-value-per-booster trends, and age-vs-value** across all tracked products.
- **Scenario explorer** — drag sliders for set value and price to see how the score would move.
- **Monthly data entry** — punch in the latest prices, add new releases, attach Cardmarket links, and export an updated `.xlsx` ready to commit back to the repo.

## Getting started

Because the dashboard auto-loads `pokemon_data.xlsx` with a `fetch()`, it needs to be served over HTTP — opening `index.html` directly from disk (`file://`) will block that request. Serve the folder with any static server:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000>. The bundled `pokemon_data.xlsx` loads automatically (it's also the offline fallback when cloud sync is enabled — see below).

The page pulls Chart.js and SheetJS from a CDN, so an internet connection is required on first load.

## The three tabs

| Tab | Purpose |
| --- | --- |
| 👋 **Welcome** | Overview, glossary, and how the workflow fits together. |
| 📊 **Analysis** | The decision view — ranked table, KPIs, price/value charts, buy signals, and the scenario explorer. |
| ✏️ **Data Entry** | The monthly update view — enter the latest prices and set values, add products, edit Cardmarket URLs, and export the updated workbook. |

## Monthly workflow

1. Once a month, fetch the latest prices from Cardmarket.
2. Enter them in the **Data Entry** tab (today's date is pre-filled as the snapshot label).
3. Click **⬇ Export updated .xlsx** to download the refreshed workbook.
4. Replace `pokemon_data.xlsx` in the repo and commit it — the next visit reflects the new data.

Add new products at any time from the Data Entry tab; the product name must match exactly between both sheets.

## Optional: cloud sync + login

The default setup is a single static file with no accounts — the workbook is the
source of truth. If you'd rather have **per-user logins with data stored in the
cloud** (log in from any device, save without committing a file), you can point
the app at a [Supabase](https://supabase.com) project while still hosting the
frontend on GitHub Pages. This is off unless you fill in `SUPABASE_CONFIG` in
`index.html`. See **[SUPABASE.md](SUPABASE.md)** for the full walkthrough.

## Data file format

`pokemon_data.xlsx` must contain two sheets with these exact (case-sensitive) column names. An optional `Links` sheet stores Cardmarket URLs.

### Sheet 1 — `Summary` (one row per product)

`Product` · `Type` (`BOX`, `ETB`, or `BUNDLE`) · `Release Date` · `Age (years)` · `Current Price (€)` · `Set Value (€)` · `Price / Booster (€)` · `SV / Booster` · `Age Weight` · `Wtd. Score`

### Sheet 2 — `Historical Data` (one row per product per snapshot)

`Product` (must match Summary exactly) · `Snapshot Date` (ISO `YYYY-MM-DD`) · `Price (€)` · `Set Value (€)`

The in-app **File Format Guide** (the 📋 button on the **Analysis** tab) documents every field in detail.

## Key concepts

- **Set Value** — the total market value of all cards in a complete set.
- **Price / Booster** — product price ÷ boosters inside (BOX = 36, ETB = 9, BUNDLE = 6).
- **SV / Booster** — Set Value ÷ Price/Booster. Reads as a value-for-money **×multiple** — how many times the price of a *single booster* the whole set is worth (e.g. `185×`), **not** a euro-per-pack amount. The core comparability metric; works across all product types.
- **Age Weight** — 0–1 multiplier. Products under a year old are penalised; ≥3 years = 1.0.
- **Wtd. Score** — SV / Booster × Age Weight. The headline ranking metric.
- **Buy Signal (💰)** — flagged when price dropped ≥5% in the last snapshot while set value held within ±5%.

## Project layout

```
index.html               Self-contained dashboard (markup, styles, and logic)
pokemon_data.xlsx        Tracked data workbook
scripts/validate-workbook.mjs  Checks the workbook matches the required format
tests/smoke.spec.mjs     Playwright test: page loads and every tab renders
SUPABASE.md              Optional cloud-sync + login setup guide
supabase/schema.sql      Database schema + Row-Level Security policies
supabase/migrate-xlsx.mjs  One-time workbook → Supabase migration script
```

## Checks (optional)

The dashboard needs nothing installed to run. There is an optional CI harness
that catches two easy-to-miss breakages — a malformed workbook (which makes the
live page silently fall back to sample data) and a change that stops a tab
rendering:

```bash
npm install          # one-time: installs the dev dependencies
npm run validate     # validate pokemon_data.xlsx against the required format
npm run test:e2e     # browser smoke test (installs a browser on first run)
npm test             # both of the above
```

These run automatically on every push and pull request via GitHub Actions
(`.github/workflows/ci.yml`). Run `npm run validate` after editing the workbook
to catch format mistakes before you commit.

## Tech

Vanilla HTML/CSS/JavaScript with [Chart.js](https://www.chartjs.org/) for charts and [SheetJS](https://sheetjs.com/) for reading and writing `.xlsx` files. No framework, no bundler.

## Disclaimer

This is a free, unofficial fan-made tool provided "as is" for informational purposes only. **It is not financial advice** — prices and values may be inaccurate or out of date, and nothing here is a recommendation to buy or sell. Always do your own research.

"Pokémon" and all related names are trademarks of Nintendo, Creatures Inc., GAME FREAK inc., and The Pokémon Company. This project is **not affiliated with, endorsed by, or sponsored by** any of them; product names are used for identification only.
