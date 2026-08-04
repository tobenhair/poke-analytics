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
(deferred by maintainer decision). Both UX passes have run
(`docs/ux-assessment.md`, then the authoritative `docs/ux-expert-review.md`);
the defects they found are fixed and ROADMAP's *Known bugs* is empty. **Items 10 (Accessibility), 8
(Mobile optimisation) and 7 (Collapsible section descriptions) have shipped** —
their plans are deleted per the rule below, and what they built is documented in
`CLAUDE.md` → *Accessibility structure*, *The board on a phone* and *Collapsible
explainers*. The remaining items in this theme are the visual-consistency fixes
from `docs/visual-design-review.md` and the larger restructure work below.

## THEN — design & usability

Ordered as the **expert UX & accessibility review** recommended
(`docs/ux-expert-review.md`, which supersedes and corrects `docs/ux-assessment.md`).
Every finding it raised has now shipped (F8 included), along with the
overview-first restructure and the demo-as-pitch rework. One item is left, and
no finding touched it. Section numbers are stable cross-reference labels —
reading order is the priority, not the numbering.

**Deliberately not built, and why** — the demo-as-pitch plan called for a
`localStorage`-gated, dismissible three-step first-visit walkthrough. The three
steps shipped, but as a permanent section of the demo page rather than a
dismissible tour: the demo page *is* the first-visit surface (only logged-out
visitors see it), so a tour overlaid on it would explain the explanation. If a
walkthrough is ever wanted for signed-in users, it needs a different home.

### 9. Set logos & product images (drill-down first)

**Set logos — SHIPPED (TCGdex, drill-down).** `ensureSetLogos()` fetches the
TCGdex set list (`api.tcgdex.net/v2/en/sets`) once, lazily, on the first
drill-down and builds a normalised `set name → logo base URL` map;
`renderDrillLogo()` name-matches the product's set (via `groupSets()`/
`setLabel()`), sets `<img id="drill-logo">.src = base + '.png'`, and reveals it
only on `onload` — guarded on `drillProduct` so a slow fetch can't paint onto
the wrong product. Every failure path (offline, blocked egress, CORS, an
unmatched set, a 404 image) falls back silently to the text title — never a
broken image. Logos are **hotlinked** (not re-hosted). Tests stub
`api.tcgdex.net` to `[]` (`tests/local-cdn.mjs`) so the suite stays hermetic and
exercises the fallback; the smoke spec asserts `#drill-logo` stays hidden.
*One live-unverified assumption:* that the list endpoint returns `{name, logo}`
with `logo` a base URL you append `.png` to — confirmed against the API docs,
to be eyeballed on the first real online load.

**Licensing stance taken (2026-08).** Proceeding commercially on the motivation
that **the product sold is the analysis tool, not the trading-card products it
tracks** — the app is not reproducing or reselling Pokémon products — and that
logos are shown for **identification / informational purposes only**, hotlinked,
with a strengthened non-affiliation + attribution notice in the page footer
(the Collectr-style disclaimer). This is a considered risk decision, not a
licence; the investigation below records what that risk is.

**Product photos — still parked.** *Sealed*-product photography (booster-box /
ETB / bundle box art) has **no clean automated source**: the card-image APIs
carry set logos and card scans, not sealed-product photos, and marketplaces
restrict their listing images. So that half stays manual / unbuilt until a
licensed source exists. *Board-row / set-grouping logos are a later, optional
extension of the shipped drill-down work.*

#### Licensing & rights — the real blocker (investigation, 2026-08)

The technical work here is small; the **rights question is the item.** It is
sharper now because **commercialisation is a stated future goal**, and that
changes the answer. Findings so far:

- **Two rights are in play, and set logos trip both.** *Copyright* protects the
  box/card artwork; *trademark* protects the "Pokémon" name, Poké Ball, and set
  logos used as brands. Set logos are the highest-risk asset class because
  they're usually protected as **both** at once. Product photos are "only"
  copyright — and if user- or seller-supplied, the photographer (not the
  publisher) authored them, which is why marketplace feeds lean on them.
- **A disclaimer is not a licence.** It cannot make reproduction lawful. It only
  helps on the *trademark* side (rebutting implied endorsement) and as evidence
  of good faith. Permission must come from a licence, a narrow legal exception
  (US fair use / EU fair dealing — fact-specific, not something a disclaimer
  secures), or the content being unprotected.
