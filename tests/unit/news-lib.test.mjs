// ============================================================
// News ingestion core — unit tests
// ============================================================
// Pins scripts/news-lib.mjs: the RSS/Atom parse, URL normalisation, the
// relevance guard, and the combine/dedup/cap that produces the `news` rows. The
// Deno Edge Function mirrors this logic, so these assertions guard the numbers/
// behaviour the scheduled job writes — the same discipline as cardmarket-lib.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeed, decodeEntities, normaliseUrl, isRelevant, buildNewsRows,
} from '../../scripts/news-lib.mjs';

// ── parseFeed: RSS 2.0 ──
test('parseFeed reads RSS 2.0 items (title, link, pubDate) incl. CDATA', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <title>Feed</title>
    <item><title><![CDATA[Prismatic Evolutions revealed]]></title>
      <link>https://ex.com/a</link><pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate></item>
    <item><title>Set list &amp; leaks</title>
      <link>https://ex.com/b</link><pubDate>Tue, 04 Aug 2026 09:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Prismatic Evolutions revealed');
  assert.equal(items[0].url, 'https://ex.com/a');
  assert.equal(items[0].published, '2026-08-05T10:00:00.000Z');
  assert.equal(items[1].title, 'Set list & leaks');       // &amp; decoded
});

// ── parseFeed: Atom (Reddit's format) ──
test('parseFeed reads Atom entries, preferring the alternate link', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Is now a good time to buy?</title>
      <link rel="alternate" href="https://reddit.com/r/x/1"/>
      <link rel="self" href="https://reddit.com/self"/>
      <updated>2026-08-05T12:00:00Z</updated></entry>
  </feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://reddit.com/r/x/1');   // alternate, not self
  assert.equal(items[0].published, '2026-08-05T12:00:00.000Z');
});

test('parseFeed tolerates a missing/blank date and bad input', () => {
  const items = parseFeed('<rss><channel><item><title>No date</title><link>https://ex.com/z</link></item></channel></rss>');
  assert.equal(items[0].published, null);
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed(null), []);
});

test('decodeEntities unwraps CDATA and common entities', () => {
  assert.equal(decodeEntities('<![CDATA[Sword &amp; Shield]]>'), 'Sword & Shield');
  assert.equal(decodeEntities('Trainer&#8217;s Toolkit'), 'Trainer’s Toolkit');
});

// ── normaliseUrl: dedup key ──
test('normaliseUrl strips tracking params + trailing slash + case', () => {
  assert.equal(
    normaliseUrl('https://Ex.com/Article/?utm_source=rss&utm_medium=feed'),
    'https://ex.com/article');
  assert.equal(normaliseUrl('https://ex.com/a/'), normaliseUrl('https://ex.com/a'));
  assert.equal(normaliseUrl('https://ex.com/a?id=7'), 'https://ex.com/a?id=7'); // real params kept
});

// ── relevance guard (for broad, non-scoped feeds) ──
test('isRelevant matches Pokémon/TCG terms, rejects unrelated', () => {
  assert.equal(isRelevant('New Pokémon TCG set announced'), true);
  assert.equal(isRelevant('The Pokemon Company posts record revenue'), true);
  assert.equal(isRelevant('2026 Topps baseball rookie card checklist'), false);
});

// ── buildNewsRows: combine, filter, dedup, sort, cap ──
test('buildNewsRows dedups across sources, keeps newest first', () => {
  const sources = [
    { source: 'PokéGuardian', category: 'tcg', scoped: true, items: [
      { title: 'A', url: 'https://a.com/1', published: '2026-08-01T00:00:00Z' },
      { title: 'B', url: 'https://b.com/2', published: '2026-08-03T00:00:00Z' },
    ]},
    { source: 'Google News', category: 'tcg', scoped: true, items: [
      { title: 'B (echo)', url: 'https://b.com/2/?utm_source=x', published: '2026-08-03T00:00:00Z' }, // dup of B
      { title: 'C', url: 'https://c.com/3', published: '2026-08-05T00:00:00Z' },
    ]},
  ];
  const rows = buildNewsRows(sources);
  assert.deepEqual(rows.map(r => r.title), ['C', 'B', 'A']); // newest first, echo dropped
  assert.equal(rows.length, 3);
});

test('buildNewsRows drops off-topic items only from NON-scoped sources', () => {
  const sources = [
    { source: 'Broad', category: 'investing', scoped: false, items: [
      { title: 'Pokémon card index up 40%', url: 'https://x.com/1', published: '2026-08-02T00:00:00Z' },
      { title: 'NBA jersey patch auction', url: 'https://x.com/2', published: '2026-08-02T00:00:00Z' },
    ]},
    { source: 'Reddit', category: 'investing', scoped: true, items: [
      { title: 'Off-topic but scoped source keeps it', url: 'https://y.com/9', published: '2026-08-04T00:00:00Z' },
    ]},
  ];
  const rows = buildNewsRows(sources);
  const urls = rows.map(r => r.url);
  assert.ok(urls.includes('https://x.com/1'));   // relevant, kept
  assert.ok(!urls.includes('https://x.com/2'));  // off-topic on a broad feed, dropped
  assert.ok(urls.includes('https://y.com/9'));   // scoped source bypasses the filter
});

test('buildNewsRows caps per category', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    title: `n${i}`, url: `https://ex.com/${i}`, published: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }));
  const rows = buildNewsRows([{ source: 'S', category: 'tcg', scoped: true, items }], { limitPerCategory: 3 });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.title), ['n9', 'n8', 'n7']); // newest 3
});
