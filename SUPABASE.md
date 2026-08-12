# Optional: cloud sync + login with Supabase

By default this app is a purely static dashboard: `pokemon_data.xlsx` auto-loads
and there is no login. That mode is unchanged and needs no setup.

If you want **per-user accounts with data stored in the cloud** (so you can log
in from any device and save without committing a file), you can point the app at
a [Supabase](https://supabase.com) project. The frontend still runs on GitHub
Pages — only the data and auth move to Supabase.

## Why this is safe on a public static host

The only Supabase value that ships in `index.html` is the **anon (publishable)
key**, which is designed to be public. It grants nothing on its own —
[Row-Level Security](https://supabase.com/docs/guides/auth/row-level-security)
policies (in [`supabase/schema.sql`](supabase/schema.sql)) enforce that every
user can read and write only their own rows, server-side. Editing the client JS
cannot bypass that. **Never put the `service_role` key in the page.**

## Access model

This is a **shared-dataset** setup:

- **Logged-out visitors** see a demo of the 3 newest sets only. To see the
  **full** catalogue they must sign in; any signed-in user can then **read** all
  product data (the same shared set of products + snapshots).
- **Only the admin can add or edit data** — the single account whose user UUID
  you configure below. The Data Entry UI is hidden for everyone else, and the
  database rejects writes from any non-admin account regardless of the UI.
- Because viewers need accounts, **leave public sign-ups on** so people can
  register. Each viewer's age-threshold preference is private to them; the
  product data is shared.

## Setup

1. **Create a project** at [supabase.com](https://supabase.com) (the free tier
   is plenty for personal use).

2. **Create your admin account and copy its UUID.** *Authentication → Users →
   Add user* (email + password). Then open that user and copy its **User UID** —
   you'll need it in the next two steps. (Or sign up through the app later; the
   dashboard route is simplest for getting the UUID up front.)

3. **Apply the schema.** Open [`supabase/schema.sql`](supabase/schema.sql),
   replace `PASTE-YOUR-ADMIN-USER-UUID` with the UUID from step 2, then paste
   the whole file into *SQL Editor → New query → Run*. This creates the
   `products`, `snapshots`, `user_settings`, `holdings`, and `alerts` tables and
   the RLS policies (shared read, admin-only write; private per-user settings,
   portfolio, and alerts). Safe to re-run.

4. **Allow the app's URL as a redirect target** (needed for password reset).
   *Authentication → URL Configuration*: set **Site URL** to where you host the
   page (e.g. `https://you.github.io/poke-analytics/`) and add the same URL
   under **Redirect URLs** — plus `http://localhost:8000` if you develop
   locally. The app calls `resetPasswordForEmail()` with `redirectTo` set to the
   current page; Supabase refuses to mail a link to a URL that isn't on this
   list, so a missing entry makes "Forgot your password?" silently useless.
   The default **Reset Password** email template needs no changes.

5. **Add your keys + admin UUID to the app.** In `index.html`, fill in the
   `SUPABASE_CONFIG` block near the top:

   ```js
   window.SUPABASE_CONFIG = {
     url:         'https://YOUR-PROJECT.supabase.co',
     anonKey:     'YOUR-ANON-KEY',
     adminUserId: 'YOUR-ADMIN-USER-UUID',
   };
   ```

   Find the URL + anon key under *Project Settings → API*; the UUID is the one
   from step 2 (it must match the value baked into `schema.sql`). Leaving `url`
   or `anonKey` blank keeps the app in its original static/xlsx mode.

6. **Sign in.** Serve the app, and the sign-in overlay appears. Sign in with the
   admin account from step 2 — Data Entry and **☁ Save to cloud** appear only
   for that account. Other people can **Create an account** and will see the
   shared data in read-only form (no Data Entry).

7. **(Optional) Import your existing data.** Seed your account from the current
   workbook instead of re-entering it. Two ways:

   **a) No terminal / phone-friendly — paste SQL.** Open
   [`supabase/seed.sql`](supabase/seed.sql), set your account email on the
   marked line, and paste the whole file into *Dashboard → SQL Editor → New
   query → Run*. It upserts every product and snapshot for your account and is
   safe to re-run. (Regenerate it from a newer workbook with
   `node supabase/gen-seed.cjs`.)

   **b) Terminal — run the migration script**
   ([`supabase/migrate-xlsx.mjs`](supabase/migrate-xlsx.mjs)):

   ```bash
   npm install @supabase/supabase-js xlsx
   SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
   SUPABASE_ANON_KEY="YOUR-ANON-KEY" \
   MIGRATE_EMAIL="you@example.com" \
   MIGRATE_PASSWORD="your-password" \
   node supabase/migrate-xlsx.mjs pokemon_data.xlsx
   ```