- **TPCi's own terms rule out our commercial case.** Their [Media Usage
  Guidelines](https://press.pokemon.com/en/Assets-Use-Terms) grant a limited
  licence **"strictly to non-commercial uses"** (editorial/informational),
  state **"in no event are you authorized to commercialize the Content...by...
  charging a fee for access to it,"** forbid making a logo the most prominent
  feature, and forbid using their branding **"in the name of your business,
  product, service, app, domain name."** Their [support
  page](https://support.pokemon.com/hc/en-us/articles/360000634094) adds that
  they "are not in a position to review requests" and "ask that you not use it
  ...in any way." So a paid tier hosting their artwork is outside what they
  permit, full stop.
- **How comparable apps cope — none of it is a clean licence we can copy:**
  - *Bulbapedia* — runs on a **fair-use/editorial rationale + non-enforcement**,
    low-res images, copyright templates crediting Nintendo/TPCi. Grey zone,
    depends on TPCi's tolerance.
  - *Cardmarket / TCGplayer / eBay* — **marketplaces**: first-sale/resale-
    advertising rationale, largely **user-uploaded** listing photos, DMCA
    machinery, legal budgets. We are analytics, not a marketplace, so that
    rationale is weaker for us; and their ToS typically **prohibit
    hotlinking/scraping** their images.
  - *Collectr* — the closest comparable (**commercial, not a marketplace**).
    Their [terms](https://www.getcollectr.com/terms-and-conditions.html) carry a
    strong non-affiliation disclaimer, claim IP over "content...owned by
    Collectr, **its licensors, or other providers**" (that phrase quietly admits
    not all of it is theirs), lean heavily on **user-scanned** card photos, and
    pair a **TCGplayer data partnership** (pricing) with catalogue images hosted
    on their own CDN. Net: by TPCi's literal guidelines their *commercial* use
    isn't authorised either — they rely on **non-enforcement + provenance cover
    (user scans, marketplace feeds) + a disclaimer for the trademark half +
    scale/legal budget**. A solo commercial project has the exposure without the
    cover.
- **Transferable *safe* tactics** (do regardless): a non-affiliation disclaimer;
  keep "Pokémon" out of the product/app/domain name (Collectr is "Collectr,"
  not "PokéCollectr"); prefer **user-supplied** or a **properly-licensed feed**
  over hosting publisher artwork; stay image-light where a badge/colour-chip does
  the job.

**Open questions to resolve before building (investigate further):**
1. **TCGdex asset terms** — does its licence actually permit redisplaying set
   logos, and does it permit *commercial* redisplay? Confirm in the 14b spike
   (and re-scope: the question is bigger than "one vendor's terms" — TPCi is the
   upstream rights holder).
2. **Any sublicensable image rights?** Does *any* reachable feed (TCGdex,
   TCGplayer, Pokémon TCG API) grant redistribution/redisplay rights we can rely
   on for a paid product — or only for non-commercial use?
3. **Split the asset classes.** Are **product photos** (user/seller-supplied,
   copyright-only) meaningfully safer than **set logos** (copyright + trademark)?
   If so, phase 1 could be photos-only and logos stay parked.
4. **Images-light alternative** — quantify the UX gain of real logos vs a
   designed set-identity system (colour chip + type badge + set abbreviation)
   that carries **zero** third-party rights. This may be the right answer for a
   commercial launch even if logos are "nicer."
5. **If we do want real fair prices/logos the honest way** — a direct licensing
   enquiry to TPCi, or a paid asset licence, is the only path that survives
   commercialisation; price that before committing.

*Not legal advice — this is a research summary to scope the item; a real
commercial launch with this imagery warrants a lawyer's review.*

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
- **PWA / installable.** *Shipped — see `CLAUDE.md` → Installable app (PWA) and
  ROADMAP → Done.* Delivered as `manifest.webmanifest` + `icons/`
  (`scripts/gen-pwa-icons.mjs`) + `sw.js` (network-first app shell, cache-first
  CDN libs, Supabase/FX bypassed) + a header install button, pinned by
  `tests/pwa.spec.mjs`. Wrappers/native (Later, steps 2–3) stay unbuilt until the
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
