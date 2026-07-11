# Roadmap

Where this goes from a personal tool toward a product other people can rely on.
Not a commitment or a schedule — a prioritised backlog. The ordering reflects
one deliberate decision: **the data stays manually entered by the maintainer
for now** (see "Parked", below). The first theme — *protecting and surfacing
that hand-curated data* rather than automating it — is now done; the current
focus is hardening correctness and building the reasons to log in.

## Foundations (done)

- **CI** — `scripts/validate-workbook.mjs` (the workbook matches the runtime
  contract) and a Playwright smoke test (every tab renders), on every push/PR.
- **Guard skills** — `data-integrity`, `metrics-review`, `verify-app`,
  `design-review` in `.claude/skills/`.

## Protect & surface the manual data (done)

Because one person's hand-entered numbers are the single source of truth, the
reliability of *that* process is the product's credibility.

- **Data Entry delta warnings** — new price / set value that moves more than a
  30% threshold vs the last snapshot is flagged inline, so a fat-finger
  (72 → 27) gets a warning instead of silently becoming a wrong "buy" signal
  (`applyEntryDeltaWarning`, `ENTRY_DELTA_WARN`). Same catch-it-before-it-ships
  spirit as the workbook validator.
- **Data-driven "last updated" + staleness** — the header shows the real latest
  *snapshot* date (not the page-load date) and flags when the newest data is
  older than ~30 days (`updateLastUpdated`, `STALE_DAYS`). Turns the manual
  cadence into an honest freshness signal instead of a hidden weakness.
- **Server-side staleness email reminder** — a Supabase `pg_cron` job emails the
  maintainer (via Resend) when the newest snapshot crosses the same ~30-day
  threshold, so a forgotten month doesn't rely on someone having the page open.
  (`supabase/staleness-reminder.sql`; setup in `SUPABASE.md`.)

## Now — quality & the reason to log in

- **Extract + unit-test the metrics module** *(done)* — the pure functions
  (`deriveProducts`, `boostersFromType`, `calcAgeWeight`, `recomputeScores`)
  now live in `metrics.js`, imported by both `index.html` (its main
  `<script type="module">`) and the `node --test` suite (`tests/unit/`), with
  no build step. Completes the correctness story CI started and turns the
  `metrics-review` skill's by-hand checklist into automated assertions.
- **Faster monthly entry loop** — since this recurs forever: pre-fill last
  month's values, keyboard/tab flow, bulk paste, an at-a-glance "did I fill
  everything?" check before export.
- **Portfolio / watchlist** — what a user owns, cost basis → unrealised P&L.
  The feature that makes logging in worthwhile. (The Supabase auth + shared
  catalogue + RLS + demo already exist to build on.)
- **Price alerts** — notify when something crosses a threshold.

## Later — reliability, polish, reach

- **Error monitoring** (e.g. Sentry) — errors are currently swallowed into a
  toast; surface them.
- **Privacy-friendly analytics** — know which views are actually used.
- **DB backup strategy** — formalise beyond the xlsx export.
- **Mobile & accessibility** — verify the dashboard is usable on a phone; add
  non-colour cues to the green/red value coding; first-class loading/empty/error
  states.
- **Scale & coverage** — sanity-check table/chart performance and add search if
  the catalogue grows to hundreds; consider singles, multi-currency,
  multi-region.
- **Legal/compliance for launch** — privacy policy, GDPR basics, cookie consent
  (EU-operated, stores emails in Supabase). The "not financial advice"
  disclaimer already exists.

## Parked — the pre-launch blocker

- **Automated EU price ingestion.** Cardmarket has no open API, PriceCharting's
  numbers diverge too much to trust, and scraping is fragile / a ToS question.
  No acceptable solution today, so data stays **manually entered by the
  maintainer**. This is explicitly the *last* thing to solve before a public
  launch — the "protect & surface the manual data" work exists to make manual
  data trustworthy in the meantime.
