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

Tasks 1, 4, 6, 7, 10, 11, and 13 are done and tasks 8 and 9 are closed; see
their checkboxes. Keep task numbers stable; execute the remaining open tasks
in this order:

| Order | Task | Reason |
| --- | --- | --- |
| 1 | 13 — Keep a mouse selection | Bug, small, isolated to the chat area's click handler. |
| 2 | 19 — Mobile keyboard | Bug for phone users; no dependencies, needs a device check. |
| 3 | 5 — Unicode deletion | Bug; server-only now, and defines the deletion unit that task 14 builds on. |
| 4 | 12 — Last 20 lines on join | High-priority feature; the last review item that changes the protocol, so land it before other features add their own. |
| 5 | 14 — Caret editing | Protocol change; needs task 5's unit. |
| 6 | 16 — Clickable URLs | Row rendering; independent. |
| 7 | 18 — Private messages | First message type outside the transcript; brainstorm and spec first. |
| 8 | 20 — Restore the join sound | Low priority, unconfirmed. Test first; tasks 15 and 17 wait for it. |
| 9 | 15 — Join-sound switch | Needs a working chirp from task 20. |
| 10 | 17 — Mentions | Row rendering and a second sound; after 15 and 16. |

## Working a task

These rules apply to every task below and are written for an agent that has
only this file, `AGENTS.md`, and the repository.

- Read `AGENTS.md` first, then the task. The task's **Location** names the
  code to read; read it before changing anything. If the code disagrees with
  the task, the code is right about the present and the task is right about
  the goal: say so in the commit message and do the goal.
- Work test-first: write the failing test, watch it fail, make it pass, then
  refactor. A test that passes before the change proves nothing.
- One task per branch and per commit series; never mix tasks. Commit messages
  say what changed and why, in plain sentences, with no trailers, links to
  chat sessions, or tool names.
- Update the docs named in the task in the same commit as the code:
  `docs/PROTOCOL.md` for anything on the wire, `docs/USER_EXPERIENCE.md` for
  anything a user notices, `docs/DESIGN.md` for a changed rationale, and the
  "Behavior to preserve" list in `AGENTS.md` for a changed rule.
- Before claiming done, run all of these and paste the results into the
  commit message or the report:

  ```sh
  npm test
  npm --prefix client test
  npm --prefix client run typecheck
  npm --prefix client run build
  npm run check:browser
  ```

  The browser check needs a built client and a `google-chrome` binary. If it
  cannot run, say so; do not skip it silently.
- When the task names a decision it does not settle, and the choice would
  change what the user sees or what goes over the wire, stop and report
  instead of guessing. Everything else is yours to decide; write the decision
  down in the commit message.
- Close the GitHub issue named in **Source** when the task is merged, with a
  one-line comment naming the commit.

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

- [ ] **Bug**
- **Location:** `server/index.js` `applyBackspace` (one line: `liveText.slice(0,-1)`).
  Since server echo this is the only deletion site: the client sends a
  `backspace` keystroke and renders the echoed live line, so no client code
  changes. Tests: `test-server-ws.js`, the "Keystrokes" block, next to
  "backspace shortens the line".
- **Problem:** `slice(0, -1)` deletes one UTF-16 code unit. Deleting `😀`
  leaves an unpaired surrogate instead of empty text; this was reproduced.
- **Facts to rely on:**
  - Input already arrives one code point at a time. `isValidChar` on both
    sides accepts a string only if `Array.from(char).length === 1`, and the
    client splits pasted text with `Array.from`, so a combining sequence such
    as `e` + U+0301 reaches the server as two `char` keystrokes and is stored
    as two code points.
  - Live text is therefore a sequence of code points, and the deletion unit
    that matches the input unit is one code point.
- **Decision (settled here):** Backspace deletes one code point. A combining
  mark or an emoji modifier is its own code point and takes its own
  Backspace. Grapheme clusters (`Intl.Segmenter`) are not used now; if a
  later task wants grapheme deletion it changes the unit on both input and
  deletion together. Task 14 adds forward deletion and caret movement and
  must use this same unit.
- **Suggested fix:** Replace the body of `applyBackspace` with a code-point
  deletion, for example:

  ```js
  function applyBackspace(participant){
    const cps = Array.from(participant.liveText);
    participant.liveText = cps.slice(0, -1).join('');
  }
  ```

  Nothing else on the server changes: row ownership, the empty-line echo,
  and sequence handling stay as they are.
- **Guardrails:**
  - Do not touch `isValidChar` or the paste splitting; they already work in
    code points.
  - Do not change the `live` message shape or add a deletion-unit field to
    the protocol; the unit is a rule, documented in prose.
  - Do not add client-side deletion logic; the client must keep rendering
    only what the server echoes.
  - Backspace on an empty line must still echo the unchanged live line and
    advance `seq` (an existing test covers it; keep it green).
