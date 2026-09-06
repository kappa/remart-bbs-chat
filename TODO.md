# Tasks and review issues

Items from the code review. The pending-commit matching finding (item 5 in the
review) is intentionally excluded.

Tasks 10 and 11 record the approved direction for the rewrite: server echo and
WebSocket chat transport. They superseded preserving optimistic rendering and
repairing the HTTP character stream, and are now implemented.
The existing review issues remain useful failure cases for the rewrite.

For every protocol-affecting task, update [docs/PROTOCOL.md](docs/PROTOCOL.md)
in the same change as the implementation and tests. Keep schemas, examples,
message direction, ordering, errors, and lifecycle behavior consistent with code.
Describe implemented behavior there; keep future proposals in these tasks.

## Recommended implementation order

Keep issue numbers stable; use this order for execution:

| Order | Tasks | Reason |
| --- | --- | --- |
| 1 | 6 — Build and setup | Establish a reliable build/test workflow. |
| 2 | 1 — Participant authorization | Establish credentials for HTTP mutations and socket sessions. |
| 3 | 4 — Stale-room joins | Make session creation reliable before implementing recovery. |
| 4 | 11 + 7 — WebSocket transport and development routing (done) | Establish the server protocol and local verification. Incorporate issues 2 and 3 into delivery/reconnection behavior. |
| 5 | 10 — Server echo (done) | Switch the client to authoritative events, remove optimistic state, and finish retiring HTTP chat mutations. |
| 6 | 12 — Last 20 lines on join | Implement on the new snapshot/rendering path rather than the client logic being removed. |
| 7 | 5 — Unicode deletion | Fix deletion in the surviving server-authoritative path. |
| 8 | 8 — Production helpers | Consolidate surviving logic and remove obsolete helpers/tests. |

Task 9 (regression coverage) accompanies every step, with a final integration
pass; it is not deferred until the end. Tasks 11 and 10 are one coordinated
migration: establish the server protocol before switching the client, and retire
old endpoints after the switch. Issue 2's stalled-input failure is solved within
WebSocket recovery rather than by a separate HTTP retry system; issue 3's
transient-failure behavior lives in the same connection lifecycle.

This order assumes the rewrite is next. If the current application will remain
deployed for an extended period, bring fixes for issues 3 and 5 forward.

## 1. Require participant authorization for mutations

- [x] **High priority** (done: per-participant token issued at join, required for char/backspace/commit/heartbeat/leave)
- **Location:** `server/index.js` mutation routes; `client/src/api.ts`.
- **Problem:** Requests trust public room and participant IDs. Another caller
  can insert characters, erase text, commit lines, leave, or refresh presence
  as another participant. Unauthorized character insertion was reproduced.
- **Suggested fix:** Issue an unpredictable participant token at join and
  require it for participant mutations. Do not expose it in public room state.
- **Acceptance:** Requests with missing or incorrect tokens cannot mutate a
  participant; valid requests, heartbeats, and page-exit leave still work.
- **Protocol docs:** Update [PROTOCOL.md](docs/PROTOCOL.md) with token issuance,
  HTTP/socket credential transport, authorization errors, and session/leave
  examples. Remove the unauthenticated-mutation caveat only once fixed.

## 2. Recover missing operations in the sequence stream

- [x] **High priority** (done: one ordered socket; unconfirmed keystrokes replayed after reconnect, duplicates ignored by seq, gaps reported as seq-gap)
- **Location:** `client/src/App.tsx` operation dispatch;
  `server/index.js` `handleSeqOp` and `drainBufferedOps`.
- **Problem:** A failed request consumes a client sequence number without a
  retry. Every later operation remains buffered waiting for that missing
  number. This stalled state was reproduced; the buffer has no size bound.
- **Suggested fix:** Solve this in task 11's WebSocket delivery/recovery policy.
  If replay is supported, retain unacknowledged operations and deduplicate retries.
  Alternatively, explicitly report uncertain/lost input and resume from server
  state. Bound any buffers. A standalone fix for the old HTTP stream would need
  retries using the original sequence numbers, but is not the planned approach.
