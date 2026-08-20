// ============================================================
// Dead-code checker for index.html
// ============================================================
// The Jul 2026 audit found 14 unused CSS rules, element IDs and functions that
// had accumulated with nobody noticing — in a single 5,200-line file, dead
// weight is invisible until someone goes looking. This makes that check
// permanent so the next one is caught the day it lands.
//
// Usage:
//   npm run check:dead-code          # exits 1 if anything is unreferenced
//   node scripts/check-dead-code.mjs --verbose
//
// ── How it decides ──
// index.html builds DOM from string templates, so a name can be "used" from
// markup, from a CSS rule, or from a JS string literal. The checker counts
// occurrences across the whole file and subtracts the declaration itself; a
// remainder of zero means nothing references it.
//
// ── The trap this must not fall into ──
// Some names are ASSEMBLED AT RUNTIME and are invisible to any textual scan:
//
//   `type-${typeCategory(...)}` → .type-BOX / .type-ETB / .type-BUNDLE / .type-COLLECTION / .type-PACK
//   'tab-' + btn.dataset.tab    → #tab-welcome / #tab-analysis / …
//
// Those are load-bearing (CLAUDE.md's "preserve these" list is exactly this
// set) and a naive checker reports them as dead. Deleting one silently breaks
// rendering — the failure this tool is supposed to prevent. So:
//
//   1. CONSTRUCTED below is an explicit allowlist of runtime-built patterns.
//   2. This tool REPORTS. It never edits. A human decides every deletion.
//   3. A false positive is a bug in the checker, not a nudge to delete code —
//      if a name is dynamic, add it to CONSTRUCTED with a note saying where it
//      is built. A checker that cries wolf gets muted, and a muted checker is
//      worse than none.
// ============================================================

import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.find((a) => a.endsWith('.html')) || join(root, 'index.html');
const VERBOSE = process.argv.includes('--verbose');

const html = readFileSync(FILE, 'utf8');

// Regions: a class used only inside <style> is still dead; used in markup or a
// JS template literal, it is alive.
const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const scriptBlocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const markup = html
  .replace(/<style>[\s\S]*?<\/style>/g, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

// ── Allowlist: names assembled at runtime ──
// Each entry says WHERE the name is built, so the next reader can verify the
// claim instead of trusting it. Keep this list short and justified — it is the
// checker's blind spot by construction.
const CONSTRUCTED = [
  { pattern: /^type-(BOX|ETB|BUNDLE|COLLECTION|PACK)$/, why: 'built as `type-${typeCategory(...)}` in typeBadge() and the row templates (PACK = the neutral single-pack tint, COLLECTION = the variable-pack purple tint)' },
  { pattern: /^tab-(welcome|analysis|portfolio|entry)$/, why: "built as `'tab-' + btn.dataset.tab` by the tab switcher" },
  { pattern: /^grp-(era|set)$/, why: 'built as `grp-${level}` in groupRow() for the grouped board’s Era/Set headline rows' },
];
const constructedReason = (name) => CONSTRUCTED.find((c) => c.pattern.test(name))?.why;

// Count non-overlapping occurrences of a literal substring.
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

const findings = [];
const allowed = [];

// ── 1. CSS classes defined but never applied ──
// Selectors only; a class that appears in markup or JS (including inside a
// template literal) is live.
const cssClasses = new Set([...styleBlocks.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
for (const cls of [...cssClasses].sort()) {
  if (count(markup, cls) + count(scriptBlocks, cls) > 0) continue;
  const why = constructedReason(cls);
  if (why) { allowed.push({ kind: 'class', name: `.${cls}`, why }); continue; }
  findings.push({ kind: 'CSS class', name: `.${cls}`, hint: 'no markup or JS applies it' });
}

// ── 2. Empty rules ── a rule with no declarations styles nothing.
// Skip selectors already reported above; one dead thing, one line.
for (const m of styleBlocks.matchAll(/([^{}]+)\{\s*\}/g)) {
  const selector = m[1].trim();
  if (findings.some((f) => f.name === selector)) continue;
  findings.push({ kind: 'empty rule', name: selector, hint: 'declares nothing' });
}

// ── 3. Element IDs nothing refers to ──
// Referenced from JS ('id' / "id" / #id), CSS (#id), or markup's own
// relationship attributes (label/for, aria-*, href anchors).
const ids = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
for (const id of [...ids].sort()) {
  const refs =
    count(scriptBlocks, `'${id}'`) + count(scriptBlocks, `"${id}"`) + count(scriptBlocks, `#${id}`) +
    count(styleBlocks, `#${id}`) +
    count(markup, `href="#${id}"`) + count(markup, `for="${id}"`) + count(markup, `list="${id}"`) +
    count(markup, `form="${id}"`) + count(markup, `aria-labelledby="${id}"`) +
    count(markup, `aria-describedby="${id}"`) + count(markup, `aria-controls="${id}"`);
  if (refs > 0) continue;
  const why = constructedReason(id);
  if (why) { allowed.push({ kind: 'id', name: `#${id}`, why }); continue; }
  findings.push({ kind: 'element ID', name: `#${id}`, hint: 'declared but never referenced' });
}

// ── 4. Functions declared but never called ──
// Named function *expressions* (e.g. the `(async function boot(){…})()` IIFE)
// are declarations that call themselves, so only match statement position.
const fnNames = new Set([...scriptBlocks.matchAll(/(?:^|\n)\s*function\s+([A-Za-z0-9_$]+)\s*\(/g)].map((m) => m[1]));
for (const fn of [...fnNames].sort()) {
  const declarations = count(scriptBlocks, `function ${fn}(`);
  const total = count(scriptBlocks, fn) + count(markup, fn);
  if (total - declarations > 0) continue;
  findings.push({ kind: 'function', name: `${fn}()`, hint: 'declared but never called' });
}

// ── Report ──
if (VERBOSE && allowed.length) {
  console.log(`ℹ ${allowed.length} name(s) skipped as runtime-constructed:`);
  for (const a of allowed) console.log(`  • ${a.name} — ${a.why}`);
  console.log('');
}

if (!findings.length) {
  console.log(`✓ No dead code found in ${basename(FILE)}.`);
  console.log(`  ${cssClasses.size} CSS classes · ${ids.size} element IDs · ${fnNames.size} functions` +
    (allowed.length ? ` · ${allowed.length} runtime-constructed name(s) allowlisted` : ''));
  process.exit(0);
}

console.error(`✕ ${findings.length} unreferenced item${findings.length === 1 ? '' : 's'} in ${basename(FILE)}:\n`);
for (const f of findings) console.error(`  • ${f.kind}: ${f.name} — ${f.hint}`);
console.error(
  '\nEach is either genuinely dead (delete it) or built at runtime (add it to ' +
  'CONSTRUCTED in scripts/check-dead-code.mjs, with a note saying where).\n' +
  'This tool never edits your code — deleting is always a human decision.',
);
process.exit(1);
