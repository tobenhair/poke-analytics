#!/usr/bin/env node
// ============================================================
// Design-token guard
// ============================================================
// The July 2026 visual review found the build had drifted from its own design
// system in a way no checklist catches: a *second* colour palette hard-coded in
// the chart JavaScript (#4fc3f7 beside the token's #5cc7f2 on the same screen),
// and 36 font sizes where a scale should have ~11. Neither is a bug a reviewer
// spots — each new literal is individually reasonable, and the drift is only
// visible in aggregate.
//
// So this is the aggregate view, run on every push. Two rules:
//
//   1. Colour literals live in :root. A hex anywhere else is either a token
//      that was re-typed (the drift) or a genuine exception (the allowlist).
//   2. font-size uses a scale token. A raw rem/px value is how 36 steps
//      happened.
//
// Same discipline as check-dead-code.mjs: it only ever *reports*. Deleting or
// tokenising is a human decision, and a false positive is a bug here, not a
// licence to change the page.
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'index.html';
const src = readFileSync(join(root, FILE), 'utf8');

// Colours that are deliberately not tokens. Each needs a reason — if you can't
// write one, it belongs in :root instead.
const ALLOWED_COLOURS = new Map([
  ['#b39ddb', 'COMPARE_PALETTE series 4 — the token set has no fourth hue'],
  ['#e8975a', 'COMPARE_PALETTE series 5 — as above'],
  ['#e5789f', 'COMPARE_PALETTE series 6 — as above'],
  ['#e8a0a0', 'account/auth message text: a lighter --accent2 for small text on its own tinted panel'],
  ['#9fd9ad', 'account/auth message text: a lighter --accent4, same reason'],
  ['#2c303c', 'scrollbar thumb hover — one step above --border, not a semantic colour'],
  ['#f5a623', 'Welcome hero gradient. Decorative accent use; ROADMAP\'s "bring Welcome onto the section pattern" removes it'],
]);

// Strip comments first: this file's own documentation names the literals it
// replaced, and a guard that flags its own explanation is a nuisance.
const stripped = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const rootBlock = stripped.slice(stripped.indexOf(':root {'), stripped.indexOf('}', stripped.indexOf(':root {')));
const tokenColours = new Set([...rootBlock.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));

const lines = stripped.split('\n');
const findings = [];

lines.forEach((line, i) => {
  const n = i + 1;
  if (line.includes('--') && /^\s*--[a-z-]+:/.test(line)) return;   // a token definition

  for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = m[0].toLowerCase();
    if (tokenColours.has(hex) || ALLOWED_COLOURS.has(hex)) continue;
    findings.push({ line: n, kind: 'colour', text: hex, hint: 'use a :root token, or add it to ALLOWED_COLOURS with a reason' });
  }
  for (const m of line.matchAll(/font-size:\s*([^;"'}\s]+)/g)) {
    if (m[1].startsWith('var(')) continue;
    findings.push({ line: n, kind: 'font-size', text: m[1], hint: 'use a --text-* / --display-* step' });
  }
});

// Re-typed tokens are the worst case: the same colour, a different literal.
const retyped = findings.filter((f) => f.kind === 'colour' && tokenColours.has(f.text));

if (!findings.length) {
  console.log(`✓ No off-token colours or font sizes in ${FILE}.`);
  console.log(`  ${tokenColours.size} colour tokens · ${ALLOWED_COLOURS.size} documented exception(s)`);
  process.exit(0);
}

console.log(`✕ ${findings.length} off-token value(s) in ${FILE}:\n`);
for (const f of findings) {
  console.log(`  ${FILE}:${f.line}  ${f.kind}: ${f.text}`);
  console.log(`      ${f.hint}`);
}
if (retyped.length) {
  console.log('\n  Note: some of these are token values typed out again — exactly the');
  console.log('  drift this guard exists to catch. Use the token.');
}
console.log('\nThis tool only reports. Fixing is a human decision; a false positive is a bug here.');
process.exit(1);
