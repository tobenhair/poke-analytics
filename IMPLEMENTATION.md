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

## NOW — a trustable product (the four gates)

**Highest priority** (see `ROADMAP.md` → *Now — a trustable product*). These four
gates carry the tool from *good* to *dependable*. They are ordered so each
protects what already exists before the next earns its place, and each has a
**provable** definition of done — not "most of it works". Two of them activate
plans already written further down this file (Gate 1 ≈ **item 1**, Gate 3 folds
in **item 2b**); those are referenced, not duplicated, and moved to **Done** as
each gate ships. Gate 2 and Gate 4 are new.

Sequencing between gates: **Gate 1 and Gate 2 are the priority pair** (they
protect data and users that already exist and can be done in parallel — one is
ops-heavy, the other audit-heavy). **Gate 3** follows (measured trigger ≈ 200
products, approaching but not urgent — do 3.1 opportunistically since it also
removes a load-time cliff felt today). **Gate 4** is last (only matters once the
first three hold). One PR per numbered sub-item, per the cross-cutting rule.

---

### G1. Durability — a rehearsed way back  *(activates item 1)*

**Why.** The live database is the source of truth and its **only** backup today
is the manual **⬇ Export updated .xlsx** button. That was tolerable while data
was hand-entered; it is not now that daily Cardmarket ingestion is automated —
a lost or corrupted DB is no longer re-enterable by hand. Close it with
automated backups **plus a restore that has actually been run**. The full build
detail lives in **item 1** below (retained in full); this section *activates* it
(it is no longer deferred — it is the top of the theme) and resolves its two
open points. Load `data-integrity` before touching the export/schema paths.

**Build:**

1. **G1.1 — Managed backups on (new; not in item 1).** Enable Supabase's own
   daily backups / PITR on the project and record the retention window in
   `SUPABASE.md`. Minutes of dashboard work; it is the platform-level net that
   the portable snapshot (G1.2) and the rehearsal (G1.3) sit on top of. Invisible
   until G1.3 proves a restore, which is the point of the gate.
2. **G1.2 — Automate the portable, vendor-independent snapshot.** This is
   **item 1's** `scripts/export-backup.mjs` + `.github/workflows/backup.yml`,
   built exactly as specified there (read `products`/`snapshots` via the REST API
   with the service-role key held only in Actions secrets; write a contract-valid
   workbook that is the inverse of `supabase/migrate-xlsx.mjs`; **self-check by
   spawning `scripts/validate-workbook.mjs` on the output** — a backup that can't
   re-import is not a backup). Weekly cron + `workflow_dispatch`.
3. **G1.3 — Rehearse the restore (the part that counts).** Restore a real backup
   into a **local `supabase start` stack** — this resolves item 1's "where to
   rehearse" open decision (the local Docker stack, not the org's second free
   project; highest-fidelity branching is Pro-only). Bring up the stack, run
   `schema.sql`, run `supabase/migrate-xlsx.mjs` on the backup, and confirm the
   app boots against it with correct numbers for a known product. Write the exact
   sequence into a **Restore** section of `SUPABASE.md`, corrected from what
   actually happened.

