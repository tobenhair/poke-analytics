// ============================================================
// Catalogue-scale measurement harness (dev-only, not a CI spec)
// ============================================================
// Answers one question with numbers instead of intuition: how do the board and
// charts behave as the catalogue grows? Deliberately NOT wired into `npm test`
// — it is a tool you run when you want the measurements, not a gate (its
// timings are machine-dependent and would flake in CI).
//
// Method (the cheapest honest one):
//   1. Generate contract-valid fixtures with scripts/gen-scale-fixture.mjs.
//   2. Serve a temp directory holding index.html + metrics.js + the fixture
//      renamed to pokemon_data.xlsx, so the real page loads the real way.
//   3. Patch the served index.html to (a) blank SUPABASE_CONFIG — forcing the
//      static/xlsx path, exactly as tests/smoke.spec.mjs does — and (b) wrap the
//      render functions with performance.now() timers that push into
//      window.__perf. The wrappers rename the original declaration and shadow
//      it; both hoist, so injecting at the top of the module is enough.
//   4. Drive interactions *in-page* (the click is dispatched inside
//      page.evaluate and timed there), so a measurement is the handler's real
//      synchronous cost and not Playwright's round-trip latency.
//   5. Report medians over several repeats.
//
// Chart.js and SheetJS are served from node_modules (the pinned CDN versions)
// so no network variance leaks into the numbers.
//
// Usage:
//   npm run scale:measure                    # the default matrix
//   node scripts/measure-scale.mjs --matrix 36x24,400x24 --repeats 7
//   node scripts/measure-scale.mjs --json out.json
//
// A cell is written "NxM" = N products × M snapshots. Cadence is monthly up to
// 36 snapshots and daily beyond (365 monthly snapshots would imply a 30-year
// history; daily is also what automated ingestion would actually produce).
// ============================================================

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};

// Default matrix: the N axis at fixed M (board/scatter/relative-value/momentum
// growth), then the M axis at fixed N (series length — the shape automated
// ingestion would create). 36x24 is the baseline: today's catalogue size.
const MATRIX  = String(arg('matrix', '36x24,200x24,400x24,36x120,36x365,400x365'))
  .split(',').map((s) => s.trim()).filter(Boolean);
const REPEATS = parseInt(arg('repeats', '5'), 10);
const JSON_OUT = arg('json', null);

// Functions worth timing individually. All are module-scoped declarations in
// index.html, each declared exactly once (asserted below — a rename upstream
// must fail loudly here rather than silently measuring nothing).
const TIMED = [
  'applyNewData', 'recomputeFit', 'updateKPIs', 'updateTable', 'updateTopPicks',
  'renderSVBChart', 'renderScatterChart', 'renderRelativeValue', 'renderMomentum',
  'initScenario', 'renderPortfolio', 'renderAlerts', 'updateLastUpdated',
  'openDrill', 'renderEntryTable',
];

// Same local-library routing the e2e specs use — keeps CDN latency (and CDN
// outages) out of the measurements.
const { routeLocalLibs } = await import(join(root, 'tests/local-cdn.mjs'));

// ── Patch index.html: static mode + timing wrappers ──
function patchIndex(html) {
  let out = html
    .replace(/url:\s*'[^']*'/, "url: ''")
    .replace(/anonKey:\s*'[^']*'/, "anonKey: ''");

  for (const fn of TIMED) {
    const decl = `function ${fn}(`;
    const count = out.split(decl).length - 1;
    if (count !== 1) {
      throw new Error(`Expected exactly one "${decl}" declaration in index.html, found ${count}. ` +
        `The function was renamed or removed — update TIMED in scripts/measure-scale.mjs.`);
    }
    out = out.replace(decl, `function __orig_${fn}(`);
  }

  const wrappers = TIMED.map((fn) => (
    `function ${fn}(...a){const t0=performance.now();try{return __orig_${fn}.apply(this,a);}` +
    `finally{window.__perf.push({fn:${JSON.stringify(fn)},ms:performance.now()-t0});}}`
  )).join('\n');

  // Injected at the top of the main module. Function declarations hoist, so the
  // wrapper and the renamed original are both defined before any call site.
  const marker = '<script type="module">';
  const at = out.indexOf(marker);
  if (at < 0) throw new Error('Could not find the main <script type="module"> in index.html');
  return out.slice(0, at + marker.length) +
    `\n/* injected by scripts/measure-scale.mjs */\nwindow.__perf = window.__perf || [];\n${wrappers}\n` +
    out.slice(at + marker.length);
}

// ── Tiny static server over a directory ──
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
function serve(dir) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = join(dir, path === '/' ? 'index.html' : path);
    if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const spread = (xs) => {          // max deviation from the median, as a %
  const m = median(xs);
  return m ? Math.max(...xs.map((x) => Math.abs(x - m))) / m * 100 : 0;
};
const fmt = (v) => (v == null ? '—' : v >= 100 ? v.toFixed(0) : v.toFixed(1));

