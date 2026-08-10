#!/usr/bin/env node
// ============================================================
// News fetch — Node fallback / preview tool
// ============================================================
// The command-line mirror of supabase/functions/news-fetch. Fetches the
// NEWS_SOURCES feeds, parses + dedupes them through the shared, unit-tested
// scripts/news-lib.mjs, and prints the resulting `news` rows as JSON. A tool,
// not a check: it needs network (the feeds must be reachable) and is deliberately
// outside `npm test`. Production ingestion is the Edge Function + pg_cron; use
// this to preview what the feeds yield, or verify a source before adding it.
//
//   node scripts/news-fetch.mjs            # fetch all sources, print rows
//   node scripts/news-fetch.mjs --source r/PokeInvesting
//
// Only headline + link + source + timestamp is extracted — never article bodies.
// ============================================================

import { parseFeed, buildNewsRows, NEWS_SOURCES } from './news-lib.mjs';

const UA = 'sealedanalytics-news/1.0 (+https://sealedanalytics.eu)';
const only = (() => { const i = process.argv.indexOf('--source'); return i >= 0 ? process.argv[i + 1] : null; })();

async function fetchFeed(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, */*' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(to); }
}

const chosen = NEWS_SOURCES.filter((s) => !only || s.source === only);
const sources = [];
for (const s of chosen) {
  try {
    const items = parseFeed(await fetchFeed(s.url));
    sources.push({ ...s, items });
    console.error(`✓ ${s.source} (${s.category}): ${items.length} items`);
  } catch (e) {
    console.error(`✕ ${s.source} (${s.category}): ${e.message}`);
    sources.push({ ...s, items: [] });
  }
}

const rows = buildNewsRows(sources);
console.log(JSON.stringify(rows, null, 2));
console.error(`\n${rows.length} deduped news rows (TCG-first, capped per category).`);
