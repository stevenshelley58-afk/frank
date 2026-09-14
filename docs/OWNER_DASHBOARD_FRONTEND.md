# Blockwise owner workspace frontend

Superseded document. The previous revision of this file described a
launch surface of external links and stated that Frank does not embed an
application. That was the second rejected implementation in the build handoff,
and it is no longer the contract. The current contract is
[`OWNER_WORKSPACE.md`](OWNER_WORKSPACE.md); where this file and that one differ,
that one wins.

## Scope

Frank's owner-only `/project/blockwise` route is a workspace: a real combined
overview of the business plus the native applications rendered inside Frank's
content area. It is not a launcher, and it is not a reimplementation of any
upstream application.

It still has no copied business records, no home-made inbox, no simulated
business data, no billing ledger, no provider transport and no second agent
runtime. Aggregation is read-only; execution stays with the native application
that owns the work.

The real technical project home remains at `/project/blockwise?technical=1`.
Other project homes and Frank's custom applications, including Ad Radar, audit
and templates, are unchanged.

## Routes

| Route | Surface |
| --- | --- |
| `/project/blockwise` | Overview |
| `/project/blockwise/mail` | Mail |
| `/project/blockwise/crm` | CRM |
| `/project/blockwise/support` | Support |
| `/project/blockwise/campaigns` | Email flows |
| `/project/blockwise/revenue` | Revenue |
| `/project/blockwise/results` | Results |
| `/project/blockwise/notifications` | Notifications |
| `/project/blockwise/customer/<opaque-id>` | Customer overview |

Sections are allowlisted identifiers; the customer identifier is exactly one
opaque, validated segment. Back, Forward, refresh and shareable deep links work
for every route. Route parsing and its tests live in
`web/js/view-routing.js` and `tests/view_routing.test.mjs`.

## Native application panels

Each native application is registered with a stable app id, display name,
approved origin, default route, allowlisted route patterns, access requirement,
native account mapping, capabilities, session readiness and its
integration-specific limits. No credential is stored in that registry, and a
client cannot mark an application connected. Readiness is decided by an
authorized server check or a supported app bridge, never by an iframe `load`
event.

One application is visible at a time. Bounded retained state is allowed so that
an unsaved draft survives a section change. Applications are not kept running
forever in hidden frames.

Framing is permitted only by the approved Frank parent origins, and the
origins are gated through the owner session so logout and revocation block
access even if an upstream session survives.

## Overview

The overview is built from authorized read projections that follow the read
model contract in [`OWNER_WORKSPACE.md`](OWNER_WORKSPACE.md). Every item carries
its source, a stable source record id, the real observation time, the last
successful refresh time, one of `ready`, `empty`, `stale`, `unavailable` or
`error`, and a typed internal drill-down target.

Missing data is not zero. A failed source degrades its own card and never blanks
the page, and cached values stay visibly dated. A summary item opens the
relevant native record or filtered list, not an application homepage.

Until a real adapter exists, a section or card renders an explicit unavailable
state. Fixture data is confined to isolated tests and previews and never appears
in the production overview.

## External providers

Rarely needed account or security operations that cannot be performed through a
supported API or an official embed are labelled as explicit exceptional external
actions. An everyday workflow is never quietly replaced by an external link and
marked complete.

Scheduling has no deployed native interface yet. The workspace states that fact
and links to the real setup blocker inside Frank rather than showing a sample
calendar.

## Design

The workspace keeps Frank's white, Inter, hairline, text-first shell from
[`../apps/window/DESIGN.md`](../apps/window/DESIGN.md). Brand lives in precise
detail, not decoration. The mobile layout collapses to one column and keeps
navigation and content usable at phone width.

## Verification boundary

Frontend checks prove route resolution, deep-link and history behaviour, the
panel host contract, explicit unavailable states, retained unsaved work, and
that no owner surface opens an external tab. They do not by themselves prove
native application authentication, SSO, data synchronization, reporting,
delivery, billing or any provider write. Those are covered by the acceptance
harness and the acceptance ledger, which record live integration separately
from software implementation.
