# UX assessment — July 2026

The structured end-to-end pass called for by `ROADMAP.md` → *Then — design &
usability*. **No code changes**: the output is this prioritised findings list,
plus a recommended reordering of the items that follow it.

The aesthetic is not under review. Every finding below is about whether the page
*works* — judged against the north star: **how fast can someone get to "is this
fairly priced, and should I buy?"**

## Method

Each journey was driven against the real page over HTTP — the real workbook (36
products) for the public journeys, the in-memory Supabase stand-in
(`tests/fake-supabase-sdk.js`) for the signed-in ones — at two viewports:

- **desktop** 1440 × 900
- **phone** 390 × 844 (iPhone-14 class), device scale factor 2

Screenshots were captured at each step and read, and the following were measured
in-page rather than eyeballed: document height in screenfuls, horizontal
overflow, y-offset of the first product row, total height of `.section-desc`
prose, interactive elements below the 44 px tap-target floor, smallest rendered
font size, and whether the drill-down fits the viewport.

Journeys walked: **A** logged-out visitor on the demo · **B** first sign-in ·
**C** the maintainer's monthly Data Entry loop · **D** a price check on a phone ·
**E** a first-time visitor trying to answer the north-star question unaided.

Numbers below are reproducible with a short Playwright script; none of them
depend on judgement.

## What already works

An assessment that only lists faults is misleading. These held up:

- **The drill-down is the strongest surface in the app.** It fits the viewport
  exactly at both sizes (900/900 desktop, 844/844 phone) with no inner
  scrolling — "one product, one screen" delivers, on a phone as well as a
  desktop. Several findings below amount to *get people there sooner*.
- **No runtime errors** in any journey at either viewport.
- **The board and the demo use the right overflow pattern** — wide tables scroll
  inside their own `.table-wrap` rather than dragging the page sideways.
- **The demo's data scope is correct**: exactly the 3 newest releases.

## Findings

Ranked by severity × frequency. "Feeds" names the roadmap item each one belongs
to, which is what drives the reordering proposal at the end.

### P1 — fix first

