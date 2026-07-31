# Sealed TCG Analytics

A single-page dashboard for tracking sealed trading-card **product** (Booster Box, Elite Trainer Box, Bundle) prices over time and deciding when to buy. It currently tracks Pokémon TCG products. Everything runs in the browser from one `index.html` file, reading and writing a single Excel workbook you keep under version control — no server, no database, no build step.

> Investment Decision Dashboard · Prices in EUR

**New here, or working on the code?** [`docs/architecture.svg`](docs/architecture.svg) maps the whole thing on one page — data sources, load path, the shared metrics core, and the tabs.

## What it does

- **Answers "is this fairly priced?"** — a **fair price in euros** per product (the expected-value-for-age fit inverted) and a plain-language verdict on the board. The board says in words how much to trust that fit — *strong fit* / *moderate fit* / *rough estimate* — and tapping it explains the method.
- **Opens on the answer** — the Analysis tab leads with *Best deals right now*: how many products are currently under their fair price, and the three biggest gaps.
- **Ranks every product** by an age-weighted value score so newer and older releases can be compared fairly.
- **Surfaces buy signals** when a product's price drops while its set value holds steady — a possible mispricing.
- **Charts price history, set-value-per-booster trends, and age-vs-value** across all tracked products, comparing either products or whole sets.
- **Scenario explorer** — drag sliders for set value and price to see how the score would move.
- **Monthly data entry** — punch in the latest prices, add new releases, attach Cardmarket links, and export an updated `.xlsx` ready to commit back to the repo.
- **With cloud sync enabled** (optional, see below): a private **portfolio** with unrealised P&L, concentration balancing and a value-over-time chart, plus **price alerts** on a fixed € target or on the fair price.

### Before you sign in

With cloud sync enabled, the logged-out page is where the tool explains itself:
the question it answers, the three ideas you need to read an answer (value
rather than price, why age moves the bar, what the verdict means), and a sample
of the three most recently released sets. It is deliberately **not** showing a
fair price or a verdict there — both are read off a fit across the whole
tracked catalogue, so a three-set preview couldn't produce the same number the
signed-in board does. It says as much rather than showing you one.

*How the fair price works* and *What the numbers mean* open from that page and
from the Welcome tab — the same two explanations either side of the login.
Signing in takes you straight to Analysis.

### When data doesn't load

The page ships with a few sample products so it's never blank — and it says so
plainly. A banner under the header states **"Sample data"** and why (a missing
workbook, a failed cloud load, an empty account) until real numbers arrive.
Nothing here is ever presented as a tracked price when it isn't one.

### Forgotten password

The sign-in dialog has a **Forgot your password?** link: it mails a recovery
link, and returning through it opens the form to set a new one. (With cloud sync
enabled — see the setup guide for the one redirect-URL setting it needs.)

### Icons

Navigation and state use a small **SVG icon set** drawn into the page, not
emoji — so they look the same on every platform and take the colour of the text
they sit with (the active tab's icon goes dark on gold; the buy-signal tag is
gold because it marks a signal).

### Reading it your way

Every numbered section carries a short explainer, and they **start collapsed** so
the page opens on the numbers — each one shows a small *ⓘ What this section
shows* you can expand, or use **Show explanations** in the header for all of
them at once. The choice is remembered on your device. Nothing is deleted:
expand any section whenever you want it.

### On a phone

The board shows **product · price · fair price** on a narrow screen, with the
product name frozen in place so swiping sideways for the rest can't lose your
row. The columns it leaves out — type, set value, €/booster, SV/booster, age,
score — are all in the product drill-down, one tap away. The drill-down also
carries **Cardmarket** and **eBay** links for the product, so you can jump
straight to the source to check listings or buy.

### Keyboard and screen-reader use

The whole dashboard is operable without a mouse. `Tab` reaches every control
with a visible focus ring; the tab bar behaves as a standard tab list (`←`/`→`
to move between tabs, `Home`/`End` for the first/last); any product on the
board opens its drill-down with `Enter` from the product name; and every dialog
traps focus while open, closes with `Esc`, and hands focus back to whatever
opened it. Sections are real headings, so a screen reader can jump between
them. `tests/a11y.spec.mjs` keeps all of that from regressing.

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