- **Tests (write first, in `test-server-ws.js`):**
  - `😀` then Backspace echoes `text: ''` and the row is kept.
  - `aЖ😀` then Backspace echoes `aЖ`; a second Backspace echoes `a`.
  - `e` + U+0301 then Backspace echoes `e` (documents the combining-mark
    rule).
  - Each new test must fail on the current code: the first one currently
    echoes a lone surrogate.
- **Docs:** In `docs/PROTOCOL.md` under the socket "Edge cases", add one
  sentence: Backspace removes one code point; combining marks are separate
  code points. In `docs/USER_EXPERIENCE.md`, in the typing section that
  describes Backspace, add that an emoji or a Cyrillic letter is one
  character to delete. Add the code-point rule to the "Behavior to preserve"
  list in `AGENTS.md` next to the Unicode-input bullet.
- **Success criteria:**
  - The three new server tests fail before the change and pass after it.
  - `npm test` passes with no other test changed.
  - The client suite, type check, build, and `npm run check:browser` pass.
  - The three doc edits are in the same commit as the code.

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

- [x] **Maintainability** (done: the component calls `computeDocumentLines` and `isValidChar` from `documentLines.ts`, the optimistic helpers and their tests are gone, and the client validator matches the server's)
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

- [x] **Testing** (done: authorization, sequence recovery, session survival, stale-room joins, reconnect replay, and scrollback each have named server or client tests; the Unicode case is tracked under task 5; the development socket item is obsolete since the Vite dev server was removed)
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

- [ ] **Requested feature, high priority**
- **Goal:** Seed a new participant's transcript with up to 20 existing committed
  lines, then continue showing live typing and subsequent committed lines.
- **Location:**
  - `server/index.js`: the `/api/join` route (it runs `cleanupStaleInRoom`,
    computes `joinRowIdx`, builds the participant, stores the join
    announcement through `storeLine`, and returns `participant` with
    `joinedAt`); `snapshotMessage` (last 100 lines of `room.lines` sorted by
    `row`).
  - `client/src/roomState.ts`: `applyServerMessage` drops lines with
    `committedAt < joinedAt` in its `snapshot` and `committed` cases.
  - `client/src/useRoomConnection.ts`: `RoomSession` carries `joinedAt` and
    passes it to the reducer.
  - `client/src/App.tsx`: the `Session` type, `readSession` (rejects a stored
    session without a numeric `joinedAt`), and `finishJoin` (builds the
    session from the join response).
  - `client/src/api.ts`: `JoinedParticipant` type of the join response.
  - Tests: `test-server-api.js` (join), `test-server-ws.js` (snapshot),
    `client/src/roomState.test.ts`, `client/src/App.rendering.test.tsx`
    ("lines committed before the join are not shown"),
    `client/src/App.regression.test.tsx` (truncated snapshot, session switch),
    and the fixtures in `client/src/testing/roomFixtures.tsx` (`SESSION`).
- **Existing behavior:** The server stores committed lines in memory in
  `room.lines`; the `snapshot` sent on every socket connect carries the last
  100 sorted by row. The client accumulates every committed line seen since
  the session began and hides lines committed before the session's
  `joinedAt`. No database or new persistence service is needed. The 100-line
  snapshot limit does not bound stored history.
- **Decision (settled here): a row boundary chosen at join.** At join, before
  the participant's own announcement is stored, the server selects the last
  20 committed lines by row and records the smallest row among them as the
  participant's `historyFromRow` (when the room has no committed lines, use
  `joinRowIdx`). The client shows a committed line when
  `line.row >= historyFromRow || line.committedAt >= joinedAt`. The first
  clause is the 20-line window, exact by construction (rows are unique per
  line and ordered as the transcript). The second clause keeps a line whose
  row was claimed before the join but committed after it, so a line the
  newcomer watched being typed does not vanish when it commits. `joinedAt`
  stays; `historyFromRow` is added next to it everywhere `joinedAt` travels:
  join response, stored session, hook, reducer.