// ── One cell of the matrix ──
async function measureCell(browser, workdir, cell) {
  const [N, M] = cell.split('x').map(Number);
  const cadence = M <= 36 ? 'monthly' : 'daily';
  const fixture = join(workdir, `fixture-${cell}.xlsx`);

  execFileSync('node', [join(root, 'scripts/gen-scale-fixture.mjs'),
    '--products', String(N), '--snapshots', String(M),
    '--cadence', cadence, '--out', fixture], { stdio: 'pipe' });
  // The fixture must satisfy the same contract the app enforces, or the page
  // silently falls back to sample data and every number below is a lie.
  execFileSync('node', [join(root, 'scripts/validate-workbook.mjs'), fixture], { stdio: 'pipe' });
  copyFileSync(fixture, join(workdir, 'pokemon_data.xlsx'));

  const { server, port } = await serve(workdir);
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await routeLocalLibs(page);

  try {
    // ── Cold load: navigation → the board actually has rows ──
    const t0 = performance.now();
    await page.goto(`http://127.0.0.1:${port}/?admin=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('.tab-btn[data-tab="analysis"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#product-tbody tr').length > 1, null, { timeout: 120_000 });
    const coldLoadMs = performance.now() - t0;

    const rows = await page.locator('#product-tbody tr').count();
    if (rows < Math.min(N, 2)) throw new Error(`board rendered ${rows} rows for N=${N} — fell back to sample data?`);

    // Per-function costs of the one real applyNewData() the load performed.
    const load = await page.evaluate(() => window.__perf.slice());

    // ── Interactions, timed in-page, repeated ──
    // Each interaction is a *fixed* transition: `prep` puts the page into an
    // identical starting state (untimed), then `action` performs and times the
    // one thing being measured. Varying the target between repeats (BOX vs ALL
    // vs ETB) would compare different amounts of work and report the variance
    // as noise. One warm-up pass is run and discarded — the first call pays for
    // lazy chart/DOM setup that a returning user never pays again.
    //
    // `action` flushes style+layout inside the timed region (see FLUSH below).
    // Without it the numbers are meaningless: innerHTML writes return in
    // microseconds and the real cost lands in the browser's next layout pass,
    // outside the timer. What we report is the main-thread block the user
    // actually feels. Chart.js's *animation* frames stay outside it — the
    // dataset rebuild and first draw are synchronous and are captured.
    const run = async (label, prep, action) => {
      await page.evaluate(prep);
      await page.evaluate(action);            // warm-up, discarded
      const samples = [];
      const perFn = new Map();
      for (let i = 0; i < REPEATS; i++) {
        await page.evaluate(prep);
        await page.waitForTimeout(120);       // let Chart.js animation settle
        const { ms, perf } = await page.evaluate(action);
        samples.push(ms);
        for (const e of perf) perFn.set(e.fn, (perFn.get(e.fn) || 0) + e.ms / REPEATS);
      }
      return {
        label, median: median(samples), spread: spread(samples), samples,
        perFn: Object.fromEntries([...perFn].sort((a, b) => b[1] - a[1])),
      };
    };

    // Injected into every action: clear the timing buffer, time the click, and
    // force a synchronous style+layout flush so deferred DOM work is counted.
    const FLUSH = 'document.body.offsetHeight;';

    const interactions = [];
    // Type filter: re-renders the board + every analytical chart via visibleProducts().
    interactions.push(await run('type filter (ALL→BOX)',
      () => { document.querySelector('#type-filters .pill[data-type="ALL"]').click(); },
      new Function(`window.__perf.length = 0;
        const el = document.querySelector('#type-filters .pill[data-type="BOX"]');
        const t = performance.now(); el.click(); ${FLUSH}
        return { ms: performance.now() - t, perf: window.__perf.slice() };`)));
    // Sort change: board rebuild only (no chart work).
    interactions.push(await run('sort change (score→price-asc)',
      () => { const s = document.getElementById('sort-select'); s.value = 'score'; s.dispatchEvent(new Event('change')); },
      new Function(`window.__perf.length = 0;
        const s = document.getElementById('sort-select'); s.value = 'price-asc';
        const t = performance.now(); s.dispatchEvent(new Event('change')); ${FLUSH}
        return { ms: performance.now() - t, perf: window.__perf.slice() };`)));
    // Board search: the per-keystroke path — filter + full tbody rebuild.
    interactions.push(await run('board search keystroke',
      () => { const el = document.getElementById('board-search'); el.value = ''; el.dispatchEvent(new Event('input')); },
      new Function(`window.__perf.length = 0;
        const el = document.getElementById('board-search'); el.value = 'Booster';
        const t = performance.now(); el.dispatchEvent(new Event('input')); ${FLUSH}
        return { ms: performance.now() - t, perf: window.__perf.slice() };`)));
    // Drill-down: one product, one screen, its own chart.
    interactions.push(await run('drill-down open',
      () => { document.querySelector('#drill-modal')?.classList.remove('open'); },
      new Function(`window.__perf.length = 0;
        const row = document.querySelector('#product-tbody tr');
        const t = performance.now(); row.click(); ${FLUSH}
        return { ms: performance.now() - t, perf: window.__perf.slice() };`)));
    // Tab switch to Data Entry: renders the full entry grid (N rows of inputs).
    interactions.push(await run('tab switch → Data Entry',
      () => { document.querySelector('.tab-btn[data-tab="analysis"]').click(); },
      new Function(`window.__perf.length = 0;
        const btn = document.querySelector('.tab-btn[data-tab="entry"]');
        const t = performance.now(); btn.click(); ${FLUSH}
        return { ms: performance.now() - t, perf: window.__perf.slice() };`)));

    return { cell, N, M, cadence, coldLoadMs, rows, load, interactions, pageErrors };
  } finally {
    await page.close();
    server.close();
  }
}

// ── Main ──
const workdir = mkdtempSync(join(tmpdir(), 'poke-scale-'));
copyFileSync(join(root, 'metrics.js'), join(workdir, 'metrics.js'));
writeFileSync(join(workdir, 'index.html'), patchIndex(readFileSync(join(root, 'index.html'), 'utf8')));

const browser = await chromium.launch(
  process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {},
);

const results = [];
try {
  for (const cell of MATRIX) {
    process.stderr.write(`measuring ${cell} … `);
    const r = await measureCell(browser, workdir, cell);
    results.push(r);
    process.stderr.write(`cold load ${fmt(r.coldLoadMs)} ms\n`);
  }
} finally {
  await browser.close();
}

// ── Report ──
// NOTE on attribution: during a cold load most render functions run *twice* —
// once from the INIT block against the hardcoded fallback data, then again from
// applyNewData() once the workbook has parsed. Totals below are the sum of all
// calls during the load (with the call count), which is what the load actually
// costs; applyNewData's own figure already contains the render calls it makes,
// so the columns overlap by design and must not be added together.
const loadStat = (r, fns) => {
  const hits = r.load.filter((e) => fns.includes(e.fn));
  if (!hits.length) return { ms: null, calls: 0 };
  return { ms: hits.reduce((a, e) => a + e.ms, 0), calls: hits.length };
};
const cell = (r, fns) => {
  const { ms, calls } = loadStat(r, fns);
  return ms == null ? '—' : `${fmt(ms)}${calls > 1 ? ` (${calls}×)` : ''}`;
};
const CHART_FNS = ['renderSVBChart', 'renderScatterChart', 'renderRelativeValue', 'renderMomentum'];

console.log(`\n## Cold load (ms; N products × M snapshots)\n`);
console.log('| Cell | Cadence | Rows | Nav → board | applyNewData¹ | updateTable | charts² |');
console.log('|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.cell} | ${r.cadence} | ${r.rows} | ${fmt(r.coldLoadMs)} | ${cell(r, ['applyNewData'])} | ` +
    `${cell(r, ['updateTable'])} | ${cell(r, CHART_FNS)} |`);
}
console.log('\n¹ inclusive — contains the render calls it makes, so columns overlap and must not be summed.');
console.log('² renderSVBChart + renderScatterChart + renderRelativeValue + renderMomentum. "(n×)" = calls during load');
console.log('  (INIT renders the fallback data first, then applyNewData re-renders the workbook).\n');
console.log(`## Interactions (median of ${REPEATS}, ms; includes a forced style+layout flush)\n`);

console.log('| Cell | ' + results[0].interactions.map((i) => i.label).join(' | ') + ' |');
console.log('|---|' + results[0].interactions.map(() => '---|').join(''));
for (const r of results) {
  console.log(`| ${r.cell} | ` + r.interactions.map((i) => `${fmt(i.median)}`).join(' | ') + ' |');
}

console.log('\n### Where interaction time goes (mean ms per call, top 3)\n');
for (const r of results) {
  for (const i of r.interactions) {
    const top = Object.entries(i.perFn).slice(0, 3).map(([f, ms]) => `${f} ${fmt(ms)}`).join(', ');
    if (top) console.log(`- ${r.cell} · ${i.label}: ${top}`);
  }
}

console.log('\n### Reproducibility (max deviation from median, per interaction)\n');
for (const r of results) {
  const worst = Math.max(...r.interactions.map((i) => i.spread));
  const worstLabel = r.interactions.find((i) => i.spread === worst)?.label;
  console.log(`- ${r.cell}: worst ±${worst.toFixed(0)}% (${worstLabel})${worst > 10 ? '  ⚠ above the ±10% bar' : ''}`);
}

const errs = results.flatMap((r) => r.pageErrors.map((e) => `${r.cell}: ${e}`));
if (errs.length) {
  console.log('\n### ⚠ Uncaught page errors\n');
  errs.forEach((e) => console.log(`- ${e}`));
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), repeats: REPEATS, results }, null, 2));
  console.log(`\nRaw samples → ${JSON_OUT}`);
}
