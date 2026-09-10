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

Tasks 1, 4, 6, 7, 10, 11, 12, 13, 14, 15, 16, 19, 21, 22, 23, 24,
26, 27, 28, 29, and 30 are done and tasks 8, 9, and 20 are closed; see
their checkboxes.
Keep task numbers stable; the table below lists only the open tasks, in
the order to execute them:

| Order | Task | Reason |
| --- | --- | --- |
| 1 | 32 — Remove the Type button | Small, isolated client cleanup. |
| 2 | 33 — Clean up the help dialog | Small client content change; reflect the controls left after task 32. |
| 3 | 25 — Mention-handle autocomplete | Client input UI; land before mention styling so both share token rules. |
| 4 | 31 — Show AFK status | Roster protocol and lifecycle change after the isolated UI cleanups. |
| 5 | 18 — Private messages | First message type outside the transcript; brainstorm and spec first. |
| 6 | 17 — Mentions | Row rendering and a second sound; after 15, 16, and 25. |

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

- [x] **Bug** (done: `applyBackspace` deletes one code point via `Array.from`, matching the code-point input unit; row ownership, empty-line echo, and sequence handling unchanged)
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

## 12. Show the last 20 committed lines when joining

- [x] **Requested feature** (done; review fix makes snapshot selection server-owned and independent of timestamps)
- **Location:** `server/index.js` join and snapshot creation;
  `client/src/roomState.ts` snapshot/event accumulation.
- **Behavior:** Newcomers see the last 20 existing committed transcript rows
  (all if fewer), in row order with original colors, plus their announcement,
  current live state, and subsequent commits. Announcements and blank lines
  count; live lines and the newcomer's own announcement do not count in the 20.
- **Implemented rule:** Before storing the join announcement, the server
  records `historyFromRow` as the smallest row among the last 20 committed
  rows (or the join row when none exist), and `joinedLineCount` as the current
  length of the append-only committed-line array. Snapshots take the last 100
  appended lines, retain those with `row >= historyFromRow` or append index
  `>= joinedLineCount`, and sort by row. Reconnect keeps the original boundaries.
- **Review correction:** The original prescribed client predicate used
  `committedAt >= joinedAt`; tied milliseconds admitted excess pre-join lines,
  and stale preservation could drop a newly committed line with an older
  timestamp. Append order resolves both. The client now accumulates every
  delivered line, without a second history filter. `joinedAt` and
  `historyFromRow` remain join/session metadata; `joinedLineCount` is internal
  server state, so no new wire fields are needed.
- **Guardrails:** Keep the 100-line snapshot cap, accumulated client scrollback,
  stored author colors, live state, row ordering, and a scrolled-up reader's
  position. Do not trim `room.lines` or add a history request.
- **Coverage:** HTTP/socket tests cover history sizes, tied timestamps, and
  recovery of earlier live rows preserved at pre-join timestamps. Reducer and
  rendering tests verify server-selected history and accumulation without
  timestamp filtering. The browser check joins after 25 numbered lines and
  checks the newcomer's 20-line window and the existing viewer's full history.
- **Docs:** `docs/PROTOCOL.md`, `docs/USER_EXPERIENCE.md`, `docs/DESIGN.md`, and
  `AGENTS.md` describe the same implemented rule.

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

- [x] **Requested feature** (done: server-owned `liveCaret` echoed as `caret` on `live`; keystroke kinds `left`, `right`, `word-left`, `word-right`, `home`, `end`, `delete`; `char` inserts at the caret; client maps Arrow/Home/End/Delete and Ctrl/Alt+Arrows; mid-line the caret underlines the code point under it)
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

