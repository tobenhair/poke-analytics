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
| `products` | one row per tracked product | read: all signed-in · write: admin | `name`, `type`, `packs`, `release`, `cardmarket_url`, `cardmarket_product_id`, `cardmarket_expansion_id`, `cardmarket_promo_product_ids`, `price_locked` |
| `snapshots` | one row per product per date | read: all signed-in · write: admin | `product_id`, `snapshot_date`, `price`, `set_value`, `low_liquidity`, `price_avg`, `price_low`, `promo_value` |
| `cardmarket_expansion_singles` | ingestion cache: expansion → its single-card ids | service-role only (no client policy) | `id_expansion`, `single_product_ids` |
| `user_settings` | per-user preferences | read/write: own row | `age_threshold`, `currency` |
| `holdings` | per-user portfolio | read/write: own row | `product_id`, `quantity`, `cost_basis` |
| `alerts` | per-user price alerts | read/write: own row | `product_id`, `alert_type` (`fixed`/`fair`), `target_price` (fixed), `below_pct` (fair) |
| `sales` | per-user disposals (realised P&L) | read/write: own row | `product_id`, `quantity`, `sale_price`, `cost_basis`, `sold_on` — **append-only** (no `unique(user_id,product_id)`: a product can be sold many times) |
| `purchases` | per-user buy events (the buy half of the Transaction Log) | read/write: own row | `product_id`, `quantity`, `unit_price`, `bought_on` — **append-only** like `sales`. `holdings` stays the source of truth for the current position; this is an event record beside it (buy-more appends, edit-in-place does not) |
| `client_errors` | runtime error reports | insert: anyone · read: admin | `message`, `stack`, `context` |
| `page_views` | privacy-friendly analytics — anonymous view counts | insert: anyone · read: admin | `view`, `created_at` (no user id / IP / UA — needs no consent) |

The admin is identified by user UUID in a `public.is_admin()` SQL function that
the write policies call; it must match `SUPABASE_CONFIG.adminUserId` in the app.
`npm run test:unit` asserts those two agree — change one and the suite fails,
rather than the mismatch surfacing later as an admin who cannot save.

Note `currency` is display-only: **€ is the canonical stored unit** for every
price and set value, and the Portfolio tab converts at render time.

## Backup & restore

The database is the live source of truth. Supabase's managed daily backups /
PITR are a **paid-plan** feature, so on the free tier the backup strategy is two
things you own and run yourself — keep both:

> ⚠️ **This is an interim, free-tier solution — not a production DR posture.**
> The in-tool button + the weekly Action are a pragmatic stand-in while the
> project runs on the Supabase free tier. Private user data is kept **off** the
> public repo — the all-users dump goes only to a **private, encrypted, off-site
> bucket** (below), never a GitHub artifact — which closes the public-exposure
> gap. What remains interim: **no point-in-time recovery** (weekly/manual
> snapshots only, so up to a week of writes can be lost), restore is **manual and
> (until rehearsed) unproven**, and it leans on a single provider. **Before this
> becomes a commercial product, add** Supabase's paid **PITR / managed backups**
> as the baseline, a defined **RPO/RTO**, redundant off-site retention, and a
> periodically **rehearsed** restore. Tracked under *Complete DB backups &
> security audit* in `ROADMAP.md` → **Later**.

**1. In-tool full backup (JSON) — the primary manual backup.** In **Data Entry**
(admin only) the **⬇ Download backup** button (`downloadFullBackup()`) reads
every table your account can read and downloads one
`sealed-analytics-backup-<date>.json`. One click, no secrets, no server — the
free-tier stand-in for PITR.

- **Coverage — bounded by RLS, on purpose.** Because it runs in the admin's
  browser it captures exactly what the admin may read: the shared
  `products`/`snapshots`, the public `news`, the admin's own `client_errors` +
  `cardmarket_excluded_singles`, and the admin's **own** portfolio
  (`user_settings`/`holdings`/`alerts`/`sales`/`purchases`). It does **not**
  include *other users'* private rows (per-user RLS blocks even the admin) or the
  service-role-only `cardmarket_expansion_singles` cache (regenerable via **Sync
  catalog**). The file's `meta.note` records this so a restore is never misled.
  For a solo deployment (one portfolio owner) this is effectively the whole
  database bar the regenerable cache.

**2. Weekly Action → a PRIVATE off-site bucket — the automated, all-users,
whole-database net.** `.github/workflows/backup.yml` runs
`scripts/export-backup.mjs --full-json` weekly (and on-demand via *Run workflow*)
using the **service-role** key (SELECT-only — it never writes), and uploads
**two** objects to a **private, S3-compatible object store** under
`backups/<date>/`. **Nothing goes to a GitHub artifact** — this repo is public,
so no user data (encrypted or not) should live on it.

