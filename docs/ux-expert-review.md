# Expert UX & accessibility review — July 2026

> **Status (Jul 2026, after the conformance pass).** This is a dated snapshot
> and its findings are left as written. What has since **shipped**: F1–F5, F6,
> F7, F9, F12, F14 and F17, plus the three defects this review contributed to
> *Known bugs*. The headline below — "not operable without a mouse" — no longer
> describes the build: board rows open the drill-down from a real button, the
> modals are dialogs that trap and return focus, every input is named, and the
> tab bar is an ARIA tablist. `tests/a11y.spec.mjs` is the gate that keeps it
> that way. Since then **F8** (tap targets), **F10** (the board names the fit's
> confidence in words and links the method), **F16** (password reset),
> **F11** (the board explainer, 190 words → ~100) and **F13** (section numbering,
> now Analysis-only) have shipped too. Still open: **F15** alone — all tracked in
> `ROADMAP.md`.
> Two things this review did not raise, fixed since by the demo-as-pitch pass:
> a signed-in non-admin saw a *"How it works"* heading with nothing under it,
> and the logged-out demo's set tables scroll sideways on a phone with nothing
> focusable inside them, so they could not be scrolled by keyboard at all
> (WCAG 2.1.1 — now `tabindex="0"`, guarded by a 320 px case in the spec).
> Note for whoever runs axe next: the trap this document records is worse than
> it says — `reducedMotion: 'reduce'` alone does **not** avoid it; wait on
> `document.getAnimations()` as the spec does.

A second, deeper pass over the same product. The [July journey
assessment](ux-assessment.md) walked the flows and measured density; this one
applies the standard evaluation instruments a usability specialist would bring —
**WCAG 2.2 A/AA conformance**, **Nielsen's ten heuristics**, and a **cognitive
walkthrough** of the primary task — and it **corrects two claims** the first pass
got wrong.

Read this one first. The journey assessment remains valid on density and
information architecture; where the two disagree, this document wins, and the
disagreements are listed explicitly below rather than quietly reconciled.

> **The headline:** the app's *information design* is strong — the numbers are
> right, the verdict is plain-language, the drill-down is genuinely excellent —
> but it is **not operable without a mouse**, and the surface that carries the
> product's whole answer is the one a keyboard or screen-reader user cannot
> reach. That is the single most consequential finding here, and it is a
> Level-A conformance failure, not a preference.

## Method

| Instrument | What it produced |
|---|---|
| **axe-core 4.x** (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, best-practice) | Automated rule violations per tab, at 1440×900 and 320×844 |
| **Contrast arithmetic on the design tokens** | A token-level pass/fail matrix, independent of sampling |
| **Keyboard traversal** | 30 sequential `Tab` presses, recording focus order and whether each stop shows a visible indicator |
| **Focus-trap probe** | 6 `Tab` presses after opening the drill-down, checking whether focus is inside the dialog |
| **Reflow probe** | Body 2-D scroll at 320 px (the 1.4.10 threshold) and 390 px |
| **Text-resize probe** | Root font-size to 200 %, checking for overflow and clipping |
| **Reduced-motion probe** | Emulated `prefers-reduced-motion: reduce`, reading computed durations |
| **Nielsen heuristic evaluation + cognitive walkthrough** | Judgement, evidenced against the above |

Two viewports (1440×900 desktop, 390×844 and 320×844 phone), the real
36-product workbook for public journeys and the in-memory Supabase stand-in for
signed-in ones. Every number below is measured; every judgement is labelled as
such.

## Corrections to the July journey assessment

Integrity first — two findings in [`ux-assessment.md`](ux-assessment.md) are
wrong or imprecise, and one of them was filed as a bug on a wrong diagnosis.

**Correction 1 — the Data Entry sideways-scroll bug has the wrong cause.**
The first pass reported `.entry-table` as 890 px wide "with no `overflow-x: auto`
wrapper". It **does** have one: `.entry-table-wrap`, `overflow-x: auto`, and it
scrolls correctly. The table was never the problem.

What actually overflows, measured by excluding every element clipped inside its
own scroller: **`.tab-bar` — 437 px wide in a 390 px viewport**, giving a body
`scrollWidth` of 453. It only reproduces **when signed in as admin**, because
that is the only state with four tabs; three tabs fit. So the defect is real, but
it is in the **navigation, affects every tab, and is caused by a non-wrapping
flex row** — not the Data Entry grid. The fix is `flex-wrap` or a scrollable tab
strip, not a table wrapper. The first pass reproduced it only in cloud mode and
mis-attributed it to whatever was on screen.

