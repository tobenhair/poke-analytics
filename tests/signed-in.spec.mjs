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
import { routeLocalLibs } from './local-cdn.mjs';

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

test('signing in lands on the answer, and Welcome shares the demo page explanations', async ({ page }) => {
  const pageErrors = await boot(page);
  await signIn(page, 'user@test.local');

  // The pitch is read once, logged out. A signed-in session opens on Analysis
  // — which itself opens on "best deals right now" — not on the Welcome tab.
  await expect(page.locator('#tab-analysis')).toBeVisible();
  await expect(page.locator('#tab-welcome')).toBeHidden();
  await expect(page.locator('.tab-bar .tab-btn[data-tab="analysis"]')).toHaveAttribute('aria-selected', 'true');

  await page.locator('.tab-bar .tab-btn[data-tab="welcome"]').click();
  await expect(page.locator('#tab-welcome')).toBeVisible();

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

test('a regular user gets portfolio + alerts but not Data Entry, and edits auto-save', async ({ page }) => {
  const pageErrors = await boot(page);
  await signIn(page, 'user@test.local');

  // Gating: signed-in tabs appear, the admin tab does not.
  await expect(page.locator('.tab-btn[data-tab="portfolio"]')).toBeVisible();
  await expect(page.locator('.tab-btn[data-tab="entry"]')).toBeHidden();

  // Full catalogue via the snapshot pivot — including the demo-gated product.
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#product-tbody tr')).toHaveCount(4);
  await expect(page.locator('#product-tbody')).toContainText('Alpha Booster Box');

  // The fixture alert (Gamma below €100, latest price €80) flags the board.
  // The alert marker is an icon, so assert its accessible name rather than a
  // glyph — that is what a screen reader gets, and it survives an icon change.
  await expect(
    page.locator('#product-tbody tr', { hasText: 'Gamma ETB' })
        .locator('[role="img"][aria-label^="Alert"]'),
  ).toBeVisible();

  // Portfolio: the fixture holding renders; adding a new one auto-saves an
  // upsert row keyed user_id+product_id — no Save button anywhere.
  await page.locator('.tab-btn[data-tab="portfolio"]').click();
  await expect(page.locator('#tab-portfolio')).toContainText('Beta Booster Box');
  await page.locator('#portfolio-product-select').selectOption({ label: 'Delta Booster Bundle' });
  await page.locator('#portfolio-qty').fill('1');
  await page.locator('#portfolio-cost').fill('50');
  await page.locator('#portfolio-add-btn').click();
  await expect.poll(async () => (await writes(page, 'holdings', 'upsert')).length).toBeGreaterThan(0);
  const holdingRow = (await writes(page, 'holdings', 'upsert')).at(-1).payload;
  expect(holdingRow).toMatchObject({ product_id: 'p4', quantity: 1, cost_basis: 50 });

  // Alerts: adding a fixed target auto-saves the same way.
  await page.locator('#alert-product-select').selectOption({ label: 'Delta Booster Bundle' });
  await page.locator('#alert-target').fill('55');
  await page.locator('#alert-add-btn').click();
  await expect.poll(async () => (await writes(page, 'alerts', 'upsert')).length).toBeGreaterThan(0);
  expect((await writes(page, 'alerts', 'upsert')).at(-1).payload).toMatchObject({
    product_id: 'p4', alert_type: 'fixed', target_price: 55,
  });

  expect(pageErrors).toEqual([]);
});

test('the admin sees Data Entry and cloud-save writes the entered snapshot', async ({ page }) => {
  const pageErrors = await boot(page);
  await signIn(page, 'admin@test.local');
  await expect(page.locator('html.is-admin')).toHaveCount(1);

  await page.locator('.tab-btn[data-tab="entry"]').click();
  await expect(page.locator('#entry-tbody tr')).toHaveCount(4);

  // Enter one price (within the 30% delta guard) for a fixed snapshot date.
  await page.locator('#snapshot-label').fill('2026-07-18');
  await page.locator('.entry-input[data-product="Beta Booster Box"][data-field="price"]').fill('175');
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