## The four tabs

Two are always visible; two appear only with cloud sync enabled and signed in.

| Tab | Shown | Purpose |
| --- | --- | --- |
| **Welcome** | always | A landing map: where each tab is, and the two shared explanations. |
| **Analysis** | always | The decision view — ranked board with fair price and verdict, KPIs, price/value charts, buy signals, and the scenario explorer. |
| **Portfolio** | signed in | Your private holdings and price alerts — unrealised P&L, concentration balancer, value over time. |
| **Data Entry** | admin only | The monthly update view — enter the latest prices and set values, add products, edit Cardmarket URLs and product ids (the "CM ID" that drives automated ingestion), and export the updated workbook. |

## Monthly workflow

1. Once a month, fetch the latest prices from Cardmarket.
2. Enter them in the **Data Entry** tab (today's date is pre-filled as the snapshot label).
3. Click **Export updated .xlsx** to download the refreshed workbook.
4. Replace `pokemon_data.xlsx` in the repo and commit it — the next visit reflects the new data.

Add new products at any time from the Data Entry tab; the product name must match exactly between both sheets.

**Or automate it (Supabase mode):** a scheduled job can write the daily
snapshot for you from Cardmarket's official bulk files — Set Value from the
set's singles, box price from the market trend — so you don't have to enter
prices by hand. Thin-liquidity grails can be **price-locked** so the job leaves
their price to your manual entry. See `SUPABASE.md` → *Automated Cardmarket
ingestion*.

The entry grid guards the numbers as you type: a large jump vs last month gets
an inline warning (an implausible one asks for confirmation before saving), and
a strip above the table flags data-quality issues — a skipped month between
snapshots, or a product whose value pattern doesn't match its Type.

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

The in-app **File Format Guide** (the **Format Guide** button on the **Analysis** tab) documents every field in detail.

## Key concepts

- **Set Value** — the total market value of all cards in a complete set.
- **Price / Booster** — product price ÷ boosters inside (BOX = 36, ETB = 9, BUNDLE = 6).
- **SV / Booster** — Set Value ÷ Price/Booster. Reads as a value-for-money **×multiple** — how many times the price of a *single booster* the whole set is worth (e.g. `185×`), **not** a euro-per-pack amount. The core comparability metric; works across all product types.
- **Age Weight** — 0–1 multiplier. Products under a year old are penalised; ≥3 years = 1.0.
- **Wtd. Score** — SV / Booster × Age Weight. The headline ranking metric.
- **Buy Signal** — flagged when price dropped ≥5% in the last snapshot while set value held within ±5%.

## Project layout

```
index.html               Self-contained dashboard (markup, styles, and logic)
metrics.js               The analytical core as pure functions (shared by the
                         page and the unit tests — one source of truth)
pokemon_data.xlsx        Tracked data workbook
docs/ux-expert-review.md WCAG 2.2 + heuristic review — the authoritative UX doc
docs/visual-design-review.md   Visual system audit: build vs documented tokens
docs/ux-assessment.md    Earlier journey/density pass (superseded, kept for data)
docs/architecture.svg    One-picture overview of how the app fits together
docs/architecture.mmd    …and the Mermaid source it is rendered from
scripts/validate-workbook.mjs  Checks the workbook matches the required format
                         (plus advisory data-quality warnings)
scripts/check-dead-code.mjs    Flags unused CSS rules, element IDs and functions
scripts/check-design-tokens.mjs  Flags colours and font sizes that bypass the
                         design tokens (the drift a reviewer can't see)
scripts/gen-scale-fixture.mjs  Generates a large, contract-valid workbook for
                         performance measurement (deterministic, dev-only)
scripts/measure-scale.mjs      Measures the board and charts at catalogue scale
                         (dev-only tool, deliberately not part of `npm test`)
tests/unit/metrics.test.mjs    Unit tests for every derived number in metrics.js
tests/unit/repo-invariants.test.mjs  Checks facts that must agree across files
tests/smoke.spec.mjs     Playwright test: page loads and every tab renders
tests/signed-in.spec.mjs Playwright test: the cloud/login surface, driven
tests/fake-supabase-sdk.js     against an in-memory Supabase stand-in
tests/fx-currency.spec.mjs     Playwright test: the Portfolio currency picker
                         and its fallback when live FX rates are unavailable
tests/a11y.spec.mjs      Playwright + axe test: no serious/critical WCAG
                         violations per tab, plus what axe can't see — keyboard
                         journeys (drill-down, focus trap, tab bar), 320px
                         reflow, 24px tap targets, and the phone board layout
tests/local-cdn.mjs      Serves Chart.js/SheetJS from node_modules so the
                         browser tests run offline (and pins their versions)
SUPABASE.md              Optional cloud-sync + login setup guide
supabase/schema.sql      Database schema + Row-Level Security policies
supabase/migrate-xlsx.mjs      One-time workbook → Supabase migration script
supabase/staleness-reminder.sql  Optional email when the data goes stale
supabase/alert-emails.sql        Optional email when a price alert triggers
supabase/error-digest.sql        Optional daily digest of client errors
```

## Checks (optional)

The dashboard needs nothing installed to run. There is an optional CI harness
that catches the easy-to-miss breakages — a wrong number in the scoring math, a
malformed workbook (which makes the live page silently fall back to sample
data), a change that stops a tab or the login surface rendering, and a
regression in keyboard operation or WCAG conformance:

```bash
npm install          # one-time: installs the dev dependencies
npm run test:unit       # the scoring/metrics math (metrics.js) + cross-file invariants
npm run validate        # validate pokemon_data.xlsx against the required format
npm run check:dead-code # unused CSS rules, element IDs and functions in index.html
npm run check:design-tokens  # colours/font sizes that bypass the design tokens
npm run test:e2e        # browser tests: static smoke, signed-in surface, accessibility
npm test                # all of the above
```

These run automatically on every push and pull request via GitHub Actions
(`.github/workflows/ci.yml`). Run `npm run validate` after editing the workbook
to catch format mistakes before you commit — it also prints advisory
data-quality warnings (a skipped month between snapshots, a product whose
value pattern doesn't match its Type) that don't block but deserve a look.

### Measuring performance at scale (occasional, not CI)

The catalogue is small today (36 products), so the page is fast. To know what
happens as it grows — and it will, if price ingestion is ever automated — there
is a measurement tool. It is **not** part of `npm test`: timings are
machine-dependent and would flake as a gate.

```bash
# Generate a big but contract-valid workbook (deterministic for a given seed)
npm run scale:fixture -- --products 400 --snapshots 24 --out /tmp/big.xlsx

# Measure the real page against generated fixtures and print a report
npm run scale:measure                          # the default matrix
npm run scale:measure -- --matrix 36x24,400x24 --repeats 7
```

A cell is written `NxM` — N products × M snapshots per product. Both axes
matter and they stress different code: N grows the board and the charts, M
grows each product's price history (what a daily ingestion cadence would
produce). The latest results and what they concluded are in
[`ROADMAP.md`](ROADMAP.md).

## Tech

Vanilla HTML/CSS/JavaScript with [Chart.js](https://www.chartjs.org/) for charts and [SheetJS](https://sheetjs.com/) for reading and writing `.xlsx` files. No framework, no bundler.

## Disclaimer

This is a free, unofficial fan-made tool provided "as is" for informational purposes only. **It is not financial advice** — prices and values may be inaccurate or out of date, and nothing here is a recommendation to buy or sell. Always do your own research.

"Pokémon" and all related names are trademarks of Nintendo, Creatures Inc., GAME FREAK inc., and The Pokémon Company. This project is **not affiliated with, endorsed by, or sponsored by** any of them; product names are used for identification only.
