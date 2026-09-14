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


## Blockwise owner workspace

The current owner instruction replaces the earlier links-only launch page.
Frank keeps its white Inter shell and combined owner overview, with native CRM,
Helpdesk, email and campaign panels inside the same workspace.

A trusted device establishes the normal shared owner session. A small,
native-origin bridge checks the application's own protected session before
showing its UI. Required sign-in uses a bounded same-tab round trip, never an
identity-provider form in a frame, and returns to the original section.
Passwords and tokens never enter dashboard storage or frame messages.

Connecting, connected, failure and retry states are explicit. Native mail is
retained when switching sections, and leaving for sign-in warns about an open
draft. There are no new-tab escape links. Other Frank routes and the technical
project home remain unchanged. A passing health check is not native-session
acceptance; desktop and mobile browser evidence is recorded separately.

## Ads workspace

`/project/blockwise/ads` is the owner's paid-advertising section, beside Mail,
CRM and Email flows. It is a Frank read model with no native application to
frame, so it takes the read slot whole rather than being wrapped in the panel
title every other section gets.

It extends the incumbent white, compact system rather than adding a second one:
the same tokens, the same Inter steps, the same hairlines, the same pill
actions. What changes is density. An ads screen is an Operate surface read
against a table, so it adds:

- **A context strip that never scrolls.** Account, date range, comparison
  period, attribution setting and last successful sync sit above the screen nav
  and stay put while the rows move.
- **One management table, three altitudes.** Campaigns, ad sets and ads share a
  table with sortable headers, choosable columns, saved filter views, row
  selection with shift-range, and paging. Numbers are right-aligned with tabular
  figures so a column can be read down the page.
- **Measurement labels at the point of display.** Meta-attributed and
  website/CRM-observed numbers are different facts. They never share a column or
  a total, and an observed metric carries its source inline.
- **Evidence instead of a winner badge.** Low volume renders *Insufficient
  evidence*, not a crown, and a comparison refuses a verdict while the
  confidence intervals overlap.
- **A record drawer, not a second page.** Rows open a trailing panel so the list
  behind it survives; Escape closes it and focus returns to where it was.

The red `--mark` stays what it is everywhere else: the active marker only. No
new accent, no tinted panel and no chart wall — the overview carries exactly one
chart, because a screen where every metric has its own sparkline is a screen
nobody reads.

Motion follows the same restraint: entering surfaces (drawer, popover, bulk bar,
publish flow) get a short custom ease-out because they explain a state change,
repeat-use controls get a bounded transition and nothing more, and everything
collapses under `prefers-reduced-motion`.

`web/ads.css` owns how a reading is presented and `web/ads-controls.css` owns
the operator's controls — saved views, columns, hierarchy, lifecycle and the
phone layout. Both are scoped to `.ads-workspace`, so no other Frank surface
changes.