- `sealed-analytics-db-<date>.json.gpg` — the **complete whole-database dump**:
  every public table, **every user's rows** (service-role bypasses RLS),
  including the per-user portfolios (`holdings`/`alerts`/`sales`/`purchases`/
  `user_settings`) and the `cardmarket_*` caches. This is the true full-database
  backup — the part the in-tool button (1) can't reach — so it scales as users
  grow. It is **client-side encrypted with gpg AES-256 before upload**
  (defense-in-depth on top of the private bucket; the plaintext never leaves the
  runner). Decrypt it with your passphrase:
  ```
  gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
      -o sealed-analytics-db.json -d sealed-analytics-db-<date>.json.gpg
  ```
- `pokemon_data-backup-<date>.xlsx` — the contract-valid, re-importable copy of
  the tracked `products` + `snapshots` (re-imports through
  `supabase/migrate-xlsx.mjs`, passes `npm run validate`; Summary sheet also
  carries CM ID / Exp ID / Promo IDs / Price Locked / Cardmarket URL). Kept beside
  the dump for convenience.

**One-time bucket setup.** Create a **private** bucket at any S3-compatible
provider — **Cloudflare R2 is recommended** (free 10 GB, no egress fees;
[Backblaze B2](https://www.backblaze.com/) or AWS S3 work identically):
1. Create the bucket (keep it **private** — no public access) and, ideally, a
   **lifecycle rule** to expire objects after N days so old backups prune
   themselves.
2. Create an API token / access key scoped to that bucket (read+write).
3. Note the S3 **endpoint** — for R2 it is
   `https://<account-id>.r2.cloudflarestorage.com`.

**Secrets** (Settings → Secrets and variables → Actions):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — DB read (service role bypasses
  RLS; keep the key only here, never in the repo or client).
- `BACKUP_PASSPHRASE` — encrypts the dump; the **only** key that decrypts it, so
  store it safely off the repo.
- `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`,
  `BACKUP_S3_SECRET_ACCESS_KEY`, and (B2/S3 only) `BACKUP_S3_REGION` — the private
  bucket. R2 uses region `auto`, so `BACKUP_S3_REGION` may be left unset for R2.

If the passphrase or any bucket secret is missing the workflow **fails before
writing any dump**, so a misconfigured run can never produce private data with
nowhere private to put it.

**3. Managed backups / PITR — the optional paid upgrade.** On a paid plan you can
enable it under **Project → Database → Backups** for point-in-time recovery with
no manual step. Not required — (1) + (2) already cover the whole database.

### Restoring

**Rebuild from a JSON backup** (the in-tool file (1) or, for all users, the
Action's complete dump (2) — **download it from the private bucket, then decrypt
the `.json.gpg`**, see above) → the JSON holds every captured table as plain rows.
Restore by upserting them back with the **service-role** key (which bypasses RLS),
keyed on each table's natural conflict target (`products` on
`user_id,name`; `snapshots` on `product_id,snapshot_date`; the per-user tables on
their `id`). Do the admin-UUID step below first on a fresh project.

**Rebuild the tracked dataset from a workbook (2)** (a fresh/clean project, or a
vendor-independent recovery) → run `schema.sql`, then
`supabase/migrate-xlsx.mjs` on a downloaded backup `.xlsx`:

1. **Create the admin account first** (sign up once in the app or the dashboard)
   and copy its **User UID** (Authentication → Users).
2. **Patch the admin UUID in both places** so writes work on the new project:
   the `public.is_admin()` function in `supabase/schema.sql` **and**
   `SUPABASE_CONFIG.adminUserId` in `index.html`. They must match — `npm run
   test:unit` (`repo-invariants.test.mjs`) checks it. **Do this before running
   the schema**, or you get a database nobody can write to (a fresh project mints
   a *different* UUID than the old one).
3. Run `schema.sql` in the SQL editor.
4. Run `supabase/migrate-xlsx.mjs` (env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `MIGRATE_EMAIL`, `MIGRATE_PASSWORD`) on the backup workbook — it upserts
   `products` + `snapshots`.
5. Verify in-app: sign in, spot-check a known product's latest price and set
   value against the backup.

**Rehearse it — this is the part that proves the backup.** A backup taken is not
a backup until a restore has been *run*. Rehearse into a throwaway target — a
local stack (`supabase start`, free, Docker: real Postgres + auth + PostgREST,
so `schema.sql` and `migrate-xlsx.mjs` run unmodified) is the recommended
destination — then correct the steps above from what actually happened, and note
the date. A local stack **cannot** exercise the three email jobs
(`staleness-reminder.sql`, `alert-emails.sql`, `error-digest.sql` — they need
`pg_cron` + `pg_net` + a Vault Resend key + outbound HTTP) or the dashboard-only
steps (API keys, Auth URL config); say so rather than skipping them silently.

> **Status:** the in-tool JSON backup, the export script and the weekly workflow
> are in place. The one remaining operator step to fully close this out is a
> **rehearsed restore** (run it once into a local `supabase start` stack and
> correct the steps above from what happened). Managed PITR (3) is an optional
> paid upgrade, not required.

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
  sealed item would show up. Run it after adding a product/set. It also **drops
  any id in `public.cardmarket_excluded_singles`** before caching — an
  admin-managed list of cards Cardmarket mis-tags into a set but that must never
  count toward Set Value (e.g. the €2,500 promo Gengar wrongly tagged to Sword &
  Shield base). To exclude a card: `insert into public.cardmarket_excluded_singles
  (id_product, reason) values (<idProduct>, '<why>');` then re-run Sync catalog.
  Because it drops them at cache-build time, a re-sync can never re-add them.

All three derive/​match identically to the unit-tested `scripts/cardmarket-lib.mjs`,
so the automated values match. (`scripts/cardmarket-ingest.mjs` mirrors the same
work on the command line — `--dry-run`, `--backfill-ids`, `--refresh-catalog` —
as a local fallback, but production needs no GitHub.)

**What the daily job writes, per tracked product:**

- **Set Value** = the sum of every single in the set (`avg30`, the 30-day
  average) — the all-cards EU value. A **day-over-day guardrail** protects this
  sum: because it adds up ~250 singles, a >50% single-day *rise* is almost always
  a data artefact (one mis-tagged high-value card entering the set's singles list
  — e.g. a €2,500 promo Gengar that once 5×'d Sword & Shield overnight), so the
  job **holds the previous value** instead of writing the spike and reports it as
  `setValueHeld` in the run output for you to review. A *fall* is allowed through,
  so once the bad card is removed the value self-corrects on the next run.
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
- **`cardmarket_promo_product_ids`** (the **"Promo IDs"** column, a `bigint[]`) —
  the Cardmarket `idProduct`s of the promo card(s) bundled into the product (e.g.
  an ETB's stamped promo — some products bundle more than one) that aren't part of
  the set's singles. Entered as a **comma-separated list**. The daily job fetches
  each card's **avg30** (same basis as Set Value) and writes their **sum** into
  `snapshots.promo_value` (a single scalar — we track only the combined amount to
  exclude, not per-card values), which is subtracted from Price for the per-booster
  maths so the product is judged on its boosters, not the extras. `NULL`/empty = no
  promo. (This replaced the old static `promo_value` €, which went stale as the
  promo card's own price moved.)

You don't hand-source the CM ID / Exp ID — click **Resolve ids** (below) and both
are filled by name-matching. Type them in only to override a specific product; a
value you enter by hand is never overwritten by Resolve ids. **The Promo IDs are
entered by hand** — a promo single isn't in the sealed-product catalogue Resolve
ids matches against, so look up each promo card on Cardmarket and paste its
`idProduct` (comma-separate several). `cardmarket-map.json` is now only for
overrides (`nameHint`, `priceOverride`, `promoIdProducts`) and the offline dry-run
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
   `products.cardmarket_expansion_id`, `products.cardmarket_promo_product_ids`,
   `products.price_locked`, `snapshots.low_liquidity`, `snapshots.promo_value`
   and the `cardmarket_expansion_singles` table exist (all idempotent).
   **Note:** re-applying the schema **migrates the old single
   `products.cardmarket_promo_product_id` into the new `cardmarket_promo_product_ids`
   array** (one-element) and drops the scalar column — existing promo ids are
   preserved. (It also drops the long-retired static `products.promo_value` €
   column, superseded by the fetched per-snapshot `snapshots.promo_value`.)
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
4. **Verify the feeds first.** The source URLs (PokéBeach, r/PokeInvesting,
   two Google News queries) should be curl-checked once — confirm each returns
   valid RSS/Atom with recent items — before relying on them; a dead feed is
   isolated (the run continues) but yields nothing. `node scripts/news-fetch.mjs`
   previews what the feeds currently return from a machine that can reach them.
   The **Invoke** button's `perSource` JSON is the fastest check per source.
   Note the per-source **User-Agent**: Reddit needs the descriptive agent, Google
   News needs a browser one (it returns **HTTP 503** to a bot agent from a
   datacenter IP — the cause if a Google News source shows `error: HTTP 503`).

The parse/relevance/dedupe logic is the unit-tested `scripts/news-lib.mjs`
(`tests/unit/news-lib.test.mjs`); the Edge Function mirrors it. If the feed is
never enabled, the app is unaffected — the news button and teasers stay hidden.