- **Acceptance:** Lost input does not permanently block subsequent typing after
  recovery. Any replay cannot apply an operation twice; without replay, uncertain
  input is reported. Test character, backspace, and commit across disconnects
  and the ordering guarantees of the chosen transport.
- **Protocol docs:** Update [PROTOCOL.md](docs/PROTOCOL.md) with implemented
  sequencing, acknowledgments, retry/replay policy, buffer limits, and recovery
  guarantees. Replace HTTP sequencing details when task 11 retires them.

## 3. Preserve sessions through transient polling failures

- [x] **Medium priority** (done: no room-state poll remains; a session ends only on unknown-participant, leave command, or the user's own leave)
- **Location:** `client/src/App.tsx` room-state session-expiration effect;
  `client/src/api.ts` error handling.
- **Problem:** Any room-state request error clears the session, including a
  temporary network failure or server error. The server may still hold the
  participant's handle, preventing immediate rejoining.
- **Suggested fix:** Distinguish transient failures from confirmed missing
  rooms or participants. Preserve the session while attempting recovery.
- **Acceptance:** A failed poll followed by a successful poll keeps the user
  joined; confirmed removal still ends the session.
- **Protocol docs:** Update [PROTOCOL.md](docs/PROTOCOL.md) to distinguish
  recoverable failures from expiration and describe revised error handling,
  retry timing, and client session transitions.

## 4. Avoid successful joins into deleted rooms

- [x] **Medium priority** (done: room recreated under same id with history carried over, join lands live)
- **Location:** `server/index.js` `/api/join` and `cleanupStaleInRoom`.
- **Problem:** Cleaning up the last stale participant deletes the room, but
  the join handler adds the newcomer to the detached room object. Reproduced:
  join returns HTTP 200, then room-state immediately returns HTTP 404.
- **Suggested fix:** Recheck room existence after cleanup, or explicitly
  coordinate cleanup and joining so a successful join retains a live room.
- **Acceptance:** Joining a room whose occupants are all stale either returns
  a valid, discoverable session or a clear failure the client can handle.
- **Protocol docs:** Update [PROTOCOL.md](docs/PROTOCOL.md) with resulting
  join/cleanup behavior and any changed response status; remove the detached-room
  caveat once fixed.

## 5. Delete Unicode characters without corrupting surrogate pairs

- [ ] **Medium priority**
- **Location:** `server/index.js` `applyBackspaceOperation`;
  `client/src/App.tsx` local deletion, rollback, and remote backspace handling.
- **Problem:** `slice(0, -1)` deletes one UTF-16 code unit. Deleting `😀` leaves
  an unpaired surrogate instead of empty text; this was reproduced.
- **Suggested fix:** Define consistent Unicode-aware deletion semantics and
  use them on the server and in all client deletion paths.
- **Acceptance:** One backspace removes a single emoji without malformed
  text, and all viewers converge. Cover ASCII, Cyrillic, supplementary Unicode
  characters, and the chosen behavior for combining sequences.
- **Protocol docs:** Update [PROTOCOL.md](docs/PROTOCOL.md) with the deletion unit
  and any changed validation or position semantics, replacing the current
  UTF-16 deletion limitation.

## 6. Repair the build entry point and setup documentation

- [x] **Development workflow** (done: root build delegates via `npm --prefix client run build`, README documents both installs)
- **Location:** Root `package.json` and `README.md`.
- **Problem:** The README uses `--workspace=client`, but no workspace is
  declared. The root build script invokes Vite without the client package's
  working directory or dependencies; root installation does not install the
  client dependencies.
- **Suggested fix:** Make the root build delegate to the client, and document
  installation for both packages (or deliberately configure workspaces).
- **Acceptance:** The documented commands install and build from a clean
  checkout, and `npm start` serves the built client.
- **Protocol docs:** If origins or ports change, update transport conventions
  in [PROTOCOL.md](docs/PROTOCOL.md).

## 7. Support application WebSockets during Vite development

- [x] **Development workflow** (done: Vite dev server removed; the built client is always served by Express)
- **Location:** `client/vite.config.ts`; `client/src/App.tsx` socket connection.
- **Problem:** The client connects to the current page host, while Vite only
  proxies `/api` and `/health`. Application WebSocket traffic does not reach
  Express when the page is served on port 5173.
- **Suggested fix:** Configure an application socket path and development
  proxy, or provide an explicit development socket URL. Preserve Vite HMR.
- **Acceptance:** Two clients served by Vite receive live character and
  backspace events through Express, and hot reload continues to work.
- **Protocol docs:** Update [PROTOCOL.md](docs/PROTOCOL.md) with the socket URL/path,
  development routing, and production differences; remove the missing-proxy
  caveat once fixed.

## 8. Make helper tests exercise production logic

- [ ] **Maintainability** (partly done: computeDocumentLines and isValidChar are the only paths; remaining: none known, verify and close)
- **Location:** `client/src/documentLines.ts`, `client/src/App.tsx`, and their tests.
- **Problem:** Character validation and document-ordering logic are duplicated;
  testing the extracted helpers does not ensure the component uses that logic.
- **Suggested fix:** After server echo, consolidate surviving reusable logic and
  call it from production code. Remove obsolete optimistic helpers/tests rather
  than recreating that behavior. Preserve idle-row filtering; the existing
  ordering helper is not a drop-in replacement.
- **Acceptance:** Helper tests cover functions actually used by the component,
  with component tests covering authoritative updates, recovery, and rendering.

## 9. Add regression coverage for the retained review findings

- [ ] **Testing**
- **Location:** `test-server-*.js` and `client/src/*.test.{ts,tsx}`.
- **Problem:** The review exposed failure paths that need explicit regression
  protection. Existing client WebSocket stubs do not validate the real transport.
- **Suggested fix:** Add focused tests alongside fixes for authorization,
  missing sequence recovery, transient polling errors, stale-room joins, and
  Unicode deletion. Verify the development socket connection separately.
- **Acceptance:** Tests demonstrate the original failure and pass after each
  fix. Run relevant server/client suites and the client build, and report any
  checks that could not run. The review used isolated reproductions; full suites
  were not run because dependencies were not installed.

## 10. Rewrite transcript rendering for server echo (no local echo)

- [x] **Requested architecture change** (done: transcript renders only from live/committed echoes; commands recognized on the server)
- **Goal:** Display chat content only after receiving authoritative server
  state or events. Accept round-trip latency for visible typing in exchange
  for removing optimistic rendering and reconciliation complexity.
- **Code:** [Client state and pending commits](client/src/App.tsx),
  [document helpers](client/src/documentLines.ts),
  [server operation application and broadcasts](server/index.js).
  In `App.tsx`, review `optimisticContent`, `pendingCommits`, `draftLineIdx`,
  `finishedDraftIdxsRef`, `documentLines`, the WebSocket effect,
  `appendCharacter`, `eraseCharacter`, and `submitActiveLine`.
- **Work:**
  - Send input without changing displayed transcript content or predicting
    server line allocation. Apply server events through the same rendering
    path for the sender and all other participants; remove own-event skipping.
  - Remove optimistic buffers, pending-commit matching, guessed line indices,
    finished-draft tracking, and rollback paths made unnecessary by server echo.
    A local idle caret can remain a UI affordance without predicting chat text.
  - Keep accepting ordered input while echo is delayed. In particular, send
    Backspace even if the displayed draft is empty but earlier input is in
    flight; do not make input decisions from lagging displayed content.
  - Interpret Enter and single-character commands against the server's current
    draft. Move command recognition out of the client's displayed-buffer logic
    (`submitActiveLine` and `clearActiveCommand`); return any required UI result
    from the server. Preserve exact `l`, `?`, and `q` command semantics.
  - Preserve server line ordering, author colors, Unicode behavior, paste limits,
    viewer-accumulated scrollback, and scroll position. Retain current join-time
    filtering until task 12 replaces it with an initial 20-line history window.
    Keep snapshot/event recovery coherent; no local echo does not remove the
    need to handle reconnection or prevent stale snapshots replacing newer data.
- **Tests:** Adapt [race tests](client/src/App.race.test.tsx),
  [regression tests](client/src/App.regression.test.tsx),
  [rendering tests](client/src/App.rendering.test.tsx), and
  [Enter-latency tests](test-server-regression-enter-latency.js) to the new
  contract. Replace expectations requiring immediate local text with checks
  that text changes only on server echo. Test fast input under delayed echo,
  including `A`, Enter, `B`, Backspace, `C`, and a command followed by Enter.
- **Acceptance:** Before echo, typing, deletion, and Enter do not mutate the
  transcript. After echo, sender and observers show the same server-ordered
  result. Continued typing does not wait for individual acknowledgements.
  No optimistic transcript reconciliation remains.
- **Related work:** Coordinate with task 11; this task owns display semantics,
  while task 11 owns transport and delivery recovery. Update
  [UX](docs/USER_EXPERIENCE.md), [design](docs/DESIGN.md), [README](README.md),
  and [agent guidance](AGENTS.md) when implemented so they no longer require
  optimistic rendering or promise immediate local character display.
- **Protocol docs:** Rewrite client interpretation, commands, timing, and example
  exchanges in [PROTOCOL.md](docs/PROTOCOL.md) for server echo. Document new server
  command results and remove obsolete optimistic reconciliation descriptions.

## 11. Make WebSocket the primary chat transport

- [x] **Requested architecture change** (done: /ws carries hello, key, snapshot, live, committed, roster, command, error; HTTP chat routes retired)
- **Goal:** Carry the actual chat character stream over WebSocket in both
  directions. Reserve separate HTTP requests for session setup and auxiliary
  operations; do not use HTTP character, backspace, or commit requests as a
  fallback chat stream.
- **Code:** [Server socket handler and REST mutation routes](server/index.js),
  [client input dispatch and socket lifecycle](client/src/App.tsx),
  [REST client](client/src/api.ts), and [Vite proxy](client/vite.config.ts).
  Review `wss.on('connection')`, `broadcastChar`, `broadcastRoom`,
  `handleSeqOp`, `drainBufferedOps`, `/api/char`, `/api/backspace`, `/api/commit`,
  and the client `sendChar`, `sendBackspace`, and `commitLine` call sites.
- **Work:**
  - Define validated client input messages for character, backspace, and Enter,
    plus authoritative server updates and command results. Include enough
    server state in updates to render without an HTTP fetch per keystroke.
  - Bind the socket to an authorized participant/session (coordinate with
    issue 1), and broadcast applied input to the sender as well as observers.
  - Send keyboard, mobile input, paste, and Enter through one ordered socket
    stream. Use ordering within an established connection to simplify the
    existing HTTP out-of-order operation buffer where possible.
  - Define initial snapshot/subscription ordering and reconnect recovery so
    updates are neither missed nor applied twice. Explicitly handle input sent
    around a disconnect: choose acknowledged replay or clearly reported loss,
    rather than assuming ordering on one connection solves reconnect ambiguity.
  - Define disconnected-input behavior and bound any outgoing/replay queues.
    Show connection state and recover without permanently wedging input or
    silently falling back to HTTP chat mutations (see issues 2 and 3).
  - Keep HTTP for room discovery, create/join, and appropriate auxiliary
    requests such as leave, health, or recovery snapshots. Remove the client's
    HTTP chat call sites and retire the corresponding server endpoints as part
    of the rewrite. Live transcript updates must not rely on periodic polling.
  - Configure development WebSocket routing while preserving HMR (issue 7),
    and verify the built client against Express as well.
- **Tests:** Extend [WebSocket integration tests](test-server-websocket.js) and
  [Enter-latency tests](test-server-regression-enter-latency.js); adapt
  [sequence tests](test-server-seq.js) to the chosen delivery contract.
  Upgrade [client socket stubs](client/src/test-setup.ts) and component tests
  to exercise echoed updates, disconnects, and reconnection.
- **Acceptance:** A multi-client session sends characters, backspaces, paste,
  and Enter exclusively over WebSocket; sender and observers receive the
  resulting updates without per-operation HTTP requests. Ordered rapid input,
  authorized access, reconnect recovery, and bounded queues are verified.
  HTTP session setup and auxiliary requests continue working.
- **Related work:** Implement in coordination with task 10. Reassess issue 2's
  proposed HTTP retry solution under this transport design, retaining its
  requirement that a lost operation cannot permanently block later input.
  Update [design](docs/DESIGN.md), [README](README.md), and
  [agent guidance](AGENTS.md) to document the implemented transport contract.
- **Protocol docs:** Update [PROTOCOL.md](docs/PROTOCOL.md) alongside migration:
  document socket schemas, authentication, snapshot/subscription handshake,
  errors, disconnect/replay policy, and emission order. Replace retired HTTP
  chat routes and revise the diagram and delivery guarantees to match the code.

## 12. Show the last 20 room lines to a newly joined participant

- [ ] **Requested feature**
- **Goal:** Seed a new participant's transcript with up to 20 existing committed
  lines, then continue showing live typing and subsequent committed lines.
- **Code:** [Room storage, join handler, and room-state snapshot](server/index.js),
  [history accumulation and visible-history filtering](client/src/App.tsx),
  [snapshot response types](client/src/api.ts), and
  [document ordering helpers](client/src/documentLines.ts).
  Review `room.lines`, `/api/join`, `/api/room-state`, `historyAccum`,
  `visibleHistory`, and both client filters comparing `committedAt` to `joinedAt`.
- **Existing behavior:** The server already stores committed lines in memory
  in `room.lines` and returns up to 100 in a recovery snapshot. The client
  explicitly filters out pre-join history. No database or new persistence service
  is needed. The current 100-line response limit does not bound stored history.
- **Scope and interpretation:**
  - Count logical committed transcript lines, not screen rows produced by
    wrapping. Use transcript order (`lineIdx`) to select the last 20 and show
    them oldest to newest; commit arrival order can differ during concurrent
    typing. Preserve author color snapshots and blank lines.
  - Treat existing join/leave announcements as transcript lines within the 20.
    Select the historical window before adding the new participant's own join
    announcement. Live drafts are separate current state, not part of the 20.
  - Show all available committed lines when fewer than 20 exist. Keep rooms
    ephemeral: history disappears when the room is deleted or the server
    restarts. Persistence across empty rooms or restarts is outside this task.
- **Work:**
  - Define the initial history selection in the server's join/snapshot contract.
    Capture it at a defined point and deliver later events without gaps or
    duplicates, including commits occurring during join.
  - Replace blanket pre-join filtering with the selected initial window plus
    subsequent events. Do not simply expose the entire 100-line recovery snapshot.
  - Seed the viewer's accumulated history once for a new session. Later snapshots
    or reconnections must not truncate already-seen scrollback to 20 lines or
    introduce older pre-join lines outside the selected window. Deduplicate by
    stable line identity and reset history when changing sessions/rooms.
  - Reuse existing in-memory storage. Keep the initial 20-line display limit
    distinct from storage retention and recovery limits; do not trim `room.lines`
    to 20 without accounting for recovery and monotonic line-index allocation.
  - Update [UX](docs/USER_EXPERIENCE.md), [design](docs/DESIGN.md),
    [README](README.md), and [agent guidance](AGENTS.md) when implemented to
    replace the current promise that no pre-join text is shown.
- **Tests:** Add server selection/snapshot tests and client rendering tests for
  rooms with 0, fewer than 20, exactly 20, and more than 20 existing lines.
  Cover commit order differing from transcript order, blank/system lines,
  departed-author colors, concurrent join/commit, reconnect deduplication,
  accumulated scrollback longer than 20, and room switching.
- **Acceptance:** New participants see exactly the last 20 existing committed
  transcript lines (or all if fewer), in server transcript order and original
  colors, plus current live state and subsequent events. Existing viewers lose
  no scrollback. Resizing does not change which logical lines were selected.
- **Order:** Implement after task 10 so it uses the final server-echo rendering
  path. Include its tests under task 9 before proceeding to final helper
  consolidation.
- **Protocol docs:** Update [PROTOCOL.md](docs/PROTOCOL.md) with initial-history
  payloads, the 20-line selection rule and join boundary, snapshot/event ordering,
  and reconnect behavior. Replace the current no-pre-join-history description
  and update join/snapshot examples in the same change as the feature.
