// ============================================================
// Workbook contract validator (CI + local)
// ============================================================
// Parses pokemon_data.xlsx and asserts the exact same contract the app's
// parseXlsx() + deriveProducts() enforce at runtime (index.html). The point:
// if a column is renamed, a Type is misspelled, a product loses its history,
// or a date is malformed, the live app silently rejects the workbook and
// falls back to hardcoded sample data. This script turns that silent fallback
// into a loud, blocking CI failure.
//
// Usage:
//   npm install          # installs xlsx
//   npm run validate     # validates ./pokemon_data.xlsx
//   node scripts/validate-workbook.mjs [path/to/workbook.xlsx]
//
// Exits 0 with a summary on success, 1 with a list of errors on failure.
// Keep this in sync with parseXlsx()/deriveProducts() in index.html.
// ============================================================

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const XLSX_PATH = process.argv[2] || 'pokemon_data.xlsx';

// Mirror of index.html's col(): first non-empty candidate column wins.
const col = (row, ...candidates) => {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== null && row[c] !== '') return row[c];
  }
  return null;
};

const isValidDate = (str) => !isNaN(new Date(str).getTime());
const toISO = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

const errors = [];

let wb;
try {
  wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer', cellDates: true });
} catch (e) {
  console.error(`✕ Could not read workbook at "${XLSX_PATH}": ${e.message}`);
  process.exit(1);
}

// ── Required sheets ──
if (!wb.Sheets['Summary']) {
  errors.push('Missing sheet named "Summary" — the tab name must be exactly "Summary"');
}
if (!wb.Sheets['Historical Data']) {
  errors.push('Missing sheet named "Historical Data" — the tab name must be exactly "Historical Data"');
}
if (errors.length) fail();

// ── Sheet 1: Summary ──
const summaryRows = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { defval: null });
if (!summaryRows.length) errors.push('Summary sheet has no data rows');
if (errors.length) fail();

const seenNames = new Set();
const productTypes = new Map(); // name -> TYPE

summaryRows.forEach((row, i) => {
  const rowNum = i + 2;
  const name = col(row, 'Product');
  const type = col(row, 'Type');
  const rawRelease = col(row, 'Release Date');
  const label = name ? `"${name}"` : `row ${rowNum}`;

  if (!name || String(name).trim() === '') {
    errors.push(`Summary row ${rowNum}: missing Product name`);
  } else if (seenNames.has(name)) {
    errors.push(`Summary row ${rowNum}: duplicate Product name "${name}" — each product must appear only once`);
  } else {
    seenNames.add(name);
  }

  if (!type) {
    errors.push(`Summary ${label}: missing Type — must be BOX, ETB, or BUNDLE`);
  } else if (!['BOX', 'ETB', 'BUNDLE'].includes(String(type).toUpperCase())) {
    errors.push(`Summary ${label}: invalid Type "${type}" — must be exactly BOX, ETB, or BUNDLE`);
  } else if (name) {
    productTypes.set(String(name).trim(), String(type).toUpperCase());
  }

  if (!rawRelease) {
    errors.push(`Summary ${label}: missing Release Date`);
  } else if (!isValidDate(toISO(rawRelease))) {
    errors.push(`Summary ${label}: Release Date "${rawRelease}" is not a valid date`);
  }
});
if (errors.length) fail();

// ── Sheet 2: Historical Data ──
const histRows = XLSX.utils.sheet_to_json(wb.Sheets['Historical Data'], { defval: null });
if (!histRows.length) errors.push('Historical Data sheet has no data rows');
if (errors.length) fail();

const histNames = new Set();
const latestPrice = new Map();  // name -> has a non-null price
const latestSetVal = new Map(); // name -> has a non-null set value
const snapshotDates = new Set();

histRows.forEach((row, i) => {
  const rowNum = i + 2;
  const name = col(row, 'Product');
  const date = col(row, 'Snapshot Date', 'Date');
  const price = col(row, 'Price (€)', 'Price');
  const sv = col(row, 'Set Value (€)', 'Set Value');

  if (!name && !date) return; // fully blank row, skipped like the app does

  if (!name) { errors.push(`Historical Data row ${rowNum}: missing Product name`); return; }
  if (!date) { errors.push(`Historical Data row ${rowNum}: missing Snapshot Date for "${name}"`); return; }

  if (price !== null && (isNaN(parseFloat(price)) || parseFloat(price) < 0)) {
    errors.push(`Historical Data row ${rowNum} ("${name}"): Price must be a non-negative number (got "${price}")`);
  }
  if (sv !== null && (isNaN(parseFloat(sv)) || parseFloat(sv) < 0)) {
    errors.push(`Historical Data row ${rowNum} ("${name}"): Set Value must be a non-negative number (got "${sv}")`);
  }

  const trimmed = String(name).trim();
  histNames.add(trimmed);
  snapshotDates.add(toISO(date));
  if (price !== null && !isNaN(parseFloat(price))) latestPrice.set(trimmed, true);
  if (sv !== null && !isNaN(parseFloat(sv))) latestSetVal.set(trimmed, true);
});

// ── Cross-checks (mirror parseXlsx) ──
seenNames.forEach((name) => {
  const trimmed = String(name).trim();
  if (!histNames.has(trimmed)) {
    errors.push(`"${name}" is in Summary but has no rows in Historical Data`);
  }
});
histNames.forEach((name) => {
  if (![...seenNames].map((n) => String(n).trim()).includes(name)) {
    errors.push(`Historical Data contains "${name}" which does not exist in Summary`);
  }
});

// ── Derivation checks (mirror deriveProducts) ──
// Every product needs a usable latest Price and Set Value, else it renders
// blank / gets dropped from the value metrics.
seenNames.forEach((name) => {
  const trimmed = String(name).trim();
  if (histNames.has(trimmed)) {
    if (!latestPrice.get(trimmed)) errors.push(`"${name}": no valid Price found in Historical Data`);
    if (!latestSetVal.get(trimmed)) errors.push(`"${name}": no valid Set Value found in Historical Data`);
  }
});

if (errors.length) fail();

console.log('✓ Workbook is valid.');
console.log(`  ${seenNames.size} products · ${histRows.length} history rows · ${snapshotDates.size} snapshot dates`);
process.exit(0);

function fail() {
  console.error(`✕ ${XLSX_PATH} failed validation (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n`);
  errors.forEach((e) => console.error(`  • ${e}`));
  console.error('\nFix the workbook and re-run. See the "Format Guide" modal in the app or README for the required columns.');
  process.exit(1);
}
