// ============================================================
// Accessibility regression spec (Playwright + axe-core)
// ============================================================
// The July 2026 expert review (docs/ux-expert-review.md) found four Level-A
// failures — the app could not be operated without a mouse. This spec is what
// keeps them fixed: an automated axe sweep per tab, plus the keyboard journeys
// axe cannot see (opening the drill-down from the keyboard, the dialog's focus
// trap, focus returning to the row that opened it) and the 320 px reflow
// threshold.
//
// Two deliberate choices:
//
// 1. Never sample colours mid-animation. The page's entrance animations hold
//    muted text at partial opacity, and axe sampled during that window reports
//    contrast failures that do not exist (docs/ux-expert-review.md counted 27).
//    `reducedMotion: 'reduce'` is necessary but *not sufficient* — it collapses
//    the durations to 0.001ms, which still schedules a frame, and switching tabs
//    restarts the pane fade; a sweep taken right after the click measured
//    var(--muted) at 1.83:1 when its resting value is 5.9:1. So every sweep also
//    awaits `settle()` below. A gate that cries wolf gets disabled; this one must not.
//
// 2. serious + critical only. Those are the levels that map to real conformance
//    failures; moderate/minor findings are advisory and would make the gate
//    noisy without making the app more usable.
//
// Hermetic like the other specs: libraries from node_modules, Supabase blanked
// (static path) except where the signed-in surface is under test.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeLocalLibs, forceStaticMode } from './local-cdn.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeSdk = readFileSync(join(here, 'fake-supabase-sdk.js'), 'utf8');

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.use({ reducedMotion: 'reduce' });

// Blocking severities. Anything here is a conformance failure, not a nit.
const BLOCKING = new Set(['serious', 'critical']);

// Wait for every running animation to finish before sampling colours.
// prefers-reduced-motion collapses the durations but does not make them zero
// (0.001ms still schedules a frame), and a tab switch restarts the pane fade —
// so axe can still catch text mid-opacity and invent contrast failures:
// var(--muted) blended at ~42% reads as #3c3f4a on #0c0e14, 1.83:1, when its
// resting value is 5.9:1. This is the trap docs/ux-expert-review.md records as
// "27 contrast failures that do not exist". Waiting on the animations
// themselves is exact, where a fixed sleep is a guess that rots.
const settle = (page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));

// Returns one readable line per blocking violation. The failure message has to
// carry enough to act on — for contrast that means the measured ratio and the
// two colours, not just a selector.
//
// `include` scopes the sweep to a selector. Use it while a dialog is open: the
// overlay's translucent backdrop dims the page behind it, and axe scores that
// dimmed-but-inert text as failing contrast. Content behind an aria-modal
// dialog is not the thing under test — the dialog is.
async function blockingViolations(page, include) {
  await settle(page);
  let builder = new AxeBuilder({ page }).withTags(WCAG);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  return violations
    .filter((v) => BLOCKING.has(v.impact))
    .map((v) => {
      const nodes = v.nodes.map((n) => {
        const d = n.any?.[0]?.data;
        const detail = d && d.contrastRatio ? ` [${d.contrastRatio}:1 ${d.fgColor} on ${d.bgColor}, needs ${d.expectedContrastRatio}]` : '';
        return n.target.join(' ') + detail;
      });
      return `${v.impact}: ${v.id} (${v.nodes.length}×) — ${nodes.join(', ')}`;
    });
}

// ?admin=1 reveals the Data Entry tab in static mode, so all four panes are
// reachable without cloud credentials.
async function bootStatic(page, path = '/?admin=1') {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto(path);
  // Wait for the workbook to have been parsed and rendered — the board rows
  // exist in the DOM even while the Welcome tab is the visible one.
  await expect(page.locator('#product-tbody tr').first()).toBeAttached();
  return pageErrors;
}

const openTab = async (page, tab) => {
  await page.locator(`.tab-bar .tab-btn[data-tab="${tab}"]`).click();
  await expect(page.locator(`#tab-${tab}`)).toBeVisible();
};

