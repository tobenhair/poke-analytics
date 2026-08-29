# Sealed Analytics

A single-page dashboard for tracking sealed trading-card **product** (Booster Box, Elite Trainer Box, Bundle) prices over time and deciding when to buy. It currently tracks Pokémon TCG products. Everything runs in the browser from one `index.html` file, reading and writing a single Excel workbook you keep under version control — no server, no database, no build step.

> Finding great products at fair prices · Prices in EUR

**New here, or working on the code?** [`docs/architecture.svg`](docs/architecture.svg) maps the whole thing on one page — data sources, load path, the shared metrics core, and the tabs.

## What it does

- **Answers "is this fairly priced?"** — a **fair price in euros** per product (the expected-value-for-age fit inverted) and a plain-language verdict on the board. The board says in words how much to trust that fit — *strong fit* / *moderate fit* / *rough estimate* — and tapping it explains the method. **Very old sets show no fair price** — once the fit has decayed near zero, inverting it produces nonsense, and vintage sealed is collector-priced rather than value-driven, so the app declines to guess; the age at which it stops is derived from the fit and shifts automatically as more history is tracked.
- **Opens on the answer** — the Analysis tab leads with *Where to start*: one shortlist you can rank four ways — **Safe pick** (age-weighted score), **Best deal** (under fair price), **Best value** (set value per booster), or **Consider selling** (the exit-side view — products most over fair price or on an un-backed run-up) — with brand-new sets flagged so a shiny-but-unsettled release can't masquerade as the top buy.
- **Ranks every product** by an age-weighted value score so newer and older releases can be compared fairly.
- **Faceted filters with live counts** — combine **Type**, **Era**, **Set** and **price / age** ranges (behind *More filters*); every facet shows how many products match, and the board leads with the **top 12** with a *show all* to expand the full Era → Set → Product tree. **Save a filter combo** as a named view to jump back to it.
- **Surfaces buy signals** when a product's price drops while its set value holds steady — a possible mispricing.
- **Charts price history, set-value-per-booster trends, and age-vs-value** across all tracked products, comparing either products or whole sets.
- **Scenario explorer** — open any product's drill-down and drag the set-value and price sliders to see how its score would move.
- **Pick your currency** — a picker in the header shows every price on the dashboard (board, charts, drill-down, portfolio) in €, $, £ or kr, using one live exchange rate. It's display-only: the underlying data stays in euros, so the value rankings don't move when you switch. If the rate can't be fetched the page stays in € and says so.
- **Installable (PWA)** — add it to your phone's home screen or your desktop and launch it like an app: its own icon, no browser chrome, and an offline shell so it still opens (with the last-loaded data) when you have no signal. On Chromium browsers an **Install app** button appears in the header when it's installable; on iOS use Share → *Add to Home Screen*.
- **Monthly data entry** — punch in the latest prices, add new releases, attach Cardmarket links, and export an updated `.xlsx` ready to commit back to the repo.
- **With cloud sync enabled** (optional, see below): a private **portfolio** with unrealised P&L, realised P&L on what you've sold, a full **transaction log** (every buy and sell, with CSV export), concentration balancing and a value-over-time chart, plus **price alerts** on a fixed € target or on the fair price.

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
row. The columns it leaves out — type, set value, per-booster price, SV/booster, age,
score — are all in the product drill-down, one tap away. The drill-down opens
with a **set-identity header** — the product type and set name, colour-coded by
type, with the **set logo** (from the free [TCGdex](https://tcgdex.dev) API, for
identification only) shown when available — and carries **Cardmarket** and
**eBay** links for the product, so you can jump straight to the source to check
listings or buy.

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
| **Analysis** | always | The decision view — one **board** with a **Value / Relative / Momentum** lens toggle, **grouped Era → Set → Product** (collapsible; opens as an era overview with per-era/-set averages, expand down to the ranked products) with fair price and verdict, KPIs, price/value charts, and buy signals. The lens swaps the ranking and columns without leaving the panel: **Value** (the headline board), **Relative** (SV/Booster vs the expected-for-age line), **Momentum** (recent price action + drawdown). The Relative and Momentum lenses add a **set-vs-product comparison chart** — a diverging bar chart that rolls the metric up so you can compare whole releases at a glance. Click any product (the board, the top picks, or the age-vs-value scatter) to open its drill-down, which carries the full detail plus a what-if scenario sandbox. The denser charts (scatter, price-history and SV/Booster trend) carry an expand button — at any width — that opens a full-screen view you can pinch/scroll to zoom and drag to pan (with a Reset control). |
| **Portfolio** | signed in | Your private holdings and price alerts — unrealised P&L, realised P&L, a full buy/sell transaction log (CSV export), concentration balancer, value over time. |
| **Data Entry** | admin only | The monthly update view — enter the latest prices and set values, add products, edit Cardmarket URLs and product ids (the "CM ID" that drives automated ingestion), review thin-liquidity flags and **lock** a manual price on products whose automated price is unreliable, export the updated workbook, and **download a full JSON backup** of the cloud database. |
| **News** | everyone (cloud) | An opt-in headline feed — Pokémon TCG (priority), TCG investing, and Pokémon-business/owner-company results. It has its own **News** tab (between Welcome and Analysis), shown once the feed has items; headlines link out to the source. The logged-out demo doesn't list news — it teases News as one of the "What a free account unlocks" tiles. Server-fetched (browsers can't read RSS cross-origin). Setup in `SUPABASE.md`. |