**Correction 2 — the tap-target criterion was cited at the wrong level.**
The first pass called 44 px "the accessibility floor" and reported 21–25
failures. 44×44 px is **WCAG 2.5.5 Target Size (AAA)**. The **AA** requirement is
**2.5.8 Target Size (Minimum), 24×24 px**. Correctly split:

- **5 elements fail AA (< 24 px)** — including two modal-close `×` controls at
  **11 × 15 px**.
- **24 of 24 fail AAA (< 44 px)**.

The AA number is the one that matters for a conformance claim; the AAA number is
still a legitimate usability observation for a tool used one-handed in a shop.

## WCAG 2.2 conformance summary

| Criterion | Level | Result | Evidence |
|---|---|---|---|
| 1.3.1 Info & Relationships | A | **Fail** | 13 `.section-eyebrow` and all `.panel-title` are `div`s; **0 headings in the Analysis tab**; 8/8 `th` without `scope`; 2 empty table headers |
| 1.4.1 Use of Color | A | **Fail** | `link-in-text-block` ×1 (Data Entry) — link distinguished by colour alone |
| 2.1.1 Keyboard | A | **Fail** | Board rows not focusable (no `tabindex`/`role`/key handler); `scrollable-region-focusable` ×3 |
| 2.4.3 Focus Order | A | **Fail** | Opening the drill-down never moves focus into it; 6/6 `Tab` presses landed on background controls |
| 3.3.2 Labels or Instructions | A | **Fail** | 72/72 Data Entry inputs have `placeholder` only — no `label`, `aria-label`, `aria-labelledby` or `title` |
| 4.1.2 Name, Role, Value | A | **Fail** | `select-name` ×4 (Analysis) + ×1 (Entry); `label` ×3; `#drill-modal` has no `role="dialog"`/`aria-modal`/accessible name |
| 1.4.10 Reflow | AA | **Fail** | At 320 px the body scrolls in two dimensions on Analysis **and** Data Entry (`scrollWidth` 342 > 320) |
| 2.4.7 Focus Visible | AA | **Fail** | **11 of the first 18** tab stops show no outline and no box-shadow — incl. `#board-search`, the sort and verdict selects, the Products/Sets pills, `#guide-btn` |
| 2.5.8 Target Size (Min) | AA | **Fail** | 5 controls under 24 px (smallest 11 × 15) |
| 1.4.3 Contrast (Minimum) | AA | **Pass at rest** | Token matrix below; see the animation caveat |
| 1.4.4 Resize Text | AA | **Pass** | Root font-size 200 % → no overflow, no clipping |
| 2.5.5 Target Size | AAA | Fail (informational) | 24/24 controls under 44 px at 390 px |
| 2.3.3 Animation from Interactions | AAA | **Pass** | `prefers-reduced-motion` honoured — durations collapse to ~1 µs, media query present |
| — `lang`, page `<title>`, zoom | A/AA | **Pass** | `lang="en"`; descriptive title; no `user-scalable=no` |

### Contrast: the palette is fine; the entrance animation is not

Computed from the tokens rather than sampled, so this is arithmetic:

| Foreground | on `--bg` | on `--card` | on `--bg3` | on `--border` |
|---|---|---|---|---|
| `--text` #f0f1f5 | 17.43 | 16.45 | 15.55 | 13.89 |
| `--muted` #8b8fa3 | 6.14 | 5.80 | 5.48 | 4.89 |
| `--accent` #f4c651 | 12.22 | 11.53 | 10.90 | 9.74 |
| `--accent2` #ef6a60 | 6.46 | 6.10 | 5.77 | 5.15 |
| `--accent3` #5cc7f2 | 10.22 | 9.64 | 9.12 | 8.14 |
| `--accent4` #7fd493 | 11.00 | 10.38 | 9.81 | 8.76 |
| **rendered mid-animation** #75798a | 4.55 | **4.30** | **4.06** | **3.63** |

**Every declared token passes AA at rest** — the design system's colour choices
are sound, which is worth stating plainly.

