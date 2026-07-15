---
name: metrics-review
description: Use whenever you touch the analytical core — the scoring math, the booster constants, calcAgeWeight/recomputeScores/deriveProducts, the age threshold, or any render function that shows a derived metric. Guards the correctness of the numbers the whole dashboard exists to show, and the ordering invariant (scores must be recomputed before the first render) that has already caused a real bug. Load BEFORE changing metric logic, and run the checklist before committing.
---

# Metrics review — the numbers must be right, and in the right order

Everything in this app serves one purpose: rank sealed products by value. If
the scoring math is wrong, or runs at the wrong time, the whole dashboard lies
convincingly. This skill guards that core.

## The fixed definitions (don't quietly change these)

- **Boosters per type** — `boostersFromType()`: `BOX = 36`, `ETB = 9`,
  `BUNDLE = 6`. These are physical facts about the products; changing one
  silently reprices everything.
- **Price / Booster** = price ÷ boosters.
- **SV / Booster** = Set Value ÷ (Price / Booster) — the core value-density
  metric, higher is better. It is a value-for-money ×multiple, **not** a euro
  amount, and it is **threshold-independent**.
- **Age Weight** = `calcAgeWeight(age)` — a 0–1 penalty for products younger
  than `ageThreshold` (default **1 year**; slider 0.5–3).
- **Wtd. Score** = SV/Booster × Age Weight — the primary ranking metric.

If you change a formula, change it in the shared **`deriveProducts()`** helper
(used by both the xlsx and Supabase loaders) so the two paths can't drift — not
in one loader.

## The ordering invariant (this was a real, fixed bug)

`recomputeScores()` recomputes each product's `ageWeight` and `score` from the
current `ageThreshold`, and **must run before the first render** in *both*:

- the `INIT` block, and
- `applyNewData()`.

Skip it and the initial view shows the scores baked into the source data
instead of the ones for the active threshold. The `ageWeight`/`score` written
inside `deriveProducts()` are provisional — `recomputeScores()` is the source
of truth for the rendered values. `svPerBooster` is threshold-independent, so
it is *not* recomputed there.

## The render-wiring invariant

Rendering is a **state + render-function** pattern: module-level state
(`activeType` — the global type filter, `sortKey`, `ageThreshold`, …)
plus render functions (`updateTable`, `updateKPIs`, `updateTopPicks`,
`renderSVBChart`, `renderScatterChart`, `renderRelativeValue`, `renderMomentum`,
`initScenario`, …) and the §06/§08 comparison controllers (`cmpHist`/`cmpSvb`,
built by `createCompareView()`; `init()` in INIT, `refresh()` in
`applyNewData()` and on type-filter change). Chart.js instances are destroyed
and recreated on each re-render.

**Any new render function must be wired into both `INIT` and `applyNewData()`**
— otherwise it works on first load but not after a data file loads, or vice
versa. This is the single most common footgun when adding a metric view.

## Checklist before committing a metrics change

1. **Constants intact?** Booster counts (36/9/6) unchanged unless that's the
   explicit intent.
2. **Formula in the shared helper?** Derivation lives in `deriveProducts()`,
   once — not duplicated per loader.
3. **Recompute ordering?** If anything affects `ageWeight`/`score`, does
   `recomputeScores()` still run before the first render in **both** `INIT` and
   `applyNewData()`?
4. **Threshold behaviour?** Moving the age-threshold slider updates weighted
   scores and re-ranks, but leaves `svPerBooster` unchanged.
5. **Render wiring?** Any new render function is called from **both** `INIT` and
   `applyNewData()`, and its Chart.js instance is destroyed before recreation.
6. **Spot-check a number.** Pick one product and verify Price/Booster,
   SV/Booster, Age Weight, and Wtd. Score by hand against the definitions above.

## Verifying

Serve locally (`python3 -m http.server 8000`). Load, then reload after the
workbook loads, and confirm the ranking is stable and matches a hand
calculation. Drag the age-threshold slider and confirm weighted scores move but
SV/Booster doesn't. `npm run test:e2e` confirms the render pipeline still runs
end-to-end without errors.