- **Work, in this order:**
  1. Server test in `test-server-api.js`: join responses carry
     `participant.historyFromRow` equal to the row of the 20th-newest line, or
     the join announcement's row when fewer than 20 exist (cover 0, 5, 20, 25
     existing lines; drive lines through a socket with Enter as the existing
     snapshot test does). Then implement in `/api/join`: compute before
     `storeLine(... joined ...)`, store on the participant object, include in
     the response. Order the candidate lines by `row`, not by array order;
     `room.lines` is in commit order, which differs during concurrent typing.
  2. Client types: add `historyFromRow: number` to `JoinedParticipant`
     (`api.ts`), `Session` (`App.tsx`), `RoomSession`
     (`useRoomConnection.ts`), and the `SESSION` fixture. `readSession`
     rejects a stored session without a numeric `historyFromRow`, the same
     way it rejects one without `joinedAt` (users from before this change
     rejoin once).
  3. Reducer tests in `roomState.test.ts`, then change `applyServerMessage`
     to take `{ joinedAt, historyFromRow }` and apply the rule above in both
     the `snapshot` and `committed` cases. Cases: exactly 20 shown from 25;
     all 5 shown from 5; a line with a row below the boundary but committed
     after `joinedAt` is shown; a line with a row below the boundary and
     committed before `joinedAt` is hidden; a later, truncated snapshot adds
     nothing older and removes nothing.
  4. Rendering test: a snapshot with 25 committed lines and
     `historyFromRow` set to the 6th line's row renders the last 20 in row
     order with their stored colors, including a `* Bob joined` announcement
     and a blank line inside the window.
  5. Docs (same commit): `docs/PROTOCOL.md` join response example and field
     list, the stored-session shape under "Identity and stored state", the
     "Client behavior" sentence about hidden lines, and the snapshot section
     (the 100-line snapshot is unchanged; the window is a client rule fed by
     the join response). `docs/DESIGN.md` line "Nothing from before you
     joined is shown" becomes the 20-line rule with its reason (enough to
     follow the conversation, not the whole history). `docs/USER_EXPERIENCE.md`
     bullet "You see everything written since you joined. Nothing from before
     you..." becomes: the last 20 lines from before you joined, then
     everything since. `AGENTS.md` "Behavior to preserve": replace the
     `joinedAt` sentence with the two-clause rule.
- **Guardrails:**
  - Do not trim `room.lines`, change the 100-line snapshot, or add a second
    history request; the window is a filter over what the snapshot already
    carries.
  - Do not remove `joinedAt`; the second clause needs it.
  - Do not select by `committedAt`: millisecond ties make the count inexact.
  - Do not count live lines or the newcomer's own announcement in the 20; the
    boundary is computed before that announcement exists.
  - Keep `applyServerMessage` pure and keep its identity-preserving returns
    (a no-op message returns the same object).
  - Keep the reconnect behavior: a later snapshot never removes accumulated
    lines and never adds lines older than the window.
- **Acceptance:** New participants see exactly the last 20 existing committed
  transcript lines (or all if fewer), in server transcript order and original
  colors, plus current live state and subsequent events. Existing viewers lose
  no scrollback. Resizing does not change which logical lines were selected.
- **Success criteria:**
  - The new server, reducer, and rendering tests fail before their step and
    pass after it; the whole server and client suites pass.
  - `npm run check:browser` passes; then extend it or check by hand: Alice
    commits 25 lines, Bob joins and sees lines 6 to 25 followed by
    `* Bob joined`; Alice's tab still shows all 25.
  - Type check and build pass; the four doc files are updated in the same
    commit.

## Product issues from GitHub

Tasks 13 to 20 come from the repository's GitHub issues, one task per issue,
imported 2026-09-06. Task numbers stay stable; the GitHub issue number is in
each task's **Source** line. These are product requests, not review findings.
They have no fixed order relative to tasks 1 to 12, except where a task says
so, and they assume the server-echo rendering path from tasks 10 and 11.
Close the GitHub issue when the task is done.

## 13. Keep a transcript text selection after the mouse is released

