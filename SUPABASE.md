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

## Setup

1. **Create a project** at [supabase.com](https://supabase.com) (the free tier
   is plenty for personal use).

2. **Apply the schema.** In the dashboard: *SQL Editor → New query*, paste the
   contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This
   creates the `products`, `snapshots`, and `user_settings` tables and their
   RLS policies.

3. **Configure auth.** *Authentication → Providers → Email* is enabled by
   default. For a private, single-user setup, consider turning **off** public
   sign-ups (*Authentication → Sign In / Providers → allow new users to sign
   up*) after you create your own account, so no one else can register. You can
   also disable "Confirm email" for a smoother first sign-in.

4. **Add your keys to the app.** In `index.html`, find the `SUPABASE_CONFIG`
   block near the top and fill in your project URL and anon key:

   ```js
   window.SUPABASE_CONFIG = {
     url:     'https://YOUR-PROJECT.supabase.co',
     anonKey: 'YOUR-ANON-KEY',
   };
   ```

   Find both under *Project Settings → API*. Leaving either blank keeps the app
   in its original static/xlsx mode.

5. **Create your account.** Serve the app, and the sign-in overlay appears.
   Click **Create an account**, then sign in (confirm your email first if
   confirmation is enabled).

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

- On load, the app checks for a session. No session → sign-in overlay. Signed
  in → your products and snapshots are loaded from the database (the normalised
  `snapshots` rows are pivoted back into the price/value history the charts
  use).
- The **Data Entry** tab is revealed when signed in. Enter the month's prices
  and set values (or add new products), then click **☁ Save to cloud** to upsert
  a snapshot for the current label — no file commit needed.
- **⬇ Export updated .xlsx** still works as a backup, and importing an `.xlsx`
  by drag-drop is still available.
- The age-threshold slider is saved per user.

## Data model

Derived metrics (age, price/booster, SV/booster, weighted score) are **not**
stored — the client recomputes them, exactly as for the `.xlsx` path. Only raw
inputs live in the database:

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `products` | one row per tracked product | `name`, `type`, `release`, `cardmarket_url` |
| `snapshots` | one row per product per date | `product_id`, `snapshot_date`, `price`, `set_value` |
| `user_settings` | per-user preferences | `age_threshold` |
