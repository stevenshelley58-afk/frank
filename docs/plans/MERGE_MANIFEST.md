# GOV-05 — Merge queue & release manifest

Maintained by AG-0. Merges land in **dependency order, not finish order**.
Status legend: 🔜 queued · 🔄 in flight · ✅ merged · ⛔ blocked

## Release manifest

| Task | Branch | Commit | CI | Preview | Gate | Status |
|---|---|---|---|---|---|---|
| G0 governance | main | d951d0d | ✅ | — | G0 ✅ | ✅ |
| FS/SS prep + SS-07 + GOV-06 | main | e512c72..b8fccfe | ✅ | — | — | ✅ |
| DEL-04 secret scan | agent/del/delivery-controls | — | — | — | G1+ | 🔄 wave 1 |
| GOV-04/DEL-05 issue board | agent/del/delivery-controls | — | — | — | — | 🔄 wave 1 |
| CH-01 ChannelPort | agent/ch/channelport-statestore | — | — | — | G2 path | 🔄 wave 1 |
| CH-02 StateStore conformance | agent/ch/channelport-statestore | — | — | — | G2 path | 🔄 wave 1 |
| WB-01 migration 0004 | agent/wb/wb-core | — | — | — | G2 | 🔄 wave 1 |
| WB-02 runner+queue | agent/wb/wb-core | — | — | — | G2 | 🔄 wave 1 |
| WB-03 docker fence | agent/wb/wb-core | — | — | — | G2 | 🔄 wave 1 |
| WB-04 harness+recipe | agent/wb/wb-core | — | — | — | G2 | 🔄 wave 1 |
| WB-05..07 | TBD after WB-04 merge | — | — | — | G2 | 🔜 wave 2 |
| HITL-01/02 | TBD | — | — | — | G3 | 🔜 wave 2 |
| CH-00 spike | — | — | — | — | G3 | ⛔ bot token |
| CH-03..07 | TBD | — | — | — | G3 | 🔜 wave 2 (token) |
| FS-01..06 | TBD | — | — | — | G4 | 🔜 wave 3 |
| SS-01..03/05 | TBD | — | — | — | G4 | 🔜 wave 3 |
| UI-07..09 | TBD | — | — | preview lane | G4 | 🔜 wave 3 |
| Acceptance W1–W10 | — | — | — | — | G5 | 🔜 wave 4 |

## Merge-order rules

1. A branch merges only when `pnpm run verify` is green AND its predecessor
   rows above are merged.
2. Migration numbers are leased: 0004 = WB-01. Next free after WB-01: 0005.
3. Lockfile/contract-index changes merge alone or last in a batch.
4. Preview evidence (Chrome path + console/network check) is required for any
   row touching `apps/web` before its merge row flips to ✅.

## Gate board

| Gate | Requirement | Status |
|---|---|---|
| G0 | Authority + baseline | ✅ d951d0d |
| G1 | CI verify + preview protocol | ✅ prebuilt integration |
| G2 | Durable run, fence, plan, stop, receipt | 🔄 wave 1+2 |
| G3 | Phone approval through command envelope | ⛔ needs token + G2 |
| G4 | Folders, schedules, egress | 🔜 |
| G5 | W1–W10 + release receipt | 🔜 |