## Monthly workflow

1. Once a month, fetch the latest prices from Cardmarket.
2. Enter them in the **Data Entry** tab (today's date is pre-filled as the snapshot label).
3. Click **Export updated .xlsx** to download the refreshed workbook.
4. Replace `pokemon_data.xlsx` in the repo and commit it — the next visit reflects the new data.

Add new products at any time from the Data Entry tab; the product name must match exactly between both sheets.

**Or automate it (Supabase mode):** a daily **Supabase Edge Function** writes the
snapshot for you from Cardmarket's official bulk files — Set Value from the set's
singles, box price from a blend of the market trend and sale average — so you don't have to enter prices by
hand. Adding products is hands-off: click **Resolve ids** to auto-fill each
product's Cardmarket **CM ID** and **Exp ID** by name-matching, then **Sync
catalog** to cache the set's card list — both are Edge Functions run from Data
Entry (no GitHub needed). Thin-liquidity grails can be **price-locked** so the
job leaves their price to your manual entry. See `SUPABASE.md` → *Automated
Cardmarket ingestion*.

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

`Product` · `Type` · `Packs` *(optional)* · `Release Date` · `Age (years)` · `Current Price (€)` · `Set Value (€)` · `Price / Booster (€)` · `SV / Booster` · `Age Weight` · `Wtd. Score`

`Type` is one of: `BOX` (36 packs) · `ETB` (9) · `ETB10` (10) · `ETB8` (8) · `BUNDLE` (6) · `BUNDLEDISPLAY` (60) · `COLLECTION` (varies) · `PACK` (1). The pack count drives the booster maths; the Elite Trainer Box variants (`ETB`/`ETB10`/`ETB8`) filter together under **Elite Trainer**, and the Bundle variants (`BUNDLE`/`BUNDLEDISPLAY`) under **Bundle**. `COLLECTION` filters on its own.

`Packs` *(optional)* is a per-product pack count that overrides the type's default — a whole number ≥ 1. Leave it blank for a fixed-count type; it is **required for `COLLECTION`**, whose pack count varies from one product to the next (a Premium/Special Collection ships anywhere from a couple of packs to a handful).

A `PACK` is a **loose single booster** and is treated as *reference data, not a ranked product*: a loose pack carries none of a sealed box's premium, so on value density it beats every box and would always top the rankings. `PACK` rows are therefore kept out of the board, the charts and the KPIs, and instead surface in the drill-down of the sealed products of the same set (matched by set name) as two reference tiles — **Loose pack price** (with the sealed-vs-loose premium per booster) and **Sealed premium** (the € you pay to buy sealed vs the same number of packs bought loose, `price − loose × boosters`) — without a loose pack ever being flagged as the recommended buy.

### Sheet 2 — `Historical Data` (one row per product per snapshot)

`Product` (must match Summary exactly) · `Snapshot Date` (ISO `YYYY-MM-DD`) · `Price (€)` · `Set Value (€)` · `Promo Value (€)` *(optional)*

`Promo Value (€)` is the combined value, at that snapshot, of the promo card(s) bundled into the product (e.g. an ETB's stamped promo — some products bundle more than one) that aren't part of the set's singles. It's **subtracted from price** for the per-booster maths so the product is judged on its boosters, not the extras; blank means none. It's a per-snapshot column because a promo card's own price moves over time — in cloud mode the daily ingestion fetches each card and sums them from their Cardmarket ids (the Data Entry **Promo IDs** column, a comma-separated list), so you don't type it by hand there.

The in-app **File Format Guide** (the **Format Guide** button on the **Analysis** tab) documents every field in detail.

## Key concepts

- **Set Value** — the total market value of all cards in a complete set.
- **Price / Booster** — product price ÷ boosters inside, set by Type (BOX = 36, ETB = 9, BUNDLE = 6, plus the variants ETB10 = 10, ETB8 = 8, BUNDLEDISPLAY = 60, PACK = 1), or by the product's own **Packs** for a variable-pack **COLLECTION**. If a product has a **Promo Value** (the bundled promo card(s)' combined price, tracked per snapshot — fetched daily from their Cardmarket ids in cloud mode), that value is subtracted from the price first, so the per-booster figure reflects only the boosters (an ETB isn't penalised for the promo(s) it also includes).
- **SV / Booster** — Set Value ÷ Price/Booster. Reads as a value-for-money **×multiple** — how many times the price of a *single booster* the whole set is worth (e.g. `185×`), **not** a euro-per-pack amount. The core comparability metric; works across all product types.
- **Age Weight** — 0–1 multiplier. Products under a year old are penalised; ≥3 years = 1.0.
- **Wtd. Score** — SV / Booster × Age Weight. The headline ranking metric.
- **Buy Signal** — flagged when price dropped ≥5% in the last snapshot while set value held within ±5%.
- **Data maturity** — the drill-down's *"How settled is this data?"* readout: age, how much history is tracked, and the peak-to-trough swing of price and set value. A new release's set value is usually elevated at launch and drifts down until the set leaves print, so its fair price is less settled — these facts let you judge that risk yourself. They are shown only; they never change the fair price or the verdict.

## Project layout

```
index.html               Self-contained dashboard (markup, styles, and logic)
metrics.js               The analytical core as pure functions (shared by the
                         page and the unit tests — one source of truth)
pokemon_data.xlsx        Tracked data workbook
manifest.webmanifest     Web app manifest (name, icons, colours) — makes it installable
sw.js                    Service worker: offline shell (network-first app, cache-first libs)
icons/                   PNG app icons (192/512/maskable), generated from the logo mark
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
scripts/gen-pwa-icons.mjs      Rasterises the logo mark into the PWA PNG icons
                         (dev-only tool; re-run and commit when the mark changes)
scripts/export-backup.mjs      Service-role backup: a re-importable .xlsx of
                         products+snapshots, plus (--full-json) a complete
                         all-tables, all-users .json dump of the whole database
.github/workflows/backup.yml   Weekly + on-demand backup → a private off-site
                         bucket (.xlsx + gpg-encrypted full-DB .json; never GitHub)
tests/unit/metrics.test.mjs    Unit tests for every derived number in metrics.js
tests/unit/repo-invariants.test.mjs  Checks facts that must agree across files
tests/unit/export-backup.test.mjs  Unit tests for the backup workbook writer
tests/smoke.spec.mjs     Playwright test: page loads and every tab renders
tests/signed-in.spec.mjs Playwright test: the cloud/login surface, driven
tests/fake-supabase-sdk.js     against an in-memory Supabase stand-in
tests/fx-currency.spec.mjs     Playwright test: the global display-currency
                         picker and its fallback when live FX rates are unavailable
tests/pwa.spec.mjs       Playwright test: the manifest, the service worker's
                         register→activate→precache, and the install-button flow
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

"Pokémon" and all related names, logos, and images are trademarks and copyrights of Nintendo, Creatures Inc., GAME FREAK inc., and The Pokémon Company. This is an independent analytics tool, **not affiliated with, endorsed by, or sponsored by** any of them — the product offered is the analysis tool, not the trading-card products it tracks. Product names, set logos, and images (set logos via the [TCGdex](https://tcgdex.dev) API) are used for identification and informational purposes only.
