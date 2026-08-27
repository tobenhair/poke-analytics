// ============================================================
// End-to-end smoke test
// ============================================================
// Loads the real page over HTTP against the real pokemon_data.xlsx and asserts
// it renders without throwing — the automated backstop for regressions like a
// broken render function or a missed recomputeScores() before first render.
//
// The app is normally configured for Supabase (see the SUPABASE_CONFIG block
// in index.html), which gates the full catalogue behind sign-in. CI has no
// credentials and shouldn't depend on an external service, so we blank that
// config at request time to force the plain static/xlsx path (SB_ENABLED =
// false → tryAutoLoad() → applyNewData() → every render function). That path
// is exactly where the rendering-regression risk lives.
//
// Chart.js and SheetJS come from node_modules for the same reason (see
// tests/local-cdn.mjs): the spec must not depend on cdnjs being reachable.
// ============================================================

import { test, expect } from '@playwright/test';
// forceStaticMode lives in local-cdn.mjs so the a11y spec can share it.
import { routeLocalLibs, forceStaticMode, expandBoard } from './local-cdn.mjs';

test('page loads and renders all tabs without runtime errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await routeLocalLibs(page);
  await forceStaticMode(page);

  // ?admin=1 reveals the Data Entry tab so we can smoke it too.
  await page.goto('/?admin=1');

  // ── Welcome (default tab) ──
  await expect(page.locator('#tab-welcome')).toBeVisible();

  // ── Analysis: data must have loaded from the workbook and rendered ──
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();

  // Board leads with the flat Top-N leaderboard (product rows, no era headers yet)
  // plus a "show all" footer — empty if data failed to render.
  await expect.poll(
    () => page.locator('#product-tbody tr.grp-product').count(),
    { message: 'board should show top-N product rows', timeout: 10_000 },
  ).toBeGreaterThan(0);
  await expect(page.locator('#product-tbody .board-more-btn')).toBeVisible();

  // The "Where to start" shortlist populated.
  await expect(page.locator('#overview-deals .pick-item').first()).toBeVisible();

  // Expand the tree to reveal product rows, then check the derived columns. Fair
  // Price column derived: the header states the fit's confidence in words (the R²
  // itself lives in the drill-down) and at least one product row shows a computed
  // fair price in euros — together these guard recomputeFit() running before the
  // first render, and the age-fit → fair-price inversion.
  await expandBoard(page);
  await expect(page.locator('#fair-fit-note')).toHaveText(/strong fit|moderate fit|rough estimate/);
  await expect.poll(
    () => page.locator('#product-tbody tr.grp-product td:nth-child(4)')
            .filter({ hasText: '€' }).count(),
    { message: 'board should show at least one fair price', timeout: 10_000 },
  ).toBeGreaterThan(0);

  // Verdict line renders under product names, and board search narrows the table.
  await expect(page.locator('#product-tbody .verdict-line').first()).toBeVisible();
  const productRows = await page.locator('#product-tbody tr.grp-product').count();
  await page.fill('#board-search', 'zzzznomatch');
  await expect(page.locator('#product-tbody')).toContainText('No products match');
  await page.fill('#board-search', '');
  // Clearing restores the pre-search expanded state (the groups stay expanded).
  await expect.poll(() => page.locator('#product-tbody tr.grp-product').count()).toBe(productRows);

  // Drill-down opens from a product row, renders its stats and a real chart.
  await page.locator('#product-tbody tr.grp-product').first().click();
  await expect(page.locator('#drill-modal')).toHaveClass(/open/);
  await expect(page.locator('#drill-stats .drill-stat')).toHaveCount(8);
  // Set logo is best-effort: with the TCGdex API stubbed empty it stays hidden
  // — the page must not show a broken image.
  await expect(page.locator('#drill-logo')).toBeHidden();
  // …but the set-identity header always renders: with no logo it falls back to
  // the set-name label and the type badge (never a blank title).
  await expect(page.locator('#drill-set-name')).toBeVisible();
  await expect(page.locator('#drill-set-name')).not.toBeEmpty();
  await expect(page.locator('#drill-type-badge .type-badge')).toBeVisible();
  // Poll: Chart.js sizes the canvas on a frame *after* the dialog becomes
  // visible, so a single boundingBox() here can catch it at zero width.
  await expect
    .poll(async () => (await page.locator('#drill-price-chart').boundingBox())?.width ?? 0,
          { message: 'drill price chart should render' })
    .toBeGreaterThan(0);
  // The drill price chart carries a 'Price' line, and the 30-day moving-average
  // overlay is suppressed on this sparse (6 monthly snapshots) static workbook —
  // movingAverageSeries only emits where ~a month of daily points sits behind a
  // point, so on monthly-only data the overlay correctly does not appear. (The
  // emit-when-dense path is covered by the metrics unit tests.)
  const priceLabels = await page.evaluate(() =>
    window.Chart.getChart('drill-price-chart').data.datasets.map(d => d.label));
  expect(priceLabels).toContain('Price');
  expect(priceLabels).not.toContain('30-day avg');
  await page.keyboard.press('Escape');
  await expect(page.locator('#drill-modal')).not.toHaveClass(/open/);

  // A Chart.js canvas actually drew (non-zero size) — the §02 Age-vs-Value scatter.
  const scatterBox = await page.locator('#scatter-chart').boundingBox();
  expect(scatterBox, 'age-vs-value scatter should be rendered').not.toBeNull();
  expect(scatterBox.width).toBeGreaterThan(0);
  expect(scatterBox.height).toBeGreaterThan(0);

  // ── Data Entry ──
  await page.locator('.tab-btn[data-tab="entry"]').click();
  await expect(page.locator('#tab-entry')).toBeVisible();
  await expect.poll(
    () => page.locator('#entry-tbody tr').count(),
    { message: 'data-entry table should have rows', timeout: 10_000 },
  ).toBeGreaterThan(0);

  // A focused number input must not step its value on wheel (the 0.01 bug):
  // it blurs instead, leaving the value untouched.
  const priceInput = page.locator('#entry-tbody .entry-input[data-field="price"]').first();
  await priceInput.focus();
  const beforeWheel = await priceInput.inputValue();
  const ib = await priceInput.boundingBox();
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.mouse.wheel(0, 120);
  expect(await priceInput.inputValue(), 'wheel must not change a number input').toBe(beforeWheel);

  // The workbook loaded, so the sample-data banner must be gone.
  await expect(page.locator('#data-source-banner')).toBeHidden();

  // No uncaught exceptions anywhere along the way.
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('an analytical chart expands to a full-screen, zoomable dialog', async ({ page }) => {
  // The dense scatter / comparison charts are hard to read inline, so an expand
  // button (offered at every width) opens a larger copy with pan/zoom. Proves the
  // affordance shows, opens the dialog, renders a real (tall) canvas, that the
  // zoom plugin is registered and actually changes the view, and that it closes
  // from the keyboard like every other overlay. Phone viewport so it also covers
  // the ≤680 layout.
  await page.setViewportSize({ width: 390, height: 820 });
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();

  const expand = page.locator('.chart-expand-btn[data-chart="scatter"]');
  // Centre it in the viewport first — scrollIntoViewIfNeeded can leave it under
  // the sticky tab-bar, which would swallow the click (a harness artifact, not a
  // real-user one: nobody taps a control tucked behind the sticky header).
  await expand.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await expect(expand).toBeVisible();
  await expand.click();

  await expect(page.locator('#chart-zoom-modal')).toHaveClass(/open/);
  // The enlarged canvas fills the tall dialog body (it escapes the 220px cap).
  await expect
    .poll(async () => (await page.locator('#chart-zoom-canvas').boundingBox())?.height ?? 0,
          { message: 'zoomed chart should be tall' })
    .toBeGreaterThan(300);

  // Pan/zoom is live: the plugin is registered, the enlarged chart exposes
  // zoom(), zooming changes the axis range, and Reset restores it.
  const zoom = await page.evaluate(() => {
    let registered = false;
    try { registered = !!window.Chart.registry.plugins.get('zoom'); } catch {}
    const c = window.Chart.getChart('chart-zoom-canvas');
    const before = c.scales.x.max - c.scales.x.min;
    c.zoom(2);
    const zoomed = c.scales.x.max - c.scales.x.min;
    c.resetZoom();
    // Zooming OUT past the data is clamped by the plugin `limits` (min/max
    // 'original'), so the axis can never reveal negative / empty space.
    const yMinBefore = c.scales.y.min;
    c.zoom(0.25);
    const zoomedOut = c.scales.x.max - c.scales.x.min;
    const yMinOut = c.scales.y.min;
    c.resetZoom();
    const reset = c.scales.x.max - c.scales.x.min;
    return { registered, hammer: typeof window.Hammer, before, zoomed, reset, zoomedOut, yMinBefore, yMinOut };
  });
  expect(zoom.registered, 'zoom plugin registered').toBe(true);
  expect(zoom.hammer, 'Hammer loaded for touch gestures').toBe('function');
  expect(zoom.zoomed, 'zooming narrows the axis range').toBeLessThan(zoom.before);
  expect(zoom.reset, 'reset restores the range').toBeCloseTo(zoom.before, 5);
  // Zoom-out is clamped to the original extent — the range can't grow past it,
  // and the y-axis floor can't drop below its original (no negative axis).
  expect(zoom.zoomedOut, 'zoom-out cannot exceed the original range').toBeLessThanOrEqual(zoom.before + 1e-6);
  expect(zoom.yMinOut, 'y floor cannot drop below the original on zoom-out').toBeGreaterThanOrEqual(zoom.yMinBefore - 1e-6);
  await expect(page.locator('#chart-zoom-reset')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#chart-zoom-modal')).not.toHaveClass(/open/);
});

test('time-series line charts are continuous — no default point markers', async ({ page }) => {
  // Price-History (§03) and SV/Booster-Trend (§04) render as clean lines with
  // pointRadius 0; a point surfaces only on hover (pointHoverRadius). The scatter
  // is exempt — its marks are the data.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await page.waitForFunction(
    () => window.Chart && window.Chart.getChart('trend-chart') && window.Chart.getChart('ratio-chart'));

  const style = await page.evaluate(() => {
    const read = id => window.Chart.getChart(id).data.datasets
      // skip helper datasets (bands) that already carry pointRadius 0 by design
      .filter(d => d.label && !d.label.startsWith('__'))
      .map(d => ({ r: d.pointRadius, hr: d.pointHoverRadius }));
    return { hist: read('trend-chart'), svb: read('ratio-chart') };
  });
  for (const d of [...style.hist, ...style.svb]) {
    expect(d.r, 'line hides its points by default').toBe(0);
    expect(d.hr, 'a point surfaces on hover').toBeGreaterThan(0);
  }
});

test('the board consolidates into one panel with a Value / Relative / Momentum lens toggle', async ({ page }) => {
  // §01 The Board is one table with three lenses (what were three separate
  // sections). Each lens swaps the visible table-wrap, its columns and its
  // badge; the Type filter + search scope every lens. Proves the toggle shows
  // exactly one table at a time and the right one.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await expect.poll(() => page.locator('#product-tbody tr.grp-product').count(),
    { timeout: 10_000 }).toBeGreaterThan(0);

  const lensBtn = (l) => page.locator(`#board-lens .pill[data-lens="${l}"]`);
  // Centre the toggle so the reveal-on-scroll fires and the click isn't
  // swallowed by the sticky tab-bar (same harness note as the chart-expand test).
  const switchTo = async (l) => {
    await lensBtn(l).evaluate(el => el.scrollIntoView({ block: 'center' }));
    await lensBtn(l).click();
  };

  // Value lens is the default: its table is shown, the others hidden.
  await expect(lensBtn('value')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#board-view-value')).toBeVisible();
  await expect(page.locator('#board-view-relative')).toBeHidden();
  await expect(page.locator('#board-view-momentum')).toBeHidden();
  await expect(page.locator('#board-badge')).toHaveText(/product/);
  // The Value-only controls (verdict + sort) are present here; the set/product
  // comparison chart rides only the other two lenses, so it's hidden on Value.
  await expect(page.locator('#sort-select')).toBeVisible();
  await expect(page.locator('#board-lens-chart')).toBeHidden();

  // Relative lens: its table shows, value hides, the badge switches to the fit,
  // the Value-only sort control is hidden, and the comparison chart appears and
  // actually drew (non-zero canvas), captioned for the residual metric.
  await switchTo('relative');
  await expect(lensBtn('relative')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#board-view-relative')).toBeVisible();
  await expect(page.locator('#board-view-value')).toBeHidden();
  await expect(page.locator('#relval-tbody tr.grp-product').first()).toBeAttached();
  await expect(page.locator('#board-badge')).toHaveText(/age trend|flat/);
  await expect(page.locator('#sort-select')).toBeHidden();
  await expect(page.locator('#board-lens-chart')).toBeVisible();
  await expect(page.locator('#board-chart-cap')).toContainText(/Δ vs peers per set/);
  await expect
    .poll(async () => (await page.locator('#board-lens-canvas').boundingBox())?.height ?? 0)
    .toBeGreaterThan(0);

  // The comparison chart's Sets ⇄ Products toggle re-captions the chart.
  const prodMode = page.locator('#board-chart-mode .pill[data-mode="product"]');
  await prodMode.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await prodMode.click();
  await expect(page.locator('#board-chart-cap')).toContainText(/per product/);

  // Momentum lens: its table shows, its badge reads "by deepest dip", and the
  // chart is captioned/labelled for the 30-day price move. We assert on the
  // canvas aria-label (not the visible #board-chart-cap) because it always
  // carries the metric word — the static workbook fixture is sparse monthly data
  // with a 77-day gap, so no product has a snapshot inside the trailing 30-day
  // window and the bar chart (30-day movers) is legitimately empty here; the
  // real daily cloud data populates it.
  await switchTo('momentum');
  await expect(page.locator('#board-view-momentum')).toBeVisible();
  await expect(page.locator('#board-view-relative')).toBeHidden();
  await expect(page.locator('#momentum-tbody tr.grp-product').first()).toBeAttached();
  await expect(page.locator('#board-badge')).toHaveText(/deepest dip/i);
  await expect(page.locator('#board-lens-chart')).toBeVisible();
  await expect(page.locator('#board-lens-canvas')).toHaveAttribute('aria-label', /30-day price change/);

  // Back to Value restores the headline board and its controls, and drops the chart.
  await switchTo('value');
  await expect(page.locator('#board-view-value')).toBeVisible();
  await expect(page.locator('#board-view-momentum')).toBeHidden();
  await expect(page.locator('#sort-select')).toBeVisible();
  await expect(page.locator('#board-lens-chart')).toBeHidden();
});

test('the comparison charts roll products up to whole Eras', async ({ page }) => {
  // §04 Trend Over Time builds one line per selection; Set and Era modes roll
  // members up with meanSeries. This pins the Eras level (the catalogue-scale
  // navigation add) — switching to it makes the picker + chips speak in eras.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();

  const eraPill = page.locator('#svb-mode .pill[data-mode="era"]');
  await eraPill.evaluate(el => el.scrollIntoView({ block: 'center' }));
  // The first click after a tab switch can land mid reveal-animation and miss
  // (same harness quirk the board-lens test guards) — retry until the mode flips.
  await expect.poll(async () => {
    if ((await eraPill.getAttribute('aria-pressed')) !== 'true') await eraPill.click();
    return eraPill.getAttribute('aria-pressed');
  }, { timeout: 10_000 }).toBe('true');

  // The picker now offers eras, and a whole-era line is seeded as a chip.
  await expect(page.locator('#svb-add option').first()).toHaveText('+ Add era…');
  await expect(page.locator('#svb-chips .cmp-chip').first())
    .toHaveText(/Mega Evolution|Scarlet & Violet|Sword & Shield|Sun & Moon|XY/);
});

test('the Era scope filter narrows every analytical view to one era', async ({ page }) => {
  // The second half of the navigation item: era as a *scope filter* (narrows the
  // pool via visibleProducts, like the Type pills), not just a series mode. The
  // board leads with a flat Top-N; "show all" reveals the multi-era tree, and
  // scoping to one era then leaves one era row.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await expect.poll(() => page.locator('#product-tbody tr.grp-product').count(),
    { timeout: 10_000 }).toBeGreaterThan(0);
  await settleFx(page);   // let the FX-driven board re-render land before clicking
  // Expand to the grouped Era tree (show-all persists across the scope re-renders).
  await toggleBoardMore(page, true);
  await expect.poll(() => page.locator('#product-tbody .grp-era').count()).toBeGreaterThan(1);

  // The dropdown is populated from the eras present; pick the first real one.
  const eraFilter = page.locator('#era-filter');
  const eraVals = await eraFilter.locator('option').evaluateAll(
    os => os.map(o => o.value).filter(v => v !== 'ALL'));
  expect(eraVals.length).toBeGreaterThan(1);
  await eraFilter.selectOption(eraVals[0]);
  await expect.poll(() => page.locator('#product-tbody .grp-era').count()).toBe(1);

  // Back to "All eras" restores the full overview.
  await eraFilter.selectOption('ALL');
  await expect.poll(() => page.locator('#product-tbody .grp-era').count()).toBeGreaterThan(1);
});

test('a checkbox on each board row cross-filters both comparison charts (unified selection)', async ({ page }) => {
  // PowerBI-style: one shared selection, edited by a row checkbox, drives every
  // chart. Ticking rows adds the products to BOTH comparison charts at once (the
  // unified selection) and the scatter cross-highlights them; Clear empties all.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await settleFx(page);   // let the FX-driven board re-render land before expanding
  await expandBoard(page);

  const boxes = page.locator('#product-tbody tr.grp-product .sel-check');
  await boxes.nth(0).check();
  await boxes.nth(1).check();

  // Both charts show the SAME selection (unified), and there are at least two.
  const histChips = await page.locator('#hist-chips .cmp-chip').allTextContents();
  const svbChips = await page.locator('#svb-chips .cmp-chip').allTextContents();
  expect(svbChips).toEqual(histChips);
  expect(histChips.length).toBeGreaterThanOrEqual(2);

  // The selection indicator appears with a count.
  await expect(page.locator('#chart-selection')).toBeVisible();
  await expect(page.locator('#selection-count')).toHaveText(/\d+ products? selected/);

  // Clear empties the selection everywhere — the indicator hides, chips go.
  await page.locator('#clear-selection').click();
  await expect(page.locator('#chart-selection')).toBeHidden();
  await expect(page.locator('#hist-chips .cmp-chip')).toHaveCount(0);
  await expect(page.locator('#svb-chips .cmp-chip')).toHaveCount(0);
});

// Parse the board's headline count ("N products") — the live filtered total.
async function boardCount(page) {
  const t = await page.locator('#board-badge').textContent();
  return Number((t.match(/\d+/) || [0])[0]);
}

// The (stubbed) FX fetch resolves shortly after load and fires one
// renderCurrencySensitive() that re-renders the board. Wait for the extra
// currencies to appear (EUR → EUR+USD+GBP+SEK) so a rapid board click can't race
// that re-render and land on the wrong row — an observed flake before this guard.
async function settleFx(page) {
  await expect.poll(() => page.locator('#display-currency option').count(),
    { timeout: 10_000 }).toBeGreaterThan(1);
}

// Toggle the board's Top-N "show all / show fewer" footer until the board reaches
// the wanted state (expanded = era rows present). Under parallel-worker CPU
// contention a single .click() can occasionally miss the toggle (a board
// re-render detaches the button mid-click); this retries the click only while the
// state hasn't flipped, so it can't over-toggle. The feature itself is verified
// working in serial runs — this only absorbs harness timing.
async function toggleBoardMore(page, wantExpanded) {
  await expect(async () => {
    const expanded = (await page.locator('#product-tbody .grp-era').count()) > 0;
    if (expanded !== wantExpanded) await page.locator('#product-tbody .board-more-btn').click();
    expect((await page.locator('#product-tbody .grp-era').count()) > 0).toBe(wantExpanded);
  }).toPass({ timeout: 10_000 });
}

test('faceted filtering shows live counts and a Top-N leaderboard with show-all', async ({ page }) => {
  // Two roadmap items in one flow: (1) every discrete facet shows how many
  // products it matches, and (2) the board leads with the best Top-N and expands
  // to the full Era→Set→Product tree on demand.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await expect.poll(() => page.locator('#product-tbody tr.grp-product').count(),
    { timeout: 10_000 }).toBeGreaterThan(0);
  await settleFx(page);   // let the FX-driven board re-render land before clicking

  // Live counts: the "All" type pill carries the full analysis count, and every
  // era option is labelled with a match count.
  const allPill = page.locator('#type-filters .pill[data-type="ALL"] .pill-count');
  await expect(allPill).toHaveText(/^\d+$/);
  const allCount = Number(await allPill.textContent());
  expect(allCount).toBeGreaterThan(0);
  expect(await boardCount(page)).toBe(allCount);
  await expect(page.locator('#era-filter option').nth(1)).toHaveText(/\(\d+\)$/);

  // Top-N: the board is capped and says so; "show all" reveals the grouped tree.
  const moreRow = page.locator('#product-tbody .board-more-btn');
  await expect(moreRow).toContainText(/Showing the top \d+ of \d+/);
  expect(await page.locator('#product-tbody tr.grp-product').count()).toBeLessThan(allCount);
  await toggleBoardMore(page, true);
  await expect(page.locator('#product-tbody .board-more-btn')).toContainText(/Show the top \d+ only/);
  // …and collapses back to the Top-N leaderboard.
  await toggleBoardMore(page, false);
  await expect(page.locator('#product-tbody .board-more-btn')).toContainText(/Showing the top/);
});

