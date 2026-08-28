// Unit tests for the backup workbook writer (scripts/export-backup.mjs).
// Guards the contract: the produced workbook must satisfy the same sheet/column
// names parseXlsx()/validate-workbook.mjs enforce, and must round-trip back in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildWorkbook } from '../../scripts/export-backup.mjs';

const products = [
  { name: 'Alpha Box', type: 'BOX', release: '2023-01-01', packs: null,
    cardmarket_product_id: 111, cardmarket_expansion_id: 222,
    cardmarket_promo_product_ids: null, price_locked: false,
    cardmarket_url: 'https://example.com/alpha' },
  { name: 'Beta ETB', type: 'ETB', release: '2024-06-01', packs: null,
    cardmarket_product_id: 333, cardmarket_expansion_id: 444,
    cardmarket_promo_product_ids: [555, 556], price_locked: true,
    cardmarket_url: null },
  { name: 'Gamma Collection', type: 'COLLECTION', release: '2025-02-01', packs: 5,
    cardmarket_product_id: null, cardmarket_expansion_id: null,
    cardmarket_promo_product_ids: null, price_locked: false, cardmarket_url: null },
];
const snapshots = [
  { product_name: 'Alpha Box', snapshot_date: '2026-08-01', price: 200, set_value: 500,
    promo_value: null, low_liquidity: false, price_avg: 205, price_low: 150 },
  { product_name: 'Beta ETB', snapshot_date: '2026-08-01', price: 90, set_value: 800,
    promo_value: 12.5, low_liquidity: true, price_avg: 95, price_low: 60 },
  { product_name: 'Gamma Collection', snapshot_date: '2026-08-01', price: 40, set_value: 120,
    promo_value: null, low_liquidity: false, price_avg: null, price_low: null },
];

function roundTrip(wb) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return XLSX.read(buf, { type: 'buffer', cellDates: true });
}

test('produces the three contract sheets', () => {
  const wb = roundTrip(buildWorkbook(products, snapshots));
  assert.ok(wb.Sheets['Summary'], 'Summary sheet');
  assert.ok(wb.Sheets['Historical Data'], 'Historical Data sheet');
  assert.ok(wb.Sheets['Links'], 'Links sheet (one product has a URL)');
});

test('Summary carries the contract + restore-critical columns', () => {
  const wb = roundTrip(buildWorkbook(products, snapshots));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Summary']);
  assert.equal(rows.length, 3);
  const alpha = rows.find((r) => r['Product'] === 'Alpha Box');
  assert.equal(alpha['Type'], 'BOX');
  assert.equal(alpha['Release Date'], '2023-01-01');
  assert.equal(alpha['CM ID'], 111);
  assert.equal(alpha['Exp ID'], 222);
  const beta = rows.find((r) => r['Product'] === 'Beta ETB');
  assert.equal(beta['Promo IDs'], '555,556');   // multi-promo list preserved
  assert.equal(beta['Price Locked'], 'TRUE');    // lock preserved
  const gamma = rows.find((r) => r['Product'] === 'Gamma Collection');
  assert.equal(gamma['Packs'], 5);               // variable-pack COLLECTION override
});

test('Historical Data carries price/set-value/promo + fidelity columns', () => {
  const wb = roundTrip(buildWorkbook(products, snapshots));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Historical Data']);
  assert.equal(rows.length, 3);
  const beta = rows.find((r) => r['Product'] === 'Beta ETB');
  assert.equal(beta['Price (€)'], 90);
  assert.equal(beta['Set Value (€)'], 800);
  assert.equal(beta['Promo Value (€)'], 12.5);
  assert.equal(beta['Low Liquidity'], 'TRUE');
  assert.equal(beta['Price Avg (€)'], 95);
});

test('Links has one row per product with a URL', () => {
  const wb = roundTrip(buildWorkbook(products, snapshots));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Links']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Product'], 'Alpha Box');
  assert.equal(rows[0]['URL'], 'https://example.com/alpha');
});

test('no Links sheet when no product has a URL', () => {
  const noUrls = products.map((p) => ({ ...p, cardmarket_url: null }));
  const wb = roundTrip(buildWorkbook(noUrls, snapshots));
  assert.equal(wb.Sheets['Links'], undefined);
});