But axe sampled the muted text as `#75798a`, not `#8b8fa3`: the reveal animation
applies opacity, so text blends toward its background *while animating*, landing
at **4.30:1 against `--card`** — under the 4.5 AA minimum. Sampled 300 ms after
a tab switch, axe reported **27** such nodes; sampled at 2,500 ms, **0**.

The correct reading is **not** "27 contrast failures". It is: the palette
complies, and the animated entrance dips below AA transiently, for users who
scroll or switch tabs faster than the animation settles. Low severity — and a
methodological warning worth recording: **an automated audit run against this
page before animations settle produces 27 false failures.** Anyone re-running
axe here must let the page settle first.

## Findings by severity

### S1 — blocking, Level A, fix before any design work

**F1. The app cannot be operated without a mouse.** Board rows carry
`cursor: pointer` and a click handler but no `tabindex`, no `role`, and no
keyboard handler, so the **drill-down cannot be opened from the keyboard at
all**. The drill-down is the best answer surface in the product (see *What's
good*), which makes this the most expensive defect in the review: the strongest
feature is unreachable for keyboard and screen-reader users. Three
`.table-wrap` scroll regions are likewise unreachable (`scrollable-region-focusable`).
*WCAG 2.1.1 (A).*

**F2. The drill-down is not a dialog.** `#drill-modal` is a bare `div` — no
`role="dialog"`, no `aria-modal="true"`, no accessible name — and focus is
neither moved into it on open nor trapped while it is open. Every one of six
`Tab` presses after opening landed on background controls (`#hist-add` among
them). A screen-reader user is not told a dialog opened, and a keyboard user
tabs invisibly through the page behind it. *WCAG 2.4.3 (A), 4.1.2 (A).*

**F3. The monthly Data Entry loop is unusable with a screen reader.** All **72**
price/set-value inputs are named by `placeholder` only
(`placeholder="price"`, `data-product="Team Up Booster Box"`). A placeholder is
not an accessible name, and it disappears the moment a value is typed — so a
non-sighted maintainer has 72 identical unlabelled number fields and no way to
tell which product or field each belongs to. The product name exists in the row
but is not programmatically associated. *WCAG 3.3.2 (A), 4.1.2 (A).*

**F4. Five interactive controls are named by nothing.** Four selects on Analysis
(sort, verdict filter, the two comparison pickers) and one on Data Entry.
*WCAG 4.1.2 (A).*

### S2 — serious, AA

**F5. Focus is invisible on most of the page.** 11 of the first 18 tab stops
have no focus indicator whatsoever — including the board search, both selects,
the Products/Sets pills and the Format Guide button. A sighted keyboard user
cannot tell where they are. *WCAG 2.4.7 (AA).* Note the app *does* show focus on
some controls, so this is inconsistency rather than absence — the fix is one
`:focus-visible` rule applied across the token set.

**F6. Reflow fails at 320 px.** Both Analysis and Data Entry force two-
dimensional scrolling at the 1.4.10 threshold width (`scrollWidth` 342 vs 320).
At 390 px they pass. *WCAG 1.4.10 (AA).*

**F7. The tab bar doesn't fit a phone when four tabs are visible.** `.tab-bar` is
a non-wrapping `display: flex` row measuring **437 px at a 390 px viewport**,
scrolling the whole body sideways for signed-in admins on every tab. *This
supersedes the first pass's Data Entry diagnosis — see Correction 1.*

**F8. Five controls are under the 24 px AA target minimum**, the smallest being
modal-close `×` buttons at 11 × 15 px. *WCAG 2.5.8 (AA).*

**F9. The Analysis tab has no heading structure.** Thirteen section eyebrows and
every panel title are `div`s; the tab contains **zero** `h1`–`h6`. The page has
exactly one heading overall. A screen-reader user cannot list or jump between the
nine sections — the primary navigation mechanism for a long page is simply
absent, and no `<main>` landmark exists either (`region` violations: 40 on
Analysis, **265** on Data Entry). *WCAG 1.3.1 (A), 2.4.6 (AA).*

### S3 — moderate: comprehension and trust

**F10. The tool asks the user to interpret a raw R², and the fit is weak.** The
board header renders *"Fair Price (€) R² 0.39"*. R² is a statistical measure
most buyers will not know, 0.39 is a *weak* fit, and the entire product rests on
the number it qualifies. Both explanations live in places a phone user cannot
reach: a `title` tooltip (no hover on touch — related to *1.4.13 Content on
Hover or Focus*) and a ~200-word `.section-desc` paragraph. **Judgement:**
express confidence qualitatively on the surface ("rough estimate" / "confident")
and keep the number for the drill-down. Presenting a weak fit as a bare
statistic reads as more authoritative than it is, which is a credibility risk
for a tool whose pitch is trustworthiness.