test('no serious or critical axe violations on any statically-reachable tab', async ({ page }) => {
  const pageErrors = await bootStatic(page);

  for (const tab of ['welcome', 'analysis', 'entry']) {
    await openTab(page, tab);
    expect(await blockingViolations(page), `axe on #tab-${tab}`).toEqual([]);
  }

  expect(pageErrors).toEqual([]);
});

test('the drill-down opens from the keyboard, traps focus, and gives it back', async ({ page }) => {
  await bootStatic(page);
  await openTab(page, 'analysis');

  // F1: the board's answer surface must be reachable without a mouse. The row
  // affordance is a real button, so focusing and pressing Enter is the whole
  // keyboard contract.
  const firstRowButton = page.locator('#product-tbody tr').first().locator('.row-open');
  await firstRowButton.focus();
  const productName = (await firstRowButton.textContent()).trim();
  await page.keyboard.press('Enter');
  await expect(page.locator('#drill-modal')).toBeVisible();
  await expect(page.locator('#drill-title')).toHaveText(productName);

  // F2: it is a dialog, it is named by the product, and focus moved into it.
  const dialog = page.locator('#drill-modal .modal');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await page.evaluate(() => document.querySelector('#drill-modal').contains(document.activeElement))).toBe(true);

  // The trap: six Tab presses used to land on background controls (#hist-add
  // among them). Every one must stay inside the dialog.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.querySelector('#drill-modal').contains(document.activeElement)),
      `focus escaped the dialog after ${i + 1} Tab press(es)`,
    ).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.querySelector('#drill-modal').contains(document.activeElement))).toBe(true);

  // No blocking violations while the dialog is the thing on screen.
  expect(await blockingViolations(page, '#drill-modal'), 'axe with the drill-down open').toEqual([]);

  // Escape closes it and focus returns to the row that opened it — not to the
  // top of the document, which would lose a keyboard user's place on a long board.
  await page.keyboard.press('Escape');
  await expect(page.locator('#drill-modal')).not.toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('row-open');
});

test('the tab bar is a tablist: arrow keys move between tabs and aria-selected follows', async ({ page }) => {
  await bootStatic(page);

  const welcome = page.locator('#tabbtn-welcome');
  const analysis = page.locator('#tabbtn-analysis');
  await expect(page.locator('.tab-bar')).toHaveAttribute('role', 'tablist');
  await expect(welcome).toHaveAttribute('aria-selected', 'true');

  // Roving tabindex: only the selected tab is a tab stop.
  await expect(analysis).toHaveAttribute('tabindex', '-1');

  await welcome.focus();
  await page.keyboard.press('ArrowRight');
  await expect(analysis).toHaveAttribute('aria-selected', 'true');
  await expect(welcome).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await expect(analysis).toBeFocused();

  // End/Home reach the last/first *visible* tab — hidden ones (.sb-only,
  // .admin-only when not applicable) must be skipped, never landed on.
  await page.keyboard.press('Home');
  await expect(welcome).toHaveAttribute('aria-selected', 'true');
});

test('every tab stop shows a visible focus indicator (WCAG 2.4.7)', async ({ page }) => {
  await bootStatic(page);
  await openTab(page, 'analysis');
  await page.locator('#analysis-status').focus().catch(() => {});

  // F5 measured 11 of the first 18 tab stops with no indicator at all: several
  // controls set `outline: none` and signalled focus with a border tint, which
  // is invisible on a <select> and absent on buttons and pills.
  const unmarked = [];
  await page.locator('.tab-bar .tab-btn[data-tab="analysis"]').focus();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const probe = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const id = el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : '');
      // The dialog container is a programmatic focus target, not a control.
      if (el.classList.contains('modal')) return { id, ok: true };
      const outlined = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      // A ring on an invisible control is not an indicator. Controls that are
      // revealed on hover (the inline explainer toggles) must also become
      // visible on focus — checked here because they otherwise pass the
      // outline test while being impossible to see.
      const visible = parseFloat(s.opacity) > 0 && s.visibility !== 'hidden';
      return { id, ok: outlined && visible };
    });
    if (probe && !probe.ok) unmarked.push(probe.id);
  }
  expect(unmarked, 'tab stops with no focus outline').toEqual([]);
});

