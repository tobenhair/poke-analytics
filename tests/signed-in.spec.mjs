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

const here = dirname(fileURLToPath(import.meta.url));
const fakeSdk = readFileSync(join(here, 'fake-supabase-sdk.js'), 'utf8');
const chartJs = readFileSync(join(here, '../node_modules/chart.js/dist/chart.umd.js'), 'utf8');
const xlsxJs = readFileSync(join(here, '../node_modules/xlsx/dist/xlsx.full.min.js'), 'utf8');

const js = (body) => ({ contentType: 'application/javascript', body });

// Serve the fake SDK + local library copies, collect page errors, and load.
async function boot(page) {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/@supabase/supabase-js@*/**', (r) => r.fulfill(js(fakeSdk)));
  await page.route('**cdnjs.cloudflare.com/**Chart.js**', (r) => r.fulfill(js(chartJs)));
  await page.route('**cdnjs.cloudflare.com/**xlsx**', (r) => r.fulfill(js(xlsxJs)));
  await page.route('**fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('/');
  return pageErrors;
}

async function signIn(page, email) {
  await page.locator('#demo-signin-btn').click();
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
  await page.locator('#demo-signin-btn').click();
  await expect(page.locator('#auth-overlay')).toBeVisible();
  await page.locator('#auth-close').click();
  await expect(page.locator('#auth-overlay')).not.toBeVisible();

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
  await expect(page.locator('#product-tbody tr', { hasText: 'Gamma ETB' })).toContainText('🔔');

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
  await expect(page.locator('#upload-status')).toContainText('Saved to cloud');

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
