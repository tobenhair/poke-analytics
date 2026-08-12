# Sealed-product photos — sourcing & rights research (2026-08)

**Status:** research complete → recommendation below. Supersedes the "still
parked / no clean automated source" note in `IMPLEMENTATION.md` item 9 by
*explaining why* and giving a buildable path. Not legal advice; a real
commercial launch with third-party imagery warrants a lawyer's review.

**The item.** Show a photo of each tracked sealed product (Booster Box / ETB /
Booster Bundle) — box art in the drill-down, maybe a thumbnail on the board — to
make the dashboard look like a finished product rather than a spreadsheet. The
prior investigation concluded "no clean automated source" and left it parked.
This pass pressure-tested that conclusion against every plausible source and
found it is **correct, but for a sharper reason than 'the images don't exist'** —
and that the reason points to a concrete, low-risk way to ship it anyway.

---

## TL;DR — the one-paragraph answer

The sealed-product images **do exist** in machine-readable feeds (TCGplayer's
catalogue, mirrored free by TCGCSV, has a clean white-background photo of nearly
every product we track, at a predictable URL). The blocker was never
availability — it is that **no reachable feed holds redistributable *image*
rights it can pass to us.** Data can be licensed; the pictures cannot. Every
automated route resolves to one of two owners: **TPCi** (official art —
non-commercial licence only) or a **marketplace/aggregator** (photos it doesn't
own and its ToS forbids us reusing commercially). Because our catalogue is
**tiny and slow-growing (~40–80 sealed products, one image each)**, the honest
answer is not an API at all: **self-host a curated image per product in Supabase
Storage** (admin uploads it once, exactly like they already enter the CM ID),
sourced from first-party/own photography or a properly-licensed set — with a
**generated "set-identity" placeholder** (colour chip + type badge + the set
logo we already show) as the zero-rights fallback and the default until a real
image is uploaded. That is the only route that survives the project's stated
goal of eventual commercialisation.

---

## What changed vs. the last investigation

The 2026-08 note in `IMPLEMENTATION.md` framed this as "the card APIs don't carry
sealed photos and marketplaces restrict their images." Both halves are confirmed,
but the picture is now more useful:

1. **Sealed photos are widely available via TCGplayer's catalogue** (through the
   free TCGCSV mirror), at a hotlinkable CDN URL — so "no source" was imprecise.
   The real problem is **rights, not existence**.
2. **The data-vs-image rights split is the whole story.** Several vendors will
   sell a *commercial data licence* (PriceCharting, PokemonPriceTracker Business,
   JustTCG). None of those licences convey rights to the **product images**,
   which they do not author or own.
3. **TCGdex — our current set-logo source — is now definitively ruled out for
   sealed photos.** Its data model (checked against the live schema) has
   `Serie`, `Set`, `Card`, `variants`, `Filter` and nothing else: **no sealed /
   box / product interface, and no box imagery.** It gives set logos and card
   scans only. Good for the logo we already ship; a dead end for this item.
4. **Enforcement posture is now on the record and it is adverse to *funded*
   projects specifically** (see Legal, below) — which matters because
   commercialisation is a stated goal.

---

## Source-by-source findings

Ranked by how close each comes to a *clean, commercial, automated* image source.
None reaches it; the table is really a map of *why*.

