# Implementation plans for the open roadmap items

This document turns every open item in [`ROADMAP.md`](ROADMAP.md) into an
executable plan: what to build, which files it touches, the decisions already
made (and the ones deliberately left open), how to verify it, and what "done"
means. It is written for a contributor who was not part of the planning —
each section should be enough to start from.

Depth is proportional to proximity: the **Now** items are specified to
hand-off level; **Then** items are solid plans, ordered by the UX assessment's
findings (`docs/ux-assessment.md`); **Later** items are directional briefs that
need a decision or a spike before detailed planning would be honest.

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

_Empty — every item in this theme has shipped._ Two plans that were once here
are kept further down rather than deleted: **2b. Board performance fixes**
(measured, deliberately dormant until ~200 products) and **1. Backup & restore**
(deferred by maintainer decision). The **UX assessment** has now run
(`docs/ux-assessment.md`); the two defects it found are in ROADMAP's *Known
bugs* and should be fixed before the design items. The next planned work is
**Mobile optimisation**, immediately below — promoted to first *by* the
assessment.

## THEN — design & usability

Ordered as the **UX assessment** recommended (`docs/ux-assessment.md`), not as
originally written. Section numbers are kept as stable cross-reference labels —
reading order is the priority, not the numbering.

### 8. Mobile optimisation

Fix the audited phone experience: the 70vh `.table-wrap` scroll interplay
with page scroll, tap targets ≥ 44px (tab buttons, sort selects, chips),
chart legibility (Chart.js `maintainAspectRatio`/font sizes at narrow
widths), the Data Entry grid's horizontal overflow (measured: the table is
890px wide in a 390px viewport with no `overflow-x` wrapper), the clipped
status pill, the board's Fair Price column starting off-screen, and the
stacked-section density (item 7 is the first lever). Add one Playwright viewport test
(`devices['Pixel 7']` or similar) asserting no horizontal body scroll and
that the board renders. *Size: M. Read `docs/ux-assessment.md` findings 1, 2, 6, 8, 9 first — 1 and 2 are filed as bugs and should already be fixed. Pairs with: 7.*

### 7. Collapsible section descriptions

Each `.section-desc` gets a per-section show/hide toggle plus one global
"hide descriptions" control; collapsed state = a small "ⓘ" affordance.
Persist per-user in `localStorage` (key e.g. `sta-desc-collapsed`), default
collapsed on small screens (`matchMedia('(max-width: 640px)')`), expanded on
desktop. Text stays in the DOM (`hidden` attribute or class, not removal) for
screen readers and first-timers. Set `aria-expanded` on the toggle. *Size: S.
Pairs with: 8.*

### 6. Overview-first restructure

With the verdict shipped, the Analysis tab can lead with the answer: a
compact "best deals now" block (verdict-sorted, fair-price gap, drill-down
links — the data already exists in `updateTopPicks`/`verdict`) above the
nine numbered sections, which become progressive disclosure. Constraints:
preserve section IDs/canvases (editing invariants), keep `.section-eyebrow`
numbering, `design-review` throughout, smoke test must keep passing
unchanged. Plan the DOM moves on paper first; this is a large diff of mostly
markup. *Size: M/L. Justified by `docs/ux-assessment.md` findings 3, 4, 6.*

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
applies to every word. *Size: M. Justified by `docs/ux-assessment.md` finding 7 — the demo currently shows no fair price or verdict at all.*

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

### 9. Set logos (drill-down first)

Decision to make first: asset source. **TCGdex serves set logo assets** (the
same API already planned for ingestion — one vendor, licensing terms to
confirm in the spike). Store the logo URL per set at load time (sets are
derived from release dates via `groupSets()` — a name→logo map fetched
lazily), render in the drill-down header only (board rows later, if at all),
with a text-only fallback when missing — never a broken image. Subordinate to
the numbers per `design-review`. *Size: S/M. Depends on: TCGdex spike (item
14b) confirming the asset source, else parked.*

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

### 2b. Board performance fixes — measured, dormant until ~200 products

Spawned by the scale measurements (item 2, shipped). **Do not build these
now:** at today's 36 products the board costs 8 ms and every fix here would be
speculative complexity. They come due when coverage growth or automated
ingestion pushes the catalogue past roughly 200 products — re-run
`npm run scale:measure` to confirm before starting, and again after, using the
same matrix so the before/after is comparable.

Measured baseline (median ms, Chromium, 7 repeats, N = 36 → 200 → 400):
board search **14.5 → 50 → 92** per keystroke · sort **15 → 51 → 91** ·
type filter **47 → 137 → 239** · Data Entry grid **14 → 59 → 133** ·
drill-down flat at ~9 (it scales with M instead: 9 → 45 at 365 snapshots).

