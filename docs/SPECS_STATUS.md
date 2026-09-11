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

`TODO.md` is the ordered list of open review findings and approved future
changes. It describes intent, not implemented behavior. Finished tasks are
kept in `docs/TODO_ARCHIVE.md` as a record of what was decided.

## Active specs and plans

`docs/superpowers/` holds specs and plans for work in progress and is empty
between such work. Anything found there is current. When the work lands and
its rationale is in `docs/DESIGN.md`, the spec and plan move to
`docs/archive/superpowers/`.

## Archive (historical, not authoritative)

`docs/archive/` holds the original 2026-09-01 design spec, implementation plan,
spec-driven-development ledger, and the approved final specification. They were
superseded on 2026-09-03/04 (Unicode, no 80-cell limit, no typing throttle,
deferred ownership on first char, live socket updates, seq-ordered ops,
viewer-accumulated scrollback). Do not execute the archived plan and do not
update the archived files; update the authoritative docs instead.

`docs/archive/superpowers/` holds the executed specs and plans, kept as
the record of what was approved:

- `2026-09-05-websocket-server-echo` — WebSocket chat transport, server
  echo, no Vite dev server (tasks 11, 10, and 7, absorbing issues 2 and 3);
  merged 2026-09-06, the commit before it tagged
  `before-websocket-server-echo`.
- `2026-09-09-afk-presence` — AFK by tab visibility (task 31).
- `2026-09-09-mention-autocomplete` — the handle list after `@` (task 25).
- `2026-09-09-mentions` — colored mentions, the bell, and the notification
  library (task 17).
- `2026-09-09-private-messages` — private messages from the roster
  (task 18).

Where a landed change departed from its spec, the TODO archive entry for
the task says so; the code and the maintained docs are right.

`docs/archive/2026-09-06-websocket-server-echo-review.md` is the review of
the `websocket-server-echo` branch against its spec and plan. Its findings
were fixed in commits inserted after the ones they address before the merge,
so it is a record, not open work.