## How it works once enabled

- **Logged out**, visitors see a **demo page** with the 3 newest release-date
  sets (read-only cards) and a **Sign in** button. Those rows are exposed to the
  anonymous role by the `"demo read …"` policies in `schema.sql`; everything
  else still requires signing in.
- On load, the app checks for a session. No session → demo page. Signed
  in → the shared products and snapshots are loaded from the database (the
  normalised `snapshots` rows are pivoted back into the price/value history the
  charts use). Every signed-in user sees the same data.
- The **Data Entry** tab and **☁ Save to cloud** are revealed **only for the
  admin** (the account matching `adminUserId`). The admin enters the month's
  prices and set values (or adds new products) and saves — no file commit
  needed. Everyone else is read-only, and the database rejects any write that
  doesn't come from the admin.
- **⬇ Export updated .xlsx** still works as a backup, and importing an `.xlsx`
  by drag-drop is still available.
- The age-threshold slider is saved per user (private to each account).
- Signed-in users get their own **Portfolio** tab (private to the account),
  holding two things:
  - **Portfolio** — quantity + per-unit cost basis for products they own, with
    unrealised P&L derived from the shared latest prices. Adding tops up a
    holding and blends the cost basis to a weighted average; a per-row edit
    corrects exact values. Holdings live in the per-user `holdings` table.
  - **Price alerts** — a buy-below target per product. When a product's latest
    tracked price falls to or below its target it's flagged in the alerts list
    and with a 🔔 on the Analysis board. Targets live in the per-user `alerts`
    table; the triggered state is derived client-side, never stored.
  Both are RLS-scoped to the account, never affect the shared data, and
  **save automatically** on every change (no explicit save button).

## Optional: email reminder when data goes stale

Because prices are entered by hand on a monthly cadence, it's easy to forget a
month. `supabase/staleness-reminder.sql` sets up a server-side job that emails
you when the newest snapshot is older than a threshold (default **30 days**, the
same as the in-app staleness flag) — no need for anyone to have the page open.