- [x] **Requested feature** (done: Join sound checkbox gating the chirp at its call site, persisted in localStorage; manually verified, GitHub issue #4 closed. Task 20 was later closed WONTFIX, so no audible-path change is pending at this call site)
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

- [x] **Requested feature** (done: render-time link splitter for committed lines; manually verified, GitHub issue #5 closed)
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
- **Spec and plan:** [docs/superpowers/specs/2026-09-09-mentions-design.md](docs/superpowers/specs/2026-09-09-mentions-design.md),
  [docs/superpowers/plans/2026-09-09-mentions.md](docs/superpowers/plans/2026-09-09-mentions.md).
  Where the plan and this task disagree, the spec records the approved decision.
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
- **Spec and plan:** [docs/superpowers/specs/2026-09-09-private-messages-design.md](docs/superpowers/specs/2026-09-09-private-messages-design.md),
  [docs/superpowers/plans/2026-09-09-private-messages.md](docs/superpowers/plans/2026-09-09-private-messages.md).
  Where the plan and this task disagree, the spec records the approved decision.
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

- [x] **Bug** (done: session layout follows the visual viewport, including
  when the keyboard is already open; confirmed working on-device by the issue
  reporter and GitHub issue #8 closed)
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

- [x] **Bug, confirmed flaky, low priority** (closed WONTFIX 2026-09-08: not
  a defect in the chirp code; the browser autoplay policy mutes a tab that has
  had no click or keystroke since its last page load. GitHub issue #9 closed
  as not planned with the root cause.)
- **Root cause:** `playJoinSound` creates a new AudioContext per newcomer.
  Without sticky user activation the browser creates it `suspended`, nothing
  scheduled on it renders, and it is closed 600 ms later; Chrome logs "The
  AudioContext was not allowed to start". After one click or keystroke in the
  tab the context is `running` and both oscillators end on schedule, background
  tab included. Activation is per page load, and a reload restores the session
  with no gesture, so the reloaded tab looks alive but is silent until touched.
  Reproduction: reload the listening tab, do not touch it, join from another
  tab (silent); press a key in it, join again (chirp). Measured in headless
  Chrome 151 by wrapping AudioContext to record state, `statechange`, and
  oscillator `ended` events. Keeping one context and calling `resume()` before
  each chirp would not change what a user hears here, so no code change.
- **Source:** [GitHub issue #9](https://github.com/kappa/remart-bbs-chat/issues/9).
- **Location:** `client/src/App.tsx` `playJoinSound`;
  `client/src/useRoomConnection.ts` newcomer detection (`onNewcomer` fires on
  a `roster` or `snapshot` message that names a participant not seen before);
  `client/src/App.roster.test.tsx`; `client/src/test-setup.ts` AudioContext
  stub.
- **Problem:** In a manual two-tab test on 2026-09-06, in Chrome and in
  Firefox, no chirp was heard when the second participant joined. A later
  issue comment confirms that sound sometimes works, so this is intermittent
  rather than a consistently silent path. A
  headless-Chrome probe of the same build showed that `playJoinSound` runs on
  each newcomer and constructs an AudioContext, so the event path is intact
  and the failure is in producing audible sound. The existing roster test only
  asserts that an AudioContext is constructed, which is why it stays green.
- **Suggested fix:** Write a deterministic failing test first, as the issue
  asks. Find the cause in a real browser with the devtools console open on the
  listening tab, testing several consecutive joins and recording `ctx.state`,
  `resume()` results, and the oscillator schedule at each chirp. Candidates:
  a context created suspended by the autoplay policy and never resumed (each
  chirp makes a fresh context and never calls `resume()`);
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

## Testing issues found during task work

Task 21 was found during the red step of task 5 on 2026-09-07, while running
the server WebSocket suite with newly written failing tests. It is local test
infrastructure, not a GitHub issue.

## 21. Leaked WebSockets block server-test teardown

- [x] **Bug, test infrastructure** (done: awaited socket cleanup after each test and before HTTP shutdown; permanent subprocess regressions)
- **Location:** `test-support.js` (`startServer` teardown); the lifecycle
  hooks in `test-server-ws.js` and `test-server-api.js`.
- **Problem:** An assertion failure can skip inline `ws.close()` or
  `roomWithTwo().done()`. The final `after` hook then waits indefinitely for
  `httpServer.close()` while an upgraded WebSocket connection remains open.
  This is unfinished teardown, not merely an otherwise-finished process
  failing to exit. A passing test that omits cleanup has the same problem.
- **Verified:** A deliberately failed assertion in the real WebSocket suite
  blocked teardown; terminating leftover server sockets let it exit normally
  with code 1. On Node 22.22.2, `--test-force-exit` did not resolve this hang.
  Calling `wss.close()` alone also leaves existing connections open.
- **Isolation:** `resetForTests()` clears rooms, not sockets. Connections can
  survive into later tests, including connections that never sent `hello`.
  Cleaning only participants is insufficient, especially after the room map
  has already been reset.
- **Implemented:** Use the existing `serverModule.wss.clients` registry of accepted
  connections, rather than adding another client registry. Add an awaited
  test helper that terminates leftover sockets and waits for their close
  events. Run it after each test in both socket-using suites and inside
  `startServer()`'s final close function before closing the HTTP server.
  Preserve explicit closes used to test normal socket behavior. Keep this
  cleanup in test infrastructure; do not change production room/session
  lifecycle or add force-exit flags.
- **Regression coverage:** Keep a subprocess test that deliberately fails
  after opening a socket and verifies a normal exit with code 1 within a
  deadline. Also cover an unauthenticated socket, a passing test that omits
  cleanup, and isolation before the next test. The parent must forcibly end
  a hung probe so the regression itself cannot wedge the test run.
- **Acceptance:** Failing and passing suites terminate normally with their
  correct exit codes; later tests inherit no accepted sockets. All existing
  server/client suites, typecheck, build, and browser checks remain green.
- **Validation:** All four subprocess regressions timed out before the fix
  and exited with the expected codes afterwards. Passed: 88 server tests,
  81 client tests, typecheck, build, and 26/26 browser checks.

## New product issues imported 2026-09-07

Issues 10 through 17 were checked against the implementation before being
added. Issue 11 and issue 9's newer comments are incorporated into tasks 23
and 20. None of issues 10 through 17 duplicates an existing task. Keep their
GitHub issue numbers and these task numbers stable.

## 22. Show join notices in the browser-tab title

- [x] **Requested feature** (done: five-second "<handle> joined " marquee with code-point rotation, restored on timeout/leave/unmount; manually verified with the separator, GitHub issue #10 closed)
- **Source:** [GitHub issue #10](https://github.com/kappa/remart-bbs-chat/issues/10).
- **Confirmed current behavior:** The document title is always
  `Remart BBS Chat`; joining participants affect only the transcript, roster,
  and attempted join chirp. No title-notification code exists.
- **Location:** `client/index.html` base title; `client/src/App.tsx` newcomer
  reactions; `client/src/useRoomConnection.ts` roster-diff detection;
  `client/src/App.roster.test.tsx`.
- **Requested behavior:** For five seconds after another participant joins,
  rotate the text `<handle> joined` through the browser-tab title, then restore
  the exact base title `Remart BBS Chat`.
- **Suggested implementation:** Change `onNewcomer` to carry the new roster
  entry (or at least its handle), since the current callback reports only a
  boolean event. In `App.tsx`, start a small client-side marquee timer that
  cyclically moves the first character of `<handle> joined` to the end. Store
  the timeout and interval handles together so a later join replaces the
  current notice cleanly. Restore the base title when five seconds elapse,
  when the session ends, and on component cleanup. Keep this separate from
  sound state: muted or autoplay-blocked audio must not suppress the title.
- **Event rules:** Do not notify for the participant's own join or for the
  initial snapshot roster. A genuinely new participant discovered in a later
  `roster` message starts the notice. A reconnect snapshot containing only
  already-known participant IDs must not restart it. If several people join
  during five seconds, the latest join replaces the earlier title notice.
- **Acceptance:** Alice is already connected; Bob joins; Alice's title rotates
  `Bob joined` for five seconds and returns to `Remart BBS Chat`. Bob does not
  receive a title notice for himself. Reconnects do not replay old notices,
  and leaving or unmounting cannot strand a modified title.
- **Tests:** Use fake timers in a client test. Assert the new handle reaches
  the callback, the title changes across at least two marquee ticks, restores
  after five seconds, and is restored by unmount. Cover own join, initial
  snapshot, reconnect snapshot, a second join replacing the first, and sound
  being unavailable or disabled.
- **Docs:** Add the five-second browser-title notification to
  `docs/USER_EXPERIENCE.md`. No wire-protocol change is needed if the existing
  roster event remains the source.

## 23. Preserve the participant session across page reload

- [x] **Bug, session lifecycle** (done: no leave on page exit; stored session reconnects as the same participant with live state intact; manually verified, GitHub issue #11 closed)
- **Source:** [GitHub issue #11](https://github.com/kappa/remart-bbs-chat/issues/11).
- **Confirmed cause and browser discrepancy (2026-09-07):** `App.tsx` sends
  authenticated `POST /api/leave` from `pagehide`, so reload deliberately
  removes the participant. With a plain `/` URL the client returns to the
  lobby; `?room=...` enables automatic rejoin under a new ID/token, which can
  look seamless but adds leave/join announcements. The existing browser check
  uses this autojoin URL and expects the broken behavior. Both outcomes were
  reproduced locally in headless Chrome 151 and Firefox 153; Firefox also
  failed when joining directly through the plain-URL lobby. The deployed
  JavaScript checksum matched the tested local build.
  The user's Firefox reload really does preserve the session: their Network
  panel shows the leave POST as **Blocked By NoScript**, followed by a new
  WebSocket connection. This explains the discrepancy; it is not evidence of
  Firefox-specific session recovery. Earlier production checks also recorded
  changed participant identity and leave/join announcements.
- **Desired behavior confirmed by the user:** Make the seamless reload seen
  with NoScript work in all supported browsers without an extension. Preserve
  the existing participant and server-confirmed live state; do not announce
  a departure or a newcomer just because the document reloads. Check the
  lifecycle side effects below before considering the task complete.
- **Location:** `client/src/App.tsx` page-exit effect;
  `client/src/api.ts` `keepaliveApi`; `client/src/connection.ts` reconnect and
  replay; `server/index.js` leave/removal and socket replacement;
  `check-browser.mjs`; session lifecycle sections in maintained docs.
- **Recommended solution:** Remove the `pagehide` leave effect and retire
  `keepaliveApi` and its obsolete test mocks. Keep authenticated HTTP Leave
  and `q` immediate. Use the existing socket-close/reconnect/stale-cleanup
  behavior: socket closure keeps the participant, and a new authenticated
  `hello` replaces its old socket and receives a recovery snapshot. No new
  endpoint, provisional-leave timer, or shorter grace interval is proposed.
  This is the simplest design and avoids a delayed exit beacon invalidating
  an already reconnected session. Do not substitute `visibilitychange` or
  `beforeunload` as a leave trigger; switching tabs must not leave the room.
  `pagehide.persisted` identifies cache preservation, not a reliable
  reload-versus-tab-close distinction (see
  [MDN pagehide](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)).
- **Required continuity:** While the server participant still exists and
  browser session storage is available, reload retains the same
  participant ID, token, color, slot, live row, caret, sequence position, and
  join-history boundary. It emits no leave/join announcements and no newcomer
  notification. The new socket replaces the old socket through the existing
  authenticated `hello` and resumes numbering from the snapshot's `nextSeq`.
  Experimentally suppressing only the beacon preserved all these fields in
  both local browsers; typing afterward inserted at the preserved mid-line
  caret and appeared correctly to the observer.
- **Side effects and scope to verify:**
  - Closing a tab or navigating away holds its participant, handle, color,
    and slot until stale cleanup. The existing threshold is 40 seconds since
    last activity, with a sweep every 15 seconds and cleanup on join: periodic
    removal normally occurs 40–55 seconds after last activity, not exactly
    40 seconds after tab closure. Room occupancy listings can stop counting a
    stale participant before physical removal. Joining the same handle from
    a fresh tab can temporarily fail. Explicit Leave/`q` releases it promptly.
  - Abandoned nonempty live text stays live until cleanup, which commits it
    with the last-activity timestamp and announces departure once. A room with
    no open sockets survives until its final participant is removed. Reload of a sole
    occupant must preserve the room as well as the participant.
  - A reload after participant removal or server restart cannot restore the
    session. Keep the existing session-ended handling; do not promise an
    unlimited reconnect window. Backgrounding alone must not deliberately
    leave, though a suspended browser may still expire through inactivity.
  - Back/forward-cache restoration can resume an existing document rather
    than mount a new app. Verify that its socket resumes/reconnects and the UI
    updates; add lifecycle recovery only if this test exposes a gap. Do not
    leave two active reconnect loops or let an old socket's close clear its
    replacement. Duplicated tabs with copied credentials must not gain a
    second active server socket; tab duplication is not a new session feature.
  - The pending keystroke queue lives only in JavaScript memory. Ordinary
    socket reconnect replays unacknowledged input, but full document reload
    destroys that queue. Server-applied input survives in the snapshot;
    input that never reached the server can be lost. The proposed fix covers
    server-confirmed state; durable pending-input replay needs separate
    persistence work and must not be claimed as an effect of removing leave.
  - Accumulated client scrollback also lives in memory. Reload receives at
    most the last 100 committed records, filtered by the original join
    boundary. Preserving that boundary does not restore unlimited scrollback
    or scroll position. Document this reload limit; broader history recovery
    would require separate work. Same-document reconnect must keep its
    existing scrollback-preservation behavior.
- **Tests before completion:** Work test-first. Reverse the browser check's
  reload expectations and cover both plain `/` and `?room=...` URLs. Assert
  ID/token and live row/text/caret survive, subsequent typing uses the correct
  sequence, and the observer sees no extra commit, leave/join, or newcomer
  notification. Include repeated reloads, a sole occupant, and a slow socket
  reconnect before removal. Cover no leave request on pagehide, immediate
  explicit Leave/`q`, abandoned-tab expiry and handle/slot release, stale live
  text preservation, old-socket replacement, and session-ended handling after
  removal/restart. Exercise back/forward navigation and background/foreground
  recovery. Run both suites, typecheck, build, and the browser check; verify
  actual Reload controls in Chrome and Firefox with leave requests unblocked,
  and Safari/WebKit where available, reporting any untested browser coverage.
- **Protocol docs:** Update `docs/PROTOCOL.md` page-exit, socket-close,
  reconnect, leave, and presence rules to match implemented behavior. Update
  `docs/USER_EXPERIENCE.md`, `docs/DESIGN.md`, and the session-lifecycle rule in
  `AGENTS.md`, including the closed-tab delay and full-reload recovery limits.

## 24. Add a favicon for tab identification

- [x] **Requested feature**
- **Source:** [GitHub issue #12](https://github.com/kappa/remart-bbs-chat/issues/12).
- **Confirmed current behavior:** `client/index.html` deliberately uses
  `<link rel="icon" href="data:,">`, which suppresses favicon requests and
  leaves the tab without an identifying icon.
- **Location:** `client/index.html`; new static assets under `client/public/`;
  client build verification.
- **Artwork:** Create one square, repo-native SVG master matching the black
  terminal background and cyan/gray DOS palette. Use a simple symbol that is
  legible at 16×16; avoid fine detail and lengthy lettering. Include a dark
  background so it remains recognizable in light and dark browser chrome.
  Export the raster fallback from this master; no image-generation or runtime
  dependency is needed.
- **Recommended asset set:**
  - `favicon.svg`: square vector, for example `viewBox="0 0 32 32"`. This is
    the main icon and scales without separate raster sizes.
  - `favicon.ico`: one ICO file containing **16×16 and 32×32** images for
    compatibility fallback.
  - Optional `apple-touch-icon.png`: **180×180 PNG** for iPhone/iPad Home
    Screen shortcuts. This is separate from the browser-tab requirement.
  SVG plus ICO is sufficient for this task; a web-app manifest and larger
  installable-app icons are outside its scope.
- **Implementation:** Put the assets under `client/public/`. Replace the
  empty icon link in `client/index.html` with root-relative `rel="icon"`
  links for the ICO fallback and SVG (`type="image/svg+xml"`, `sizes="any"`).
  If the optional Apple icon is included, give it a separate
  `rel="apple-touch-icon"` link with `sizes="180x180"`. See
  [MDN icon links](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel)
  and [Apple Home Screen icons](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).
- **Acceptance:** The deployed tab displays the Remart icon instead of the
  browser's generic document icon; direct navigation and reload request the
  icons successfully; the client build copies them to the expected paths.
- **Tests:** Add a focused static/build assertion for the icon links and
  assets, then run the client build. Verify both asset URLs return the actual
  images and the ICO contains the intended sizes. Manually inspect the
  deployed icon at ordinary tab size in Chrome and Firefox, in light and dark
  browser themes; check Safari where available. Account for favicon caching
  when verifying an updated icon.
- **Docs:** No product-document or protocol change is required.

## 25. Autocomplete participant handles after `@`

- [ ] **Requested feature**
- **Spec and plan:** [docs/superpowers/specs/2026-09-09-mention-autocomplete-design.md](docs/superpowers/specs/2026-09-09-mention-autocomplete-design.md),
  [docs/superpowers/plans/2026-09-09-mention-autocomplete.md](docs/superpowers/plans/2026-09-09-mention-autocomplete.md).
  Where the plan and this task disagree, the spec records the approved decision.
- **Source:** [GitHub issue #13](https://github.com/kappa/remart-bbs-chat/issues/13).
- **Location:** `client/src/App.tsx` echoed own-line rendering and shared key
  handling; roster state from `client/src/roomState.ts`; a small pure mention
  token/filter helper; `client/src/theme.css`.
- **Requested behavior:** Typing `@` opens an inline list of participant
  handles. Further text filters case-insensitively by handle prefix. Up/Down
  moves the selection; Tab or Enter inserts the selected handle. When no
  handles match, the popup disappears and may reappear after Backspace makes
  the prefix match again. Escape dismisses autocomplete for the current `@`
  token without interfering with ordinary `@` text.
- **Server-echo constraint:** Derive the active token from the server-echoed
  own live text and caret; do not predict transcript text locally. Selecting a
  handle sends only the remaining code points through the existing ordered
  `char` stream, so the server observes the originally typed `@` and prefix
  followed by the completion. Do not introduce a completion wire message.
- **Interaction rules:** Match the non-whitespace token immediately before the
  caret when it begins with `@`; exclude the user's own handle. Preserve roster
  order for the initial list. Up/Down wrap through matches. Tab selects without
  changing browser focus; Enter selects without committing the line while the
  popup has a selection. If the popup is absent or dismissed, Enter retains its
  ordinary commit behavior. A new `@` token clears Escape dismissal.
- **Acceptance:** With Alice, Bob, and Carol present, typing `@c`, then Enter
  sends the remaining characters of `@Carol` without committing; typing can
  continue normally. Nonmatching `@text` remains ordinary chat. Backspace can
  restore matches, Escape closes the current completion, and roster changes
  update the choices.
- **Tests:** Pure tests for token detection, Unicode/case-insensitive prefix
  matching, own-handle exclusion, and no-match behavior. Component tests cover
  echoed input opening/filtering the popup, Up/Down, Tab, Enter versus commit,
  Escape, Backspace reappearance, roster changes, delayed echo, and the exact
  keystrokes sent for a completion. Add a browser-check sequence with two or
  more candidate handles.
- **Docs:** Document autocomplete and its keys in `docs/USER_EXPERIENCE.md` and
  the help overlay. No protocol change is required.

## 26. Keep the transcript monospace in Chrome on Linux

- [x] **Bug, browser compatibility** (done: transcript rows consolidated on var(--mono) with a Linux-available fallback; verified in Chrome on Linux, GitHub issue #14 closed)
- **Source:** [GitHub issue #14](https://github.com/kappa/remart-bbs-chat/issues/14).
- **Confirmed requirement:** The issue describes the desired face as
  “sans-serif,” but `docs/DESIGN.md` requires monospace and the terminal layout
  depends on it. The actionable defect is Chrome/Linux rendering transcript
  rows as serif instead of the intended non-serif monospace face.
- **Location:** `client/src/theme.css` `--mono`, global font declarations, and
  `.chat-line`, which currently uses a second, shorter font stack; rendered
  transcript styles in Chrome/Linux.
- **Suggested fix:** Reproduce in Chrome on Linux and inspect the computed and
  rendered font. Consolidate every terminal surface on `var(--mono)` and use a
  Linux-available explicit monospace fallback before the generic family. If the
  CSS is correct but the deployed stylesheet is missing, diagnose the asset
  load/cache path instead of masking it with more font names. Do not add a web
  font unless local stacks demonstrably cannot provide stable rendering.
- **Acceptance:** Committed lines, live lines, the caret, roster, lobby, and
  help remain visibly monospace in Chrome and Firefox on Linux. Character-cell
  widths are consistent; the existing terminal aesthetic and wrapping remain.
- **Tests:** Add a style regression that all transcript rows inherit the single
  canonical font variable. Use a real Chrome/Linux computed-style check and
  record the resolved font family; compare Firefox manually. A DOM test that
  merely repeats the CSS string is insufficient by itself.
- **Docs:** No behavior change is intended. Update `docs/DESIGN.md` only if the
  chosen canonical stack is worth recording.

## 27. Add a “Report a problem” sidebar link

- [x] **Requested feature** (done: roster-footer anchor to the issue form; manually verified, GitHub issue #15 closed)
- **Source:** [GitHub issue #15](https://github.com/kappa/remart-bbs-chat/issues/15).
- **Location:** `client/src/App.tsx` roster footer; `client/src/theme.css`;
  `client/src/App.roster.test.tsx`.
- **Requested behavior:** Add a clearly labeled `Report a problem` link in the
  right sidebar pointing to
  `https://github.com/kappa/remart-bbs-chat/issues/new`.
- **Suggested implementation:** Render a normal anchor in the roster footer,
  opening the issue form in a new tab with `rel="noopener noreferrer"`. Style
  it consistently with the compact terminal controls without disguising that
  it is a link. Clicking it must not move chat focus or send input.
- **Acceptance:** The link is visible and keyboard accessible on desktop and
  mobile, has the exact destination and safe new-tab attributes, and does not
  disturb the transcript or session.
- **Tests:** Roster rendering test for accessible name, `href`, `target`, and
  `rel`; browser smoke check that the control is present without navigating
  away from the test room.
- **Docs:** Mention the reporting link in `docs/USER_EXPERIENCE.md`; no protocol
  change.

## 28. Replace the duplicate sidebar command buttons with Help

- [x] **Requested UI cleanup** (done: single Help control replacing the [l][?][q] row; manually verified, GitHub issue #16 closed)
- **Source:** [GitHub issue #16](https://github.com/kappa/remart-bbs-chat/issues/16).
- **Location:** `client/src/App.tsx` roster footer and help overlay;
  `client/src/theme.css` command-button layout; roster/rendering tests and
  `check-browser.mjs`.
- **Requested behavior:** Remove the `[l] [?] [q]` button row and put one
  `Help` control in its place that opens the same popup as typing `?` then
  Enter. Keep the separate `Leave` button and the typed `l`, `?`, and `q`
  commands.
- **Suggested implementation:** Reuse `setShowHelp(true)` from the existing
  `[?]` button. Remove the now-unused three-column command-button wrapper and
  styles. Do not remove server command handling or the toolbar-independent
  roster API unless it becomes genuinely unused after checking all call sites.
- **Acceptance:** The sidebar contains `Type`, `Help`, and `Leave`, with no
  `[l]`, `[?]`, or `[q]` controls. Help opens and dismisses exactly as before;
  typed commands retain their behavior.
- **Tests:** Update roster tests to assert the new control set and absence of
  the old buttons. Exercise Help click, Escape/Close dismissal, explicit Leave,
  and typed `l`, `?`, `q`. Keep keyboard focus behavior covered.
- **Docs:** Update the sidebar description in `docs/USER_EXPERIENCE.md`; no
  protocol change.

## 29. Remove the sidebar character counter

- [x] **Requested UI cleanup** (done: counter element, styles, and derived value removed; manually verified, GitHub issue #17 closed)
- **Source:** [GitHub issue #17](https://github.com/kappa/remart-bbs-chat/issues/17).
- **Location:** `client/src/App.tsx` `ownText` and `.char-counter` rendering;
  `client/src/theme.css`; `client/src/App.roster.test.tsx`.
- **Confirmed current behavior:** The roster footer always shows the echoed
  own-line length as `<number> chars`, even though chat lines have no length
  limit and the counter does not guide any decision.
- **Suggested implementation:** Remove the counter element, its CSS, its test,
  and the `ownText` derived value if it has no remaining consumer. Preserve the
  paste-limit warning, which reports a separate 100-code-point paste rule.
- **Acceptance:** No character count appears in the sidebar while typing;
  live text, caret editing, paste warnings, layout, and all other footer
  controls behave unchanged.
- **Tests:** Replace the existing counter assertion with absence coverage and
  keep a focused assertion that an oversized paste still shows its warning.
- **Docs:** Remove any counter mention if one exists; no protocol change.

## 30. Use the approved 20-color hybrid participant palette

- [x] **Bug, participant colors** (done: approved 20-color hybrid palette assigned first-unused with white tenth; verified in Chrome and Firefox at full rooms; no GitHub issue for this task)
- **Source and current state:** The user's six-participant screenshot exposed
  the original custom palette's similar green/lime assignments. Commit
  `b644e14` replaced that palette with bright-first VGA colors as initially
  requested, but device testing found dark blue too dim, green/light green
  and cyan/light green too similar, and the ordering unsatisfactory.
  The user reviewed alternatives on black and approved the exact hybrid
  below on **2026-09-08**. This replaces the earlier VGA-only requirement;
  the server still needs to adopt the approved hybrid.
- **Design requirements:** Colors should be visible on black, distinguish
  authors at ordinary chat text size, and look appealing. Put the preferred,
  clearly different colors first. Hex uniqueness alone does not establish
  visual distinction. The approved palette combines six ColorBrewer Set2
  colors, selected original/VGA colors, white, and nine Glasbey additions.
- **Approved assignment order (one-based):**

  | Position | Color | Hex |
  | --- | --- | --- |
  | 1 | Set2 lime | `#A6D854` |
  | 2 | Set2 yellow | `#FFD92F` |
  | 3 | Set2 orange | `#FC8D62` |
  | 4 | Original periwinkle | `#8080FF` |
  | 5 | Pure cyan | `#00FFFF` |
  | 6 | Set2 pink | `#E78AC3` |
  | 7 | Set2 blue | `#8DA0CB` |
  | 8 | Pure magenta | `#FF00FF` |
  | 9 | VGA light red | `#FF5555` |
  | 10 | White | `#FFFFFF` |
  | 11 | Set2 teal | `#66C2A5` |
  | 12 | Olive | `#867924` |
  | 13 | Dusty rose | `#926D75` |
  | 14 | Generated green | `#00A600` |
  | 15 | Teal | `#108A92` |
  | 16 | Raspberry | `#D70082` |
  | 17 | Violet | `#9E59BA` |
  | 18 | Sand | `#CABE9A` |
  | 19 | Pale lavender | `#E3CAFF` |
  | 20 | Burnt orange | `#BE5900` |

  ```js
  ["#A6D854", "#FFD92F", "#FC8D62", "#8080FF", "#00FFFF",
   "#E78AC3", "#8DA0CB", "#FF00FF", "#FF5555", "#FFFFFF",
   "#66C2A5", "#867924", "#926D75", "#00A600", "#108A92",
   "#D70082", "#9E59BA", "#CABE9A", "#E3CAFF", "#BE5900"]
  ```

- **Generation provenance:** The first eleven values were selected by the
  user; the last nine were generated with Glasbey 0.3.0 using
  `extend_palette(seed, palette_size=20, grid_size=64,
  lightness_bounds=(40,90), chroma_bounds=(15,100), hue_bounds=(0,360),
  optimize_palette=False)`. The seed was subsequently reordered by the user;
  the generated tail kept its original order. The exact approved values
  above are authoritative; do not regenerate or optimize them during
  implementation. Generation was a design-time step, not an app dependency.
  References: [ColorBrewer Set2](https://d3js.org/d3-scale-chromatic/categorical#schemeSet2),
  [Glasbey extension](https://glasbey.readthedocs.io/en/latest/extending_palettes.html).
  `preview-palette.mjs` includes the approved result alongside the earlier
  palettes; run `node preview-palette.mjs > /tmp/remart-palette.html` to view it.
- **Location:** `server/index.js` palette and join-time color allocation;
  `test-server-api.js` and palette-dependent fixtures; roster, live text,
  committed text, and announcement rendering for visual verification.
- **Implementation and scope:** Replace `VGA_COLORS` with the exact approved
  array and rename it to reflect participant colors rather than VGA. Keep
  assignment as the first unused color in this order. Preserve unique colors
  among active participants, stable colors across reconnects, and reuse after
  departure. Black is excluded. The twenty-color array prepares for a possible
  future capacity increase; **keep the room limit at ten in this task**.
  Consequently white is the tenth assigned color and Set2 teal is eleventh,
  reserved with the remaining tail for future capacity. Do not add a runtime
  generator or color-selection dependency.
- **Acceptance:** Newly assigned colors follow the approved array exactly.
  Roster swatches, handles, live lines, and
  announcements agree on the assigned color. Committed lines retain their
  stored author-color snapshots after departure and color reuse; do not
  recolor historical lines by looking up a current roster slot.
- **Tests:** Work test-first. Verify all twenty palette values and their
  order, including white tenth, Set2 teal eleventh, uniqueness, and no black.
  Exercise ten joins to check actual assignments and that an eleventh join
  still fails at capacity. Cover
  departure/rejoin color reuse, reconnect stability, and preservation of
  committed author colors. Visually inspect six- and ten-participant rosters
  and transcripts at ordinary text size on black in Chrome and Firefox;
  compare with the approved preview and inspect the full twenty-color preview
  separately without raising room capacity for the check.
- **Docs:** Replace VGA-only claims in `docs/DESIGN.md` and
  `docs/PROTOCOL.md` with the hybrid palette and first-unused assignment
  policy; update other stale palette references and fixtures. Keep the wire
  color representation and the ten-person capacity unchanged.

## New product issues imported 2026-09-09

Tasks 31 to 33 come from the repository's GitHub issues opened since the
previous import. Keep the GitHub issue numbers and these task numbers stable.

## 31. Show AFK status for participants in background tabs

- [ ] **Requested feature, presence**
- **Spec and plan:** [docs/superpowers/specs/2026-09-09-afk-presence-design.md](docs/superpowers/specs/2026-09-09-afk-presence-design.md),
  [docs/superpowers/plans/2026-09-09-afk-presence.md](docs/superpowers/plans/2026-09-09-afk-presence.md).
  Where the plan and this task disagree, the spec records the approved decision.
- **Source:** [GitHub issue #19](https://github.com/kappa/remart-bbs-chat/issues/19).
- **Location:** `server/index.js` participant state, socket handshake and
  roster broadcasts; `client/src/connection.ts` and
  `client/src/useRoomConnection.ts` socket messages; `client/src/protocol.ts`;
  `client/src/roomState.ts`; roster rendering in `client/src/App.tsx` and
  `client/src/theme.css`.
- **Requested behavior:** Mark a participant AFK while their browser tab is in
  the background, and clear the mark when it becomes visible again. Keep the
  participant in the room with their live line and assigned color intact.
- **Presence rule:** Use the Page Visibility API as the signal described by the
  issue: `document.hidden` means AFK and a visible document means active. This
  is distinct from stale-socket detection; WebSocket pongs continue to prove
  that the participant is connected and must not clear AFK. Send the current
  visibility after socket authentication and each time it changes. The server
  owns the shared status and includes it in snapshots and roster broadcasts.
  Reconnect must replace any previous status with the newly reported current
  visibility rather than preserving a stale AFK value.
- **Display:** Add a compact, text-readable AFK marker beside the handle in the
  roster. Do not dim participant colors enough to weaken author identification,
  and do not add AFK annotations to ordinary transcript rows.
- **Acceptance:** Other participants see the marker appear when a tab becomes
  hidden and disappear when it becomes visible, without a join/leave notice or
  roster reordering. Backgrounding does not discard live text, disconnect the
  participant, or change stale cleanup. A newly joined or reconnected viewer
  receives the current status in its snapshot.
- **Tests:** Write server tests first for authenticated presence updates,
  invalid messages, snapshot state, broadcasts, reconnect replacement, and
  preservation of live text. Add reducer and component tests for marker
  rendering and roster updates, plus connection tests for initial and changed
  visibility. Extend the two-tab browser check if its Chrome harness can
  reliably emulate visibility; otherwise record a focused manual two-tab check.
- **Docs:** Update `docs/PROTOCOL.md` with the presence message, roster field,
  ownership, and reconnect behavior. Document the AFK marker and its
  background-tab rule in `docs/USER_EXPERIENCE.md`, and add the rule to
  `AGENTS.md` once implemented.

## 32. Remove the sidebar Type button

- [ ] **Requested UI cleanup**
- **Source:** [GitHub issue #20](https://github.com/kappa/remart-bbs-chat/issues/20).
- **Location:** `client/src/App.tsx` roster footer;
  `.keyboard-button` rules in `client/src/theme.css`;
  `client/src/App.roster.test.tsx`, `client/src/App.rendering.test.tsx`, and
  `check-browser.mjs`.
- **Requested behavior:** Remove the `Type` button from the participant
  sidebar. The chat remains directly typeable through the existing hidden
  capture textarea and document-level keyboard handling.
- **Implementation:** Remove the button and its now-unused CSS. Keep the
  internal `focusKeyboard` helper where it is still needed for transcript
  clicks, help dismissal, and input handling. Do not replace the button with a
  differently labeled focus control.
- **Acceptance:** The sidebar offers Help and Leave but no Type control.
  Keyboard input still works after joining, after selecting transcript text,
  after closing Help, and after clicking the transcript; mobile input remains
  accessible through the existing chat surface behavior.
- **Tests:** Update the focused roster and rendering tests to assert the Type
  button is absent while preserving the observable focus-and-type scenarios.
  Run the browser check on desktop and manually confirm that tapping the mobile
  chat surface still opens the on-screen keyboard.
- **Docs:** Remove the Type button from the sidebar description in
  `docs/USER_EXPERIENCE.md`. No protocol change is required.

## 33. Clean up the help dialog contents

- [ ] **Requested UI cleanup**
- **Source:** [GitHub issue #21](https://github.com/kappa/remart-bbs-chat/issues/21).
- **Location:** Help overlay markup in `client/src/App.tsx`; help-dialog styles
  in `client/src/theme.css`; `client/src/App.roster.test.tsx` and maintained
  behavior in `docs/USER_EXPERIENCE.md`.
- **Current problems:** The dialog says Enter assigns a new empty line even
  though an idle participant has no shared row; describes `l` as refreshing a
  roster that already updates live; omits supported line-editing keys; and
  exposes the `?name=` testing convenience as user help.
- **Requested behavior:** Keep the dialog concise and user-facing. Describe the
  three typed commands accurately, explain that Enter sends the current line,
  summarize Backspace/Delete and caret movement, and retain the useful Unicode
  and no-line-limit facts. Remove the per-tab testing paragraph. Reflect task
  25's autocomplete keys if that task has landed when this one is implemented;
  do not describe unimplemented behavior.
- **Acceptance:** Every statement in Help matches current behavior and the
  maintained user-experience document. The dialog remains readable without
  horizontal scrolling on narrow mobile screens, dismisses with Escape and its
  Close button, and returns keyboard focus to chat.
- **Tests:** Update the Help component assertions to cover the corrected
  command and editing descriptions and the absence of testing-only text. Keep
  opening, Escape, Close, focus restoration, and narrow-layout browser coverage.
- **Docs:** Make matching wording corrections in `docs/USER_EXPERIENCE.md` if
  its command or typing descriptions are stale. No protocol change is required.