| Source | Sealed photos? | Automated? | Commercial image rights? | Verdict |
|---|---|---|---|---|
| **TCGplayer catalogue via TCGCSV** | ✅ clean, near-complete | ✅ free/$1-mo mirror, stable URL | ❌ TCGplayer ToS forbids commercial/third-party reuse of their content & graphics | Best *technical* route; **not rights-clean** |
| **PriceCharting API** | ✅ (tracks sealed) | ✅ (token) | ⚠️ licences *pricing data* for "business use"; images are marketplace/user-sourced, **not** licensed for redisplay | Data-clean, **image-ambiguous** |
| **PokemonPriceTracker** | ✅ sealed prices + images | ✅ ($99/mo Business = commercial) | ⚠️ commercial licence covers **their data**; images appear to reference TCGplayer — rights not theirs to grant | Data-clean, **image-ambiguous** |
| **JustTCG** | ⚠️ tracks `sealed_count`; images unclear | ✅ (paid tiers carry commercial licence) | ⚠️ same caveat — pricing licence ≠ image licence | Pricing tool, not an image source |
| **eBay Browse API** | ✅ per-listing seller photos | ✅ (needs eBay Partner Network) | ⚠️ usable only *within the app while linking out* to the live listing; images are transient, inconsistent, watermarked | Only as "buy" thumbnails, not catalogue art |
| **Amazon PA-API** | ✅ | ⚠️ Associate-gated, **deprecating 2026-05-15** → Creators API | ⚠️ must fetch live, no re-hosting, tied to affiliate links | Fragile; sunsetting |
| **Cardmarket** (our price source) | image field exists on REST `Product` | ❌ **API closed to new applicants**; bulk files we use are price/id only, **no image**; presentation needs "prior written agreement" | ❌ | Dead despite our existing `idProduct` map |
| **Official pokemon.com product gallery** | ✅ authoritative art | ⚠️ scrapeable, not a feed | ❌ **non-commercial licence only**, no brand-in-product-name, no logo-as-most-prominent | Cleanest art, **wrong licence** |
| **TCGdex** (our logo source) | ❌ no sealed model at all | ✅ | ✅ for logos | Confirmed dead for this item |
| **pokemontcg.io** | ❌ cards only | ✅ | — | No sealed imagery |
| **Wikimedia Commons** | ✗ effectively none | ✅ | ✅ if it existed | No usable coverage of sealed box art |

### The one that almost works: TCGplayer via TCGCSV

- **Coverage & quality:** TCGplayer catalogues virtually every sealed SKU we
  track, with consistent, cropped, white-background studio photography — exactly
  the "professional" look the item is after.