It uses **pg_cron** (schedule) + **pg_net** (outbound HTTP) + **[Resend](https://resend.com)**
(email) + **Supabase Vault** (stores the Resend key). One-time setup:

1. **Enable the extensions** — Dashboard → Database → Extensions: turn on
   `pg_cron` and `pg_net`.
2. **Set up Resend** — create a free account, verify a sending domain, and copy
   an API key. The `from` address must be on your verified domain.
3. **Store the key in Vault** — Dashboard → Project Settings → Vault (or the SQL
   editor):
   ```sql
   select vault.create_secret('re_your_key_here', 'resend_api_key');
   ```
4. **Edit and run the SQL** — open `supabase/staleness-reminder.sql`, set the
   three values at the top of the function (`recipient`, `sender`, `threshold`),
   then run the whole file in the SQL Editor.

The job runs **weekly (Mondays 09:00 UTC)** so an overdue dataset nudges you a
few times rather than every day — change the cron expression to taste. To test
it immediately, run `select public.check_data_staleness();` (it sends a real
email only if the data is currently stale). To remove it,
`select cron.unschedule('staleness-reminder');`.

The function is `SECURITY DEFINER` and execute is revoked from `anon` /
`authenticated`, so only the scheduler can trigger it — a signed-in user can't
make it send emails.

## Optional: email when a price alert triggers

`supabase/alert-emails.sql` emails each user whose **fixed € buy-below** price
alerts are currently triggered (latest price ≤ target), so the in-app 🔔 reaches
them with the page closed. It reuses the same stack and Vault key as the
staleness job — enable `pg_cron`/`pg_net`, set `sender` at the top of the
function, and run the file. Runs **weekly (Mondays 10:00 UTC)**; test with
`select public.check_price_alerts();` and remove with
`select cron.unschedule('price-alerts');`.

Scope: **fixed** alerts only. **Fair-price** alerts (% below fair price) are
evaluated in the browser — the fair price depends on the age-fit across all
products, which isn't computed in the database — so they stay in-app.

## Error monitoring (client_errors)

Runtime errors on the page are reported into an insert-only `client_errors`
table (created by `schema.sql`) instead of dying in a console warning or a
toast — a silent failure in a scoring path is a wrong buy signal. Two stages in
`index.html`: an early inline script buffers `window.onerror` /
`unhandledrejection` events from the first script tick, and the main module
drains the buffer once the Supabase client exists (plus explicit reports at
the cloud-load/save and demo-load catches). The client dedupes messages and
hard-caps at 10 reports per session; column length checks bound abuse.

Access: **anyone may insert** (including logged-out demo visitors; a report may
carry the reporter's own `user_id` or none), **only the admin may read**, and
nothing can be updated or deleted through the API. Review errors as the admin
in the SQL editor:

```sql
select created_at, message, context, user_id
from public.client_errors order by created_at desc limit 50;
```

In static/xlsx mode (no `SUPABASE_CONFIG`) the beacon is a no-op — there is no
backend to send to.

### Optional: daily error-digest email

`supabase/error-digest.sql` emails you a grouped summary (message × count,
worst first) of any `client_errors` rows from the last day — and stays
completely silent when there are none, so the email itself is the signal. Same
stack and Vault key as the staleness job: enable `pg_cron`/`pg_net`, set
`recipient`/`sender` at the top of the function, run the file. Runs **daily
(07:30 UTC)**; test with `select public.send_error_digest();` (after inserting
a fake row — the file's footer shows how) and remove with
`select cron.unschedule('error-digest');`.

## Data model

Derived metrics (age, price/booster, SV/booster, weighted score) are **not**
stored — the client recomputes them, exactly as for the `.xlsx` path. Only raw
inputs live in the database:

| Table | Purpose | Access | Key columns |
|-------|---------|--------|-------------|
| `products` | one row per tracked product | read: all signed-in · write: admin | `name`, `type`, `release`, `cardmarket_url`, `cardmarket_product_id`, `cardmarket_expansion_id`, `price_locked` |
| `snapshots` | one row per product per date | read: all signed-in · write: admin | `product_id`, `snapshot_date`, `price`, `set_value`, `low_liquidity`, `price_avg`, `price_low` |
| `cardmarket_expansion_singles` | ingestion cache: expansion → its single-card ids | service-role only (no client policy) | `id_expansion`, `single_product_ids` |
| `user_settings` | per-user preferences | read/write: own row | `age_threshold`, `currency` |
| `holdings` | per-user portfolio | read/write: own row | `product_id`, `quantity`, `cost_basis` |
| `alerts` | per-user price alerts | read/write: own row | `product_id`, `alert_type` (`fixed`/`fair`), `target_price` (fixed), `below_pct` (fair) |
| `client_errors` | runtime error reports | insert: anyone · read: admin | `message`, `stack`, `context` |

The admin is identified by user UUID in a `public.is_admin()` SQL function that
the write policies call; it must match `SUPABASE_CONFIG.adminUserId` in the app.
`npm run test:unit` asserts those two agree — change one and the suite fails,
rather than the mismatch surfacing later as an admin who cannot save.

Note `currency` is display-only: **€ is the canonical stored unit** for every
price and set value, and the Portfolio tab converts at render time.

## Optional: automated Cardmarket ingestion

Instead of entering prices by hand each month, a scheduled job can write the
daily snapshot for you from Cardmarket's official bulk catalogue files (native
EUR). It feeds the same `snapshots` table the app already reads, and never runs
in the browser. See `ROADMAP.md` → *Automated ingestion* for the full rationale.

**Architecture — three Edge Functions, all inside Supabase.** No GitHub Action.
The work is split so the daily job stays within the Edge runtime's ~256 MB
memory limit:

- **Daily snapshot — `supabase/functions/cardmarket-daily`**, scheduled by
  `pg_cron` (`supabase/cardmarket-cron.sql`). It fetches only the smaller
  `price_guide` bulk file and, using ids the DB already holds, writes today's
  Price + Set Value.
- **Resolve ids — `supabase/functions/cardmarket-resolve-ids`**, triggered from
  Data Entry (the **Resolve ids** button, admin-only). For every product missing
  a CM ID and/or Exp ID it name-matches against Cardmarket's (small) nonsingles
  catalogue and writes the ids back — **NULLs only**, so a manual pin is never
  overwritten. This is what makes bulk-adding products hands-off; you never
  hand-source an id.
- **Catalog refresh — `supabase/functions/cardmarket-catalog-refresh`**,
  triggered from Data Entry (the **Sync catalog** button, admin-only). It caches,
  per expansion id on your products, the single-card ids that make up Set Value
  into `public.cardmarket_expansion_singles`, so the daily function never loads
  the huge singles file. It **streams** that file (reads it chunk by chunk, one
  record at a time) so it too stays inside the memory limit no matter the file
  size, and reports each set's card count + max single price so a mis-categorised
  sealed item would show up. Run it after adding a product/set.

All three derive/​match identically to the unit-tested `scripts/cardmarket-lib.mjs`,
so the automated values match. (`scripts/cardmarket-ingest.mjs` mirrors the same
work on the command line — `--dry-run`, `--backfill-ids`, `--refresh-catalog` —
as a local fallback, but production needs no GitHub.)

**What the daily job writes, per tracked product:**

- **Set Value** = the sum of every single in the set (`avg30`, the 30-day
  average) — the all-cards EU value.
- **Box Price** = the midpoint of Cardmarket's `trend` and `avg` (a 50/50 blend).
  For thin-liquidity boxes the true price sits between the smoothed `trend` and
  the sales `avg`; for liquid boxes the two nearly coincide, so the blend ≈
  `trend`. *Unless* the product is **price-locked** (see below), in which case
  the price is left to your manual entry.
- **`low_liquidity`** — an advisory flag set when the sales-based price is
  unreliable (the guide's `trend` and `avg` disagree by ≥20%, i.e. thin volume).

**Which Cardmarket product/set each row maps to.** The job is **DB-driven**: the
tracked set is your `products` table. Each product carries two Cardmarket ids you
enter in Data Entry and save with **☁ Save to cloud**:
- **`cardmarket_product_id`** (the **"CM ID"** column) — the Cardmarket
  `idProduct`; the daily job reads this product's Box Price directly from it.
- **`cardmarket_expansion_id`** (the **"Exp ID"** column) — the set whose singles
  make up Set Value. The catalog refresh uses it to cache that set's card list.

You don't hand-source these — click **Resolve ids** (below) and both are filled
by name-matching. Type them in only to override a specific product; a value you
enter by hand is never overwritten by Resolve ids. `cardmarket-map.json` is now
only for overrides (`nameHint`, `priceOverride`) and the offline dry-run
allowlist used by the local `scripts/cardmarket-ingest.mjs` fallback.

**Manual control for thin-liquidity products.** The daily job flags a snapshot
`low_liquidity` when the guide's `trend` and `avg` diverge ≥20% (thin sales →
unreliable price), and stores the reference prices (`snapshots.price_avg` /
`price_low`) alongside. In **Data Entry** those flagged products are badged
"⚠ thin" with the spread (`auto €trend · avg €… · low €…`) and listed in the
advisory strip for review. Hit the row's **🔒 lock** (→ `products.price_locked =
true`) and the job never overwrites that product's price — you set it by hand,
and Set Value still auto-updates. It's the override for grails whose few sales
make the automated price untrustworthy.

**Setup:** every step is in the browser — no terminal required (deploy the
functions via **Edge Functions → Deploy a new function → Via Editor**, pasting
each `supabase/functions/<name>/index.ts`; the CLI `supabase functions deploy
<name>` works too).

1. Apply the schema (`supabase/schema.sql`) so `products.cardmarket_product_id`,
   `products.cardmarket_expansion_id`, `products.price_locked`,
   `snapshots.low_liquidity` and the `cardmarket_expansion_singles` table exist
   (all idempotent).
2. Seed the `products` rows (Data Entry → Save to cloud, or the workbook). A
   product missing from Supabase is skipped by the jobs. You do **not** need to
   hand-enter the Cardmarket ids — step 4 fills them.
3. **Deploy all three Edge Functions** (they use the auto-injected `SUPABASE_URL`
   / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` — no secrets to set):
   `cardmarket-resolve-ids`, `cardmarket-catalog-refresh`, `cardmarket-daily`.
4. **Fill the ids:** in Data Entry, click **Resolve ids**. It name-matches every
   product missing a CM ID / Exp ID and writes both back (leaving any you typed
   yourself). Anything it can't match confidently is listed — enter those by hand
   in the CM ID / Exp ID columns and **Save to cloud**.
5. **Cache the card lists:** click **Sync catalog**. It streams the singles file
   and caches each Exp ID's card list; the response reports each set's card count
   + max single price — sanity-check those. Re-run it whenever you add a set.
6. **Schedule the daily job:** run `supabase/cardmarket-cron.sql` in the SQL
   editor (fill in your project ref and store the `service_role` key in Vault as
   instructed). `pg_cron` then invokes `cardmarket-daily` daily at ~04:17 UTC.
   Test once via the function's **Invoke** button (or `supabase functions invoke
   cardmarket-daily`).

**Adding products later** is then fully in-browser: add them in Data Entry →
**Save to cloud** → **Resolve ids** → **Sync catalog**. Done.

The derivation is the unit-tested core in `scripts/cardmarket-lib.mjs`
(`tests/unit/cardmarket-lib.test.mjs` pins the numbers); all three Edge Functions
mirror the same match/derive math, so the automated values match what the
read-only `cardmarket:spike` checks reported.

## Optional: news feed (Pokémon TCG / investing / business)

A companion headline feed. Browsers can't fetch third-party RSS (no CORS), so a
scheduled server job does it and the client reads a table.

1. **Create the table:** re-running `supabase/schema.sql` adds `public.news`
   (public read for anon + signed-in; writes only via the service role — no
   client write policy).
2. **Deploy the function:** `supabase functions deploy news-fetch`
   (`supabase/functions/news-fetch/index.ts`). It fetches the feeds in
   `NEWS_SOURCES`, parses RSS/Atom, dedupes, and upserts `news`; it prunes rows
   older than 60 days. Only headline + link + source + timestamp is stored.
3. **Schedule it:** run `supabase/news-cron.sql` (fill in your project ref; store
   the `service_role` key in Vault as `news_service_key`, or reuse an existing
   secret). `pg_cron` then calls `news-fetch` hourly at :07. Test once via the
   function's **Invoke** button. Optionally set an `INGEST_SECRET` env var on the
   function and send it as `x-ingest-secret` to lock down manual invocation.
4. **Verify the feeds first.** The source URLs (PokéBeach, r/PokeInvesting)
   should be curl-checked once — confirm each returns valid RSS/Atom with recent
   items — before relying on them; a dead feed is isolated (the run continues)
   but yields nothing. `node scripts/news-fetch.mjs` previews what the feeds
   currently return from a machine that can reach them. The **Invoke** button's
   `perSource` JSON is the fastest check per source. Note the per-source
   **User-Agent**: Reddit needs the descriptive agent (it 429s a browser one).
   **Google News was dropped** — it returns **HTTP 503** to the Edge runtime's
   datacenter IP regardless of UA, so the **business** category has no source for
   now and stays empty until a datacenter-friendly feed is added.

The parse/relevance/dedupe logic is the unit-tested `scripts/news-lib.mjs`
(`tests/unit/news-lib.test.mjs`); the Edge Function mirrors it. If the feed is
never enabled, the app is unaffected — the news button and teasers stay hidden.