**F11. The board's explainer paragraph is ~200 words of dense prose.** It is
accurate and genuinely well written, but it is the densest text in the app,
sitting directly above the most important table. It is also the single largest
contributor to the first pass's measured 16.4 % prose share on phone. Collapsing
descriptions (already planned) addresses the scroll cost; this one also needs
*editing*, not just hiding.

**F12. Tabs are not tabs.** No `role="tablist"/"tab"/"tabpanel"`, no
`aria-selected`, no arrow-key navigation. They look and behave like tabs
visually, so assistive technology and keyboard users get neither the semantics
nor the interaction convention. *WCAG 4.1.2 (A) in effect; violates Jakob's
law — users expect established control behaviour.*

**F13. Section numbering collides.** Analysis numbers its sections 01–09 and
Portfolio independently numbers its own 01–03. "Section 05" is ambiguous across
the app, and the board's explainer text refers to "section 05" by number. Cheap
fix: prefix or renumber.

**F14. Meaning carried by emoji.** 💰 (buy signal) and 🔔 (alert) convey state
in board rows. To the app's credit 💰 carries a descriptive `title` and the
column header includes a "💰 = buy signal" legend — better than nothing, but
`title` is unreliable for assistive tech and unavailable on touch. A
visually-hidden text alternative would settle it. *WCAG 1.4.1 (A) borderline.*

### S4 — polish

**F15.** Smallest rendered font is 9.6 px (mono labels/badges) — deliberate in
the design language, marginal on a phone at arm's length.
**F16.** No password reset (carried over from the first pass — still open).
**F17.** No `<main>` landmark; header/footer are the only landmarks.

## Nielsen's ten heuristics

Applied to this product specifically; each rated and evidenced.

| # | Heuristic | Verdict | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | **Weak** | One status channel (`setStatus`), clipped off-screen on phone; no loading state on any async surface |
| 2 | Match with the real world | **Mixed** | "SV/Booster" needs a paragraph to explain it is a ×multiple, not euros — the README says so twice, which is itself a signal |
| 3 | User control & freedom | **Weak** | Portfolio edits auto-save with no undo; Data Entry has no revert; no way to dismiss/restore the nine explainers |
| 4 | Consistency & standards | **Weak** | Tabs without tab semantics (F12); duplicated section numbering (F13); focus styling inconsistent (F5) |
| 5 | Error prevention | **Strong** | The 30 %/80 % delta guards and the snapshot-gap and type-outlier checks are genuinely good, and rare in a hobby tool |
| 6 | Recognition over recall | **Weak** | Nine sections, no in-page nav, no anchors, no headings to jump between (F9); users must remember what lives where |
| 7 | Flexibility & efficiency | **Weak** | No keyboard path at all (F1); filter/sort state not remembered between visits |
| 8 | Aesthetic & minimalist design | **Mixed** | The visual language is disciplined and attractive; the *quantity* front-loaded before the answer is not (2.8 screens on phone) |
| 9 | Help users recover from errors | **Weak** | No password reset (F16); cloud-save failure invisible on phone; the workbook→sample-data fallback still presents fake data as real |
| 10 | Help & documentation | **Mixed** | The Format Guide is good; the *method* — how fair price is computed, what R² means — is explained only in tooltips and dense prose (F10) |

## Cognitive walkthrough — "is this Booster Box fairly priced?"

The four-question walkthrough, on a phone, for a first-time visitor:

| Step | Will they know what to do? | Will they see the control? | Will they know it's right? | Will they understand the feedback? |
|---|---|---|---|---|
| Land on the page | — | Lands on **Welcome**, not an answer | No | — |
| Find Analysis | Maybe | Tab bar is below the header block, and overflows when signed in | Yes | Yes |
| Reach the board | Only by scrolling | **2,376 px / ~2.8 screens** down, past 3 KPI cards and a 200-word paragraph | Yes | Yes |
| See Fair Price | **No** | Column starts **off-screen**; horizontal scroll has no affordance | No | Once found, the verdict line is excellent |
| Judge confidence | **No** | "R² 0.39" with no reachable explanation on touch | No | No |
| Open the drill-down | Only with a mouse | Row is tappable but not keyboard-focusable (F1) | — | **Excellent once open** |