1. **Debounce the board search** (~150 ms trailing). `#board-search`'s `input`
   handler calls `updateTable()` on every keystroke, and `updateTable()` is
   O(N) — 92 ms per character at N = 400. Highest value for the least code.
   Keep the *first* keystroke responsive if possible (leading + trailing) so
   short queries still feel instant. Verify with the harness's "board search
   keystroke" row, and by hand: type a long query at N = 400 and watch for lag.
2. **Stop rebuilding the whole tbody.** Sort/filter/search each re-render every
   row (50–70 ms at N = 400). Options in increasing order of intrusiveness:
   reuse row elements and update their cells in place; or virtualise the
   existing capped-height (`70vh`) `.table-wrap` scroll area. Preserve the
   JS-referenced IDs/classes (`product-tbody`, `.verdict-line`, the row click
   → `openDrill()` binding) — the smoke spec asserts several of them.
3. **Split the type filter's re-render.** `applyTypeFilter()` synchronously
   rebuilds the board *and* four charts (239 ms at N = 400; 329 ms at
   400 × 365). Render the board first and let the charts update in a follow-up
   frame (`requestAnimationFrame`) so the interaction feels immediate.

**Verify:** `npm run scale:measure -- --matrix 36x24,200x24,400x24` before and
after (the numbers are the point); `npm test` green; and by hand at N = 400
using a generated fixture — sort, filter, search, drill-down all still correct,
not just fast. *Size: S (1) / M (2) / S (3). Dependencies: a catalogue big
enough to justify them.*

### 1. Backup & restore — deferred (full plan retained)

Moved here from **Now** in Jul 2026 by maintainer decision — not descoped, just
not next. (Item numbers are stable labels so cross-references keep working;
ROADMAP's ordering is the priority, not these numbers.) **Why deferred:** the
rehearsal has to restore *into* something that isn't production, and spending
the organisation's second free Supabase project on it isn't worth it right now.
**Interim mitigation, in force until this ships:** the manual **⬇ Export
updated .xlsx** button is the only backup of the live database — export after
each monthly entry loop and keep the file off-repo.

**Goal.** The Supabase database is the live source of truth and its only
backup today is that manual export button. Ship an automated weekly workbook
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
   optional email jobs. **Rehearse it once and correct the doc from what
   actually happened** — the rehearsal is part of the item, not optional.

**Where to rehearse** (settled Jul 2026 — only this step needs a non-production
destination; the export script and workflow read the live project read-only and
need nothing new):

- **A local stack — `supabase start` (recommended, free, Docker).** Real
  Postgres + GoTrue auth + PostgREST, so `schema.sql` and
  `supabase/migrate-xlsx.mjs` run unmodified — both want only a URL, an anon
  key, and an email/password. Repeatable, so it can be re-run whenever the
  schema changes rather than once.
- **A second free Supabase project.** Highest fidelity, no Docker; the free
  tier allows two active projects per organisation (verify against the current
  org before assuming). Deliberately *not* spent on this yet — that is the
  deferral reason above.
- **Supabase branching.** Cleanest, but a paid-plan feature. Skip unless the
  project is already on Pro.

  A local stack cannot exercise: the three email jobs
  (`staleness-reminder.sql`, `alert-emails.sql`, `error-digest.sql`) which need
  `pg_cron` + `pg_net` + a Vault-stored Resend key and real outbound HTTP, and
  the dashboard-driven steps (API keys, Auth settings). Say so in the restore
  doc rather than skipping them silently.

**Restore-order gotcha found while planning (do not lose this).** `is_admin()`
hardcodes the admin UUID (`supabase/schema.sql:156`) and it must match
`SUPABASE_CONFIG.adminUserId` in `index.html`. A restore into a fresh project
mints a *different* `auth.users` UUID, so the sequence must be: create the
admin account first → read its new UUID → patch both places → *then* run the
rest of `schema.sql` and the migration. Skipping this yields a database nobody
can write to. The current step 3 above does not encode this ordering — fix that
when the item is picked up.

**Decisions left open:** none blocking; artifact-only vs commit-to-repo can be
cut to artifact-only if the maintainer prefers a lean repo (then retention is
the only copy — say so in SUPABASE.md).

**Verify:** run the script locally against the real project (read-only); run
the validator on its output; trigger the workflow manually
(`workflow_dispatch`) once; perform the restore rehearsal.

**Done when:** a green scheduled run exists, a restore has been rehearsed and
documented, and README's layout table lists the new script/workflow.

*Size: S/M. Dependencies: none (a rehearsal destination is the only input).
Touches: new script, new workflow, SUPABASE.md, README, ROADMAP.*