test('the type filter pills are operable from the keyboard', async ({ page }) => {
  await bootStatic(page);
  await openTab(page, 'analysis');

  const boxPill = page.locator('#type-filters .pill[data-type="BOX"]');
  await boxPill.focus();
  await page.keyboard.press('Enter');
  await expect(boxPill).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#type-filters .pill[data-type="ALL"]')).toHaveAttribute('aria-pressed', 'false');
  // The filter actually applied, not just the ARIA state.
  await expect(page.locator('#count-badge')).not.toHaveText(/^0 /);
});

test('every tab reflows at 320px without two-dimensional scrolling (WCAG 1.4.10)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await bootStatic(page);

  for (const tab of ['welcome', 'analysis', 'entry']) {
    await openTab(page, tab);
    // Wide tables are allowed to scroll inside their own wrapper; the page
    // body is what must not scroll sideways.
    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      doc: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(overflow.body, `#tab-${tab} body scrollWidth`).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.doc, `#tab-${tab} document scrollWidth`).toBeLessThanOrEqual(overflow.viewport);
  }
});

test('the phone status line stays on screen and readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await bootStatic(page);
  await openTab(page, 'analysis');

  // A long cloud-failure message is the case that broke: as a nowrap pill in a
  // flex-end row it overflowed *left*, off-screen, where nothing can scroll to
  // it — so the admin never saw "✕ Cloud save failed".
  await page.evaluate(() => {
    const el = document.getElementById('analysis-status');
    el.className = 'status-pill err';
    el.style.display = 'inline-block';
    el.textContent = '✕ Cloud save failed: could not reach the database, the request timed out after 30 seconds';
  });
  const box = await page.locator('#analysis-status').boundingBox();
  expect(box.x, 'status pill starts off the left edge').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'status pill runs past the right edge').toBeLessThanOrEqual(390);
});

