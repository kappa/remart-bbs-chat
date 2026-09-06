# Docs status

## Authoritative

- `README.md` — overview, testing deployment, structure, how to run.
- `docs/USER_EXPERIENCE.md` — what it does, as a black box.
- `docs/DESIGN.md` — why it behaves that way.
- `docs/PROTOCOL.md` — current wire protocol and client/server exchange behavior.

These describe the system as built. When behavior changes, update them in the
same change. The implementation (`server/index.js`, `client/src/App.tsx`) is
the final arbiter when docs and code disagree — and then the docs get fixed.

## Pending work

`TODO.md` is the ordered list of review findings and approved future changes.
It describes intent, not implemented behavior.

## Active specs and plans

`docs/superpowers/` holds only active superpowers specs and plans. Anything
found there is current.

- `docs/superpowers/specs/2026-09-05-websocket-server-echo-design.md` —
  approved design for TODO tasks 11, 10, and 7 (WebSocket chat transport,
  server echo, no Vite dev server), absorbing issues 2 and 3.

## Archive (historical, not authoritative)

`docs/archive/` holds the original 2026-09-01 design spec, implementation plan,
spec-driven-development ledger, and the approved final specification. They were
superseded on 2026-09-03/04 (Unicode, no 80-cell limit, no typing throttle,
deferred ownership on first char, live socket updates, seq-ordered ops,
viewer-accumulated scrollback). Do not execute the archived plan and do not
update the archived files; update the authoritative docs instead.
