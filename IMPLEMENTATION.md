# Implementation plans for the open roadmap items

This document turns every open item in [`ROADMAP.md`](ROADMAP.md) into an
executable plan: what to build, which files it touches, the decisions already
made (and the ones deliberately left open), how to verify it, and what "done"
means. It is written for a contributor who was not part of the planning —
each section should be enough to start from.

Depth is proportional to proximity: the **Now** items are specified to
hand-off level; **Then** items are solid plans that may be reordered by the UX
assessment; **Later** items are directional briefs that need a decision or a
spike before detailed planning would be honest.

## Cross-cutting conventions (apply to every item)

- **One item = one branch = one PR.** Small, reviewable, revertable.
- **Load the guard skills before touching their areas** (`.claude/skills/`):
  `design-review` for any UI, `data-integrity` for data/schema/loaders,
  `metrics-review` for any derived number, `verify-app` before every commit.
- **Definition of done** = the feature works and is verified per `verify-app`
  (green `npm test` + the real flow driven by hand), **and** the documentation
  rule in `CLAUDE.md` is satisfied in the same PR (including moving the item
  to ROADMAP's **Done**, condensed, and updating this file by deleting the
  item's section).
- **Two standing rules**: no derived number ships without a unit test in
  `tests/unit/`; no document may claim something the code no longer does.
- **Editing invariants** (see `CLAUDE.md`): preserve JS-referenced element
  IDs/classes and `:root` CSS variable names; new render functions must be
  wired into both `INIT` and `applyNewData()`.

---

## NOW — trustworthy numbers

### 1. Backup & restore

**Goal.** The Supabase database is the live source of truth and its only
backup today is a manual export button. Ship an automated weekly workbook
snapshot plus a documented, *rehearsed* restore path.

**Build:**

1. `scripts/export-backup.mjs` — Node script that:
   - Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env (service
     role bypasses RLS; the key must only ever live in GitHub Actions
     secrets, never in the repo or client).
   - Fetches `products` and `snapshots` via the REST API (`@supabase/supabase-js`
     as a devDependency, or plain `fetch` against `/rest/v1/` — plain fetch
     avoids a new dependency and is enough for two tables).
   - Writes a workbook with the **exact** contract `parseXlsx()` expects
     (sheets `Summary`, `Historical Data`, optional `Links`; column names per
     the Format Guide / README). Reuse the column logic in
     `supabase/migrate-xlsx.mjs` — this script is its inverse.
   - Self-checks: after writing, run the validator's logic against the output
     (spawn `node scripts/validate-workbook.mjs <outfile>`); non-zero exit
     fails the backup. A backup that can't be re-imported is not a backup.
2. `.github/workflows/backup.yml` — weekly cron (e.g. Monday 06:00 UTC):
   checkout → `npm ci` → run the script → upload the workbook as an artifact
   (90-day retention) **and** commit it to `backups/pokemon_data-<date>.xlsx`
   on `main`, pruning to the newest ~12 files so the repo doesn't grow
   unboundedly. Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. `SUPABASE.md` — a **Restore** section with the exact sequence: create/clean
   project → run `schema.sql` → run `supabase/migrate-xlsx.mjs` on the chosen
   backup file → verify in-app (spot-check a known product) → re-run the
   optional email jobs. **Rehearse it once against a scratch Supabase project
   and correct the doc from what actually happened** — the rehearsal is part
   of the item, not optional.

**Decisions left open:** none blocking; artifact-only vs commit-to-repo can be
cut to artifact-only if the maintainer prefers a lean repo (then retention is
the only copy — say so in SUPABASE.md).

**Verify:** run the script locally against the real project (read-only); run
the validator on its output; trigger the workflow manually
(`workflow_dispatch`) once; perform the restore rehearsal.

**Done when:** a green scheduled run exists, a restore has been rehearsed and
documented, and README's layout table lists the new script/workflow.

*Size: S/M. Dependencies: none. Touches: new script, new workflow, SUPABASE.md, README, ROADMAP.*

### 2. Performance at catalogue scale

**Goal.** Know — with numbers, before it happens organically — how the board
and charts behave at several hundred products. Measure first; optimise only
what the measurements convict.

**Build:**

1. `scripts/gen-scale-fixture.mjs` — deterministic (seeded PRNG) generator
   producing a contract-valid workbook: N products (default 400; realistic
   BOX/ETB/BUNDLE mix across ~60 release dates) × M snapshots (default 24
   monthly). Writes to a path given on argv. Validate with the validator.
2. Measurement harness — the cheapest honest method: serve a temp directory
   containing `index.html`, `metrics.js`, and the fixture renamed to
   `pokemon_data.xlsx`; drive it with a short Playwright script (not a CI
   spec) that loads the page and reads `performance.now()` timings injected
   around `applyNewData()` and each render function via
   `page.addInitScript`/`page.evaluate`. Capture: initial render, tab switch,
   type-filter change, sort change, drill-down open, at N ∈ {36, 200, 400}.
3. Record findings as a short table in the PR description and condense the
   conclusion into ROADMAP (either "fine up to N=400, nothing to do" — a
   perfectly good outcome — or new, specific items: e.g. "board innerHTML
   rebuild is O(n) per keystroke of search; batch it").

**Likely suspects if something is slow** (do NOT pre-fix them): per-row
`innerHTML` in `updateTable()`, chart dataset rebuilds on every filter change,
the comparison-picker chip list at hundreds of entries.

**Verify:** measurements are reproducible run-to-run (±10%); no repo behaviour
changes at all unless a fix item is spawned.

**Done when:** the numbers exist, the conclusion is in ROADMAP, and any needed
fixes are filed as their own items. *Size: S. Dependencies: none.*

### 3. Full code, comment & documentation audit

**Goal.** One deliberate end-to-end pass over everything the repo contains and
claims, applying the documentation rule retroactively. Behaviour-preserving.

**Method — three lenses, one commit per lens** so each is reviewable:

1. **Code.** Walk `index.html` top-to-bottom (it's ~5,200 lines; budget real
   time) and `metrics.js`. Hunt specifically for: dead functions/variables
   (grep each suspicious name for call sites), unused CSS rules (grep each
   class/ID against the markup and JS string templates — remember the JS
   builds DOM from strings, so a plain-markup grep is not enough), leftovers
   from removed features (the upload/drag-drop UI was removed; `parseXlsx`/
   `exportXlsx` stay — they serve the fallback and export), duplicated logic,
   and any derived-number math still inline (should be none; verify).
   Reconcile folder structure and `package.json` scripts with reality.
2. **Comments.** Every comment either states a constraint the code can't show
   or gets deleted. Kill anything describing *what the next line does*,
   anything stale ("no unit suite"-class lies), anything referring to code
   that moved. Add missing constraint comments where the audit itself needed
   tribal knowledge to understand something.
3. **Documentation.** For each of `README.md`, `SUPABASE.md`, `CLAUDE.md`,
   `ROADMAP.md`, the four skills, and the in-app Format Guide modal: read
   every factual claim, check it against the code, fix or delete. (Precedent:
   this process caught "three tabs", "no test suite", and a stale line count.)

**Rules:** `npm test` green before and after every commit; zero behaviour
change (if a "cleanup" changes behaviour it's a bug fix — separate PR);
findings too big to fix inline become new ROADMAP items rather than scope
creep.

**Done when:** all three lenses done, diff reviewed against the
behaviour-preserving rule, ROADMAP updated. *Size: M — mostly reading.
Dependencies: best after items 1–2 land (audit sweeps their docs too).*

### 4. Architecture overview diagram

**Goal.** One committed image mapping the moving parts, so a new contributor
doesn't reverse-engineer the architecture from a 5,200-line file.

**Build:** `docs/architecture.mmd` (Mermaid source, the editable truth) +
`docs/architecture.svg` rendered from it (`npx -y @mermaid-js/mermaid-cli`;
render locally, commit both — no build step is added). Content, one screen:

- The three data sources: hardcoded fallback / `pokemon_data.xlsx` /
  Supabase (with the demo + auth split).
- The load path: `boot()` → `loadFromSupabase()` | `tryAutoLoad()` →
  `parseXlsx()` → `applyNewData()` → `recomputeScores()` → render functions.
- `metrics.js` as the shared pure core, feeding both the page and
  `tests/unit/`.
- The four tabs and which render functions own them; the Supabase side jobs
  (staleness, alert emails, error digest) as satellites.

Link it near the top of `CLAUDE.md` and from README's layout section. Add a
"kept in sync" line to the documentation-rule table (`docs/architecture.mmd`
row: update when the load path or module structure changes).

**Done when:** the diagram matches `boot()` as actually written (verify by
reading, not memory) and both files render on GitHub. *Size: S.
Dependencies: none — but doing it after item 3 means diagramming the cleaned
truth.*

---

## THEN — design & usability (sequence subject to the UX assessment)

### 5. UX assessment (do first — it may reorder everything below)

Walk the real journeys end-to-end, cataloguing where each stalls: logged-out
visitor on the demo → sign-up → first sign-in; the maintainer's monthly Data
Entry loop; a price check on a phone (DevTools device mode minimum, a real
phone ideally); a first-time visitor trying to answer "is this fairly
priced?" unaided. Output is a **prioritised findings list** (severity ×
frequency), committed as `docs/ux-assessment.md`, plus a reordering PR for
the items below. No code changes in this item. *Size: S/M.*

### 6. Overview-first restructure

With the verdict shipped, the Analysis tab can lead with the answer: a
compact "best deals now" block (verdict-sorted, fair-price gap, drill-down
links — the data already exists in `updateTopPicks`/`verdict`) above the
nine numbered sections, which become progressive disclosure. Constraints:
preserve section IDs/canvases (editing invariants), keep `.section-eyebrow`
numbering, `design-review` throughout, smoke test must keep passing
unchanged. Plan the DOM moves on paper first; this is a large diff of mostly
markup. *Size: M/L. Depends on: 5.*

### 7. Collapsible section descriptions

Each `.section-desc` gets a per-section show/hide toggle plus one global
"hide descriptions" control; collapsed state = a small "ⓘ" affordance.
Persist per-user in `localStorage` (key e.g. `sta-desc-collapsed`), default
collapsed on small screens (`matchMedia('(max-width: 640px)')`), expanded on
desktop. Text stays in the DOM (`hidden` attribute or class, not removal) for
screen readers and first-timers. Set `aria-expanded` on the toggle. *Size: S.
Pairs with: 8.*

### 8. Mobile optimisation

Fix the audited phone experience: the 70vh `.table-wrap` scroll interplay
with page scroll, tap targets ≥ 44px (tab buttons, sort selects, chips),
chart legibility (Chart.js `maintainAspectRatio`/font sizes at narrow
widths), the Data Entry grid's horizontal overflow, and the stacked-section
density (item 7 is the first lever). Add one Playwright viewport test
(`devices['Pixel 7']` or similar) asserting no horizontal body scroll and
that the board renders. *Size: M. Depends on: 5 (for the priority list), 7.*

### 9. Set logos (drill-down first)

Decision to make first: asset source. **TCGdex serves set logo assets** (the
same API already planned for ingestion — one vendor, licensing terms to
confirm in the spike). Store the logo URL per set at load time (sets are
derived from release dates via `groupSets()` — a name→logo map fetched
lazily), render in the drill-down header only (board rows later, if at all),
with a text-only fallback when missing — never a broken image. Subordinate to
the numbers per `design-review`. *Size: S/M. Depends on: TCGdex spike (item
14b) confirming the asset source, else parked.*

### 10. Accessibility

- Tab system: `role="tablist"/"tab"/"tabpanel"`, `aria-selected`,
  arrow-key navigation between tabs.
- Board rows (they open the drill-down): `tabindex="0"` + Enter/Space
  activation, visible `:focus-visible` outline using `--accent`.
- Modals: focus trap + focus return on close (drill-down, Format Guide,
  account overlay); Esc already works.
- Non-colour cues: audit every place green/red alone carries meaning; the
  text verdict resolved the board — check momentum arrows, P&L, deltas.
- Add `@axe-core/playwright` as a devDependency and one spec asserting no
  serious/critical violations on each tab — turns a11y into a regression
  test instead of a one-off pass. *Size: M.*

### 11. First-class loading, empty, and error states

Inventory every async surface: `boot()`, `loadFromSupabase()`, `loadDemo()`,
cloud save, FX fetch, and — the critical one — the **workbook-failed →
sample-data fallback, which today masquerades as real data**. Give each a
designed state from existing tokens (skeleton/`.portfolio-empty`-style
panels, not spinners everywhere). The fallback specifically must show a
persistent, visible banner ("showing sample data — real data failed to
load") and the smoke test should assert it appears when the workbook 404s.
*Size: M.*

### 12 + 13. Onboarding, the demo as a pitch, and the Welcome tab (one PR)

These two roadmap bullets are one piece of work: today the pitch lives in two
places (Welcome tab for the signed-in, demo page for visitors) and both
under-explain the method. Recommended resolution: make the demo page the
single "what this is / how to read it" surface — lead with the tool's purpose
in one screen, then the fair-price story, then demo cards — and slim the
Welcome tab to a signed-in landing that links to the same explanations
(glossary modal shared by both). First-visit walkthrough:
`localStorage`-gated, dismissible, three steps (set value vs price, why age
matters, what the verdict means). Mostly copywriting; `design-review`
applies to every word. *Size: M. Depends on: 5.*

---

## AUTOMATED INGESTION — spike first, then pipeline

Both spikes are cheap, independent, and unblocked (the guards and error
monitoring they depended on have shipped). Run them before any pipeline code.

### 14a. Tradera price spike (product prices, SEK→EUR)

Register in Tradera's developer program (free; Application Key), then a
throwaway script calling SOAP `SearchService` for each of the 36 tracked
products (category IDs: booster boxes `1001340`, other boxes/ETBs `1001341`,
booster packs `1001339`; rate limit 100 calls/method/24h — one pass fits).
Measure per product: active "Köp nu" listing count, price spread, noise rate
(cases, 2-packs, sleeved, empty boxes) before/after keyword+price-band
filtering, and a proposed price (median of cleaned asking). Deliverable: a
coverage report (which products are reliably priceable weekly) committed to
`docs/`, and a go/no-go recommendation. **FX design decision to settle in the
spike:** conversion happens at ingestion, EUR is stored, and the rate used is
stored with each snapshot — plan a `snapshots.fx_rate numeric` column (plus
source+date) in a schema migration, so history stays reproducible.

### 14b. TCGdex set-value spike (Set Value, EUR)

One GraphQL query per tracked set (`api.tcgdex.net/v2/graphql`) pulling every
card's Cardmarket EUR price. Two questions to answer: (1) is a usable EUR
price per card actually returned today; (2) which sum definition best
reproduces the hand-entered Set Values — validate candidates (sum of all
cards' market price; chase/holo-rare subset) against the last N hand-entered
snapshots and pick the one with the lowest error, then **pin that formula**
as canonical. Also confirm set-logo asset availability + licensing for item
9. Politeness: cache responses on disk, one pass, self-throttled.

### 14c. Pipeline (only after both spikes pass)

A scheduled GitHub Action (weekly): Tradera fetch → clean → SEK→EUR → TCGdex
sums (slow cadence, cached) → write snapshot rows via service role → run the
delta/gap guards against the new rows → **open a PR for the maintainer to
review** rather than writing silently (human at the merge preserves the
credibility of the data; direct writes can come later once trusted). Never
coupled into the static page. Error digest catches its failures.
*Size: spikes S each; pipeline M/L.*

### 15. eBay Browse API cross-check — parked

Build only after 14c proves out; secondary signal (pan-EU asking prices) for
sanity-checking thin Tradera weeks. Not part of the core loop.

---

## LATER — briefs (need a decision or a prerequisite before real planning)

- **LLM assistant.** Server-side only (Supabase Edge Function holding the
  API key; never client-side). Grounding contract: the function receives the
  *computed* metrics (verdict, fair gap, drawdown, holdings summary) as
  structured JSON and the model explains/synthesises — it never sees raw
  scraped text and never invents a price. Gate behind sign-in; per-use cost
  means it lands last. Prerequisite: none technically, but product-wise wait
  for the fair-price surfaces to stabilise post-UX-restructure.
- **PWA / installable.** After mobile optimisation: `manifest.json`, icons,
  a minimal service worker (cache-first shell, network-first workbook),
  installability audit via Lighthouse. Revisit wrappers/native only if the
  PWA falls short of a concrete need.
- **Privacy-friendly analytics.** Decision first: Plausible/GoatCounter-class
  hosted script vs a self-rolled Supabase page-view counter (no new vendor,
  matches the beacon pattern). Needs the legal item's cookie/consent answer.
- **Legal/compliance.** Privacy policy page (what's stored: email, holdings;
  where; how to delete), GDPR basics, cookie/consent review (currently only
  localStorage + auth token — likely consent-exempt, verify). The "not
  financial advice" disclaimer exists.
- **Coverage growth.** More sets/eras = more rows in the same model; blocked
  on ingestion (14) making entry cost ~zero. Multi-currency display exists;
  multi-region *pricing* would be a data-model change — plan only when real.
- **Launch checklist.** Uptime expectations, support contact, versioned
  changelog, and a public "how the numbers work" methodology page (the trust
  document — largely written already across README/ROADMAP; consolidate).
