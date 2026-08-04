// ============================================================
// Installable app (PWA): manifest, service worker, install affordance
// ============================================================
// Guards the three pieces that make the page installable and offline-capable:
// a valid web app manifest with resolvable icons, a service worker that
// registers → activates → precaches the app shell (the real offline guarantee),
// and the header "Install app" button that only appears when the browser offers
// an install and then drives the prompt.
//
// The rest of the suite runs with `serviceWorkers: 'block'` (playwright.config)
// so the SW cache can't bleed between specs; this one opts back in.
// ============================================================

import { test, expect } from '@playwright/test';
import { routeLocalLibs, forceStaticMode } from './local-cdn.mjs';

test.use({ serviceWorkers: 'allow' });

// Keep in sync with the CACHE constant in sw.js (bumped when the shell changes).
const CACHE = 'sta-shell-v1';

async function load(page) {
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
}

test('the manifest, icons and head wiring make the page installable', async ({ page }) => {
  await load(page);

  // Head wiring the browser (and iOS) read to offer an install.
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /icon-192\.png$/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0a0b0f');

  // The manifest itself is valid and complete.
  const res = await page.request.get('/manifest.webmanifest');
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m.name).toBeTruthy();
  expect(m.start_url).toBeTruthy();
  expect(m.display).toBe('standalone');
  expect(m.background_color).toBe('#0a0b0f');

  // Installability needs a 192 and a 512; Android's adaptive icon needs a
  // maskable one. Assert the set and that every icon file actually resolves.
  const sizes = m.icons.map((i) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.icons.some((i) => (i.purpose || '').includes('maskable'))).toBeTruthy();
  for (const icon of m.icons) {
    const iconRes = await page.request.get('/' + icon.src);
    expect(iconRes.ok(), `icon ${icon.src} resolves`).toBeTruthy();
    expect(iconRes.headers()['content-type']).toContain('image/png');
  }
});

test('the service worker registers, activates and precaches the offline shell', async ({ page }) => {
  await load(page);

  // Wait for the worker to finish activating (its activate handler does async
  // cache cleanup, so `ready` can resolve while it's still 'activating').
  await expect.poll(() => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return (reg.active && reg.active.state) || null;
  })).toBe('activated');

  // The precache holds the shell that lets the app open with no network. Reading
  // the Cache Storage directly proves the install step ran, without the flake of
  // a real offline reload.
  const cached = await page.evaluate(async (name) => {
    const c = await caches.open(name);
    const keys = await c.keys();
    return keys.map((r) => new URL(r.url).pathname);
  }, CACHE);
  expect(cached.some((p) => p.endsWith('/index.html'))).toBeTruthy();
  expect(cached.some((p) => p.endsWith('/metrics.js'))).toBeTruthy();
});

test('the install button appears only when the browser offers it, then drives the prompt', async ({ page }) => {
  await load(page);
  const btn = page.locator('#install-btn');

  // Hidden until the browser says the app is installable — so it never shows a
  // dead control (and never shows on iOS, which fires no such event).
  await expect(btn).toBeHidden();
  // On this desktop-Chromium UA the iOS Share-sheet hint must stay hidden too.
  await expect(page.locator('#ios-install-hint')).toBeHidden();

  // Synthesise the browser's beforeinstallprompt: a cancelable event carrying the
  // prompt()/userChoice API the handler replays. This is exactly the shape the
  // page's wiring consumes.
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__installPrompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });

  await expect(btn).toBeVisible();

  await btn.click();
  await expect.poll(() => page.evaluate(() => window.__installPrompted === true)).toBeTruthy();
  // A prompt is single-use, so the button retires after it's spent.
  await expect(btn).toBeHidden();
});

// iOS Safari never fires beforeinstallprompt, so the button can't help there.
// The page detects iOS Safari and reveals a manual "Share → Add to Home Screen"
// hint instead — otherwise an iPhone user sees no way to install at all.
test.describe('on iOS Safari', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });

  test('the install button is replaced by the Share-sheet hint', async ({ page }) => {
    await load(page);
    // No programmatic install prompt exists on iOS, so no button…
    await expect(page.locator('#install-btn')).toBeHidden();
    // …but the manual route is surfaced instead.
    await expect(page.locator('#ios-install-hint')).toBeVisible();
    await expect(page.locator('#ios-install-hint')).toContainText(/Add to Home Screen/i);
  });
});
