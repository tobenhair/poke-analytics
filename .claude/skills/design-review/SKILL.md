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
`--hairline`, `--border`, `--radius`, `--elev`, `--ease`. Colour meaning is
fixed: gold = primary/emphasis, green = good/positive, red = poor/negative,
blue = neutral/secondary. Don't introduce new hues.

**Type** — three fonts only:
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
- Motion: reveal-on-scroll (`.rv` → `.rv-in`) is a progressive enhancement —
  don't hide content without it, and respect `prefers-reduced-motion`.

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
