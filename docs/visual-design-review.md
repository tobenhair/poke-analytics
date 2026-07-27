# Visual design & consistency review — July 2026

> **Status (Jul 2026, after the token pass).** A dated snapshot; the findings
> below are left as written. **Shipped since:** V1 (the chart palette now
> resolves the tokens at runtime, and ~30 further re-typed literals went with
> it), V2 (11 named type steps; 36 rendered sizes → 11), V4 (`--radius-pill` /
> `--radius-sm` / `--radius`), V5 (`font: inherit` — Arial is gone), V8 (the decision went to an **SVG
> set**, now shipped: 15 symbols in one inline sprite, `currentColor`
> throughout), V6 and V7 (Welcome now uses `.section-eyebrow`, the hero shares the `h1`
> treatment, and the card titles are `--text` rather than category tints), V10
> (`--medal-bronze`, plus `--medal-silver`). The document's own process
> suggestion also shipped: **`npm run check:design-tokens`** now fails the build
> on a non-token colour literal or a raw `font-size`. **Still open:** V3 (the
> remaining inline `style` attributes — the *colour* and *font-size* ones are
> now tokenised, but the attributes themselves remain) and V9 (gold
> over-subscribed). All tracked in `ROADMAP.md`.

The third and last of the July reviews, covering what the other two explicitly
excluded. [`ux-assessment.md`](ux-assessment.md) measured journeys and density;
[`ux-expert-review.md`](ux-expert-review.md) covered WCAG conformance and
usability heuristics. Both said, in as many words, *"the aesthetic is not under
review"*. This document reviews the aesthetic.

The angle that makes this objective rather than a matter of taste: **this repo
documents its own design system** (`.claude/skills/design-review/SKILL.md` — the
token set, three fonts and their roles, the component vocabulary, and fixed
colour meanings). So the question is not "is this attractive" but **"does the
built product match the system it says it has"** — which is measurable.

> **The headline:** the *designed* system is genuinely good — a disciplined dark
> palette, sensible colour semantics, one strong display face, a coherent panel
> vocabulary. The *built* product has drifted from it in a specific, traceable
> way: **240 inline `style` attributes and a second, near-duplicate colour
> palette living in the chart JavaScript.** The gap between the two is the
> finding. Nothing here is a redesign; it is reconciliation.

## Method

Every element in the Welcome, Analysis and Data Entry tabs was walked at
1440×900 and its *computed* style tallied — font size, family, weight, colour,
background, radius, padding, margin, gap — then compared against the declared
tokens. The stylesheet was parsed for colour literals that are not token
definitions, and the markup for inline `style` attributes and what they set.
Screenshots of each surface were read for the judgements automation can't make
(hierarchy, iconography, rhythm).

## System as documented vs system as built

| The system says | The build has | Verdict |
|---|---|---|
| Three fonts: Bebas Neue (display), DM Mono (labels/figures), DM Sans (body) | **Four** — plus Arial on native form controls | Drift |
| A token set for colour; "a new hard-coded colour is a red flag" | **55 of 68** colour literals in the stylesheet are not token definitions; **14** distinct text colours render, of which **6** are tokens | Drift |
| `--radius: 18px` | 18px used **20** times; `8px` **75**; `999px` **242**; 9 distinct radii | Token doesn't describe reality |
| Reuse components before creating | **240** inline `style` attributes, setting `color` 96×, `font-size` 75×, `font-family` 52× | Drift |
| Colour meanings fixed: gold = primary, green = positive, red = negative, blue = neutral | Held in the data views; **broken on the Welcome cards**, where accents are arbitrary category colours | Partial |
| `.section-eyebrow` (`0N — TITLE`) introduces sections | Analysis and Portfolio comply; **Welcome does not** | Partial |

## Findings

### V1 — Two palettes for the same meanings *(highest impact)*

The charts and scoring code carry their own colours, hard-coded in JavaScript,
which are **near-duplicates** of the tokens rather than the tokens:

| Meaning | Design token | Chart/JS literal | Same? |
|---|---|---|---|
| Blue / BOX / neutral | `--accent3` `#5cc7f2` | `#4fc3f7` | No |
| Green / ETB / positive | `--accent4` `#7fd493` | `#81c784` | No |
| Gold / BUNDLE / primary | `--accent` `#f4c651` | `#f5c842` | No |
| Red / negative | `--accent2` `#ef6a60` | `#e8473f` | No |

