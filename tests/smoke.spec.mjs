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

  // Board renders as the grouped Era overview (collapsed to era headline rows) —
  // empty if data failed to render.
  await expect.poll(
    () => page.locator('#product-tbody .grp-era').count(),
    { message: 'board should show era rows', timeout: 10_000 },
  ).toBeGreaterThan(0);

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
    const reset = c.scales.x.max - c.scales.x.min;
    return { registered, hammer: typeof window.Hammer, before, zoomed, reset };
  });
  expect(zoom.registered, 'zoom plugin registered').toBe(true);
  expect(zoom.hammer, 'Hammer loaded for touch gestures').toBe('function');
  expect(zoom.zoomed, 'zooming narrows the axis range').toBeLessThan(zoom.before);
  expect(zoom.reset, 'reset restores the range').toBeCloseTo(zoom.before, 5);
  await expect(page.locator('#chart-zoom-reset')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#chart-zoom-modal')).not.toHaveClass(/open/);
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
  await expect.poll(() => page.locator('#product-tbody .grp-era').count(),
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
  await expect(page.locator('#relval-tbody .grp-era').first()).toBeAttached();
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
  // chart re-captions to the 30-day price move.
  await switchTo('momentum');
  await expect(page.locator('#board-view-momentum')).toBeVisible();
  await expect(page.locator('#board-view-relative')).toBeHidden();
  await expect(page.locator('#momentum-tbody .grp-era').first()).toBeAttached();
  await expect(page.locator('#board-badge')).toHaveText(/deepest dip/i);
  await expect(page.locator('#board-lens-chart')).toBeVisible();
  await expect(page.locator('#board-chart-cap')).toContainText(/30-day price change/);

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
  // board opens as a multi-era overview; scoping to one era leaves one era row.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await expect.poll(() => page.locator('#product-tbody .grp-era').count(),
    { timeout: 10_000 }).toBeGreaterThan(1);

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
  await expect(page.locator('#product-tbody .grp-era').first()).toBeAttached();

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
