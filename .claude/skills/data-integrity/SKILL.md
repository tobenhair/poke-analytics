---
name: data-integrity
description: Use whenever you touch the data layer — the tracked workbook (pokemon_data.xlsx), the xlsx parser/exporter (parseXlsx/exportXlsx), the hardcoded fallback data, the Supabase schema/RLS, or anything about how data loads into the app. Enforces the two-source model and the exact workbook contract so a change can't silently break loading (which makes the live page fall back to sample data without any visible error). Load BEFORE editing data code or the workbook, and run the validator before committing.
---

# Data integrity — the loading contract must not drift

This dashboard reads its numbers from data, and the single worst failure mode
is **silent**: if the workbook doesn't match the contract, `parseXlsx()`
throws, the app swallows it, and the page falls back to hardcoded sample data.
It *looks* fine and shows the wrong numbers. Your job on any data change is to
keep that from happening.

## The prime directive

**To change the tracked data, edit the workbook — never the HTML.** The
hardcoded `products` / `historicalData` / `histDates` in `index.html` are an
offline *fallback* only. If you do touch the sample data, keep all three
mutually consistent.

## The two (and a half) sources — the workbook wins

1. **Hardcoded fallback** in `index.html` — used only if the workbook fails to
   load. Keep `products`, `historicalData`, and `histDates` consistent.
2. **`pokemon_data.xlsx`** — the real data. Auto-loaded by `tryAutoLoad()` →
   `parseXlsx()` → `applyNewData()`.
3. **Supabase** (opt-in) — active only when `window.SUPABASE_CONFIG.url` **and**
   `.anonKey` are filled in. Reads `products`/`snapshots`/`user_settings`,
   pivots snapshot rows into aligned `price[]`/`setVal[]` arrays, and feeds the
   **same** `applyNewData()` path. Only raw inputs are stored; metrics are
   recomputed client-side.

Both the xlsx and Supabase loaders share `deriveProducts(newProducts,
newHistoricalData)` (and `boostersFromType()`) so they can never drift. If you
change how a metric is derived, change it **there**, once.

## The workbook contract (what `parseXlsx()` validates)

Exact, case-sensitive sheet and column names. Keep the app, the in-app "Format
Guide" modal, the README, and `scripts/validate-workbook.mjs` all in sync — if
you change the contract in one, change it in all four.

- **Sheet `Summary`** (one row per product): `Product`, `Type` (exactly
  `BOX`/`ETB`/`BUNDLE`), `Release Date` (date or `YYYY-MM-DD`). Product names
  must be unique.
- **Sheet `Historical Data`** (one row per product per snapshot): `Product`
  (must match Summary exactly), `Snapshot Date` (`YYYY-MM-DD`), `Price (€)`,
  `Set Value (€)`. Blank price/set-value is allowed (not yet tracked); if
  present it must be a non-negative number.
- **Sheet `Links`** (optional): `Product` + a URL column; non-`http` URLs are
  ignored.

Cross-checks the parser enforces (and the validator mirrors): every Summary
product has ≥1 Historical row, no Historical row references an unknown product,
and every product resolves a usable *latest* Price and Set Value (else it can't
be scored).

## Supabase specifics (only if config is filled in)

- Product data (`products`/`snapshots`) is a **single shared dataset**: any
  signed-in user can read it, but only the **admin** (UUID ==
  `SUPABASE_CONFIG.adminUserId`) may write. `user_settings` is private per user.
- The write boundary is **RLS in `supabase/schema.sql`** (`public.is_admin()`),
  not the UI. `setAuthedUI()`'s `is-admin` class is cosmetic gating only — never
  rely on it for security. If you change who can write, change the RLS policy.
- The logged-out demo exposes only the 3 newest release dates via the
  `public.demo_product_ids()` SECURITY DEFINER function and `"demo read …"` RLS
  policies. Widening what anonymous users see means changing that function/those
  policies deliberately.

## Checklist before committing a data change

1. **Contract in sync?** If you changed a sheet/column name or rule, did you
   update `parseXlsx()`, `exportXlsx()`, the Format Guide modal, the README, and
   `validate-workbook.mjs` together?
2. **Validator passes?** Run `npm run validate` (or `node
   scripts/validate-workbook.mjs`). It must exit 0 for the committed workbook.
3. **Round-trips?** If you touched `exportXlsx()`, export and re-import — the
   output must parse cleanly back in.
4. **Fallback consistent?** If you edited the hardcoded sample data, are
   `products`/`historicalData`/`histDates` still aligned?
5. **Shared derivation?** New/changed metric logic lives in `deriveProducts()`,
   not duplicated in one loader.
6. **Supabase (if configured):** raw inputs only in the DB; write access still
   gated by RLS, not just the UI.

## Verifying

Run `npm run validate` for the contract, then serve locally
(`python3 -m http.server 8000`) and confirm the app loads the **workbook**, not
the fallback — check a known value from the xlsx appears. The `npm run test:e2e`
smoke test is the automated backstop that the page still renders after a data
change.