These appear **side by side on the same screen**: a BOX badge in the board is
`#5cc7f2`, and the same product's series in the chart above it is `#4fc3f7`.
Close enough that it reads as a rendering inconsistency rather than a decision,
far enough apart to be visible. The scoring thresholds in
`scoreColour()`-style helpers use the same off-palette set.

**This is the single highest-value fix in this document**: replacing four string
literals with token lookups removes an entire class of drift, and it is the kind
of thing that silently multiplies as more charts are added.

### V2 — There is no type scale

**29 distinct font sizes** render across three tabs, and most are fractional:
12.48, 13.28, 13.12, 11.52, 10.88, 12.16, 10.56, 11.84, 13.44, 13.6, 15.2 px.
Those are the arithmetic of arbitrary `rem` values (`0.78rem`, `0.83rem`,
`0.72rem`, `0.66rem` …) chosen individually rather than drawn from a scale.

A designed scale has roughly 6–8 steps on a consistent ratio. Twenty-nine steps
means the difference between two text elements is frequently 0.16 px — a
distinction no one can perceive, carrying no meaning, but which has to be
maintained forever. **75 of those sizes are set inline**, which is how it
happened.

The fix is not to restyle the app: pick the ~7 sizes actually doing work, name
them (`--text-xs` … `--text-3xl`), and map the rest onto the nearest step.
Visually this changes almost nothing, which is the point.

### V3 — 240 inline style attributes are the drift mechanism

Not a finding on their own — the app is deliberately one file — but this is
*how* V1, V2 and V4 happened. Inline styles bypass the class system entirely,
and their top properties are exactly the system's own vocabulary:

`color` 96 · `font-size` 75 · `font-family` 52 · `padding` 40 · `text-align` 34
· `line-height` 26 · `gap` 24 · `background` 22 · `border-radius` 18

Over half the typography decisions in the app are made outside the stylesheet.
Every new one is a small, invisible vote against the design system, and the
`design-review` skill's "reuse before you create" rule cannot catch them because
they never create a *named* thing to notice.

### V4 — Spacing and radius are off-system

**19 distinct padding values, 19 margins, 13 gaps.** The dominant values (14px,
18px, 10px) are coherent, but `3px`, `7px`, `9px`, `22px`, `26px` sit off any
4- or 8-px grid. Radii: **9 distinct**, with the declared `--radius: 18px` being
only the *third* most used — `999px` (pills) and `8px` (panels/inputs) dominate.

Either the token is wrong or the usage is; today the token describes neither.
Recommend: `--radius-pill: 999px`, `--radius: 8px`, `--radius-lg: 18px`, and
retire the strays (`2px`, `10px`, `12px`, `2px 2px 0 0`).

### V5 — Native form controls fall out of the type system

Three inputs and two buttons on Analysis render in **Arial**, because
`<input>`, `<select>` and `<button>` do not inherit `font-family`. The board
search box and several controls are therefore in a different typeface from
everything around them. One `input, select, button, textarea { font: inherit }`
rule fixes the whole class.

### V6 — The Welcome tab doesn't use the app's own section pattern

Analysis and Portfolio introduce every section with `.section-eyebrow`
(`01 — THE BOARD`, mono, uppercase, numbered). Welcome uses none: it has a
centred hero, two colour-titled cards, and a plain "How it works" heading. It is
attractive, but it reads as a different product's page — and it is the first
screen most people see.

Related: the hero **"Track. Analyse. Decide."** is set in bold DM Sans while the
page `h1` uses the display face. Two different treatments for "the most
important text on screen", 300 px apart.

### V7 — Accent colours used as decoration on the Welcome cards

The card titles are *Analysis* in blue and *Data Entry* in green. In the
documented system green means **positive/good** and blue means
**neutral/secondary** — here they are arbitrary category tints. Everywhere else
in the app the semantics hold rigorously (a green figure genuinely means good),
which is exactly why the exception is costly: it teaches a first-time visitor,
on the first screen, that the colours are decorative. Recommend both titles in
`--text` and let the numbers carry the colour.

### V8 — Emoji are the icon system

👋 📊 ✏️ 💰 🔔 🔗 📋 🎴 carry navigation and state throughout. Three costs, all
real for a product intending to be shipped:

1. **They render differently on every platform.** The tab bar is Noto on Linux,
   Apple Color Emoji on iOS, Segoe on Windows — different weights, colours and
   optical sizes. The design is dark and restrained; the emoji are neither, and
   they are the only saturated multi-colour objects on the page.
