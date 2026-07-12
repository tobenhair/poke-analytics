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

4. **Add your keys + admin UUID to the app.** In `index.html`, fill in the
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

5. **Sign in.** Serve the app, and the sign-in overlay appears. Sign in with the
   admin account from step 2 — Data Entry and **☁ Save to cloud** appear only
   for that account. Other people can **Create an account** and will see the
   shared data in read-only form (no Data Entry).

6. **(Optional) Import your existing data.** Seed your account from the current
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

## Data model

Derived metrics (age, price/booster, SV/booster, weighted score) are **not**
stored — the client recomputes them, exactly as for the `.xlsx` path. Only raw
inputs live in the database:

| Table | Purpose | Access | Key columns |
|-------|---------|--------|-------------|
| `products` | one row per tracked product | read: all signed-in · write: admin | `name`, `type`, `release`, `cardmarket_url` |
| `snapshots` | one row per product per date | read: all signed-in · write: admin | `product_id`, `snapshot_date`, `price`, `set_value` |
| `user_settings` | per-user preferences | read/write: own row | `age_threshold` |
| `holdings` | per-user portfolio | read/write: own row | `product_id`, `quantity`, `cost_basis` |
| `alerts` | per-user price alerts | read/write: own row | `product_id`, `target_price` |

The admin is identified by user UUID in a `public.is_admin()` SQL function that
the write policies call; it must match `SUPABASE_CONFIG.adminUserId` in the app.