test('advanced facets combine and a saved view round-trips', async ({ page }) => {
  // The Set / price-range facets combine with the primary row, and a whole filter
  // combo can be named, saved (localStorage), reset, and reloaded.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await expect.poll(() => page.locator('#product-tbody tr.grp-product').count(),
    { timeout: 10_000 }).toBeGreaterThan(0);
  await settleFx(page);
  const allCount = await boardCount(page);

  // Open the "More filters" disclosure (retry the toggle click — under
  // parallel-worker contention a single click can miss, see toggleBoardMore).
  await expect(async () => {
    if (!(await page.locator('#advanced-filters').isVisible()))
      await page.locator('#more-filters-btn').click();
    await expect(page.locator('#advanced-filters')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  // The Set facet narrows the board and flags one active advanced facet.
  const setVals = await page.locator('#set-filter option').evaluateAll(
    os => os.map(o => o.value).filter(v => v !== 'ALL'));
  expect(setVals.length).toBeGreaterThan(1);
  await page.locator('#set-filter').selectOption(setVals[0]);
  await expect(page.locator('#more-filters-badge')).toHaveText('1');
  const setCount = await boardCount(page);
  expect(setCount).toBeLessThan(allCount);

  // Save the combo as a named view.
  await page.locator('#view-name').fill('MyView');
  await page.locator('#save-view').click();
  await expect(page.locator('#saved-views option[value="MyView"]')).toHaveCount(1);

  // Reset clears every facet back to the full board.
  await page.locator('#reset-filters').click();
  await expect(page.locator('#set-filter')).toHaveValue('ALL');
  expect(await boardCount(page)).toBe(allCount);

  // Loading the saved view re-applies the exact combo.
  await page.locator('#saved-views').selectOption('MyView');
  await expect(page.locator('#set-filter')).toHaveValue(setVals[0]);
  expect(await boardCount(page)).toBe(setCount);
});

test('the boot splash covers first paint and clears once data is ready', async ({ page }) => {
  // The splash hides the transient sample→cloud swap (and its banner/status
  // flicker) behind an opaque logo screen, then clears the instant data loads.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  // Hold the workbook briefly so the splash is observably up before it clears
  // (well inside the 8s failsafe).
  await page.route('**/pokemon_data.xlsx', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });

  // Present on first paint.
  await expect(page.locator('#app-loader')).toBeVisible();

  // Clears once the workbook resolves, revealing the rendered board behind it.
  await expect(page.locator('#app-loader')).toBeHidden({ timeout: 6000 });
  await expect(page.locator('#product-tbody tr.grp-product').first()).toBeAttached();

  // The success-status pill is gone — the splash is the load signal now.
  await expect(page.locator('#analysis-status')).toBeHidden();
});

test('a missing workbook says so instead of passing sample data off as real', async ({ page }) => {
  // The dangerous failure: the page boots with a small hardcoded dataset so
  // nothing is blank, and until now a 404 left those numbers on screen looking
  // exactly like tracked prices — the board, the P&L and every chart fiction,
  // silently.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.route('**/pokemon_data.xlsx', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/?admin=1');

  const banner = page.locator('#data-source-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Sample data');
  await expect(banner).toContainText('404');          // says *why*, not just that

  // It is on every tab, not just the one that happened to be open — the
  // portfolio's P&L would be computed from these numbers too.
  await page.locator('.tab-bar .tab-btn[data-tab="analysis"]').click();
  await expect(banner).toBeVisible();
  await page.locator('.tab-bar .tab-btn[data-tab="entry"]').click();
  await expect(banner).toBeVisible();

  // And it does not scroll away — a warning you can lose is no warning.
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(banner).toBeVisible();
});
