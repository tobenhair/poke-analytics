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

- **Every visitor must sign in.** Any signed-in user can **read** all product
  data (the same shared set of products + snapshots).
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
   `products`, `snapshots`, and `user_settings` tables and the RLS policies
   (shared read, admin-only write). Safe to re-run.

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

- On load, the app checks for a session. No session → sign-in overlay. Signed
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

## Data model

Derived metrics (age, price/booster, SV/booster, weighted score) are **not**
stored — the client recomputes them, exactly as for the `.xlsx` path. Only raw
inputs live in the database:

| Table | Purpose | Access | Key columns |
|-------|---------|--------|-------------|
| `products` | one row per tracked product | read: all signed-in · write: admin | `name`, `type`, `release`, `cardmarket_url` |
| `snapshots` | one row per product per date | read: all signed-in · write: admin | `product_id`, `snapshot_date`, `price`, `set_value` |
| `user_settings` | per-user preferences | read/write: own row | `age_threshold` |

The admin is identified by user UUID in a `public.is_admin()` SQL function that
the write policies call; it must match `SUPABASE_CONFIG.adminUserId` in the app.
