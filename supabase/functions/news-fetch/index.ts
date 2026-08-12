// ============================================================
// News fetch — Supabase Edge Function
// ============================================================
// Scheduled by pg_cron → pg_net (see supabase/news-cron.sql). Browsers can't
// fetch third-party RSS (no CORS), so this server job does it: fetch each feed,
// parse RSS/Atom, keep only Pokémon-relevant headlines, dedupe, and upsert into
// public.news. The client only reads that table.
//
// Parse + relevance + dedupe logic MIRRORS scripts/news-lib.mjs (pinned by
// tests/unit/news-lib.test.mjs) — keep the two in sync, same discipline as
// cardmarket-daily ↔ cardmarket-lib. Only headline + link + source + timestamp
// is stored, never article bodies (RSS/copyright norm).
//
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional INGEST_SECRET — when set, the caller must send it as x-ingest-secret.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// The User-Agent is per-source and it matters: Reddit REQUIRES a unique
// descriptive agent (it 429s blank/generic ones), while Google News REJECTS bot
// agents from datacenter IPs with HTTP 503 and wants a browser one. So each
// source picks its UA (Source.ua), defaulting to the browser string.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FEED_UA = 'sealedanalytics-news/1.0 (+https://sealedanalytics.eu)';
const RETENTION_DAYS = 60;

type Source = { source: string; category: 'tcg' | 'investing' | 'business'; scoped: boolean; url: string; ua?: string };

// The v1 source set — TCG is the priority. scoped:true = already Pokémon-locked
// (dedicated site or a Pokémon query) so it skips the relevance filter.
const NEWS_SOURCES: Source[] = [
  // Dedicated TCG news (PokéBeach) via a GitHub Pages mirror — static hosting,
  // so no datacenter 503 and no UA sensitivity. The reliable, non-Google primary.
  { source: 'PokéBeach',       category: 'tcg',       scoped: true, url: 'https://kaprestridge.github.io/pokebeach-news-feed/feed.xml' },
  // Google News safety net so the priority category always fills. Needs a browser UA.
  { source: 'Google News',     category: 'tcg',       scoped: true, url: 'https://news.google.com/rss/search?q=%22Pokemon+TCG%22+OR+%22Pokemon+cards%22&hl=en-US&gl=US&ceid=US:en' },
  // Reddit keeps the descriptive UA — a browser one gets 429'd here.
  { source: 'r/PokeInvesting', category: 'investing', scoped: true, url: 'https://www.reddit.com/r/PokeInvesting/.rss', ua: FEED_UA },
  // Broadened past earnings-only (which rarely had fresh items) to Pokémon-
  // business generally; every clause names Pokémon/TPC so it stays on-topic
  // despite scoped:true (no relevance filter).
  { source: 'Google News',     category: 'business',  scoped: true, url: 'https://news.google.com/rss/search?q=%22Pokemon+Company%22+OR+%22The+Pokemon+Company%22+OR+(Pokemon+revenue)+OR+(Pokemon+sales)+OR+(Pokemon+earnings)+OR+(Pokemon+business)+OR+(Pokemon+Nintendo)&hl=en-US&gl=US&ceid=US:en' },
];

const POKEMON_KEYWORDS = ['pokemon', 'pokémon', 'tcg', 'booster', 'elite trainer', 'etb', 'pokemon company', 'pokémon company'];

// ── parse + normalise (mirror of scripts/news-lib.mjs) ──
function decodeEntities(s: string): string {
  if (s == null) return '';
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘').replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&#160;|&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}
function firstTag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}
function atomLink(block: string): string | null {
  const alt = block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i)
           || block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  return any ? any[1] : null;
}
function toISO(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(String(s).trim());
  return isNaN(d.getTime()) ? null : d.toISOString();
}
type Item = { title: string; url: string; published: string | null };
function parseFeed(xml: string): Item[] {
  if (!xml) return [];
  const items: Item[] = [];
  for (const b of xml.match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const title = firstTag(b, 'title'); const url = firstTag(b, 'link');
    const pub = firstTag(b, 'pubDate') || firstTag(b, 'dc:date') || firstTag(b, 'published');
    if (title && url) items.push({ title, url: url.trim(), published: toISO(pub) });
  }
  for (const b of xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []) {
    const title = firstTag(b, 'title'); const url = atomLink(b);
    const pub = firstTag(b, 'updated') || firstTag(b, 'published');
    if (title && url) items.push({ title, url: url.trim(), published: toISO(pub) });
  }
  return items;
}
function normaliseUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(String(url).trim());
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^oc$|^ref$|^ref_src$|^cmpid$|^guccounter$/i.test(k)) u.searchParams.delete(k);
    return (u.origin + u.pathname.replace(/\/+$/, '') + (u.search || '')).toLowerCase();
  } catch { return String(url).trim().toLowerCase().replace(/\/+$/, ''); }
}
function isRelevant(title: string): boolean {
  const t = String(title || '').toLowerCase();
  return POKEMON_KEYWORDS.some((k) => t.includes(k));
}

async function fetchFeed(url: string, ua: string): Promise<string> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: {
      'User-Agent': ua,
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(to); }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('INGEST_SECRET');
  if (secret && req.headers.get('x-ingest-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  const perSource: Record<string, number | string> = {};

  for (const s of NEWS_SOURCES) {
    try {
      const items = parseFeed(await fetchFeed(s.url, s.ua ?? BROWSER_UA));
      let kept = 0;
      for (const it of items) {
        if (!it.title || !it.url) continue;
        if (!s.scoped && !isRelevant(it.title)) continue;
        const key = normaliseUrl(it.url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push({ source: s.source, category: s.category, title: it.title.slice(0, 400), url: it.url.slice(0, 600), published_at: it.published });
        kept++;
      }
      perSource[`${s.source}:${s.category}`] = kept;
    } catch (e) {
      // Isolate failures — one dead feed must not abort the run.
      perSource[`${s.source}:${s.category}`] = `error: ${(e as Error).message}`;
    }
  }

  let upserted = 0;
  if (rows.length) {
    const { error } = await supabase.from('news').upsert(rows, { onConflict: 'url', ignoreDuplicates: false });
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message, perSource }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    upserted = rows.length;
  }
  // Prune old rows so the table stays small.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
  await supabase.from('news').delete().lt('published_at', cutoff);

  return new Response(JSON.stringify({ ok: true, upserted, perSource }), { headers: { 'Content-Type': 'application/json' } });
});
