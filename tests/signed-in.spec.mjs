// ============================================================
// Signed-in surface e2e (Playwright + fake Supabase SDK)
// ============================================================
// The smoke test covers the static/xlsx path; this spec covers everything
// behind Supabase: the logged-out demo scope, auth-driven UI gating, the
// snapshot pivot in loadFromSupabase, portfolio/alert auto-save payloads, the
// admin Data Entry → cloud-save loop, and the error beacon's cloud path.
//
// No cloud credentials: the page's SUPABASE_CONFIG stays as committed, but the
// SDK request is intercepted and served tests/fake-supabase-sdk.js — an
// in-memory stand-in that logs every write to window.__sbWrites for the
// assertions below. Chart.js and SheetJS are served from node_modules (pinned
// to the same versions as the CDN tags) so the spec is hermetic — no external
// network can flake it. This proves the client's behaviour; the real RLS
// policies live server-side in supabase/schema.sql and are out of scope here.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeLocalLibs, expandBoard } from './local-cdn.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeSdk = readFileSync(join(here, 'fake-supabase-sdk.js'), 'utf8');

// Serve the fake SDK + local library copies, collect page errors, and load.
async function boot(page) {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/@supabase/supabase-js@*/**', (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSdk }));
  await routeLocalLibs(page);
  await page.goto('/');
  return pageErrors;
}

async function signIn(page, email) {
  await page.locator('#demo-page header .signin-open').click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill('test-password');
  await page.locator('#auth-signin-btn').click();
  await expect(page.locator('html.sb-authed')).toHaveCount(1);
}

const writes = (page, table, op) =>
  page.evaluate(
    ([t, o]) => (window.__sbWrites || []).filter((w) => w.table === t && w.op === o),
    [table, op],
  );

test('logged-out visitors get the demo scope and a dismissible sign-in', async ({ page }) => {
  const pageErrors = await boot(page);

  // Demo page shows only the 3 newest releases; the older Alpha is gated.
  await expect(page.locator('#demo-page')).toBeVisible();
  await expect(page.locator('#demo-sets')).toContainText('Gamma ETB');
  await expect(page.locator('#demo-sets')).toContainText('Delta Booster Bundle');
  await expect(page.locator('#demo-sets')).not.toContainText('Alpha Booster Box');

  // Sign-in overlay opens and dismisses without forcing a login.
  await page.locator('#demo-page header .signin-open').click();
  await expect(page.locator('#auth-overlay')).toBeVisible();
  await page.locator('#auth-close').click();
  await expect(page.locator('#auth-overlay')).not.toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('the news feed shows a TCG-first teaser and opens a grouped, safe-linking overlay', async ({ page }) => {
  const pageErrors = await boot(page);

  // Logged-out demo shows the teaser (public-read news), Pokémon TCG headline first.
  await expect(page.locator('#demo-page .news-teaser')).toBeVisible();
  await expect(page.locator('#demo-page .news-teaser .news-teaser-body li').first())
    .toContainText('Prismatic Evolutions');

  // "All news →" opens the shared overlay (the demo page has no tab bar),
  // grouped with Pokémon TCG first.
  await page.locator('#demo-page .news-teaser .news-all').click();
  await expect(page.locator('#news-modal')).toHaveClass(/open/);
  await expect(page.locator('#news-modal .news-group-title').first()).toHaveText('Pokémon TCG');
  await expect(page.locator('#news-modal .news-full')).toContainText('The Pokemon Company posts record revenue');

  // Headlines link out safely — new tab + noopener.
  const link = page.locator('#news-modal .news-link').first();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#news-modal')).not.toHaveClass(/open/);

  // Signed in, news is its OWN tab (between Welcome and Analysis), revealed once
  // the table returns rows — no header button, no Welcome teaser.
  await signIn(page, 'user@test.local');
  await expect(page.locator('#tabbtn-news')).toBeVisible();
  await expect(page.locator('#tab-welcome .news-teaser')).toHaveCount(0);
  await page.locator('#tabbtn-news').click();
  await expect(page.locator('#tab-news')).toBeVisible();
  await expect(page.locator('#tab-news .news-group-title').first()).toHaveText('Pokémon TCG');
  await expect(page.locator('#tab-news .news-full')).toContainText('The Pokemon Company posts record revenue');

  expect(pageErrors).toEqual([]);
});

test('the demo page pitches before it lists, and is honest about what it withholds', async ({ page }) => {
  // The demo used to open on a bare table of Price / Set Value / €/Booster /
  // SV/Booster with no statement of what the tool is or what any column means
  // — a visitor's first screen was six numbers and no argument. These are the
  // parts of the pitch that have to survive a refactor.
  const pageErrors = await boot(page);
  await expect(page.locator('#demo-page')).toBeVisible();

  // The question comes first, above the sample.
  const heroY = (await page.locator('#demo-page .hero-title').boundingBox()).y;
  const tableY = (await page.locator('#demo-sets table').first().boundingBox()).y;
  expect(heroY, 'the pitch must lead the page').toBeLessThan(tableY);

  // Three steps: value not price, why age matters, what the verdict means.
  await expect(page.locator('#demo-page .steps .step')).toHaveCount(3);

  // Fair price and the verdict are *not* claimed here, and the page says why
  // rather than leaving a visitor to notice the gap. Computing a fit from the
  // 3 demo sets would produce a number the signed-in board disagrees with —
  // the one failure this trust-first page cannot afford.
  await expect(page.locator('#demo-page .section-desc')).toContainText('whole');
  await expect(page.locator('#demo-sets')).not.toContainText('Under fair price');

  // Both explanations are reachable without signing in, and they are the same
  // dialogs the signed-in Welcome tab opens.
  await page.locator('#demo-page .method-open').click();
  await expect(page.locator('#method-modal')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await page.locator('#demo-page .glossary-open').click();
  await expect(page.locator('#glossary-modal')).toHaveClass(/open/);
  await expect(page.locator('#glossary-modal')).toContainText('Fair Price');
  await expect(page.locator('#glossary-modal')).toContainText('SV / Booster');
  await page.keyboard.press('Escape');

  // A second sign-in button closes the pitch — the page is long enough that
  // scrolling back to the header would be friction.
  await page.locator('#demo-page .demo-cta .signin-open').click();
  await expect(page.locator('#auth-overlay')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('the demo Where-to-start teaser ranks by value live and locks the fit-based lenses', async ({ page }) => {
  // The signed-in Analysis tab opens on the Where-to-start shortlist; the demo
  // shows the same block but only Best value (SV/Booster, fit-independent) is
  // live — Safe pick and Best deal are locked behind sign-in, because both read
  // a catalogue-wide fit the 3-set demo slice can't reproduce (the demo's
  // no-fair-price/verdict honesty rule). This is the concrete "why sign in".
  const pageErrors = await boot(page);
  await expect(page.locator('#demo-page')).toBeVisible();

  // Best value is the default and it renders real ranked cards, headline ×value.
  await expect(page.locator('#demo-start-lens .pill[data-lens="value"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#demo-start-list .pick-item').first()).toBeVisible();
  await expect(page.locator('#demo-start-list .pick-score').first()).toContainText('value');
  // Honesty rule: no fair price / verdict leaks into the live value lens.
  await expect(page.locator('#demo-start-list')).not.toContainText('fair');

  // Safe pick and Best deal are locked — no ranked cards, a slim one-line "sign
  // in to rank by…" note (no feature grid duplicated inside the ranking widget).
  for (const lens of ['safe', 'deal']) {
    await page.locator(`#demo-start-lens .pill[data-lens="${lens}"]`).click();
    await expect(page.locator('#demo-start-list .pick-item')).toHaveCount(0);
    await expect(page.locator('#demo-start-list')).toContainText('Sign in');
    await expect(page.locator('#demo-start-list .unlock-tile')).toHaveCount(0);
  }
  await page.locator('#demo-start-list .signin-open').click();
  await expect(page.locator('#auth-overlay')).toBeVisible();

  // The unlock-toolkit tiles live once, in their own standalone section on the
  // demo page — not inside the ranking widget.
  await expect(page.locator('#demo-page .unlock-tile')).toHaveCount(5);
  await expect(page.locator('#demo-start-list .unlock-tile')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('the demo mounts three "see it in action" sample charts, drawn on scroll', async ({ page }) => {
  // Illustrative SVG charts (value-vs-age scatter, fair-price line, momentum
  // bars) that teach the pitch; badged Sample, so no real product's fair price
  // is shown (the demo honesty rule). They animate on scroll into view via
  // mountDemoVizzes()'s IntersectionObserver.
  const pageErrors = await boot(page);
  await expect(page.locator('#demo-viz-scatter svg')).toBeVisible();
  await expect(page.locator('#demo-viz-fair svg')).toBeVisible();
  await expect(page.locator('#demo-viz-momentum svg')).toBeVisible();
  // Each is labelled a Sample, keeping the no-real-fair-price rule visible.
  await expect(page.locator('.demo-viz .demo-viz-badge').first()).toHaveText('Sample');
  // Scrolling a chart into view triggers its reveal (draw-on) class.
  const firstViz = page.locator('.demo-viz').first();
  await firstViz.scrollIntoViewIfNeeded();
  await expect(firstViz).toHaveClass(/in-view/);
  // …and the build replays on a slow loop so a mid-scroll visitor still catches
  // it — mountDemoVizzes() arms a replay timer (skipped under reduced motion).
  await expect.poll(() => firstViz.evaluate(el => !!el._vizTimer)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('signing in lands on the Welcome tab, which shares the demo page explanations', async ({ page }) => {
  const pageErrors = await boot(page);
  await signIn(page, 'user@test.local');

  // A signed-in session opens on the Welcome tab — the signed-in landing (the
  // where-to-go map + the latest-news teaser), which is also the markup default,
  // so first paint and post-login agree.
  await expect(page.locator('#tab-welcome')).toBeVisible();
  await expect(page.locator('#tab-analysis')).toBeHidden();
  await expect(page.locator('.tab-bar .tab-btn[data-tab="welcome"]')).toHaveAttribute('aria-selected', 'true');

  // Welcome advertises every tab this user actually has. Portfolio used to be
  // missing here even though the tab exists for every signed-in user.
  await expect(page.locator('#tab-welcome .card-title[data-goto="analysis"]')).toBeVisible();
  await expect(page.locator('#tab-welcome .card-title[data-goto="portfolio"]')).toBeVisible();
  await expect(page.locator('#tab-welcome .card-title[data-goto="entry"]')).toBeHidden();

  // …and no heading is left standing over hidden content. A signed-in
  // non-admin used to get a "How it works" eyebrow with nothing underneath it,
  // because the panel was .admin-only and the <h2> introducing it was not.
  // Assert the pairing rather than the visibility: every eyebrow must appear
  // exactly when the block it introduces does.
  const orphans = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-welcome h2.section-eyebrow')]
      .filter((h) => {
        const shown = (el) => !!el && el.offsetParent !== null;
        return shown(h) !== shown(h.nextElementSibling);
      })
      .map((h) => h.textContent.trim()),
  );
  expect(orphans, 'a section heading is showing without its content').toEqual([]);

  // The two explanations are the *same dialogs* the demo page opens — one
  // definition of SV/Booster in the build, not one per surface.
  //
  // Driven from the keyboard, not clicked: these sit below the fold at the
  // default viewport, and `html { scroll-behavior: smooth }` makes Playwright's
  // scroll-into-view race its own click — the click silently lands on nothing.
  // (The demo page's copies of these buttons *can* be clicked: #demo-page is
  // its own `overflow-y: auto` container, and the smooth rule is on <html>.)
  await page.locator('#tab-welcome .glossary-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#glossary-modal')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await page.locator('#tab-welcome .method-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#method-modal')).toHaveClass(/open/);

  expect(pageErrors).toEqual([]);
});

test('signing in re-shows the boot splash so the sample-data banner never flashes', async ({ page }) => {
  // The demo hides the boot splash once it loads. Signing in then reveals the app
  // UI on the still-`sample` hardcoded fallback for a beat before
  // loadFromSupabase() swaps in cloud data — the "sample data" banner flashed
  // there. The auth handler now re-shows the splash to cover that transition, and
  // loadFromSupabase() hides it when the real data lands.
  const pageErrors = await boot(page);
  await expect(page.locator('#app-loader')).toBeHidden();   // gone after the demo loads

  // Spy on the re-show before signing in (a live global lookup in the handler).
  await page.evaluate(() => {
    window.__splashReshown = false;
    const orig = window.__showAppLoader;
    window.__showAppLoader = function () { window.__splashReshown = true; return orig && orig.apply(this, arguments); };
  });
  await signIn(page, 'user@test.local');

  expect(await page.evaluate(() => window.__splashReshown), 'sign-in re-shows the splash').toBe(true);
  await expect(page.locator('#app-loader')).toBeHidden();   // cleared once cloud data is ready, never stuck up
  expect(pageErrors).toEqual([]);
});

test('the account actions live in a profile menu that keeps the phone header from overflowing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 }); // an iPhone-ish width
  const pageErrors = await boot(page);
  await signIn(page, 'user@test.local');

  const trigger = page.locator('#profile-btn');
  const menu = page.locator('#profile-menu');
  const changePw = page.locator('#change-pw-btn');
  const signOut = page.locator('#auth-signout-btn');

  // The header fits the viewport — the reason this menu exists (the email + two
  // buttons used to overflow to the right and clip).
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'header (or page) scrolls horizontally on a phone').toBeLessThanOrEqual(0);

  // Collapsed by default: the trigger shows, the actions are tucked away.
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeHidden();
  await expect(changePw).toBeHidden();

  // Open it: the actions and the signed-in email appear, focus moves inside.
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(changePw).toBeVisible();
  await expect(signOut).toBeVisible();
  await expect(page.locator('#auth-user-email')).toHaveText('user@test.local');
  await expect(changePw).toBeFocused();

  // The open menu stays within the viewport — on a phone the trigger is at the
  // right edge and the right:0 dropdown opens leftward (it used to overflow off
  // the left when the controls were stranded on the left of the wrapped row).
  const box = await menu.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x, 'menu left edge on screen').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'menu right edge on screen').toBeLessThanOrEqual(vw);

  // …and it has a SOLID fill so the (translucent, frosted) tab-bar behind it
  // can't show through — the old `background: var(--elev)` (a box-shadow token)
  // left it transparent.
  const bg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg, 'menu background must be opaque').not.toMatch(/rgba?\([^)]*,\s*0\)\s*$|transparent/);

  // Escape closes it and returns focus to the trigger (it's a disclosure).
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // Choosing an action opens its overlay and closes the menu.
  await trigger.click();
  await changePw.click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#account-overlay')).toHaveClass(/open/);

  expect(pageErrors).toEqual([]);
});

test('a regular user gets portfolio + alerts but not Data Entry, and edits auto-save', async ({ page }) => {
  const pageErrors = await boot(page);
  await signIn(page, 'user@test.local');

  // Gating: signed-in tabs appear, the admin tab does not.
  await expect(page.locator('.tab-btn[data-tab="portfolio"]')).toBeVisible();
  await expect(page.locator('.tab-btn[data-tab="entry"]')).toBeHidden();

  // Full catalogue via the snapshot pivot — including the demo-gated product.
  // The board opens collapsed to eras; expand to reveal the four product rows
  // (Alpha SM · Beta SV · Gamma/Delta ME).
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expandBoard(page);
  await expect(page.locator('#product-tbody tr.grp-product')).toHaveCount(4);
  await expect(page.locator('#product-tbody')).toContainText('Alpha Booster Box');

  // The fixture alert (Gamma below €100, latest price €80) flags the board.
  // The alert marker is an icon, so assert its accessible name rather than a
  // glyph — that is what a screen reader gets, and it survives an icon change.
  await expect(
    page.locator('#product-tbody tr', { hasText: 'Gamma ETB' })
        .locator('[role="img"][aria-label^="Alert"]'),
  ).toBeVisible();

  // Sell caution: Delta ran up +16% on its last snapshot while set value stayed
  // flat (an un-backed run-up), so its board row shows the sell-caution flag —
  // the mirror of the buy signal, asserted by its accessible name.
  await expect(
    page.locator('#product-tbody tr', { hasText: 'Delta Booster Bundle' })
        .locator('[role="img"][aria-label="Sell caution"]'),
  ).toBeVisible();

  // Portfolio: the fixture holding renders; adding a new one auto-saves an
  // upsert row keyed user_id+product_id — no Save button anywhere.
  await page.locator('.tab-btn[data-tab="portfolio"]').click();
  await expect(page.locator('#tab-portfolio')).toContainText('Beta Booster Box');
  // The product picker is a searchable datalist input now, not a <select>.
  await page.locator('#portfolio-product-select').fill('Delta Booster Bundle');
  await page.locator('#portfolio-qty').fill('1');
  await page.locator('#portfolio-cost').fill('50');
  await page.locator('#portfolio-add-btn').click();
  await expect.poll(async () => (await writes(page, 'holdings', 'upsert')).length).toBeGreaterThan(0);
  const holdingRow = (await writes(page, 'holdings', 'upsert')).at(-1).payload;
  expect(holdingRow).toMatchObject({ product_id: 'p4', quantity: 1, cost_basis: 50 });

  // The buy is also recorded as its own ledger event (the buy half of the
  // Transaction Log — the individual purchase the blended holding would lose).
  await expect.poll(async () => (await writes(page, 'purchases', 'insert')).length).toBeGreaterThan(0);
  expect((await writes(page, 'purchases', 'insert')).at(-1).payload).toMatchObject({
    product_id: 'p4', quantity: 1, unit_price: 50,
  });
  // The Transaction Log lists that buy, plus an "opening" reconstruction of the
  // pre-existing holding that predates the log.
  await expect(page.locator('#ledger-tbody')).toContainText('Delta Booster Bundle');
  await expect(page.locator('#ledger-tbody')).toContainText('opening');

  // Alerts: adding a fixed target auto-saves the same way. The product picker
  // is a searchable datalist input now (like the Holdings editor), not a select.
  await page.locator('#alert-product-select').fill('Delta Booster Bundle');
  await page.locator('#alert-target').fill('55');
  await page.locator('#alert-add-btn').click();
  await expect.poll(async () => (await writes(page, 'alerts', 'upsert')).length).toBeGreaterThan(0);
  expect((await writes(page, 'alerts', 'upsert')).at(-1).payload).toMatchObject({
    product_id: 'p4', alert_type: 'fixed', target_price: 55,
  });

  // Phone reflow (WCAG 1.4.10): the holding cards must not force horizontal
  // scroll at 320px. Regressed once because the card grid floored its track at
  // minmax(280px,1fr) — wider than a small phone — so a card overflowed the
  // viewport (worst with longer currency strings). Now minmax(min(280px,100%),
  // 1fr) + the grid item's min-width:0 keep every card inside the viewport.
  await page.setViewportSize({ width: 320, height: 780 });
  await expect(page.locator('.holding-card').first()).toBeVisible();
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const cards = [...document.querySelectorAll('.holding-card')];
    const widest = Math.max(0, ...cards.map((c) => c.getBoundingClientRect().right));
    return { pageScrolls: document.documentElement.scrollWidth > vw, cardPast: widest > vw + 0.5 };
  });
  expect(overflow).toEqual({ pageScrolls: false, cardPast: false });

  expect(pageErrors).toEqual([]);
});

test('recording a sale draws the holding down and reports realised P&L', async ({ page }) => {
  const pageErrors = await boot(page);
  await signIn(page, 'user@test.local');
  await page.locator('.tab-btn[data-tab="portfolio"]').click();
  // Wait for the signed-in portfolio to settle (the holding loaded + rendered)
  // before interacting — the summary tile only renders once holdings are in.
  await expect(page.locator('#portfolio-summary')).toContainText('Unrealised Profit & Loss');

  // The fixture holds 2× Beta at €150 cost. Sell 1 at €200 → realised +€50, and
  // the holding is drawn down to 1 (cost basis unchanged by a partial sale).
  // The Sell button sits low on a long page; dispatch the click directly so the
  // test exercises the handler, not Playwright's pointer hit-testing under the
  // sticky chrome.
  const betaCard = page.locator('.holding-card', { hasText: 'Beta Booster Box' });
  await betaCard.locator('.portfolio-sell-btn').dispatchEvent('click');
  await expect(page.locator('#portfolio-add-btn')).toHaveText('✓ Record sale');
  await page.locator('#portfolio-qty').fill('1');
  await page.locator('#portfolio-cost').fill('200');   // repurposed as sale price in sell mode
  await page.locator('#portfolio-add-btn').dispatchEvent('click');   // "✓ Record sale"

  // A sale row is inserted (append-only) with the holding's cost basis captured.
  await expect.poll(async () => (await writes(page, 'sales', 'insert')).length).toBeGreaterThan(0);
  expect((await writes(page, 'sales', 'insert')).at(-1).payload).toMatchObject({
    product_id: 'p2', quantity: 1, sale_price: 200, cost_basis: 150,
  });
  // The holding is drawn down to the remaining 1 (an upsert, not a delete).
  expect((await writes(page, 'holdings', 'upsert')).at(-1).payload).toMatchObject({
    product_id: 'p2', quantity: 1,
  });

  // Realised P&L surfaces in the summary and the Closed Positions list shows the row.
  await expect(page.locator('#portfolio-summary')).toContainText('Realised Profit & Loss');
  await expect(page.locator('#sales-tbody')).toContainText('Beta Booster Box');
  await expect(page.locator('#sales-badge')).toHaveText(/1 sale/);

  expect(pageErrors).toEqual([]);
});

test('the admin sees Data Entry and cloud-save writes the entered snapshot', async ({ page }) => {
  const pageErrors = await boot(page);
  await signIn(page, 'admin@test.local');
  await expect(page.locator('html.is-admin')).toHaveCount(1);

  await page.locator('.tab-btn[data-tab="entry"]').click();
  await expect(page.locator('#entry-tbody tr')).toHaveCount(4);

  // Enter one price (within the 30% delta guard) for a fixed snapshot date,
  // plus the promo card's Cardmarket id (the daily job fetches its live value).
  await page.locator('#snapshot-label').fill('2026-07-18');
  await page.locator('.entry-input[data-product="Beta Booster Box"][data-field="price"]').fill('175');
  // Two promo ids, comma-separated — a product can bundle more than one; the
  // daily job sums their avg30 into snapshots.promo_value.
  await page.locator('.promo-input[data-product="Beta Booster Box"]').fill('9001, 9002');
  await page.locator('#save-cloud-btn').click();
  // Data Entry actions report to their own footer pill, not the Analysis tab's.
  await expect(page.locator('#entry-status')).toContainText('Saved to cloud');

  // The exact rows the server would receive: the snapshot upsert keyed
  // product_id+snapshot_date, and the age-threshold settings upsert.
  const snapWrites = await writes(page, 'snapshots', 'upsert');
  expect(snapWrites.length).toBeGreaterThan(0);
  expect(snapWrites.at(-1).payload).toMatchObject([
    { product_id: 'p2', snapshot_date: '2026-07-18', price: 175 },
  ]);
  // The promo edit is written to products.cardmarket_promo_product_ids (the ids
  // the daily job prices and sums; the promo € itself is fetched per-snapshot,
  // not entered). The comma-separated cell becomes an integer array.
  const prodUpdates = await writes(page, 'products', 'update');
  expect(prodUpdates.some((w) => w.payload &&
    JSON.stringify(w.payload.cardmarket_promo_product_ids) === JSON.stringify([9001, 9002]))).toBe(true);
  expect((await writes(page, 'user_settings', 'upsert')).length).toBeGreaterThan(0);

  // The save reloads cloud state: the new snapshot is now the latest tracked
  // date on the page.
  await expect(page.locator('#last-update-date')).toContainText('18 July 2026');

  expect(pageErrors).toEqual([]);
});

test('a locked-out user can request a reset and finish through the link', async ({ page }) => {
  // Before this the sign-in overlay offered only Sign in and Create an account,
  // so a forgotten password meant losing the account — and with it the
  // RLS-scoped holdings and alerts.
  const pageErrors = await boot(page);
  await page.locator('#demo-page header .signin-open').click();

  // Asking without an address should say so rather than mail nowhere.
  await page.locator('#auth-forgot-btn').click();
  await expect(page.locator('#auth-error')).toContainText('Enter your email address first');
  expect(await writes(page, 'auth', 'resetPasswordForEmail')).toHaveLength(0);

  await page.locator('#auth-email').fill('user@test.local');
  await page.locator('#auth-forgot-btn').click();

  const [reset] = await writes(page, 'auth', 'resetPasswordForEmail');
  expect(reset.payload.email).toBe('user@test.local');
  // Must come back to this page, without dragging an old fragment along.
  expect(reset.payload.options.redirectTo).not.toContain('#');
  // The reply must not confirm whether the account exists.
  await expect(page.locator('#auth-error')).toContainText('If an account exists');

  // Returning through the emailed link: a recovery session, and the password
  // form open and titled for the occasion.
  await page.evaluate(() => window.__sbRecovery('user@test.local'));
  await expect(page.locator('#account-overlay')).toBeVisible();
  await expect(page.locator('#account-heading')).toHaveText('Set a new password');
  await expect(page.locator('#account-password')).toBeFocused();

  await page.locator('#account-password').fill('a-new-password');
  await page.locator('#account-password2').fill('a-new-password');
  await page.locator('#account-save-btn').click();
  await expect(page.locator('#account-msg')).toContainText('Password updated');

  expect(pageErrors).toEqual([]);
});

test('the error beacon reports a runtime error to client_errors', async ({ page }) => {
  await boot(page);

  // Wait for boot to create the client and drain the early buffer, then throw.
  await expect
    .poll(() => page.evaluate(() => typeof window.__onClientError === 'function'))
    .toBe(true);
  await page.evaluate(() => setTimeout(() => { throw new Error('beacon-test-error'); }, 0));

  await expect.poll(async () => (await writes(page, 'client_errors', 'insert')).length).toBeGreaterThan(0);
  const report = (await writes(page, 'client_errors', 'insert')).at(-1).payload;
  expect(report.message).toContain('beacon-test-error');
  expect(report.stack).toBeTruthy();
});