**1. On a phone, the Data Entry tab scrolls the whole page sideways.** *(Bug ·
journey C · every phone visit)*
`.entry-table` lays out **890 px wide inside a 390 px viewport** and is not
inside an `overflow-x: auto` wrapper, so the body scrolls horizontally — 49
elements extend past the right edge. This directly violates the rule the
`design-review` skill states ("the page body never scrolls horizontally — wide
content scrolls inside its own container"), and it hits the maintainer's core
monthly task. *Feeds: mobile optimisation — but it is a defect, not polish.*

**2. On a phone, the status line is unreadable and unreachable.** *(Bug ·
journeys C, D, E · every phone visit)*
`#analysis-status` is a `white-space: nowrap` pill inside a
`justify-content: flex-end` flex row. On a 390 px viewport its text is wider than
the row, so it overflows to the **left**, off-screen — and because negative
overflow creates no scroll area, there is no way to reach it. The screenshot
shows the load confirmation truncated mid-word ("…xlsx from repo — 36
products").
This is worse than cosmetic: `setStatus()` is the *only* channel for cloud
save/load feedback, so on a phone the admin cannot read "✓ Saved to cloud" **or
"✕ Cloud save failed"** — a silent-failure path in the one flow where data is
written. *Feeds: mobile optimisation + first-class error states.*

**3. The answer is ~2.8 screens below the fold on a phone.** *(journeys D, E ·
every visit)*
Analysis tab totals **8,357 px — 9.9 screenfuls** on phone (7,599 px / 8.4 on
desktop). The first product row sits at **y = 2,376** on phone and **y = 1,697**
on desktop; above it are the header block, a 5-line explainer, and four
full-width KPI cards that each consume roughly a third of a phone screen.
Nothing a buyer needs to decide is visible without scrolling. This is the
quantified case for the overview-first restructure. *Feeds: overview-first
restructure.*

### P2 — high value, next

**4. Everyone lands on Welcome, never on the answer.** *(journeys B, D, E ·
every visit)*
The active pane on load is `#tab-welcome` — for logged-out visitors, first-time
sign-ins (verified: still Welcome immediately after authenticating), and
returning users alike. Minimum two taps to any number, and on a phone the tab
bar itself is below the header block. There is no "resume where I was" and no
default-to-Analysis. *Feeds: overview-first restructure.*

**5. Explainer prose occupies 16.4% of the phone page.** *(journeys D, E)*
Nine `.section-desc` blocks total **1,372 px on phone** (1,073 px / 14.1% on
desktop). Invaluable on first read, pure scroll cost forever after. The measured
share is the argument for making them collapsible with the choice remembered,
rather than for deleting them. *Feeds: collapsible section descriptions.*

**6. The Fair Price column — the north-star answer — is off-screen by default on
a phone.** *(journey D)*
The board's 9 columns exceed the phone viewport, so `.table-wrap` scrolls
horizontally (the correct pattern). But the default position shows Product /
Type / Price; **Fair Price, the verdict and SV/Booster require a sideways swipe
with no affordance hinting that it exists.** A price-checker in a shop sees the
price they already know and none of the judgement. Consider column priority
(freeze or reorder for narrow viewports) rather than more scrolling. *Feeds:
mobile optimisation + overview-first restructure.*

**7. The demo never says what the tool is.** *(journey A · every first visit)*
The entire framing above the fold is *"A preview of the three latest sets. Sign
in to explore the full catalogue — value rankings, price history, and buy
signals."* Nothing states what is tracked (sealed product), what Set Value means,
or the one question the tool answers. **And the demo shows no fair price and no
verdict at all** — the marketing surface omits the product's whole point, so the
strongest reason to sign in is the one thing a visitor cannot see. *Feeds:
onboarding & the demo as a pitch.*

### P3 — real, lower urgency

**8. 21–25 interactive elements per view are below the 44 px tap-target floor.**
*(journeys C, D, E)*
Consistent across viewports. Worst on Data Entry, where the phone inputs measure
**90 × 31 px** — the exact controls the monthly loop depends on. *Feeds:
accessibility + mobile optimisation.*

**9. Smallest rendered font is 9.6 px.** *(all journeys)*
The mono labels, badges and eyebrows. Deliberate in the design language and fine
on a desktop; below comfortable reading on a phone held at arm's length in a
shop. *Feeds: mobile optimisation.*

**10. There is no password-reset path.** *(journey B · rare, but total when hit)*
The sign-in overlay offers only *Sign in* and *Create an account*;
`resetPasswordForEmail` appears nowhere in `index.html`. A user who forgets their
password has no route back — and since holdings and alerts are RLS-scoped to the
account, they lose access to their own portfolio. Signed-in users *can* change a
password (`#change-pw-btn`), which makes the gap easy to miss. *Feeds: a new
item — see below.*

**11. On a phone the demo's Set Value column starts off-screen.** *(journey A)*
The demo tables are 622 px wide in a 390 px viewport. They scroll correctly
inside `.table-wrap`, so nothing is lost, but the value metric the pitch rests on
is not visible until the visitor discovers a sideways swipe. Same shape as
finding 6, lower stakes. *Feeds: onboarding & the demo as a pitch.*

## Recommended reordering

The assessment was explicitly allowed to reorder what follows it. Two changes:

1. **Findings 1 and 2 are defects, not design work** — a layout-contract
   violation and an unreadable-on-mobile save/failure message. They should be
   filed under **Known bugs** and fixed ahead of the design items, not folded
   into a larger mobile pass.
2. **Then run the design items in this order**, which is *not* the order they
   were written in:

| Was | Now | Item | Why the change |
|---|---|---|---|
| 8 | **1st** | Mobile optimisation | Findings 1, 2, 6, 8, 9 all land here, and two are defects. It stopped being polish. |
| 7 | **2nd** | Collapsible section descriptions | Measured at 16.4% of the phone page; small, self-contained, and compounds with the mobile work. |
| 6 | **3rd** | Overview-first restructure | Still the biggest win (findings 3, 4, 6) but the largest change — do it after the cheap wins, informed by them. |
| 12+13 | 4th | Onboarding & demo as a pitch | Finding 7 is a real gap, but it converts visitors rather than serving existing users. |
| 10 | 5th | Accessibility | Finding 8 overlaps the mobile pass; do the audit once that has settled. |
| 11 | 6th | Loading, empty & error states | Finding 2 covers the urgent part; the rest is genuine but quieter. |
| 9 | last | Set logos | No finding touched it. Confirmed as the lowest-value item of the theme. |

**One new item proposed:** *password reset* (finding 10) — small, and currently a
dead end for any user who hits it.

## Caveats

- The signed-in journeys ran against the 4-product fake Supabase fixture. Journey
  structure, gating and layout are faithful; **density** figures for those views
  are not — which is why every density number quoted above comes from the
  static/xlsx path with the real 36-product workbook.
- Measured in headless Chromium at a fixed device scale, not on physical
  hardware. Real-device checks (touch accuracy, actual text legibility, iOS
  Safari's dynamic viewport) remain worth doing during the mobile item.
- No accessibility-tool audit (screen reader, contrast sweep) was run; that is
  the accessibility item's own scope, and finding 8 should not be read as its
  substitute.