2. **They cannot take a colour**, so they sit outside the token system by
   construction and can't participate in state (active/inactive tabs).
3. **Mixed vocabulary**: the header has a real custom logo mark, and every other
   "icon" is an emoji — two icon languages on one page.

This is a deliberate-looking choice and cheap to keep, so it is a *judgement*,
not a defect: emoji are friendly and zero-maintenance. But if the launch
checklist matters, a small monochrome SVG set that inherits `currentColor` would
resolve 1–3 together and let the icons finally obey the palette.

### V9 — Gold is over-subscribed

`--accent` gold carries: the wordmark, the hero, the active tab, KPI values,
section numerals, the primary button, and the "top pick" ranks. When the primary
accent marks everything, it stops marking anything. Worth auditing which of
those genuinely mean "this is the most important thing here" — most likely the
active tab and the KPI values, not the numerals and the hero as well.

### V10 — A hue outside the system

`.pick-rank.bronze` uses `#cd7f32`, a brown/bronze that exists in no token. The
medal metaphor justifies gold/silver/bronze, so this is defensible — but it
should be *declared* (`--medal-bronze`) rather than inlined, or the next reader
will treat it as another stray literal.

## What's genuinely good

Stated deliberately, and not as a courtesy — several of these are better than
the norm:

- **The palette itself.** Six accents on a near-black ground, each with a fixed
  meaning, all passing WCAG AA at every background (verified arithmetically in
  the expert review). Restrained and legible.
- **The semantics hold where they matter.** In every data view, green really
  does mean good and red really does mean poor. That discipline is why V7's
  exception stands out.
- **The panel vocabulary is consistent** — `.panel` → `.panel-header` →
  `.panel-title`, and the `.section-eyebrow` numbering, applied uniformly across
  Analysis and Portfolio.
- **The typographic *pairing* is strong** — a condensed display face against
  mono figures is exactly right for a numbers product, and using mono for all
  data is a real, correct decision that most dashboards get wrong.
- **Vertical rhythm at section scale is generous and even**, and the dark
  surface hierarchy (`--bg` → `--card` → `--bg3`) is subtle and legible.
- **The drill-down is as visually resolved as it is functionally** (both prior
  reviews said the same about its behaviour).

## Recommendations

Ordered by value-per-effort. None is a redesign; all are reconciliation.

| # | Action | Effort | Why it's worth it |
|---|---|---|---|
| 1 | **Move the chart palette onto the tokens** (V1) | XS | Four string literals; removes a whole drift class and a visible mismatch |
| 2 | **`font: inherit` on form controls** (V5) | XS | One rule; removes the fourth font family |
| 3 | **Name a type scale and map the 29 sizes onto ~7 steps** (V2) | M | Nearly invisible visually, permanently cheaper to maintain |
| 4 | **Fix the radius tokens to describe reality** (V4) | S | The token currently documents a value that is barely used |
| 5 | **Migrate inline `style` colour/font declarations into classes** (V3) | M | The mechanism behind 1–4; do it *after* 3 so there is a scale to migrate onto |
| 6 | **Bring Welcome onto the section-eyebrow pattern, and neutralise the card-title colours** (V6, V7) | S | First screen; currently teaches that colour is decorative |
| 7 | **Decide on emoji vs an SVG icon set** (V8) | M | A decision to *make*, not a defect to fix — but make it before launch |

**One process suggestion:** the `design-review` skill is good and was clearly
followed for *new components* — the drift is all in ad-hoc values, which a
checklist can't see. The `check:dead-code` script already proves this repo will
support a cheap static guard; a sibling `check:design-tokens` that fails on new
non-token colour literals and inline `font-size`/`color` declarations would hold
the line automatically. Recommend it as an item, with the same "report, never
auto-fix" discipline the dead-code checker uses.

## Limits

- **One reviewer, no design critique panel.** Visual judgement is not
  measurable, and V8 and V9 in particular are opinions supported by evidence,
  not findings.
- **Desktop only.** Phone rendering was covered by the two prior reviews; this
  pass tallied computed styles at 1440×900. Type-scale behaviour at narrow
  widths is unexamined here.
- **Three tabs.** The Portfolio tab was not walked (it needs the signed-in
  fixture, whose 4-product data would skew the tallies) — its component
  vocabulary matched Analysis on inspection in the earlier reviews, but its
  computed styles are not in these counts.
- **Chart.js internals** (grid lines, tooltips, legend styling) were not audited
  beyond the series palette.