- [x] **Bug** (done: chat-area clicks skip keyboard focus while the document selection is non-collapsed; keystrokes are handled by a document-level listener keyed on the active element, so typing works without a click after a selection)
- **Source:** [GitHub issue #2](https://github.com/kappa/remart-bbs-chat/issues/2).
- **Location:** `client/src/App.tsx`: the session view's
  `<section id="chat-area" ... onClick={focusKeyboard}>`, `focusKeyboard`
  (focuses the hidden `.keyboard-capture` textarea with `preventScroll`),
  `onKeyDown` (attached to the same section), and the `Escape` listener on
  `document` that closes help, which is the pattern for a document-level key
  listener. Transcript rows are keyed by `row.key` from `computeDocumentLines`
  (line ids for committed rows, participant ids for live rows). Tests:
  `client/src/App.rendering.test.tsx` and the fixtures in
  `client/src/testing/roomFixtures.tsx` (`renderJoined`).
- **Problem:** Selecting a piece of the transcript with the mouse is lost the
  moment the button is released. The `click` that ends a drag runs
  `focusKeyboard`, and focusing a textarea collapses the document selection.
  A second effect: clicking non-focusable transcript text blurs the textarea,
  so after a selection the next keystroke goes nowhere until the user clicks
  again.
- **Decision (settled here):**
  - The chat area's click handler focuses the keyboard only when the document
    selection is collapsed. Read it at click time with
    `window.getSelection()`; treat `null`, `rangeCount === 0`, or
    `isCollapsed` as "no selection".
  - Typing must work without a click after a selection. Move keystroke
    handling to a `document` `keydown` listener that is active only while a
    session exists and only when `document.activeElement` is the body, the
    chat section, or the keyboard textarea. When it accepts a key, it focuses
    the textarea (so mobile input and later keys land there) and handles the
    key exactly as `onKeyDown` does today. Keys arriving while a button, the
    lobby input, or the help overlay has focus are left alone.
- **Suggested fix:**
  1. Test first (rendering suite): render joined; create a range over a
     committed line's text node and add it to `window.getSelection()`; fire a
     `click` on the chat area; assert `document.activeElement` is not the
     textarea and the selection is still not collapsed. A second test: with a
     collapsed selection, the click focuses the textarea (this passes today;
     it guards the regression).
  2. Change `focusKeyboard`'s caller on the section to a small handler that
     checks the selection and then calls `focusKeyboard`. Keep the "Type"
     button and the post-join focus timer calling `focusKeyboard` directly.
  3. Test: after the selection test's click, `fireEvent.keyDown(document.body,
     { key: 'A' })` sends `{ kind: 'char', char: 'A' }` over the fake socket
     and focuses the textarea. And: with a roster button focused, the same
     keydown sends nothing.
  4. Register the document listener in an effect keyed on `session`, reuse the
     `onKeyDown` logic (extract the key-to-keystroke mapping into a function
     both paths call), and remove or keep the section's `onKeyDown` as a
     no-op; keeping both must not send a keystroke twice, so test that one
     `A` produces exactly one `char` message.
  5. Verify by hand in Chrome and Firefox: drag across three lines, release,
     press Ctrl+C, paste elsewhere; then type without clicking and see the
     text echo.
- **Guardrails:**
  - Do not call `preventDefault` on `mousedown` in the chat area; that is what
    would stop the browser from selecting text at all.
  - Do not change `user-select` in CSS.
  - Do not move focus on `mousedown`; the selection has not happened yet.
  - Ctrl+C, Ctrl+V, Ctrl+A and other modifier combinations must keep their
    browser meaning: the existing early return on `metaKey || ctrlKey ||
    altKey` in the key handler stays.
  - Do not re-render the transcript on selection changes; nothing in state
    should track the selection.
  - Row keys stay as they are; do not wrap the transcript in a new element
    that is recreated on every message.
- **Acceptance:** Select text across several transcript lines with the mouse,
  release, and the selection stays; Ctrl+C copies it. A plain click still
  focuses input. Incoming echoes and committed lines do not clear an existing
  selection. Typing after a selection, without clicking, still reaches the
  room. On mobile the native selection handles behave as usual.
- **Success criteria:**
  - The selection-click test and the document-keydown test fail before the
    change and pass after it; the double-send test passes.
  - Every existing client test passes unchanged, in particular the fast-input
    tests in `App.race.test.tsx`, which type through the chat area.
  - `npm run check:browser` passes (it clicks the chat area before typing).
  - The manual Chrome and Firefox check is recorded in the commit message.
  - `docs/USER_EXPERIENCE.md` mentions that transcript text can be selected
    and copied.

## 14. Edit the live line with arrows, Delete, Home, and End

- [ ] **Requested feature**
- **Source:** [GitHub issue #3](https://github.com/kappa/remart-bbs-chat/issues/3).
- **Depends on:** task 5 (the code-point deletion unit). Do task 5 first.
- **Location:**
  - `server/index.js`: `KEY_KINDS`, `handleKey` (sequence rules, then one
    branch per kind), `applyChar` (appends and claims a row on the first
    character), `applyBackspace`, `commitLive` and the command branch (both
    clear `liveText` and `liveRow`), `liveMessage` (`{type, participantId,
    row, text, seq}`), `liveLineOf` (snapshot live lines), `removeParticipant`
    (preserves nonempty live text).
  - `client/src/protocol.ts`: `KeyInput`, `LiveLine`, the `live` message.
  - `client/src/App.tsx`: `onKeyDown` (returns early on any modifier; handles
    Backspace, Enter, single characters), `onKeyboardInput` (mobile input
    events by `inputType`), `onPaste`, and the own live row rendering, which
    prints `participant.text` followed by the `.caret` span.
  - `client/src/roomState.ts`: the `live` case copies `row` and `text`.
  - `client/src/theme.css`: `.caret`.
  - Tests: `test-server-ws.js` "Keystrokes" block, `client/src/roomState.test.ts`,
    `client/src/App.race.test.tsx`, `client/src/App.rendering.test.tsx`,
    `client/src/App.regression.test.tsx`.
- **Problem:** A live line can only be appended to and backspaced. Arrow
  keys, Ctrl+Arrow, Delete, Home, and End do nothing, so a typo early in a
  long line means deleting everything after it.
- **Decisions (settled here):**
  - The server owns the caret, as it owns the live line. Each participant
    gets `liveCaret`, an index in code points into `liveText`, 0 when the
    line is empty.
  - New keystroke kinds: `left`, `right`, `word-left`, `word-right`, `home`,
    `end`, `delete`. `char` inserts at the caret and moves it right by one;
    `backspace` deletes the code point before the caret; `delete` deletes the
    code point after it. Each is one `key` message with its own `seq`, so
    replay, duplicate, and gap rules apply unchanged.
  - Word boundaries are whitespace-delimited. `word-left` moves to the start
    of the word before the caret (skipping whitespace first); `word-right`
    moves to the end of the word after the caret (skipping whitespace first).
  - The `live` message and snapshot live lines gain `caret: number`. It is
    sent to everyone; only the author's client renders it.
  - Movement on an idle line (no row) is a no-op that still echoes and
    advances `seq`, like Backspace on an empty line does today. Movement does
    not claim a row; only `char` does.
  - Enter commits the whole line regardless of caret position and resets the
    caret to 0; the commands `l`, `?`, `q` match the whole `liveText` as
    before.
  - Client keys: ArrowLeft, ArrowRight, Home, End, Delete; Ctrl+ArrowLeft and
    Ctrl+ArrowRight (also Alt+Arrow on macOS) for words. The early return on
    modifiers stays for every other key, so copy and paste keep working.
    Mobile: `inputType === 'deleteContentForward'` maps to `delete`; caret
    movement is not available from the on-screen keyboard and that is fine.
  - Paste inserts at the caret because it is a burst of `char` keystrokes.
- **Suggested fix, in this order:**
  1. Server tests first, one per kind, on a line `abc def` with the caret
     placed by the keys themselves: `left` from the end then `char x` gives
     `abc dexf` and caret 7; `home` then `delete` gives `bc def`; `delete` at
     the end and `left` at 0 are no-ops that echo; `word-left` twice from the
     end lands at 0; `word-right` from 0 lands after `abc`; Unicode: on
     `aЖ😀` `left` then `backspace` removes `Ж`; the snapshot's live line
     carries `caret`; commit resets the caret to 0; an unknown kind is still
     `invalid-message`.
  2. Server implementation: keep `liveText` a string, operate on
     `Array.from(liveText)` in one helper `editLive(participant, kind, char)`
     that returns nothing and updates `liveText` and `liveCaret`; clamp the
     caret into `[0, length]`; reset the caret wherever the line is cleared.
     Add `caret` to `liveMessage` and `liveLineOf`.
  3. Client types and reducer: extend `KeyInput`, add `caret` to `LiveLine`
     and the `live` message, copy it in the reducer, and keep the
     identity-preserving return when nothing changed (now including the
     caret).
  4. Client keys: test that ArrowLeft, Home, Delete, and Ctrl+ArrowRight send
     the right kinds and that Ctrl+C sends nothing; then map them in the
     shared key handler (see task 13 if it landed first; otherwise
     `onKeyDown`).
  5. Rendering: test that the own live row draws the caret at the echoed
     position (text `abc`, caret 1: `a`, caret, `bc`) and that an observer's
     row has no caret. Implement by splitting `Array.from(text)` at the caret.
     Mid-line, the caret should not push text sideways: render the code point
     under the caret in a span with a bottom border and no extra width; at
     the end of the line keep the existing `.caret` block.
  6. Docs (same commit): `docs/PROTOCOL.md` "Client to server" list, the
     `live` schema, the snapshot live-line schema, the edge cases (idle-line
     movement, deletion unit, word rule); `docs/USER_EXPERIENCE.md` typing
     section (replace the sentence that you backspace the whole thing and
     retype it); `AGENTS.md` behavior list (caret owned by the server, code
     point unit).
- **Guardrails:**
  - Never index `liveText` by UTF-16 unit; every position is a code point.
  - The client never predicts the caret or the text; it renders the echo.
    Before the echo arrives, nothing moves.
  - Do not add a separate caret message; the caret rides on `live`.
  - Do not change row allocation, sequence rules, the command matching, or
    the preserved-line behavior on leave.
  - Do not render the caret for other participants and do not send the
    author's caret to the roster or committed messages.
  - Keep Backspace on an empty line and Enter on an idle line exactly as they
    are (existing tests).
  - Do not touch the local preview row (the caret shown when idle) except to
    keep it the existing end-of-line block.
- **Acceptance:** Left/Right move one character, Ctrl+Left/Right one word,
  Home/End to the ends, Delete removes the character after the caret,
  Backspace the one before; typing inserts at the caret. Everyone sees the
  resulting text after the echo, only the author sees the caret. Emoji and
  Cyrillic move and delete as single characters. Paste inserts at the caret.
  Mobile input without these keys is unaffected.
- **Success criteria:**
  - New server, reducer, key-mapping, and rendering tests fail before their
    step and pass after; both suites pass in full.
  - Type check and build pass; `npm run check:browser` passes and is extended
    with one sequence: type `abd`, Left, type `c`, Enter, and both tabs show
    `abcd` committed.
  - The three doc files are updated in the same commit; the sequence
    diagram in PROTOCOL.md still renders (it is Mermaid, not JSON) and shows
    `caret` on its `live` messages.

## 15. Add a client-side switch to turn off the join sound

- [ ] **Requested feature**
- **Source:** [GitHub issue #4](https://github.com/kappa/remart-bbs-chat/issues/4).
- **Location:** `client/src/App.tsx` join-sound playback and the roster
  footer; browser `localStorage`.
- **Problem:** The two-tone chirp on every join cannot be turned off.
- **Suggested fix:** A checkbox in the roster footer labeled "Join sound",
  on by default, stored under a `remart-bbs-chat.sound` key in localStorage
  (through the existing storage helpers, which tolerate blocked storage).
  Consult the setting where the sound is played. Any later sounds (task 17's
  mention bell) respect the same switch or get their own; decide there.
- **Acceptance:** Unchecking the box stops the chirp for later joins in this
  browser; the choice survives a reload; the default is on. No server change.
- **Tests:** Roster test that a newcomer does not play the chirp when the
  setting is off, and does when it is on, using the audible-path assertion
  from task 20; a storage test for the persisted value.
- **Order:** After task 20; a switch for a silent sound cannot be tested.
- **Protocol docs:** none. Mention the switch in
  [USER_EXPERIENCE.md](docs/USER_EXPERIENCE.md).

## 16. Make URLs in transcript lines clickable

- [ ] **Requested feature**
- **Source:** [GitHub issue #5](https://github.com/kappa/remart-bbs-chat/issues/5).
- **Location:** `client/src/App.tsx` transcript row rendering; possibly a
  small pure helper next to `client/src/documentLines.ts`.
- **Problem:** A pasted link is plain text; the reader has to copy it out.
- **Suggested fix:** At render time, split a line's text into text and link
  segments with a conservative matcher (`http://` and `https://` followed by
  non-whitespace, trailing punctuation excluded) and render links as anchors
  opening in a new tab with `rel="noopener noreferrer"`. Keep the author
  color and monospace look; underline is enough to mark a link. Stored text
  and the wire format do not change. Apply to committed lines; for live
  lines decide whether a half-typed URL should already be a link (probably
  not until committed). Make sure the chat area's focus-on-click handler
  does not swallow the click on an anchor.
