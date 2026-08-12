# Build state

One line per task. A replacement agent reads this file first and needs nothing else.
Status: READY | IN_PROGRESS | DONE | BLOCKED | BLOCKED-DEP

| id | status | branch | commit | owner | updated |
|---|---|---|---|---|---|
| F0-1 scaffold | DONE | main | - | cowork | 2026-08-12 |
| F0-2 deploy frank | READY | - | - | - | - |
| F0-3 graphify registry | READY | - | - | - | - |
| F0-4 gitignore | READY | - | - | - | - |
| F1-1 project registry | BLOCKED-DEP F0 | - | - | - | - |
| F1-2 release contract | BLOCKED-DEP F1-1 | - | - | - | - |
| F1-3 module manifest | BLOCKED-DEP F1-1 | - | - | - | - |
| F1-4 delivery | BLOCKED-DEP F1-2 | - | - | - | - |
| F2-A1 renderer | BLOCKED-DEP F1-2 | - | - | - | - |
| F2-A2 template factory | BLOCKED-DEP F2-A1 | - | - | - | - |
| F2-B1 ad-intelligence | BLOCKED-DEP F1-4 | - | - | - | - |
| F2-B2 prospect-discovery | BLOCKED-DEP F1-4 | - | - | - | - |
| F2-B3 mail | BLOCKED-DEP F1-4 | - | - | - | - |
| F2-B4 outreach | BLOCKED-DEP F2-B2,F2-B3 | - | - | - | - |
| F2-C1 content-factory | BLOCKED-DEP F1-4 | - | - | - | - |
| F3-0 chat | BLOCKED-DEP F0-2 | - | - | - | - |
| F3-1 project home | BLOCKED-DEP F3-0 | - | - | - | - |
| F3-2 widget groups | BLOCKED-DEP F3-1 | - | - | - | - |
| F3-3 night watch | BLOCKED-DEP F3-1 | - | - | - | - |
| F3-4 graphify+lake | READY | - | - | - | - |
| B4-1 delete legacy adstudio | READY | - | - | - | - |
| B4-2 consumer boundary | BLOCKED-DEP B4-1,F1-4 | - | - | - | - |
| B4-3 catalogue | BLOCKED-DEP B4-2 | - | - | - | - |
| B4-4 editor | BLOCKED-DEP B4-3 | - | - | - | - |
| B4-5 save | BLOCKED-DEP B4-3 | - | - | - | - |
| B4-6 publish+meta | BLOCKED-DEP B4-5 | - | - | - | - |

## Migration numbers (coordinator assigns, never a worker)
Highest applied: 0013. Next free: 0014.
0014 -> F3-1 project dashboard
0015 -> F3-3 night watch