**Six steps, two dead ends, one statistical concept — to answer the one question
the product exists to answer.** Nothing in the chain is individually broken; the
accumulation is the problem, and it is exactly what the overview-first
restructure is for.

## What's genuinely good

Stated deliberately, because a review that only lists faults misleads — and
because two of these are load-bearing for the recommendations:

- **The drill-down.** Fits the viewport *exactly* at 1440×900 and 390×844 with no
  inner scrolling, and answers the question completely once open. Several
  findings reduce to "get people here sooner, and make it reachable".
- **The verdict line.** Plain-language synthesis under each product name is the
  right answer to "what do I do with these numbers", and it is already
  non-colour-dependent — the hardest part of 1.4.1 was solved by design intent.
- **The data-quality guards.** Delta warnings, snapshot-gap detection and
  type-outlier checks are better than most commercial tools manage.
- **The colour system.** Every token passes AA at rest, at every background.
- **`prefers-reduced-motion` is honoured**, and text resizes to 200 % without
  breaking. Both are commonly missed.
- **No runtime errors** in any journey at any viewport.

## Recommended plan changes

The first pass promoted mobile optimisation to the front. This review changes
that: **accessibility moves ahead of it**, because F1–F4 are Level-A conformance
failures — the app is not operable without a mouse — while the mobile findings,
F7 aside, are degradation rather than exclusion.

| Order | Item | Change | Driven by |
|---|---|---|---|
| **1st** | **Accessibility** | ⬆ from 5th (was last-but-two before the first pass) | F1, F2, F3, F4, F5, F9, F12, F14 — eight findings, four at Level A |
| 2nd | Mobile optimisation | ⬇ from 1st | F6, F7, F8, F15 + the first pass's density findings |
| 3rd | Collapsible section descriptions | unchanged | F11 + measured 16.4 % prose |
| 4th | Overview-first restructure | unchanged | The cognitive walkthrough above |
| 5th | Loading, empty & error states | ⬆ from 6th | Heuristics 1 and 9; the sample-data fallback still lies |
| 6th | Onboarding & demo as a pitch | ⬇ from 4th | Real, but converts visitors rather than unblocking users |
| last | Set logos | unchanged | Still untouched by any finding, in either pass |

**New items this review proposes:**

1. **Fix — "Fair Price" confidence presentation** (F10): qualitative confidence
   on the board, the raw R² in the drill-down, and the method explained somewhere
   reachable without hover.
2. **Fix — edit the board explainer** (F11): ~200 words is too many directly
   above the primary table; this is copy-editing, distinct from collapsing.
3. **Fix — resolve the section-numbering collision** (F13).
4. **Bug — the tab bar overflows a phone viewport when four tabs show** (F7),
   replacing the mis-diagnosed Data Entry bug from the first pass.

**One process recommendation:** wire `@axe-core/playwright` into the suite as the
accessibility item already plans — but with a **settle delay before the sweep**,
or it will report 27 contrast failures that do not exist (see the contrast
section). An a11y gate that cries wolf gets disabled, which is worse than not
having one.

## Limits of this review

- **No human assistive-technology testing.** Everything here is static analysis,
  automated rules, and programmatic keyboard traversal. A real screen-reader pass
  (NVDA/JAWS/VoiceOver) would find things none of these instruments can — reading
  order oddities, verbose announcements, table-navigation quality — and F3's
  severity in particular deserves confirming with a real screen reader.
- **No real users.** Heuristic evaluation and cognitive walkthrough are expert
  proxies for usability testing, not substitutes. The task-cost figures are
  mechanical counts, not observed behaviour, and expert reviews systematically
  over-weight discoverability problems and under-weight comprehension ones.
- **No physical devices.** Headless Chromium at fixed device scale. Touch
  accuracy, iOS Safari's dynamic viewport and real-world glare are unmeasured.
- **Signed-in journeys used the 4-product fixture.** Structure and gating are
  faithful; density figures for those views are not, and every density number
  quoted here comes from the real 36-product workbook.
- **axe-core covers roughly 30–40 % of WCAG criteria** by design. The manual
  probes above extend that, but a clean automated run would not equal
  conformance.