- **Acceptance:** A committed line containing `https://example.com/x` shows
  that span as a link that opens in a new tab; surrounding text is unchanged;
  text that merely looks like a domain without a scheme is not linked; no
  HTML injection is possible (text stays text, only anchors are created).
- **Tests:** Helper tests for the matcher (scheme required, trailing period
  or comma excluded, several links in one line, Unicode around links);
  rendering test that the anchor exists with the right href and attributes.
- **Protocol docs:** none.

## 17. Ring a bell and highlight `@nickname` mentions

- [ ] **Requested feature**
- **Source:** [GitHub issue #6](https://github.com/kappa/remart-bbs-chat/issues/6).
- **Location:** `client/src/App.tsx` transcript row rendering;
  `client/src/useRoomConnection.ts`, where `committed` messages arrive and
  the join chirp is triggered; the sound helper.
- **Problem:** Someone addressing you with `@yourname` is easy to miss, and
  the mention looks like any other text.
- **Suggested fix:** Client-side only: every client knows its own handle and
  the roster. When a committed line (not a live line, so the bell does not
  ring on every keystroke of a half-typed name) contains `@handle` matching a
  roster handle case-insensitively, render that token in the mentioned
  participant's color for everyone, and play a distinct short bell on the
  mentioned participant's client only. Mentions of handles that have since
  left keep plain text. Respect the sound switch from task 15 or add a
  second switch. Do not ring for lines committed before joining or for
  snapshot replays after a reconnect: ring only for a `committed` message
  seen for the first time.
- **Acceptance:** Bob commits "hi @Alice"; Alice hears the bell once and
  both see `@Alice` in Alice's color. `@alice` matches too. A line seen again
  through a reconnect snapshot does not ring again. The join chirp and the
  mention bell are distinguishable.
- **Tests:** Helper tests for mention detection; rendering test for the
  colored token; a test that the bell plays exactly once for a new committed
  line addressed to the own handle and not for others or for snapshot lines.
- **Protocol docs:** none.

## 18. Private messages from the roster

- [ ] **Requested feature**
- **Source:** [GitHub issue #7](https://github.com/kappa/remart-bbs-chat/issues/7).
- **Location:** `client/src/App.tsx` roster and session view;
  `server/index.js` socket message handling; `docs/PROTOCOL.md`.
- **Problem:** There is no way to say something to one person without the
  whole room seeing it.
- **Requested shape:** Click a nickname in the roster, type one line, press
  Enter; the recipient sees it as a popup. Keep it that simple.
- **Suggested fix:** Brainstorm and spec before implementing; this is the
  first feature that adds a message type outside the shared transcript.
  Points to settle: the private line is typed in a separate one-line input
  (in the roster footer or a small overlay), not in the shared live line, so
  the transcript and sequence numbers are untouched; a new client message
  `private { to: participantId, text }` and a server message to the recipient
  only `private { from: participantId, handle, color, text }`; the server
  validates the sender's socket, the recipient's presence, and the text
  (same character rule, a length cap); nothing is stored and nothing is
  replayed on reconnect; the recipient sees a popup with sender handle in
  the sender's color that dismisses on Escape, click, or a timeout; the
  sender gets brief feedback ("sent to Bob" or "Bob has left"). Escape
  cancels the private input and returns focus to the chat.
- **Acceptance:** Alice clicks Bob in the roster, types "lunch?", presses
  Enter; Bob sees a popup from Alice, Carol sees nothing, the transcript is
  unchanged. Sending to someone who has left reports it. Private messages
  are not in snapshots.
- **Tests:** Server tests for delivery to the recipient only, rejection of
  unknown recipients and bad text, and absence from snapshots; client tests
  for the input flow, the popup, and dismissal.
- **Protocol docs:** Add both messages, validation, and the no-persistence
  rule to [PROTOCOL.md](docs/PROTOCOL.md); describe the feature in
  [USER_EXPERIENCE.md](docs/USER_EXPERIENCE.md).

## 19. Keep the typing position above the on-screen keyboard on mobile

- [ ] **Bug** (code implemented: session layout sized to the visual viewport via --app-height/--app-offset, `interactive-widget=resizes-content` in the viewport meta, capture textarea moved to the top-left, resize re-follows a bottom reader; the real-device checks below still close this task)
- **Source:** [GitHub issue #8](https://github.com/kappa/remart-bbs-chat/issues/8).
- **Location:**
  - `client/index.html`: the viewport meta
    (`width=device-width, initial-scale=1, viewport-fit=cover`).
  - `client/src/theme.css`: `html, body, #root` are `height:100%` with
    `overflow:hidden`; `#container` is a flex row with `height:100vh` then
    `height:100dvh`; `#chat-area` scrolls (`overflow-y:auto`); `#roster` is a
    160px sticky column; `.keyboard-capture` is the hidden textarea, fixed at
    `left:2px; bottom:2px`, 2px square.
  - `client/src/App.tsx`: `wasNearBottomRef`, the effect that sets
    `chat.scrollTop = chat.scrollHeight` when `documentLines` change and the
    reader was near the bottom, `onChatScroll` (near-bottom means within
    80px), and `focusKeyboard`.
  - `docs/USER_EXPERIENCE.md` "On a phone" section.
  - Tests: `client/src/App.regression.test.tsx` "a reader scrolled up is not
    yanked down", which shows how the tests fake `scrollHeight` and
    `clientHeight`.
- **Problem:** On phones the chat works, but when the on-screen keyboard
  opens it covers the bottom of the transcript, where the caret and the
  newest lines are. The layout fills the layout viewport, which does not
  shrink when the keyboard appears on iOS Safari and, depending on settings,
  on Android Chrome; the page is scrolled instead, and the fixed textarea at
  the bottom edge invites iOS to scroll the page to reveal it.
- **Decisions (settled here):**
  - Size the session layout to the visual viewport, driven by
    `window.visualViewport`: on its `resize` and `scroll` events set two CSS
    variables on the `#container` element, `--app-height` to
    `visualViewport.height` in px and `--app-offset` to
    `visualViewport.offsetTop` in px. CSS uses
    `height: var(--app-height, 100dvh)` and
    `transform: translateY(var(--app-offset, 0px))` on `#container`.
  - Add `interactive-widget=resizes-content` to the viewport meta; browsers
    that honor it shrink the layout viewport and the variables then simply
    match it.
  - Move `.keyboard-capture` to the top-left corner (`top:2px; left:2px`)
    so focusing it never asks the browser to scroll the bottom edge into
    view.
  - When the visual viewport shrinks and the reader was near the bottom
    (`wasNearBottomRef`), scroll the chat to the bottom again after the
    resize, using the same rule the transcript effect uses.
  - Desktop is untouched by construction: without a keyboard the visual
    viewport equals the layout viewport, so the variables equal `100dvh` and
    offset 0. Browsers without `visualViewport` keep the CSS fallbacks.
- **Suggested fix, in this order:**
  1. Test first (regression suite): before rendering, define
     `window.visualViewport` as an object with `height`, `offsetTop`, and
     `addEventListener`/`removeEventListener` that store the listeners;
     render joined; set `height` to 400 and `offsetTop` to 120 and call the
     stored `resize` listener inside `act`; assert the container's inline
     style has `--app-height: 400px` and `--app-offset: 120px`; with the
     chat faked as scrolled to the bottom (see the existing scroll test),
     assert `scrollTop` equals `scrollHeight` after the resize; with it
     scrolled up, assert `scrollTop` is unchanged. Also assert the listeners
     are removed on unmount.
  2. Implement the effect in `App.tsx`, active only while a session exists,
     reading `window.visualViewport` once and returning if it is undefined.
  3. CSS and meta changes as decided; keep `100dvh` as the fallback and keep
     the existing `100vh` line before it for older browsers.
  4. Manual check on a real iPhone (Safari) and a real Android phone (Chrome):
     open a room, tap the chat, type a long line; the caret row and the
     newest lines stay above the keyboard; close the keyboard and the layout
     is whole again; rotate the phone. Record model, OS version, browser
     version, and the outcome for each in the commit message. If no device is
     available, say so in the report and stop before merging; the desktop
     checks alone do not close this task.
  5. Update the "On a phone" section of `docs/USER_EXPERIENCE.md`.
- **Guardrails:**
  - Do not change the desktop layout, the roster width, or the scroll rules
    for readers who scrolled up ("Do not force-scroll a viewer reading older
    text" in `AGENTS.md`).
  - Do not use `position:fixed` for the whole layout or lock `body` scrolling
    with JavaScript; the transform-plus-height approach is enough.
  - Do not scroll the window yourself except through the chat area's
    `scrollTop`.
  - Do not add a dependency for viewport handling.
  - The hidden textarea must stay tiny and effectively invisible; moving it
    must not make it visible or focusable by tab order changes.
  - Keep the help overlay usable: it uses `100dvh` in its own max-height and
    should follow the same variable if it overflows on a phone.
- **Acceptance:** On iOS Safari and Android Chrome, tapping the chat opens
  the keyboard and the caret row and the newest lines remain visible above
  it; closing the keyboard restores the layout; typing a long line keeps the
  caret in view. Desktop layout is unchanged.
- **Success criteria:**
  - The visual-viewport test fails before the change and passes after it;
    the existing scroll regression test still passes.
  - Both suites, the type check, the build, and `npm run check:browser` pass
    (the headless check has no keyboard and must see no difference).
  - The commit message records the two device checks with versions.
  - `docs/USER_EXPERIENCE.md` "On a phone" describes the behavior.

## 20. Restore the join sound

- [ ] **Bug, unconfirmed, low priority**
- **Source:** [GitHub issue #9](https://github.com/kappa/remart-bbs-chat/issues/9).
- **Location:** `client/src/App.tsx` `playJoinSound`;
  `client/src/useRoomConnection.ts` newcomer detection (`onNewcomer` fires on
  a `roster` or `snapshot` message that names a participant not seen before);
  `client/src/App.roster.test.tsx`; `client/src/test-setup.ts` AudioContext
  stub.
- **Problem:** In a manual two-tab test on 2026-09-06, in Chrome and in
  Firefox, no chirp was heard when the second participant joined. A
  headless-Chrome probe of the same build showed that `playJoinSound` runs on
  each newcomer and constructs an AudioContext, so the event path is intact
  and the failure is in producing audible sound. The existing roster test only
  asserts that an AudioContext is constructed, which is why it stays green.
- **Suggested fix:** Write the failing test first, as the issue asks. Find the
  cause in a real browser with the devtools console open on the listening
  tab: log `ctx.state` and the oscillator schedule at chirp time. Candidates,
  unconfirmed: a context created suspended by the autoplay policy and never
  resumed (each chirp makes a fresh context and never calls `resume()`);
  oscillators scheduled on a context that is closed 600 ms later; or a
  regression in the browsers themselves, which the tag
  `before-websocket-server-echo` can rule in or out by checking whether the
  chirp works on the pre-rewrite build. Likely shape of the fix: create one
  AudioContext lazily on the first click or keystroke in the chat area, keep
  it, call `resume()` before each chirp, and stop closing contexts per chirp.
- **Acceptance:** Two tabs in Chrome and Firefox: after at least one click or
  keystroke in the tab already in the room, that tab plays the chirp when
  someone joins. A tab that has never been interacted with stays silent, which
  browsers require; the docs say so.
- **Tests:** A client test that asserts the audible path, not construction:
  with a fake AudioContext that records its state, `resume()` calls, oscillator
  `start()` and `stop()` times, and gain values, a newcomer after a simulated
  user gesture produces a started oscillator on a running context, and a
  newcomer before any gesture does not throw. The test must fail on the
  current build before the fix. Record the two-browser check in the commit
  message.
- **Protocol docs:** none. Note the one-gesture requirement in
  [USER_EXPERIENCE.md](docs/USER_EXPERIENCE.md) next to the chirp sentence.
- **Order:** Before task 15 and before task 17's bell.
