// ============================================================
// News ingestion core — pure, dependency-free
// ============================================================
// The analytical companion feed: Pokémon TCG (priority), TCG investing, and
// Pokémon-business/owner-company headlines. Browsers can't fetch third-party
// RSS (no CORS), so a scheduled server job fetches the feeds and writes rows to
// the `news` table; the client just reads that table. This module is the parse +
// relevance + dedupe core of that job.
//
// It is imported by scripts/news-fetch.mjs (the Node fallback / one-off runner)
// and its logic is MIRRORED by supabase/functions/news-fetch/index.ts (the Deno
// Edge Function that pg_cron runs). Keeping it pure and Node-only-API-free means
// the same code runs in Deno and stays unit-tested here — no derived behaviour
// ships without a test (tests/unit/news-lib.test.mjs).
//
// Only headline + link + source + timestamp are extracted — never article
// bodies (RSS/copyright norm: link out, don't republish).

// Decode the handful of XML/HTML entities that show up in feed titles, and strip
// CDATA wrappers. Deliberately small — feeds are not arbitrary HTML.
export function decodeEntities(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&#160;|&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstTag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

// Atom <link>: prefer rel="alternate" (the human page), else the first href.
function atomLink(block) {
  const alt = block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i)
           || block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  return any ? any[1] : null;
}

function toISO(s) {
  if (!s) return null;
  const d = new Date(String(s).trim());
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Parse an RSS 2.0 or Atom feed string into normalised items:
//   [{ title, url, published }]   (published = ISO string or null)
// Handles both formats in one pass and tolerates missing dates.
export function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const items = [];
  for (const b of xml.match(/<item\b[\s\S]*?<\/item>/gi) || []) {   // RSS 2.0
    const title = firstTag(b, 'title');
    const url   = firstTag(b, 'link');
    const pub   = firstTag(b, 'pubDate') || firstTag(b, 'dc:date') || firstTag(b, 'published');
    if (title && url) items.push({ title, url: url.trim(), published: toISO(pub) });
  }
  for (const b of xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []) {  // Atom
    const title = firstTag(b, 'title');
    const url   = atomLink(b);
    const pub   = firstTag(b, 'updated') || firstTag(b, 'published');
    if (title && url) items.push({ title, url: url.trim(), published: toISO(pub) });
  }
  return items;
}

// Strip tracking params + trailing slash + case so the same story arriving from
// two feeds (e.g. a primary source and a Google News wrapper of it) dedupes.
export function normaliseUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url).trim());
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_|^oc$|^ref$|^ref_src$|^cmpid$|^guccounter$/i.test(k)) u.searchParams.delete(k);
    }
    return (u.origin + u.pathname.replace(/\/+$/, '') + (u.search || '')).toLowerCase();
  } catch {
    return String(url).trim().toLowerCase().replace(/\/+$/, '');
  }
}

// Relevance guard for *broad* feeds (a generic hobby feed, or a future non-
// Pokémon-scoped source). The v1 sources are all Pokémon-scoped at the query,
// so they set scoped:true and skip this — but it's the gate any broad source
// (e.g. a sports-heavy card-news feed) must pass, and it is unit-tested so it's
// ready when one is added.
export const POKEMON_KEYWORDS = [
  'pokemon', 'pokémon', 'tcg', 'booster', 'elite trainer', 'etb',
  'the pokemon company', 'pokemon company', 'pokémon company',
];

export function isRelevant(title, keywords = POKEMON_KEYWORDS) {
  const t = String(title || '').toLowerCase();
  return keywords.some(k => t.includes(k));
}

// Combine parsed items from every source into deduped, newest-first news rows,
// capped per category so one chatty feed can't crowd out the others.
//   sources: [{ source, category, scoped, items:[{title,url,published}] }]
//   -> [{ source, category, title, url, published_at }]
export function buildNewsRows(sources, opts = {}) {
  const { keywords = POKEMON_KEYWORDS, limitPerCategory = 40 } = opts;
  const seen = new Set();
  const rows = [];
  for (const s of sources || []) {
    for (const it of s.items || []) {
      if (!it || !it.title || !it.url) continue;
      if (!s.scoped && !isRelevant(it.title, keywords)) continue;
      const key = normaliseUrl(it.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        source: s.source, category: s.category,
        title: it.title, url: it.url,
        published_at: it.published || null,
      });
    }
  }
  // Newest first; rows with no date sort last (empty string < any ISO date).
  rows.sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
  const perCat = {};
  const capped = [];
  for (const r of rows) {
    perCat[r.category] = (perCat[r.category] || 0) + 1;
    if (perCat[r.category] <= limitPerCategory) capped.push(r);
  }
  return capped;
}

// The v1 source set — TCG is the priority. `scoped:true` means the feed is
// already Pokémon-targeted (a dedicated site or a Pokémon-locked query) so it
// skips the relevance filter. The Edge Function and the Node runner both read
// this list. cron-fetched hourly. VERIFY each URL against a live network before
// relying on it — this sandbox can't reach them.
export const NEWS_SOURCES = [
  // 1 — Pokémon TCG (priority): dedicated daily TCG news…
  { source: 'PokéGuardian', category: 'tcg', scoped: true, kind: 'rss',
    url: 'https://www.pokeguardian.com/articles?format=rss' },
  // …hardened by a Google News safety net so the priority category always fills
  // even if the dedicated feed path drifts.
  { source: 'Google News', category: 'tcg', scoped: true, kind: 'gnews',
    url: 'https://news.google.com/rss/search?q=%22Pokemon+TCG%22+OR+%22Pokemon+cards%22&hl=en-US&gl=US&ceid=US:en' },
  // 2 — TCG investing: the community that discusses card values & buy-timing.
  { source: 'r/PokeInvesting', category: 'investing', scoped: true, kind: 'reddit',
    url: 'https://www.reddit.com/r/PokeInvesting/.rss' },
  // 3 — Pokémon business / owner-company results.
  { source: 'Google News', category: 'business', scoped: true, kind: 'gnews',
    url: 'https://news.google.com/rss/search?q=%22Pokemon+Company%22+(earnings+OR+revenue+OR+financial)+OR+(Nintendo+earnings)&hl=en-US&gl=US&ceid=US:en' },
];

// Category display order + labels — TCG first everywhere (the stated priority).
export const NEWS_CATEGORIES = [
  { key: 'tcg',       label: 'Pokémon TCG' },
  { key: 'investing', label: 'Investing' },
  { key: 'business',  label: 'Business' },
];