**Decision settled here (fixes item 1's flagged gotcha — do not lose it).** The
restore order must encode the **admin-UUID** problem: `is_admin()` hardcodes the
admin UUID (`supabase/schema.sql`, the `create or replace function public.is_admin()`
block — currently the UUID on that line) and it must equal
`SUPABASE_CONFIG.adminUserId` in `index.html`. A restore into a fresh project
mints a *different* `auth.users` UUID, so the documented sequence is: **create
the admin account first → read its new UUID → patch `is_admin()` and
`SUPABASE_CONFIG` → then run the rest of `schema.sql` and the migration.**
Skipping this yields a database nobody can write to. `repo-invariants.test.mjs`
already guards that the two literals agree; the restore doc must make an operator
set them correctly on a fresh project.

**What a local stack cannot exercise** (say so in the doc, don't skip silently):
the three email jobs (`staleness-reminder.sql`, `alert-emails.sql`,
`error-digest.sql`) need `pg_cron` + `pg_net` + a Vault Resend key + real
outbound HTTP, and the dashboard-driven steps (API keys, Auth URL config).

**Verify.** Run `export-backup.mjs` against the real project read-only; run the
validator on its output; trigger `backup.yml` once via `workflow_dispatch`;
perform the rehearsal end-to-end.

**Done when.** A green scheduled backup run exists, **a restore has actually been
performed into a clean local stack and dated/documented** in `SUPABASE.md`, and
README's layout table lists the new script + workflow. *(Then move item 1 and
this gate to ROADMAP → Done, delete item 1's section.)*

*Size: S/M. Touches: new script, new workflow, `SUPABASE.md`, `README.md`,
`ROADMAP.md`. Dependencies: none (a rehearsal destination is the only input, now
decided).*

---

### G2. Safety — audit the cloud boundary directly  *(new)*

**Why.** `tests/signed-in.spec.mjs` proves the *client* behaves against a fake
SDK; nothing proves the *server-side* boundary — the real RLS policies, the
`is_admin()` write gate, the `demo_product_ids()` demo scope, and the three Edge
Functions' service-role usage. The DB holds real user emails, holdings, alerts
and sales today, so a silent RLS hole is the most damaging failure this tool
could ship. This gate verifies the boundary **against the database itself**, and
leaves behind an automated regression test so it can't rot. Load `data-integrity`
and run the `security-review` skill over the final diff.

**Build / execute (this gate is mostly verification + one new test file):**

1. **G2.1 — Apply the advisor findings — ✅ DONE (migration `g2_security_hardening`
   applied 2026-08-28; all 11 tables already had RLS on).** Outcome:
   - **`is_admin()` mutable `search_path`** (WARN) → **fixed**: `alter function
     public.is_admin() set search_path = public`. Advisor confirms cleared.
   - **`auth_rls_initplan` on 6 per-user policies** (`user_settings`, `holdings`,
     `alerts`, `sales`, `purchases`, `client_errors`) → **fixed**: each policy's
     `auth.uid()` rewritten as `(select auth.uid())`. All 6 perf warnings cleared.
   - **`demo_product_ids()` executable via `/rest/v1/rpc`** (WARN×2) →
     **accepted-with-reason** (the verify branch resolved to accept). A
     rolled-back probe proved the demo read policies run *as anon* and call this
     function, so anon must keep EXECUTE; revoking from `PUBLIC` breaks the demo
     ("permission denied for function"), and revoking only from anon/authenticated
     is a no-op (PUBLIC still grants). The exposure is benign — the RPC returns
     only the demo product UUIDs anon already reads. Closing it would mean moving
     the function to a non-API schema (added surface, no real gain). Documented in
     `schema.sql`.
   - **Leaked-password protection disabled** (WARN) → **pending**: a dashboard
     toggle (Auth → Password security → enable HaveIBeenPwned). Not applyable via
     SQL — the one remaining operator click.
   - **Accept-with-reason (documented, unchanged):**
     `cardmarket_expansion_singles` "RLS enabled, no policy" (INFO — intentional
     service-role-only cache); `multiple_permissive_policies` on
     `products`/`snapshots`/`cardmarket_excluded_singles` (the read + admin-write
     split is intentional); `unindexed_foreign_keys` INFO on the per-user tables'
     `product_id` (minor now — bundle the useful ones into G3's index work).
   - The applied DDL is mirrored into `supabase/schema.sql` (source of truth); no
     row data was touched.
2. **G2.2 — Prove every table's policy from the DB side, and lock it with a
   test.** Add **`tests/rls.test.mjs`** (a Node integration test, gated to run
   only when `SUPABASE_TEST_URL` + keys are present in the environment — so it is
   skipped in the default hermetic CI but runnable on demand and in a
   credentialed CI job). It signs in as (a) the admin, (b) a plain second user,
   (c) anon, and asserts the intended boundary for all eleven tables with real
   queries:
   - `products` / `snapshots`: any authenticated user **reads**; **only the admin
     writes** — the load-bearing negative case: *a non-admin `insert`/`update`/
     `delete` on `products` is rejected by RLS* (not merely hidden by the
     `is-admin` UI class). Anon reads only the `demo_product_ids()` slice.
   - `user_settings` / `holdings` / `alerts` / `sales` / `purchases`: user B
     cannot read or write user A's rows (per-user `auth.uid()` scope).
   - `client_errors`: anon + authed may `insert`; a reporter **cannot** insert a
     row with someone else's `user_id`; only the admin may `select`; nobody may
     `update`/`delete` via the API.
   - `news`: anon + authed read; no client write.
   - `cardmarket_expansion_singles` / `cardmarket_excluded_singles`: no
     anon/authed access at all (RLS on, no client policy) — confirm a plain
     select returns zero rows / permission error.
   - `demo_product_ids()`: anon cannot widen it (it is `SECURITY DEFINER`
     `stable`; confirm the anon `products` select returns only the 3-release
     slice).
3. **G2.3 — Review the three Edge Functions + secrets.** Confirm
   `cardmarket-daily`, `cardmarket-resolve-ids`, `cardmarket-catalog-refresh`
   (and `news-fetch`) use the service-role key **only** server-side and never
   leak it into any client-reachable response; confirm the admin-gated functions
   (`resolve-ids`, `catalog-refresh`) check `is_admin()` server-side; review each
   function's handling of its inputs; audit key management (anon vs service-role
   vs the Vault-stored Resend key). No key literal in `index.html` beyond the
   documented anon key.
4. **G2.4 — Re-confirm untrusted-text escaping.** External text (news titles/URLs
   via `news-fetch`, `client_errors` payloads) must pass through `escHtml` /
   `safeUrl` on every render path. Grep the news + error render functions and
   confirm; add a note to the `security-review` output.

**Fold in here (from the roadmap footnote): mark the US→EU basis break.** While
in this area, add a dated marker/annotation on the time-series charts at the
US→EU Set-Value switchover so the ~15–20% one-time step isn't misread as a market
move. Small, presentational; `metrics-review` applies only if it touches a
derived series (it should not — it is an annotation).

**Verify.** `tests/rls.test.mjs` passes against a real test project (all three
roles, all eleven tables); advisors clean or accepted-with-reason; the
`security-review` skill run over the gate's diff is clean.

**Done when.** Every table's boundary is asserted by a test that talks to the
database, the advisor findings are resolved or consciously accepted in
`SUPABASE.md`, no secret is reachable client-side, and `SUPABASE.md` gains an
**RLS / security audit** section recording the result. *(This is the
security-audit half of ROADMAP's Later "Complete DB backups & security audit"
gate, pulled forward and satisfied.)*

*Size: M. Touches: `supabase/schema.sql` (the `search_path` pin), new
`tests/rls.test.mjs`, `SUPABASE.md`, possibly a small chart annotation in
`index.html`. Dependencies: a credentialed Supabase test project for the RLS
test (a local `supabase start` stack works, sharing G1.3's setup).*

---

### G3. Resilience — don't degrade as history deepens  *(folds in item 2b)*

**Why.** Daily ingestion grows the snapshot axis forever. `loadFromSupabase()`
→ `allSnapshots()` (`index.html`, via `fetchAllRows()`) pages through **every**
snapshot for **every** product on every sign-in and every demo load, then pivots
client-side into aligned arrays — O(N×M), and M only climbs. The scale harness
already caught the tail (the 400×365 fallback workbook takes 4.2 s). Fix the load
shape now; the board's per-render cost (**item 2b**) stays gated on the measured
≈200-product trigger. Load `data-integrity` and `metrics-review` — this changes
*what data the metrics see*, so it is not a pure perf change.

**Status (2026-08-29): the safe, evidence-warranted slice shipped; the loader
rewrite is deliberately deferred.** The live DB is 188 products but only ~4,600
snapshots (M is still shallow — daily ingest began ~Jul 2026), so the O(N×M) load
is a few thousand rows and **not slow today**; the 4.2 s cliff was measured at
400×365 ≈ 146k rows. Rewriting `loadFromSupabase()` — the single most critical
path (a subtle bug there silently shows sample data or wrong momentum) — for a
problem that isn't yet biting, and doing it in an environment where the page can't
be exercised in a real browser, is exactly the speculative risk the scale work was
filed to avoid. So **G3.3 (search debounce) and the G3.1 composite index shipped**
(felt win + cheap future-proofing); the **`latest_snapshots` view + the loader
switch (rest of G3.1) and the lazy-history drill-down/portfolio (G3.2) are
deferred** until a fresh `scale:measure` — or real history depth (M into the
hundreds/product) — warrants them, per G3.4's "re-measure, then stop" discipline.
The design below stays the plan for that point.

**The key design subtlety (get this right or the board breaks).** "Latest-only"
is not literally one row per product. The board's **Momentum lens** shows 7d/30d
date-windowed change and the **Value lens** shows buy/sell flags — both read a
*recent trailing window* of snapshots (`momentum()`, `buySignal()`,
`sellSignal()` off the last snapshots; `movingAverageSeries()` too). So the board
needs, per product: **its single newest row (for ranking: price, set value,
SV/Booster, fair gap, score) AND a recent trailing window (~40 days, for momentum
+ signals).** Only the **drill-down charts** (price history, SV/Booster trend, the
§03/§04 comparison views) and the **Portfolio value-over-time chart** need the
*full* multi-year series — the first for one product at a time, the second for the
bounded set of held products.

**Build:**

1. **G3.1 — Latest-window board load + composite index (the biggest lever).**
   - **Index — ✅ SHIPPED:** `snapshots(product_id, snapshot_date desc)`
     (`snapshots_product_date_idx`, applied via migration + mirrored in
     `schema.sql`) — the access path the view, the windowed query and the daily
     job's prior-window reads need.
   - **View — deferred:** a `latest_snapshots` view (`distinct on (product_id) …
     order by
     product_id, snapshot_date desc`) exposing one newest row per product.
     **RLS/demo scoping — get this right:** a Postgres view is **security-definer
     by default** (it runs as the view owner and would bypass RLS, exposing every
     row to anon/authenticated). Create it **`with (security_invoker = true)`**
     (PG15+; the project is on PG17) so it runs the querying role's RLS on the
     underlying `snapshots` — the shared-read and `demo_product_ids()` anon
     policies then carry through. Grant `select` to `anon, authenticated` and
     verify the anon slice explicitly (a rolled-back `set role anon` probe, as in
     G2).
   - **Loader:** replace the single `allSnapshots()` call in `loadFromSupabase()`
     (and the demo's `loadDemo()`) with **two bounded reads**: the
     `latest_snapshots` view (spine) + a date-windowed `snapshots` query
     (`snapshot_date >= max_date − ~40d`, still paginated via `fetchAllRows`).
     Merge/pivot both into the same `newHistoricalData[name]` aligned arrays the
     rest of the app already consumes — so `applyNewData()`, `deriveProducts()`,
     the momentum/signal/MA helpers and every render function are **unchanged**.
     A product whose newest row predates the window still appears (from the view)
     with `—` for momentum, which is already the correct, tested behaviour of
     `pctChangeOverDays()`.
   - Keep `fetchAllRows()` for the windowed query (bounded now, but still may
     exceed the 1000-row cap across all products).
2. **G3.2 — Lazy full history on drill-down + portfolio.** When a drill-down
   opens (`openDrill(name)`), fetch that one product's **full** series
   (`snapshots` where `product_id = …`, all dates) and hand it to the drill-down
   chart builders; cache per-name for the session so re-opening is free. For the
   **Portfolio value chart**, fetch full history for the (bounded) set of held
   product ids when the Portfolio tab first renders. Everything else stays on the
   windowed data. Preserve the JS-referenced ids (`#drill-modal`,
   `renderDrillPriceChart`, `#portfolio-value-chart`) and the
   render-after-overlay-visible ordering the a11y notes require.
3. **G3.3 — Debounce the board search — ✅ SHIPPED.** A small leading+trailing
   `debounce()` helper (160 ms) wraps the board's per-keystroke `renderBoard()`
   (O(N) tree rebuild); `searchTerm` + `updateFilterChrome()` stay synchronous so
   state and the Reset control track every character, while the expensive rebuild
   coalesces. First keystroke after idle runs immediately (stays instant); a burst
   collapses to one trailing render. `renderBoard()` reads the module-level
   `searchTerm`, so no stale-args risk. (Was **item 2b step 1**.)
4. **G3.4 — Re-measure, then stop.** Re-run `npm run scale:measure` on a generated
   fixture. The rest of **item 2b** (in-place row updates / virtualisation; split
   the type-filter re-render) ships **only if** a fresh run past ~200 products
   still says so — no pre-optimisation.

**Decisions left open (settle when starting 3.1):** the exact window (~40 days is
enough to cover the 30d momentum + a margin; confirm against the widest window any
board metric reads); whether `latest_snapshots` is a plain view or a materialised
one (start plain — correctness first; only materialise if 3.4 shows the view's
`distinct on` is itself a cost). The fake SDK (`tests/fake-supabase-sdk.js`) must
learn the view + the windowed/`gte` query so `signed-in.spec.mjs` still drives the
real loader.

**Verify.** `npm test` green (extend `signed-in.spec.mjs`: board renders from the
view + window, a drill-down triggers the lazy full-history fetch, momentum shows
`—` for a window-less product); `npm run scale:measure` before/after on the same
matrix shows sign-in load is ≈O(N), not O(N×M); by hand at a large fixture — board,
momentum lens, drill-down charts and the portfolio value chart all still *correct*,
not just fast. Numbers go in `ROADMAP.md`.

**Done when.** Sign-in/demo load is ≈O(N) regardless of history depth, the board
+ momentum + signals are unchanged in behaviour, drill-down/portfolio full-history
charts load lazily and correctly, and a fresh scale measurement is recorded.
*(Realises ROADMAP's Later "Data volume at scale" latest-only lever + item 2b
step 1; leave the rest of item 2b filed and dormant.)*

*Size: M/L. Touches: `supabase/schema.sql` (index + view), the loader +
drill-down + portfolio paths in `index.html`, `tests/fake-supabase-sdk.js`,
`tests/signed-in.spec.mjs`, `CLAUDE.md` (the load-path + data-model notes),
`ROADMAP.md`. Dependencies: none.*

---

### G4. Accountability — the launch paperwork  *(new; draws Later items forward)*

**Why.** A tool that claims to know fair value, is EU-operated and stores emails
incurs paperwork before it opens wider. Meaningful only once G1–G3 hold. Load
`design-review` for the two new pages.

**Build:**

1. **G4.1 — Methodology (how the numbers work) — ✅ SHIPPED (consolidated into
   the shared dialog, not a new route).** The `#method-modal` dialog now carries
   the full trust story: the age-fit + R²-gating (`fitConfidence`) + old-set
   suppression it already had, plus two added `modal-section`s — **Where the
   numbers come from** (the Cardmarket `(trend+avg)/2` box blend, the `avg30`
   all-cards Set Value, promo subtraction) and **Where it's weakest** (thin
   liquidity + hand-lock, the one-time US→EU basis step, "not financial advice").
   The page **footer** gained a `.link-row` surfacing `#method-modal` +
   `#glossary-modal` app-wide (reachable from every tab, not just demo/Welcome).
   Reused existing components only (`.modal-section`/`.method-text`/`.link-row`/
   `.text-link`/`.method-open`/`.glossary-open`) — no new tokens/ids; copy
   consolidated from README/ROADMAP. *Deliberately not a separate URL-addressable
   page:* the SPA has no routing, and a modal reachable app-wide + logged-out
   satisfies the trust-doc need at far less design weight; a real route stays a
   later option if SEO/deep-linking is wanted.
2. **G4.2 — Privacy — ✅ SHIPPED (draft).** `#privacy-modal` (opened by class
   `.privacy-open` from the app-wide footer, reachable logged out): what's stored
   + why (account email; the private portfolio: holdings/alerts/sales/purchases/
   settings; error reports; anonymous view counts), cookies/`localStorage` +
   auth-token (no tracking cookies — the consent-exempt answer, recorded in the
   copy), EU Supabase hosting + encrypted Cloudflare backups, and GDPR rights.
   Carries a `[set a contact email]` placeholder + a DRAFT HTML comment — a
   starting point, **not** a lawyer-reviewed doc.
3. **G4.3 — What's new + support/uptime — ✅ SHIPPED.** `#changelog-modal`
   (`.changelog-open`), notable changes newest-first seeded from `ROADMAP.md` →
   Done, with a best-effort-uptime + support-contact line (same placeholder).
4. **G4.4 — Privacy-friendly analytics — ✅ SHIPPED (self-rolled).** Decision:
   the self-rolled Supabase counter (no new vendor/script/cookie). `recordView()`
   (beside `reportClientError()`, same beacon discipline) inserts an **anonymous**
   row (`view` + `created_at` — no id/IP/UA) into the insert-only **`page_views`**
   table, **once per surface per session**, from `activateTab()` and `loadDemo()`.
   RLS: anon+authenticated insert (`with check (true)`), admin-only select,
   immutable. No PII ⇒ no consent banner (disclosed in Privacy). Folded into
   `ALL_TABLES` + `downloadFullBackup()` + the fake SDK; the signed-in backup test
   asserts the 11th table key.

**Verify.** dead-code + design-tokens green; both inline modules parse; a11y +
smoke run in CI (browser not drivable in this env). Reused existing modal /
`.method-text` / `.link-row` / `.text-link` components — no new tokens.

**Done when.** A first-time visitor can read how the numbers are derived, what
happens to their data, what to expect, and how to get help — **before** signing
up — and basic usage analytics are flowing. **Met**, bar two maintainer steps:
fill the `[set a contact email]` placeholder, and get the privacy copy reviewed
before a real launch. *(Satisfies ROADMAP's Later "Launch checklist" +
"Privacy-friendly analytics" + "Legal/compliance".)*

*Shipped across `index.html` (method enrich + privacy/changelog dialogs +
`page_views` beacon), `supabase/schema.sql` (migration `g4_page_views_analytics`,
mirrored), `scripts/export-backup.mjs`, `tests/fake-supabase-sdk.js` +
`tests/signed-in.spec.mjs`, and the docs.*

---

## NOW — trustworthy numbers

_One active plan (16, below); the rest of this theme has shipped._ Two plans that
were once here are kept further down rather than deleted: **2b. Board performance
fixes** (measured, deliberately dormant until ~200 products) and **1. Backup &
restore** (deferred by maintainer decision).

### 16. Box price 30-day moving average

**Why.** Box price has no Cardmarket 30-day average (only singles carry
`avg1/7/30`), so the daily job writes a `(trend + avg)/2` blend — a *spot*. The
Aug-2026 derivative-indicator study (`ROADMAP.md` → **Now**) confirmed daily box
returns are anti-persistent noise (lag-1 autocorrelation median −0.06), so a
30-day mean is the right smoother and oscillators (RSI/MACD/Bollinger/vol-badges)
would over-fit — they were investigated and rejected. This was already the
ingestion "fast follow"; it is **now unblocked** — ≥30 daily snapshots exist
(daily cadence began ~2026-07-26). Ships in two phases; **Phase A is the
recommended first step and is independently valuable.**

**Data reality to design for.** Daily coverage is only ~1 month and ramped
(products were added 2026-07-26 → 08-20), so most products do **not** yet have a
full 30 calendar days of daily points, and pre-July history is sparse monthly
backfill with large gaps. The window must therefore be **calendar-defined**
(trailing 30 days over whatever tracked snapshots fall in it), not positional,
and every surface must degrade gracefully when the window is thin — exactly the
discipline `pctChangeOverDays()` already uses for momentum.

#### Phase A — client-side MA overlay on the drill-down price chart — ✅ SHIPPED

- **Pure helper `movingAverageSeries(prices, dates, windowDays = 30, minPoints = 10)`
  in `metrics.js`** (unit-tested), returning aligned `{x: ts, y: mean}[]` — the
  mean of the tracked price over the trailing calendar `windowDays`, emitted
  **only** where the window holds ≥ `minPoints` samples spanning ≥ half the window
  (`MA_MIN_SPAN_FRAC = 0.5`), so it never draws a fake-smooth line across the
  sparse monthly region or off a handful of just-started daily points.
- **Render:** a faint gold dashed "30-day avg" line on the drill-down price chart
  (`renderDrillPriceChart()`), same `{x,y}` time-axis + `pointRadius:0` convention
  as the other lines, currency-correct (converted in the dataset builder). **The
  optional "vs 30-day avg" tile was deliberately dropped** (design-review
  restraint): the drill-down already carries a "30d change" tile, and a second
  30-day number beside it reads as clutter without adding a distinct decision.
- **Average-of-an-average, disclosed:** the daily price it smooths is already
  Cardmarket's `(trend+avg)/2` blend (`trend` is itself an EMA-like smoother), so
  the MA is a second smoothing — acceptable for a slow reference line, and the
  reason it stays presentational (no ranking change). Documented in the helper and
  `CLAUDE.md`.
- **Verify (done):** 6 unit tests on `movingAverageSeries` (full window, sparse
  monthly → suppressed, partial early daily → not-yet-plotted, null/gap handling,
  bad input); the smoke spec opens a drill-down and asserts the `Price` line is
  present and the `30-day avg` line is absent on the 6-snapshot static workbook
  (the emit-when-dense path is covered by the unit tests). No schema, no
  ingestion, no ranking change — presentational and reversible.

#### Phase B — make the stored/ranked box price a 30-day mean (optional, maintainer-gated)

This is the roadmap's original intent (price-of-record = 30-day mean) and is
**higher-stakes: it moves every board price**, so it is a maintainer decision,
not an automatic follow-on. Do **not** overwrite `snapshots.price` in place with
a rolling mean — the stored price *is* the blend, so a mean of it compounds into
an EMA-like lag. Instead:

- **Keep the raw daily blend as the source** and add a **separate** stored field
  (e.g. `snapshots.price_ma30`, or invert: store raw in a new column and let
  `price` become the mean) so the mean is always taken over the *raw* blend, once.
- **Ingestion change, mirrored in all three derive paths** (`scripts/cardmarket-lib.mjs`,
  `supabase/functions/cardmarket-daily/index.ts`, `scripts/cardmarket-ingest.mjs`,
  pinned by `cardmarket-lib.test.mjs`): extend the existing prior-window read
  (the daily fn already pages the last 7 days of set value for `guardSetValue` —
  widen to 30 days and pull `price` too), compute the trailing-30-day mean of the
  raw blend, write it. **Fallback:** < `minPoints` in-window → use the raw blend
  (today's interim), so partial-history products are never blank.
- **Interactions to preserve:** `products.price_locked` → no MA, the admin's
  manual value stands (unchanged); the Set-Value `guardSetValue` is on set value,
  not price, so it is untouched; `low_liquidity` still derives from the day's
  trend/avg spread.
- **Decide before building:** which price the board/fair-price/portfolio read —
  the smoothed MA or the spot — and whether to show both. Because the blend was
  validated at median 0.91× hand prices, the switch is a visible re-basing and
  should be a deliberate call. `data-integrity` + `metrics-review` skills both
  apply.

**Definition of done (Phase A):** `movingAverageSeries` unit-tested; the overlay
renders on the drill-down price chart and is suppressed on thin history; docs
updated (`CLAUDE.md` charts section, ROADMAP fast-follow line); one branch/PR.
Phase B is filed but not started until the maintainer opts in.

--- Both UX passes have run
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
`renderDrillLogo()` derives the set name from the product's *own* name
(`setLogoKey()` strips the SKU suffix — not a release-date grouping, which merges
twin sets sharing a date like Black Bolt / White Flare and mislabels them), sets
`<img id="drill-logo">.src = base + '.png'`, and reveals it only on `onload` —
guarded on `drillProduct` so a slow fetch can't paint onto the wrong product. A
set whose name differs from TCGdex's, or that TCGdex hasn't listed yet, is pinned
in `SET_LOGO_ALIASES` (normalised app name → normalised TCGdex name). Every failure path (offline, blocked egress, CORS, an
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

**Product photos — Phase 0 shipped, Phase 1 (real photos) parked.** *Sealed*-product
photography (booster-box / ETB / bundle box art) has **no source that cleanly
licenses the images for commercial redisplay** (see
`docs/sealed-product-photos-research.md`): the card-image APIs carry set logos and
card scans, not sealed-product photos; TCGplayer's catalogue (free TCGCSV mirror)
*has* the photos but its ToS bars commercial reuse; official art is
non-commercial-only. The catalogue is small (~40–80 products), so the answer is
self-curation, not a feed. **Phase 0 (shipped):** the drill-down header is an
always-on **set-identity block** — a category-tinted accent + set name + type badge
(`renderDrillIdentity()` / `#drill-identity`), with the TCGdex logo swapping in as a
best-effort upgrade; zero third-party-image rights, never a blank title. **Phase 1
(parked):** a **self-hosted, admin-uploaded photo per product** (Supabase Storage,
`products.image_path`, an upload control in Data Entry beside CM ID / Exp ID),
first-party/licensed imagery only — never re-hosted publisher/marketplace art.
*Board-row / set-grouping logos are a later, optional extension of the shipped
drill-down work.*

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

**Open questions — now answered by the 2026-08 deep-dive
([`docs/sealed-product-photos-research.md`](docs/sealed-product-photos-research.md)):**
1. **Any sublicensable image rights?** *No.* No reachable feed conveys
   redistributable *image* rights. The data/image split is the whole story:
   PriceCharting / PokemonPriceTracker Business / JustTCG will licence *pricing
   data* commercially, but the pictures are TPCi's (official, non-commercial
   only) or a marketplace/aggregator's (photos they don't own to sublicense).
2. **Sealed photos do exist automatically — via TCGplayer's catalogue (free
   TCGCSV mirror), `tcgplayer-cdn.tcgplayer.com/product/{id}_200w.jpg`** — but
   re-using them commercially violates TCGplayer's ToS; clean only for a
   free/non-commercial build, hotlinked, and must be off before any paywall.
3. **TCGdex is confirmed dead for sealed photos** — its schema has no product/box
   interface, logos and card scans only. (Still fine as our logo source.)
4. **Product photos *are* meaningfully safer than logos** on the *trademark*
   axis (nominative fair use fits an identification/comparison tool), but that
   doctrine does not license the copyrighted **artwork** — so re-hosting anyone's
   box photo is still copyright exposure a disclaimer can't cure.
5. **The catalogue is small (~40–80 sealed products), so automation isn't
   required** — the recommendation is Phase 0 a **generated set-identity
   placeholder** (set logo + type-coloured card + badge; zero third-party
   rights) and Phase 1 a **self-hosted, admin-uploaded photo per product** in
   Supabase Storage (first-party / licensed imagery), never re-hosted publisher
   or marketplace art. Enforcement is funding-keyed (TPCi's ex-CLO: they act
   "once they get funded"), so the free grey-zone route and the paid build must
   diverge. A TPCi licensing enquiry stays the only clean path to *official* art
   in a paid tier — price it before committing.

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

### 2b. Board performance fixes — mostly dormant (step 1 pulled into Gate G3.3)

Spawned by the scale measurements (item 2, shipped). **Step 1 (debounce the
board search) is now Gate G3.3** — pulled forward because it is felt today and
pairs with the G3.1 load change. **Steps 2–3 stay dormant:** at today's ~36
products the board costs 8 ms and they would be speculative complexity; they ship
only if G3.4's fresh measurement past ~200 products still says so. They come due when coverage growth or automated
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

### 1. Backup & restore — ACTIVATED as Gate G1 (full plan retained here)

**Shipped as Gate G1 — but the design evolved past the detail below.** What
actually shipped (see the **G1** section at the top of this file and
`SUPABASE.md` → *Backup & restore*, the authoritative references): (a) an
**in-tool admin JSON backup** button; (b) `scripts/export-backup.mjs` with a
`--full-json` **complete all-tables dump** as well as the xlsx; (c) the weekly
Action writes **gpg-encrypted** to a **private off-site S3-compatible bucket**
(R2/B2/S3), **not** a GitHub artifact and **not** committed to the repo — because
the repo is public. The step-by-step below is the **original** plan, kept for the
`export-backup.mjs`↔`migrate-xlsx.mjs` contract reasoning and the admin-UUID
restore-order gotcha; where it says "upload as an artifact / commit to the repo",
read "upload to the private bucket". The one open step is the **rehearsed
restore** (into a local `supabase start` stack).

Moved to **Now** in Jul 2026 then deferred by maintainer decision — not descoped,
just not next at the time. (Item numbers are stable labels so cross-references keep working;
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
