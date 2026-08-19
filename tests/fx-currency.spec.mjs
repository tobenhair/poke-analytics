// ============================================================
// Global display-currency picker + FX fallback
// ============================================================
// Regression cover for a reported bug: the picker offered only €, with nothing
// anywhere saying why. The picker itself was fine — it lists € plus whatever
// currencies it has a live rate for, so "€ only" always meant the FX fetch had
// failed, and the failure was swallowed by a bare `catch {}`.
//
// These tests pin all three outcomes: the current endpoint answering, the
// legacy host covering for it, and both failing (which must still leave a
// working €-denominated page, but now says so).
//
// The picker lives in the page header (it drives every price on the page, not
// just the Portfolio tab). populateCurrencySelect() runs from INIT regardless of
// auth, so the static path exercises it without the Supabase stack — which keeps
// this spec small.
// ============================================================

import { test, expect } from '@playwright/test';
import { routeLocalLibs, FX_RATES } from './local-cdn.mjs';

const isDev = (url) => new URL(url).host.endsWith('frankfurter.dev');
const ratesJson = { contentType: 'application/json', body: JSON.stringify(FX_RATES) };

// Static mode, with a caller-supplied handler for the FX request. Registered
// after routeLocalLibs() so it wins (Playwright prefers the newest match).
async function load(page, fxHandler) {
  const hosts = [];
  await routeLocalLibs(page);
  await page.route(/\/(index\.html)?(\?.*)?$/, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const body = (await response.text())
      .replace(/url:\s*'[^']*'/, "url: ''")
      .replace(/anonKey:\s*'[^']*'/, "anonKey: ''");
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  await page.route('**frankfurter**', async (route) => {
    hosts.push(new URL(route.request().url()).host);
    await fxHandler(route);
  });
  await page.goto('/');
  return hosts;
}

const options = (page) => page.locator('#display-currency option').allTextContents();

// The note lives in the always-visible header now, but we still assert on the
// element's own inline display (what the code actually sets) rather than
// toBeVisible()/toBeHidden(): it's the precise signal, and it keeps this check
// robust to any wrapper that might dim or hide the surrounding chrome.
const noteShown = (page) =>
  page.locator('#fx-note').evaluate((el) => el.style.display !== 'none');

test('rates load → the picker offers every configured currency', async ({ page }) => {
  const hosts = await load(page, (r) => r.fulfill(ratesJson));

  await expect.poll(async () => (await options(page)).length).toBe(4);
  // The compact header picker shows just the symbol (€ / $ / £ / kr).
  expect(await options(page)).toEqual(['€', '$', '£', 'kr']);

  // Only the current endpoint is called when it answers — no pointless second
  // request to the legacy host.
  expect(hosts).toEqual(['api.frankfurter.dev']);
  expect(await noteShown(page)).toBe(false);
});

test('current endpoint down → falls back to the legacy host', async ({ page }) => {
  const hosts = await load(page, (r) =>
    isDev(r.request().url())
      ? r.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' })
      : r.fulfill(ratesJson));

  await expect.poll(async () => (await options(page)).length).toBe(4);
  expect(hosts).toEqual(['api.frankfurter.dev', 'api.frankfurter.app']);
  expect(await noteShown(page)).toBe(false);
});

test('all endpoints down → € only, and the page says why', async ({ page }) => {
  const hosts = await load(page, (r) => r.abort());

  // Both are tried before giving up.
  await expect.poll(() => hosts.length).toBe(2);

  // Degraded, not broken: € still works as the canonical unit …
  expect(await options(page)).toEqual(['€']);

  // … and the reason is visible instead of silent, which was the actual defect.
  await expect.poll(() => noteShown(page)).toBe(true);
  const note = page.locator('#fx-note');
  await expect(note).toHaveText(/live rates unavailable/);
  await expect(note).toHaveAttribute('title', /frankfurter\.dev.*frankfurter\.app/s);
});