- **Access:** [TCGCSV](https://tcgcsv.com/) is a free (or $1/mo) public mirror of
  TCGplayer's categories/groups/products/prices as CSV **and** JSON; the product
  records expose an `imageUrl`. We already know each product's identity, so
  matching is trivial.
- **URL format** (no auth needed to *load* the image):
  `https://tcgplayer-cdn.tcgplayer.com/product/{productId}_200w.jpg` — swap the
  suffix for `_in_1000x1000` for a larger render.
- **Why it still isn't clean:** the bytes are **TCGplayer's catalogue images on
  TCGplayer's CDN.** [TCGplayer's ToS](https://help.tcgplayer.com/hc/en-us/articles/205004918-Terms-of-Service)
  prohibits distributing their content "to end users or third parties for
  commercial or competitive purposes" and using their graphics "outside of
  TCGplayer without express written permission," and bars scraping outside the
  (now-closed) API. TCGCSV is itself a tolerated grey-area mirror; **it cannot
  grant image rights it does not hold.** Hotlinking these into a *commercial*
  analytics product is the same rights posture as Cardmarket/TCGplayer — common
  in hobby tools, but not defensible once money is charged.

**Bottom line on automation:** the closest automated source is rights-unclean;
the rights-clean source (official art) is non-commercial. There is no cell in the
matrix that is simultaneously automated, commercial, and image-rights-clean.

---

## Legal analysis (why the matrix has no clean cell)

- **Two rights, and product photos trip fewer of them than logos.** Box art is
  **copyright** (TPCi, or the photographer for a marketplace photo). "Pokémon,"
  the Poké Ball and set logos are also **trademark**. A *product photo used to
  identify the product* leans on **nominative fair use** on the trademark side —
  the doctrine that lets a comparison/review site name and depict a product to
  describe or compare it. Its three prongs
  ([INTA](https://www.inta.org/fact-sheets/fair-use-of-trademarks-intended-for-a-non-legal-audience/),
  [Wikipedia](https://en.wikipedia.org/wiki/Nominative_use)) — product not
  identifiable without the mark; use only as much as necessary; no implied
  sponsorship — **fit this app well**, and the test "applies even if the use is
  commercial." That helps the *trademark* half.
- **But nominative fair use is a *trademark* doctrine, not copyright.** It does
  **not** authorise reproducing the copyrighted **box artwork** itself. Copying
  the photograph is a separate question governed by copyright fair use
  (fact-specific, four-factor) or a licence. This is the crux: identifying the
  product by name/logo is defensible; **re-hosting someone's photo of the box is
  not something a disclaimer or nominative use fixes.**
- **TPCi's own terms rule out the official art for us.** The
  [Assets Use Terms](https://press.pokemon.com/en/Assets-Use-Terms) grant a
  licence "strictly to non-commercial uses" and state "in no event are you
  authorized to commercialize the Content… by… charging a fee for access to it,"
  and forbid brand use "in the name of your business, product, service, app,
  domain name." A paid tier hosting their art is outside what they permit.
- **Enforcement is real and is keyed to funding.** TPCi runs an aggressive DMCA
  program against fan projects (e.g. the 2024 Relic Castle takedown —
  [Kotaku](https://kotaku.com/pokemon-fan-games-relic-castle-shutdown-dmca-reason-1851359618),
  [Nintendo Life](https://www.nintendolife.com/news/2024/03/pokemon-fan-game-site-relic-castle-shut-down-following-dmca-takedown-notice)).
  Most pointedly, former TPCi chief legal officer Don McGowan has described the
  process as waiting "to see if they get funded" and engaging **once a project is
  funded.** For a tool whose roadmap explicitly plans commercialisation, that is
  the exact trigger to design around: a free/personal hobby build hotlinking
  images sits in the tolerated grey zone; **the moment it charges, the risk
  profile changes qualitatively.**
- **Transferable safe tactics (already partly adopted):** keep "Pokémon" out of
  the product/app/domain name; carry the non-affiliation + attribution notice
  (already in the footer); **prefer first-party or user-supplied imagery** over
  re-hosting publisher/marketplace art; stay image-light where a badge does the
  job.

---

## The reframe that unblocks it: the catalogue is small

Everything above assumes we need an *automated pipeline* because the catalogue is
large — the mental model inherited from **card** imagery (tens of thousands of
scans). But this app tracks **sealed products**, and there are only about
**40–80 of them**, growing by a handful per set release a few times a year. At
that size:

- A **one-image-per-product manual step is entirely tractable** — it is the same
  cadence and the same surface as entering a product's CM ID / Exp ID in Data
  Entry, which the admin already does per product.
- **Self-hosting** (Supabase Storage — already in the stack, already how
  everything else persists) removes every third-party-CDN dependency, hotlink
  fragility, and most of the rights exposure in one move.
- The **rights question collapses to "where did this one image come from,"** and
  the clean answers are available at this scale: **own photography** of a box the
  maintainer holds (maintainer authors the copyright), or a **properly-licensed /
  permission-granted image**. Both are impractical for 20 000 cards and trivial
  for 40 boxes.

This is the difference between the card-image problem (genuinely needs a licensed
feed) and the sealed-image problem (small enough to curate).

---

## Recommendation — phased, ship the safe core first

**Phase 0 — Generated set-identity placeholder (zero third-party rights).**
Build the image slot as a first-class piece of the drill-down (and optionally a
board thumbnail), but have its **default** render a designed identity, not a
photo: the **set logo we already fetch from TCGdex** (rights-clean for logos) on
a **type-coloured card** (`CATEGORY_COLOR`) with the **type badge** and set
name — the existing dark-system components, no new palette. This alone makes the
product look finished, carries **zero** copyright exposure, and is the permanent
fallback for any product without an uploaded photo. *Design-review + it reuses
tokens; nothing new invented.*

**Phase 1 — Self-hosted curated photo per product (the "real photo" path).**
Add an optional `image_path` (or `image_url`) to the `products` table and a
**Data Entry image upload** next to the CM ID / Exp ID fields, writing to a
**Supabase Storage** bucket (public-read, admin-write via the existing
`is_admin()` RLS pattern). The drill-down shows the uploaded photo when present,
else the Phase-0 identity. Source the images from **first-party photography or
licensed/permitted stock** — never re-hosted TPCi/marketplace art in the
commercial build. Guard exactly like the set logo: hidden until `onload`, never a
broken image, `drillProduct`-guarded against late loads.

**Deliberately *not* recommended for the commercial build:**
- Hotlinking **TCGplayer/TCGCSV** or **Cardmarket** CDN images — rights-unclean
  once we charge, and hotlinks rot when the vendor rewrites URLs.
- Hosting **official pokemon.com** art — non-commercial licence, explicit bar on
  charging for access.
- **eBay/Amazon** affiliate images — transient, inconsistent, tied to live
  listings; fine only as a "view listing" thumbnail, not catalogue identity.

**If a fully-automated real-photo catalogue is ever wanted anyway** (e.g. a
free/non-commercial deployment, or before any paywall exists): the TCGCSV →
`tcgplayer-cdn` route is the pragmatic choice, hotlinked (not re-hosted) with the
non-affiliation notice — accepting the documented grey-zone risk. It should be a
conscious, reversible decision, and it must be **turned off before the product
charges money**, per the McGowan-funding trigger.

**Open commercial-clean path (out of scope to build now):** a direct licensing
enquiry to TPCi or a paid asset licence is the only route that survives
commercialisation with *official* art. Price it before committing to real box art
in a paid tier; otherwise Phase 0 + first-party Phase 1 is the launch answer.

---

## Suggested next step

Ship **Phase 0** as the near-term roadmap item — it is pure UI over data we
already have (TCGdex logos + type/category tokens), carries no rights risk, and
delivers most of the "looks like a product" win. File Phase 1 (schema + Storage
upload) as the follow-up, and keep the licensing enquiry parked until a paid tier
is concretely on the table.

---

## Sources

- [TCGCSV](https://tcgcsv.com/) · [TCGCSV docs](https://tcgcsv.com/docs)
- [TCGplayer Terms of Service](https://help.tcgplayer.com/hc/en-us/articles/205004918-Terms-of-Service) · [TCGplayer API Terms & Conditions](https://help.tcgplayer.com/hc/en-us/articles/360061115874-TCGplayer-API-Terms-Conditions)
- [Cardmarket RESTful API 2.0 — Product entity](https://api.cardmarket.com/ws/documentation/API_2.0:Entities:Product) · [Cardmarket API help (access closed)](https://help.cardmarket.com/en/cardmarket-api)
- [PriceCharting API documentation](https://www.pricecharting.com/api-documentation) · [PriceCharting Terms of Service](https://www.pricecharting.com/page/terms-of-service)
- [PokemonPriceTracker pricing](https://www.pokemonpricetracker.com/pricing) · [PokemonPriceTracker card API](https://www.pokemonpricetracker.com/pokemon-card-api)
- [JustTCG docs](https://justtcg.com/docs)
- [eBay API License Agreement](https://developer.ebay.com/join/api-license-agreement) · [eBay Browse API — Image type](https://developer.ebay.com/api-docs/buy/browse/types/gct:Image)
- [Amazon PA-API 5.0 — Images](https://webservices.amazon.com/paapi5/documentation/images.html) · [PA-API License Agreement](https://webservices.amazon.com/paapi5/documentation/read-la.html)
- [TCGdex interfaces (cards-database)](https://github.com/tcgdex/cards-database/blob/master/interfaces.d.ts) · [TCGdex FAQ](https://tcgdex.dev/faq)
- [pokemontcg.io migration/images](https://docs.pokemontcg.io/getting-started/migration/)
- [Pokémon Assets Use Terms](https://press.pokemon.com/en/Assets-Use-Terms) · [Pokémon Support — using images](https://support.pokemon.com/hc/en-us/articles/360000634094)
- [Pokémon TCG Product Gallery](https://www.pokemon.com/us/pokemon-tcg/product-gallery)
- Nominative fair use: [INTA](https://www.inta.org/fact-sheets/fair-use-of-trademarks-intended-for-a-non-legal-audience/) · [Wikipedia](https://en.wikipedia.org/wiki/Nominative_use)
- TPCi enforcement: [Kotaku (Relic Castle)](https://kotaku.com/pokemon-fan-games-relic-castle-shutdown-dmca-reason-1851359618) · [Nintendo Life](https://www.nintendolife.com/news/2024/03/pokemon-fan-game-site-relic-castle-shut-down-following-dmca-takedown-notice) · [Techdirt](https://www.techdirt.com/2024/03/28/site-that-listed-information-about-3rd-party-pokemon-fan-games-shuts-down-under-threat/)