test('no interactive control is under the 24px target minimum (WCAG 2.5.8)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await bootStatic(page);
  await openTab(page, 'analysis');
  // Dialog controls only have a box while a dialog is open, so measure with the
  // drill-down up — that is where the worst offender lived (an 11×15 ✕).
  await page.locator('#product-tbody tr').first().locator('.row-open').click();
  await expect(page.locator('#drill-modal')).toBeVisible();

  const undersized = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href], button, input, select, textarea').forEach((el) => {
      if (el.offsetParent === null) return;                 // not rendered
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.width < 24 || r.height < 24) {
        const id = el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : '');
        out.push(`${id} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    });
    return out;
  });
  expect(undersized, 'controls under 24×24').toEqual([]);
});

test('the board gives a phone the answer: column priority, a frozen name, a hint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await bootStatic(page);
  await openTab(page, 'analysis');

  const board = page.locator('#tab-analysis .table-wrap').first();
  const phone = await board.evaluate((wrap) => ({
    scrollW: wrap.scrollWidth,
    clientW: wrap.clientWidth,
    detailShown: [...wrap.querySelectorAll('.col-detail')].some((c) => getComputedStyle(c).display !== 'none'),
    firstColSticky: getComputedStyle(wrap.querySelector('tbody td')).position,
  }));

  // Measured before this change: 1,098px of columns in a 356px window, with
  // Fair Price — the north-star answer — starting at x=392. The six detail
  // columns are dropped on a phone (all of them are in the drill-down), which
  // brings the swipe down to a fraction of a screen.
  expect(phone.detailShown, 'detail columns must be hidden on a phone').toBe(false);
  expect(phone.scrollW, 'board scroll width on a phone').toBeLessThan(phone.clientW * 1.4);
  // …and the product name stays put while swiping, so a row can't be lost.
  expect(phone.firstColSticky).toBe('sticky');
  await expect(page.locator('#tab-analysis .scroll-hint').first()).toBeVisible();

  // Fair Price is reachable, and reading it does not cost the row's identity.
  await board.evaluate((wrap) => { wrap.scrollLeft = wrap.scrollWidth; });
  const afterSwipe = await board.evaluate((wrap) => {
    const cell = wrap.querySelector('tbody td');
    const fair = wrap.querySelector('tbody td:nth-child(4)');   // Fair Price
    const box = wrap.getBoundingClientRect();
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.left >= box.left - 1 && r.right <= box.right + 1;
    };
    return { nameVisible: inView(cell), fairVisible: inView(fair) };
  });
  expect(afterSwipe.fairVisible, 'Fair Price after one swipe').toBe(true);
  expect(afterSwipe.nameVisible, 'product name still visible after swiping').toBe(true);
});

test('the desktop board keeps every column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await bootStatic(page);
  await openTab(page, 'analysis');
  // Column priority is a phone concession, not a feature — nothing is hidden
  // where there is room for it.
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-analysis .table-wrap .col-detail')].filter((c) => getComputedStyle(c).display === 'none').length);
  expect(hidden).toBe(0);
  await expect(page.locator('#tab-analysis .scroll-hint').first()).toBeHidden();
});

test('the Top-10 bar chart keeps a label per bar at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await bootStatic(page);
  await openTab(page, 'analysis');

  // Chart.js drops every other category label when the plot area is too short
  // for them — at the default 2:1 ratio a 332px-wide phone gave 166px, and half
  // the bars became unidentifiable. The height now comes from the wrapper.
  const h = await page.locator('#svb-chart').evaluate((c) => c.getBoundingClientRect().height);
  expect(h, 'ten labelled rows need ~26px each').toBeGreaterThanOrEqual(240);
});

test('section explainers start collapsed at every width and remember the choice', async ({ page }) => {
  // Measured at 1,478px — 17.7% of the phone page — of prose before the board.
  // The text is hidden, never removed, so it stays reachable for a first-time
  // visitor and a screen reader.
  await page.setViewportSize({ width: 390, height: 800 });
  await bootStatic(page);
  await openTab(page, 'analysis');

  const shown = () => page.evaluate(() =>
    [...document.querySelectorAll('#tab-analysis .section-desc, #tab-analysis .kpi-intro')].filter((d) => !d.hidden).length);
  const firstToggle = page.locator('#tab-analysis .desc-toggle').first();

  expect(await shown(), 'explainers start collapsed').toBe(0);
  await expect(page.locator('#tab-analysis .section-desc').first()).toBeAttached();  // hidden, not removed
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');

  // One section can be opened on its own…
  await firstToggle.click();
  expect(await shown()).toBe(1);
  await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');

  // …and with one open, the global control reads "Hide" and means it.
  await expect(page.locator('#desc-toggle-all')).toHaveText('Hide explanations');
  await page.locator('#desc-toggle-all').click();
  expect(await shown(), 'the global control hides every explainer').toBe(0);

  // From all-collapsed it shows every one. (Seven numbered sections' .section-desc
  // plus the KPI intro — §01 "Top Picks" was retired into the Where-to-start block,
  // and the What-If explainer moved into the drill-down.)
  await expect(page.locator('#desc-toggle-all')).toHaveText('Show explanations');
  await page.locator('#desc-toggle-all').click();
  expect(await shown()).toBe(8);

  // The choice survives a reload — the whole point of persisting it.
  await page.reload();
  await expect(page.locator('#product-tbody tr').first()).toBeAttached();
  await openTab(page, 'analysis');
  expect(await shown(), 'expanded state should persist').toBe(8);

  // A desktop visitor with nothing stored gets the same condensed page — the
  // default is width-independent, so the first view is the numbers.
  const fresh = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const freshPage = await fresh.newPage();
  await routeLocalLibs(freshPage);
  await forceStaticMode(freshPage);
  await freshPage.goto('/?admin=1');
  await expect(freshPage.locator('#product-tbody tr').first()).toBeAttached();
  const desktopShown = await freshPage.evaluate(() =>
    [...document.querySelectorAll('#tab-analysis .section-desc, #tab-analysis .kpi-intro')].filter((d) => !d.hidden).length);
  expect(desktopShown, 'desktop starts collapsed too').toBe(0);
  // …and the ⓘ that stands in for each one is visible, not hover-gated.
  const markOpacity = await freshPage.locator('#tab-analysis .desc-toggle').first().evaluate((e) => getComputedStyle(e).opacity);
  expect(Number(markOpacity), 'the collapsed affordance must always show').toBe(1);
  await fresh.close();
});

test('the icon set resolves, is monochrome, and shows tab state', async ({ page }) => {
  await bootStatic(page);

  // Every <use> must point at a symbol that exists — a typo'd href renders
  // nothing at all, silently.
  const unresolved = await page.evaluate(() =>
    [...document.querySelectorAll('use')].map((u) => u.getAttribute('href')).filter((h) => !document.querySelector(h)));
  expect(unresolved, 'icon references with no matching <symbol>').toEqual([]);

  // The reason for replacing the emoji: an icon takes the colour of its label,
  // so it can show active vs inactive. The active tab sits on gold, and its
  // icon has to go dark with the text.
  await openTab(page, 'analysis');
  const strokes = await page.evaluate(() =>
    [...document.querySelectorAll('.tab-bar .tab-btn')]
      .filter((b) => b.offsetParent)
      .map((b) => ({ active: b.classList.contains('active'), stroke: getComputedStyle(b.querySelector('.icon')).stroke })));
  const active = strokes.find((t) => t.active);
  const inactive = strokes.find((t) => !t.active);
  expect(active.stroke, 'the active tab icon must not match the inactive ones').not.toBe(inactive.stroke);

  // No colour is baked into the sprite: icons inherit, so a token change
  // reaches them. (currentColor resolves per-use, never to a literal here.)
  const hardCoded = await page.evaluate(() =>
    [...document.querySelectorAll('.sprite [stroke], .sprite [fill]')]
      .flatMap((el) => [el.getAttribute('stroke'), el.getAttribute('fill')])
      .filter((v) => v && v !== 'currentColor' && v !== 'none'));
  expect(hardCoded, 'sprite paths must use currentColor').toEqual([]);
});

test('the Analysis tab opens on the answer, not on the dataset', async ({ page }) => {
  await bootStatic(page);
  await openTab(page, 'analysis');

  // Measured before this: the first thing a buyer needed sat 1,354px down on
  // desktop. The overview has to be near the top, not merely present.
  const y = await page.locator('#overview-deals').evaluate(
    (el) => el.getBoundingClientRect().top + window.scrollY);
  expect(y, 'the overview should be above the fold').toBeLessThan(700);

  const rows = page.locator('#overview-deals .pick-item');
  await expect(rows).toHaveCount(5);

  // The lead "Where to start" block leads with the safe (age-weighted) ranking
  // by default, and its headline figure is the score — not the raw deal — so a
  // first-time user sees the risk-adjusted pick first, not the shiniest new set.
  await expect(page.locator('#start-lens .pill.active')).toHaveText('Safe pick');
  await expect(page.locator('#overview-lead')).toContainText('age-weighted score');
  const primaries = await page.locator('#overview-deals .pick-score').allTextContents();
  expect(primaries.length).toBe(5);
  expect(primaries.every((s) => s.includes('score'))).toBe(true);

  // Every card also carries all three signals, so the lenses can be compared in
  // place rather than across separate lists.
  const metrics = await rows.first().locator('.pick-metric').allTextContents();
  expect(metrics.length).toBe(3);

  // The product name is the same affordance as on the board.
  await rows.first().locator('.row-open').click();
  await expect(page.locator('#drill-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  // Wait for it to actually close: the overlay swallows pointer events, so the
  // next click would hit the backdrop instead of the pill.
  await expect(page.locator('#drill-modal')).not.toBeVisible();

  // It follows the global type filter, like every other analytical view.
  // Driven from the keyboard rather than a mouse click: the filter bar sits
  // below the fold, and `html { scroll-behavior: smooth }` makes Playwright's
  // scroll-into-view race its own click — the click lands where the pill was.
  // focus()+Enter is a real user path (and the one the pill test already
  // proves works) that needs no scrolling.
  const etb = page.locator('#type-filters .pill[data-type="ETB"]');
  await etb.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => {
      const metas = await page.locator('#overview-deals .pick-meta').allTextContents();
      return metas.length > 0 && metas.every((m) => m.startsWith('ETB'));
    }, { message: 'overview must respect the type filter' })
    .toBe(true);
});

test('the signed-in surface (portfolio + demo page) has no serious or critical violations', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/@supabase/supabase-js@*/**', (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSdk }));
  await routeLocalLibs(page);
  await page.goto('/');

  // The logged-out demo is the first thing a visitor meets, and since the
  // pitch rework it is the app's only "what this is / how to read it" surface
  // — so it carries prose, a step panel and two dialog openers, not just a
  // table. Sweep it before anything else.
  await expect(page.locator('#demo-page')).toBeVisible();
  expect(await blockingViolations(page), 'axe on the demo page').toEqual([]);

  // The glossary is shared with the Welcome tab, so one sweep covers both.
  await page.locator('#demo-page .glossary-open').click();
  await expect(page.locator('#glossary-modal')).toHaveClass(/open/);
  expect(await blockingViolations(page, '#glossary-modal'), 'axe on the glossary').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#glossary-modal')).not.toHaveClass(/open/);

  await page.locator('#demo-page header .signin-open').click();
  await expect(page.locator('#auth-overlay')).toBeVisible();
  expect(await blockingViolations(page, '#auth-overlay'), 'axe on the sign-in dialog').toEqual([]);

  await page.locator('#auth-email').fill('user@test.local');   // known to the fake SDK
  await page.locator('#auth-password').fill('test-password');
  await page.locator('#auth-signin-btn').click();
  await expect(page.locator('html.sb-authed')).toHaveCount(1);

  await openTab(page, 'portfolio');
  expect(await blockingViolations(page), 'axe on #tab-portfolio').toEqual([]);

  // The Welcome tab is a signed-in landing now; sweep it in the state that
  // actually ships (signed in, non-admin), not the static-mode one.
  await openTab(page, 'welcome');
  expect(await blockingViolations(page), 'axe on #tab-welcome signed in').toEqual([]);

  expect(pageErrors).toEqual([]);
});

test('the demo page is operable and readable on a phone', async ({ page }) => {
  // The pitch is the surface a first-time visitor is most likely to meet on a
  // phone — a link off social, not a bookmark. It has to reflow, and its two
  // explanation openers have to clear the 24px target floor (WCAG 2.5.8).
  await page.setViewportSize({ width: 320, height: 640 });
  page.on('dialog', (d) => d.accept());
  await page.route('**/@supabase/supabase-js@*/**', (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSdk }));
  await routeLocalLibs(page);
  await page.goto('/');
  await expect(page.locator('#demo-page')).toBeVisible();
  await settle(page);

  // 1.4.10: no two-dimensional scrolling at the conformance threshold. The
  // demo is its own scroll container, so measure that, not the document.
  const overflow = await page.evaluate(() => {
    const el = document.getElementById('demo-page');
    return { scrollW: el.scrollWidth, clientW: el.clientWidth };
  });
  expect(overflow.scrollW, 'the demo page must not scroll sideways at 320px')
    .toBeLessThanOrEqual(overflow.clientW + 1);

  // 2.5.8: every control on the pitch, including the text-weight links.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('#demo-page button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ t: b.textContent.trim().slice(0, 30), r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 24 || r.height < 24)
      .map(({ t, r }) => `${t} ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small, 'controls under the 24px target minimum').toEqual([]);

  expect(await blockingViolations(page), 'axe on the demo page at 320px').toEqual([]);
});
