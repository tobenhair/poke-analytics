---
name: verify-app
description: Use before committing any change to index.html or the data — this app has no unit suite, so "it looks right" isn't verification. Defines how to actually check a change in this specific app: serve over HTTP (never file://), run the CI checks locally, and exercise the real UI. Load after making a change and before you commit or push.
---

# Verify the app — how QA works here

There is **no unit test suite**, on purpose — the app is one framework-free
`index.html`. That means verification is deliberate and mostly hands-on. Don't
confuse "the code reads correctly" with "the app works." Actually run it.

## Non-negotiable: serve over HTTP

The page `fetch()`es `pokemon_data.xlsx`, so opening `index.html` via `file://`
**blocks that request** and the app silently falls back to hardcoded sample
data. Always:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

If you're "testing" over `file://`, you're testing the fallback, not your
change.

## The two automated checks (run both)

```bash
npm run validate    # workbook matches the parseXlsx()/deriveProducts() contract
npm run test:e2e    # Playwright: page loads and every tab renders, no page errors
npm test            # both
```

- `validate` catches a malformed workbook before it silently degrades the live
  page. Run it after any data or contract change.
- The smoke test is the automated backstop for "a tab stopped rendering" bugs
  (e.g. a render function not wired into both `INIT` and `applyNewData()`, or a
  missed `recomputeScores()`). It forces the static/xlsx path, so it needs no
  cloud credentials.

These also run in CI (`.github/workflows/ci.yml`) on every push/PR — but run
them locally *before* pushing.

## Then exercise it by hand

Automated checks don't judge whether it looks or behaves right. In the browser:

1. **Data actually loaded** — a known value from `pokemon_data.xlsx` appears
   (not the sample fallback). Check the browser console for errors.
2. **All three tabs** — Welcome, Analysis, Data Entry: each renders, charts
   draw, tables populate.
3. **The affected view specifically** — drive the exact flow you changed
   (sort, filter, slider, selector, export), not just page load.
4. **Interactions** — age-threshold slider re-ranks; scenario sliders update;
   Data Entry → Export updated `.xlsx` round-trips back in cleanly.
5. **Dependencies** — Chart.js and SheetJS load from CDNs; a blocked CDN shows
   the "required library" guard, not a silently broken page.

## If the change is UI, or data, or metrics

Layer the specialised skill on top of this one:

- **UI / markup / CSS / copy** → `design-review`.
- **Workbook / parser / fallback / Supabase** → `data-integrity`.
- **Scoring math / booster constants / render wiring** → `metrics-review`.

## The bar before committing

Green `npm test`, plus you loaded the served page and drove the actual flow you
changed and watched it work. If you couldn't run it, say so explicitly rather
than implying it was verified.
