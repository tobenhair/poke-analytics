---
name: design-review
description: Use whenever you add or change any UI in this dashboard — markup, CSS, a new section/view/component, a modal, a table, cards, colours, or copy in index.html. Enforces the minimalist dark design system: reuse the existing tokens and components instead of inventing new ones, and actively question whether each new element earns its place and stays easy to navigate. Load BEFORE writing UI code, and review the result against the checklist before committing.
---

# Design review — keep it minimal, consistent, navigable

This app is a single self-contained `index.html`. Its look is a deliberate,
restrained **dark analytics** aesthetic. New UI must feel like it was always
part of the app — not a bolt-on. Someone has to guard that; on any UI change,
that someone is you.

## The prime directive

**Reuse before you create.** Before adding any style or element, find the
existing token or component that already does the job and use it. A new
hard-coded colour, font, spacing value, or bespoke component is a red flag —
justify it or drop it.

## The design system (what to reuse)

**CSS variables (`:root`)** — never hard-code values these cover:
`--bg`, `--bg3`, `--card`, `--text`, `--muted`, `--accent` (gold),
`--accent2` (red/negative), `--accent3` (blue), `--accent4` (green/positive),
`--hairline`, `--border`, `--elev`, `--ease`; the gold gradient ends
`--accent-hi`/`--accent-lo` and the near-blacks that sit *on* them
(`--on-accent`, `--on-accent4`); `--chart-axis` for chart chrome; the medals
(`--medal-silver`, `--medal-bronze`). Colour meaning is fixed: gold =
primary/emphasis, green = good/positive, red = poor/negative, blue =
neutral/secondary. Don't introduce new hues.

**Type scale** — 11 steps, `--text-2xs · --text-xs · --text-sm · --text-md ·
--text-lg · --text-xl · --display-xs · --display-sm · --display-md ·
--display-lg · --display-xl`. Never write a raw `font-size`; pick the nearest
step. (The build once carried 36 sizes, most of them 0.16px apart.)

**Radii** — `--radius-pill` (999px, by far the most used), `--radius-sm` (8px,
inputs and small surfaces), `--radius` (18px, the panel corner).

**Charts use the same tokens.** The JS resolves them once into `COLOR`
(`.gold/.red/.blue/.green/.muted/.axis`) and derives fills with `alpha(hue, a)`
so a fill can't drift from its line. Never type a colour into a chart config —
that is exactly how the app grew a second palette.

**`npm run check:design-tokens` enforces the two above** and fails on any hex
outside `:root` or any raw `font-size`. A genuine exception goes in its
`ALLOWED_COLOURS` map *with a written reason*.

**Icons** — the inline sprite, never emoji. `<svg class="icon" aria-hidden="true">
<use href="#i-name"/></svg>`; add a `<symbol>` rather than a one-off `<path>`.
Stroke-only on `currentColor` so it inherits its label's colour (`.icon-lg` for
standalone icons). Meaning-carrying alone → `role="img"` + `aria-label` on the
wrapper.

**Fonts** — three only:
- `Bebas Neue` — display headings (`h1`, `.panel-title`).
- `DM Mono` — labels, figures, eyebrows, badges, anything numeric/technical.
- `DM Sans` — body copy.

**Components** — introduce sections and data the app's way:
- Section header: `.section-eyebrow` (`0N — TITLE`, uppercase, mono) + an
  optional `.section-desc` explainer line. Numbered, stacked, full-width.
- Container: `.panel` → `.panel-header` (`.panel-title` + optional
  `.panel-badge`) → body. Use `.table-wrap` for tables.
- Tables: reuse `thead th`, `tbody td`, `.num` (right-aligned mono figures),
  `.product-name`, and value colouring `.val-excellent / .val-good / .val-poor`.
- Product type: `.type-badge.type-BOX/.type-ETB/.type-BUNDLE`.
- Chrome: the `header` (`.logo`/`.logo-mark`/gradient `h1`/`.subtitle`), the
  `.tab-bar`/`.tab-btn`, `.modal-overlay`/`.modal`, `.pill`.
- Prose surfaces (the demo page, the Welcome tab): `.hero-title` for the one
  headline, `.steps`/`.step`/`.step-n`/`.step-label` for a numbered three-across
  explanation, `.text-link` for a text-weight action, `.link-row` for a row of
  them, `.glossary` for a term/definition table, `.code-inline` for a filename
  in a sentence. All of these already exist in two places — adding a third
  should mean reusing them, not writing a variant.
- Motion: reveal-on-scroll (`.rv` → `.rv-in`) is a progressive enhancement —
  don't hide content without it, and respect `prefers-reduced-motion`.
- Accessibility is part of the system, not a later pass (the app is at WCAG 2.2
  AA and `tests/a11y.spec.mjs` fails if it slips):
  - Anything clickable is a real `<button>` or `<a>` — never a `<div>`/`<tr>`
    with a click handler. That was a Level-A failure here twice (board rows,
    type pills).
  - Every input/select needs a visible label or an `aria-label`; an icon-only
    button needs one too. `title` is not a label.
  - Section headings use `.section-eyebrow` on an `<h2>` and `.panel-title` on
    an `<h3>` — keep the class *and* the heading element.
  - Don't set `outline: none` and don't use `transition: all` on a control —
    both defeat the one global `:focus-visible` ring.
  - A new overlay opens through `openOverlay()`/`closeOverlay()` and carries
    `role="dialog"` + `aria-modal` + an accessible name.
  - Meaning must not ride on colour or an emoji alone — pair it with text (the
    board's verdict line is the pattern) or a `.sr-only` alternative.
  - Every control needs a **≥24×24 hit area** (WCAG 2.5.8). Where the layout
    can't grow, add `padding` and cancel it with an equal negative `margin`
    (see `.row-open`).
- A new Analysis/Portfolio section's `.section-desc` is picked up automatically
  by `initSectionDescriptions()` — write the explainer, don't add a toggle.
- Narrow screens are part of the design, not an afterthought: a new board
  column has to declare whether it is `.col-detail` (dropped below 680px, where
  the board keeps only product · price · fair price), and a chart whose height
  is a function of its *row count* needs a wrapper with a height, not an aspect
  ratio. See `CLAUDE.md` → *The board on a phone*.

## Question the aesthetics (run this checklist before committing UI)

1. **Reuse:** Did I reuse an existing component/token, or invent a new one? If
   new — is it truly necessary, and is it built from the existing tokens?
2. **Restraint:** Does this add visual weight (a new panel, colour, divider,
   font size) that isn't earning its place? Can it be removed or merged? When
   in doubt, less.
3. **Consistency:** Side by side with an existing view, does it look like the
   same app — same spacing rhythm, same header/eyebrow/panel patterns, same
   colour meanings?
4. **Navigability:** Is the hierarchy obvious at a glance? Is the primary
   action clear? Could a first-time visitor find their way without a tour?
5. **Copy:** Short, plain, lower-key. Labels in mono; no marketing fluff.
6. **Theme + responsive:** Uses the CSS variables (works with the dark theme);
   the page body never scrolls horizontally — wide content (tables, charts)
   scrolls inside its own `overflow-x:auto` container.
7. **Invariants:** Preserved JS-referenced IDs/classes and `:root` variable
   names (see `CLAUDE.md` → *Editing invariants*).

If a change fails any point, fix it or flag the trade-off explicitly — don't
let the design quietly drift.

## Verifying

There's no build/test step. Serve locally (`python3 -m http.server 8000`),
exercise the affected view, and **look at it** next to an existing section — a
screenshot comparison is the fastest way to catch drift. Only then commit.
