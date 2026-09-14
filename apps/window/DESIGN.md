---
version: alpha
name: Frank Window
description: White window. No scroll. Hermes thinks, Frank shows.
colors:
  primary: "#111111"
  secondary: "#666666"
  tertiary: "#E53C1F"
  neutral: "#FFFFFF"
  paper: "#FFFFFF"
  ink: "#111111"
  mute: "#666666"
  faint: "#999999"
  line: "#ECECEC"
  card: "#FFFFFF"
  chip: "#F5F5F5"
typography:
  h1:
    fontFamily: Inter
    fontSize: 2.125rem
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  h2:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: 8px
  md: 12px
  pill: 999px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.pill}"
    padding: 12px
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 16px
  chip:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.pill}"
    padding: 8px
  rail-item:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.sm}"
    padding: 8px
---

## Overview

Frank is a window, not a brochure. One viewport, no page scroll. A left rail of workspaces and window surfaces; a top bar naming where you are; content that fills the rest. Pure white. The mark carries the only red.

## Colors

- **Ink (#111111):** text, active states, the composer send.
- **White (#FFFFFF):** every surface. No tinted paper.
- **Secondary (#666666) / Faint (#999999):** copy and hints.
- **Tertiary (#E53C1F):** the slash in the mark, the active dot in the rail. Nothing else.
- **Line (#ECECEC):** hairline separators only.

## Logo

An inline SVG, transparent, drawn in `currentColor` plus one red slash. It sits on white like every other surface. Use `brand/mark.svg` (mark) and `brand/wordmark.svg` (mark + name) anywhere.

## Typography

Inter only. Headings 500, never italic, never decorative. Labels are lowercase with a 10px uppercase group caption in the rail.

## Layout

`height: 100dvh`, `overflow: hidden` on html and body. The rail is fixed 220px (collapses to icons on mobile). The content column fills the rest; only internal lists (files tree, a long doc) scroll inside their own pane. A widget grid uses `auto-fill, minmax(300px, 1fr)`.

## Components

A widget is a white card with a hairline border and an isolated failure state. Rail items are flat; the selected one gets a red dot, never a filled slab. The composer is a pill with a round send.

## Do's and Don'ts

- Do keep everything in one viewport.
- Do read the same folders Hermes reads.
- Do show an empty state when a source is missing — never fake data.
- Don't add a second brain, scheduler, or memory store.
- Don't tint the background.
- Don't invent metrics.

## Current route and performance notes

The current Window keeps the existing one-viewport rail and content-pane route
model. Graph workbench code is built separately and its browser validation is
separate from the non-browser verification runner. Cleanup measurements on
2026-09-05 reduced the minified graph workbench bundle from 12,232,201 to
5,570,436 bytes and the dashboard bundle from 1,587,380 to 600,235 bytes.
Lazy graph loading remains a planned frontend improvement, not a shipped claim.


## Owner Dashboard Surface

This is a bounded surface record for the Blockwise owner dashboard mounted inside the Frank Window. It extends the incumbent white Inter system; it does not replace Frank's global visual rules or describe the customer-facing Blockwise product.

### Overview

The dashboard is a code-first operating surface for moving between customer records, inbox, growth evidence, revenue, email flows, operations, and connection readiness. It leads with actionable work, then a four-column metric strip, acquisition stages, today's work, and recent events. The surface is dense but quiet: hierarchy comes from whitespace, hairlines, weight, and explicit source labels rather than tinted panels or decorative graphics.

**The Evidence Label Rule.** Sample metrics, people, messages, events, and charts stay visibly identified as sample or preview data. A source label explains what a chart measures and does not imply joined attribution or a live provider connection.

### Colors

The surface uses Frank's white, ink, muted text, faint line, and red-mark palette directly, with one local soft neutral for hover and stale-state surfaces.

- **Ink** (`#111`): titles, active controls, values, chart bars, and primary text.
- **Muted gray** (`#666`): descriptions, metadata, source notes, and disabled-state explanations.
- **Hairline gray** (`#ececec`): borders, separators, stat divisions, and dialog rules.
- **Soft neutral** (`#f7f7f6`): hover backgrounds and the stale-state notice only.
- **White** (`#fff`): the dashboard canvas, cards, fields, and controls at rest.
- **Frank red** (`#e53c1f`): the active navigation dot inherited from the Frank rail language; it is not a general dashboard accent.

**The Quiet Accent Rule.** Keep the dashboard monochrome at rest. Red remains a small Frank identity signal; status meaning is carried by words such as “Attention”, “Due”, “New”, and “Sample”.

### Typography

Inter is used throughout, with the existing Frank fallback stack (`ui-sans-serif, system-ui, sans-serif`). The dashboard's local base is 13px. The title is 30px with a tight `1` line-height and `-0.045em` tracking; card and detail headings are 16px at `1.25` with `-0.02em`; metric values are 22px with tabular numerals and `-0.03em`; supporting copy is 11–12px at `1.5`; compact labels and source notes are 10–11px.

**The Scanable Type Rule.** Use weight, size, and line-height to separate action, metric, context, and evidence. Do not introduce display faces, italics, or decorative lettering into this operating surface.

### Layout

The dashboard fills its host viewport and keeps page overflow contained. On desktop, the local shell is a two-column grid with a 174px navigation rail and a flexible main pane. The main pane scrolls internally and uses 24px padding. At 900px the rail becomes 132px and the overview reflows to two columns; at 620px the shell stacks, the navigation becomes a horizontally scrollable row, and the main padding becomes `14px 12px 24px`. Cards and split views collapse to one column on phone widths. The overview uses a two-column top row, a three-column lower row, and a four-column stat strip that becomes two columns below 900px.

**The Context-Preserving Scroll Rule.** Keep the Frank shell and Blockwise navigation context in place while the dashboard's content pane scrolls. Mobile navigation may scroll horizontally inside its own row; the page itself must not gain horizontal overflow.

### Elevation & Depth

The dashboard is flat by default. White cards, fields, controls, and connection tiles are separated by `1px` hairlines and whitespace. Hover adds a soft-neutral fill or a darker border; it does not lift the element. The native dialog is the one structural elevation treatment, using a restrained `0 18px 48px rgba(0, 0, 0, 0.16)` shadow and a dimmed backdrop.

### Shapes

The form language is gently rounded and consistent: navigation items and fields use 8px corners, cards and dialogs use 12px, and buttons, tabs, ranges, preview banners, and chips use a full pill radius (`999px`). Borders are quiet hairlines. Lists remain rectangular within their parent card, and split panes clip their shared border and radius rather than adding extra decoration.

### Components

#### Navigation and tabs

The navigation is text-first and flat. Inactive items use muted text on white; hover uses the soft neutral; the active item is darker and semibold with a 6px Frank-red dot. View tabs and range controls use outlined pills; selected controls invert to ink with white text.

#### Buttons and fields

Buttons and selects share a minimum 36px height, 1px hairline border, pill radius, and compact `7px 11px` padding. Primary actions invert to ink. Search inputs use an 8px radius, minimum 38px height, and `8px 10px` padding. Focus-visible controls receive a 2px ink outline with a 2px offset. Disabled controls remain readable at reduced opacity and carry an explanatory title or note when the action is unavailable.

#### Cards, stats, and rows

Cards are white, 1px hairline bordered, 12px rounded, and padded 16px, reducing to 14px on phone. The stat strip repeats the same border language and divides cells with hairlines. Rows use 11px vertical padding, top rules, bold primary copy, muted secondary copy, and an optional pill chip. Charts are source-labelled black bars with a hairline baseline and a plain-text figcaption.

#### Split detail and dialog

Inbox and similar list/detail views use a bordered split container; the list and detail share the same white surface and become vertically stacked on phone. Details and notifications open a native modal dialog with a 12px radius, internal scrolling, focus restoration, keyboard focus trapping, Escape dismissal, and a clear close action.

#### Connection tiles

Connection readiness is presented as a responsive auto-fill grid of compact white tiles with 8px corners, hairline borders, and a disabled “Connect” control. Provider names are future setup labels only; the visual state never claims a connection.

### Do's and Don'ts

### Do:

- **Do** preserve the white Frank canvas, ink-led hierarchy, hairline separators, and restrained red navigation signal.
- **Do** label sample data and source boundaries at the point of use.
- **Do** keep primary customer work and actionable attention states ahead of supporting metrics.
- **Do** keep native, provider, billing, mail, and authentication actions visibly unavailable until a real connection exists.

### Don't:

- **Don't** turn a sample fixture into a live-looking provider, billing, mailbox, or customer record.
- **Don't** make every section an equal card wall; retain the observed attention-first hierarchy.
- **Don't** use the red accent as a general status color or replace text status labels with color alone.
- **Don't** add a decorative display face, image composition, or page-level overflow that conflicts with the operating surface.
