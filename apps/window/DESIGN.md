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
