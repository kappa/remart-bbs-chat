# Review: branch `websocket-server-echo` against the spec and plan

Reviewed 2026-09-06. Spec: `docs/superpowers/specs/2026-09-05-websocket-server-echo-design.md`.
Plan: `docs/superpowers/plans/2026-09-05-websocket-server-echo.md`.
Range: `master` (19820cb) to `websocket-server-echo` (aed2332), 14 commits.
File and line references are to the branch head unless a commit is named.

## Verdict

Merge with fixes. The final code matches the spec's protocol, the client
renders only from echo, replay and `seq-gap` work as designed, and both suites
and the build pass at the head. Four things should change before merge:

1. Decide the timestamp of a preserved live line on HTTP leave and `q`
   (commit 5). The branch stamps it at last activity instead of leave time,
   which differs from master and from the plan, and can hide the line from a
   recent joiner.
2. Keystrokes typed before the first snapshot after a page reload are dropped
   silently (commit 10). This is a defect in the plan's connection code, not
   an executor deviation, but it needs a fix and a test.
3. Remove the stray `joinedAt` field on `liveLines` (commit 6 residue). The
   client never reads it.
4. Sweep `docs/PROTOCOL.md` for text left over from the old protocol
   (commits 7 and 14).

History hygiene is a separate question. Five of the fourteen commits have a
failing or hanging server suite, against the plan's "never commit with a
failing suite" rule; commit 6 is a rewrite that the later commits replace
wholesale. If the branch is merged with a merge commit or squash, this does
not matter. If the commits are to be kept individually, see the notes under
commits 2, 4, 5, and 6.

## Verification at the head

| Check | Result |
| --- | --- |
| `npm test` | 64 pass, 0 fail (baseline 61) |
| `npm --prefix client test` | 61 pass (baseline 40), 2 React `act()` warnings |
| `npm --prefix client run build` | passes |
| `cd client && npx tsc --noEmit -p tsconfig.json` | fails only on `src/theme.test.ts` (missing Node types), same failures exist on master; the branch fixed the two `App.tsx` errors master had |
| Claude-Session trailers | none |
| Lockfiles, `dist/`, `node_modules/` | none committed |

## Suite status per commit

| # | Commit | Server suite | Client suite |
| --- | --- | --- | --- |
| 1 | 2165b47 | 61 pass | 40 pass |
| 2 | 512b3cf | 66 pass, 6 fail | 40 pass |
| 3 | 79a2c68 | 76 pass, 6 fail | 40 pass |
| 4 | 3a87866 | hangs (tests wait on unimplemented behavior) | 40 pass |
| 5 | a94e7e8 | 85 pass, 6 fail | 40 pass |
| 6 | 79500b3 | 85 pass, 6 fail | 39 pass |
| 7 | 68f8227 | 64 pass | 39 pass |
| 8 | 886af27 | 64 pass | 39 pass |
| 9 | 29a5019 | 64 pass | 46 pass |
| 10 | 39bc958 | 64 pass | 55 pass |
| 11 | 2ed9e65 | 64 pass | 51 pass |
| 12 | 0d251c6 | 64 pass | 51 pass |
| 13 | 34e4220 | 64 pass | 61 pass |
| 14 | aed2332 | 64 pass | 61 pass |

The six failures in commits 2 to 6 are the old `test-server-websocket.js`
(subscribe protocol on the root path) and the Enter-latency regression suite,
both broken the moment the socket moved to `/ws`. The plan told Task 2 to delete
`test-server-websocket.js`; the latency suite was scheduled for deletion in
Task 5, which was a gap in the plan. Both were deleted in commit 7.

## Commit by commit

### 1. 2165b47 Remove Vite dev server and document transcript terminology (TODO task 7)

Does: deletes the `server` block in `client/vite.config.ts`, the client `dev`
and `preview` scripts, and the root `dev` script. Three files.

Findings:

- The message promises the terminology section, but `docs/PROTOCOL.md`,
  `AGENTS.md`, and `README.md` are untouched. Plan Task 1 steps 4 to 6 were
  skipped here and landed only in commit 7. Between commits 1 and 7,
  `AGENTS.md` still told developers to run `npm run dev`, which no longer
  existed.

Recommendations:

- If history is kept, amend the message to "Remove the Vite dev server" or
  move the doc edits from commit 7 into this commit.

### 2. 512b3cf Implement WebSocket handshake, snapshot, presence (TODO task 2)

Does: socket server on `/ws`, `hello` validation, one socket per participant,
`snapshot`, pong-based presence, `pingSockets`, `test-support.js`,
`test-server-ws.js`. Matches plan Task 2 closely; the helpers
(`sendWs`, `sendTo`, `broadcast`, `rosterOf`, `publicLine`, `liveLineOf`,
`snapshotMessage`) are the planned ones.

Findings:

- Server suite red (6 failures, see table). `test-server-websocket.js` should
  have been deleted here as the plan said.
- The TODO tag is wrong: TODO task 2 is "recover missing operations"; this
  commit is task 11.
- `server/index.js:408`: malformed JSON before `hello` answers
  `invalid-message` and keeps the socket open. The spec says anything other
  than `hello` as the first message gets `unauthorized` and a close. Minor.
- A socket that never sends `hello` is never closed. There is no handshake
  timeout. Minor; the old server had the same exposure.

Recommendations:

- Treat unparseable input before `hello` like any other non-hello first
  message: `unauthorized` and close.
- Optional: close sockets that have not sent `hello` within a few seconds.

### 3. 79a2c68 Apply keystrokes over the socket and echo live lines (TODO task 11)

Does: `handleKey` with the three sequence rules, `applyChar`,
`applyBackspace`, `commitLive`, `storeLine`, `newLineId`, `liveMessage`,
`committedMessage`, and the Keystrokes test block. Matches plan Task 3.

Findings:

- Tests are strong: sender and observer echo, empty backspace, idle Enter,
  the A Enter B Backspace C burst with a fresh-snapshot cross-check,
  duplicate, gap, invalid character as a no-op, invalid message shapes, and
  the 120-Enter snapshot (rows 22..121, `nextSeq` 121).
- Server suite still red from commit 2.

Recommendations: none for the code.

### 4. 3a87866 Organize server tests into handshake, presence, keystrokes, commands, and API suites (TODO task 2)

Does: adds the Commands and Join/leave/cleanup test blocks to
`test-server-ws.js`. No implementation.

Findings:

- The message describes a reorganization; the diff is the Task 4 tests
  committed ahead of the Task 4 code. At this commit the server suite hangs:
  the `q` test waits forever for a close that nothing sends.
- The TODO tag is wrong again (task 2).

Recommendations:

- Squash into commit 5 so test and implementation form the one Task 4 commit
  the plan asked for.

### 5. a94e7e8 feat: implement stale-room joins and new socket contract (handleKey, removeParticipant, COMMANDS, rosterMessage)

Does: `COMMANDS`, the command branch in `handleKey`, `removeParticipant` as
the single leave path used by HTTP leave, `q`, and stale cleanup,
`rosterMessage`, and join broadcasting `committed` then `roster`.

Findings:

- Preserved-line timestamp differs from master and from the plan.
  `removeParticipant` (`server/index.js:237-239`) stamps a preserved live
  line at `lastSeen` on every path. On master, HTTP leave stamped it at leave
  time; the plan passed `preservedAt` (now for leave and `q`, `lastSeen` for
  stale cleanup). The `at` argument is now used only for the announcement.
  Consequence: the client hides lines with `committedAt` before its own
  `joinedAt` (`client/src/roomState.ts:21,34`). A participant who joined
  after the leaver's last message or pong (a window of up to 12 seconds) sees
  the "left" announcement but not the preserved text. `AGENTS.md` and
  `docs/PROTOCOL.md` now document the new behavior, so the docs are
  consistent with the code but not with the plan. Decide which is wanted.
- `removeParticipant` and the join route (`server/index.js:243-262`,
  `351-358`) build line objects by hand with ids of the form
  `line-<id>-<ms>` and `leave-<id>-<ms>` instead of calling `storeLine`,
  which the plan used for both. `newLineId` adds a random suffix; these do
  not. Two code paths for one record shape.
- `rosterMessage` carries `roomId` (`server/index.js:232`). The spec's
  `roster` message has no `roomId`, and `live` and `committed` do not carry
  one either. Harmless, but now documented in PROTOCOL.md as part of the
  contract.
- `server/index.js:216`: `participant.lastSeen = new Date()` in the command
  branch repeats what the message handler did two lines earlier.
- Message style ("feat:" prefix, "stale-room joins", which is TODO task 4
  and was already on master) does not match the rest of the branch.
- Server suite still red.

Recommendations:

- Pass the preserved-line timestamp explicitly as the plan did, or keep the
  last-activity rule and say so in the spec's Edge cases so the record is
  complete. My recommendation is the plan's rule: leave and `q` stamp now,
  stale cleanup stamps `lastSeen`, because a deliberate leave is an event at
  leave time.
- Route the preserved line, the leave announcement, and the join announcement
  through `storeLine`.
- Drop `roomId` from `rosterMessage` and from the client type and
  PROTOCOL.md, or leave it and accept the asymmetry. Dropping is one line.
- Remove the redundant `lastSeen` refresh.

### 6. 79500b3 Replace optimistic rendering with WebSocket echo (TODO tasks 10/11)

Does: rewrites `App.tsx` against the socket, puts `openChatSocket`,
`sendKey`, and `WsMessage` into `api.ts`, adds a 186-line in-memory chat
server mock to `test-setup.ts`, adds `joinedAt` to `liveLineOf` on the
server, and removes one client test.

Findings:

- This is plan Task 10 done out of order, before Tasks 5 to 9, in a different
  shape from the plan: a promise-based handshake with a 5-second timeout in
  `api.ts`, room state typed as `any[]`, and `joinedAt` read from
  `liveLines` instead of the join response. Commits 9 to 12 replace all of
  it. Net churn is about 1,700 lines across commits 6, 7, and 12.
- The only lasting residue is the extra `joinedAt` on every live line
  (`server/index.js:142`), typed as optional in `client/src/protocol.ts:3`
  and documented in `docs/PROTOCOL.md:237`. Nothing reads it; the client
  uses the session's `joinedAt` (`client/src/useRoomConnection.ts:25`).
- The message body says "All 82 server tests pass"; 6 fail at this commit.
- The commit also edits `test-server-ws.js` and `server/index.js` in a
  client commit.

Recommendations:

- Remove `joinedAt` from `liveLineOf`, `protocol.ts`, and PROTOCOL.md.
- If history is kept per commit, drop this commit; everything it did is
  superseded.

### 7. 68f8227 Retire HTTP chat, heartbeat, and room-state routes; document the socket protocol (TODO tasks 2, 3, 11)

Does: deletes `/api/char`, `/api/backspace`, `/api/commit`,
`/api/heartbeat`, `/api/room-state`, `/api/room/:id`, `handleSeqOp`,
`drainBufferedOps`, the three old apply functions, `broadcastRoom`,
`broadcastChar`, `opBuffer`, `charEvents`, `nextLineIdx`; deletes
`test-server-seq.js`, `test-server-regression-enter-latency.js`,
`test-server-websocket.js`; rewrites `test-server-api.js` including a 404
check for the retired routes; rewrites PROTOCOL.md; removes room-state
polling from the client. Both suites are green from here on.

Findings:

- Good: the retired-routes 404 test, and the PROTOCOL.md rewrite is
  structured as the plan asked (terminology, transport, schemas, sequence
  rules, commands, edge cases, emission order, presence, example).
- PROTOCOL.md kept text from the old protocol. At the head: line 9 says
  `api.ts` holds "socket helpers" (they are in `connection.ts`); lines 66
  and 161 say "draft text" and line 175 "stale drafts" (the vocabulary rule
  bans "draft"); line 67 names `greatestLineIdx`, which is now
  `greatestRow`; line 80 lists the stored session as
  `{roomId, roomName, participantId, handle, token}` although
  `client/src/App.tsx:99` now requires `joinedAt` and discards sessions
  without it; line 82 says only token-less sessions are expired.
- The client edits here exist only because commit 6 had already switched
  the client. In the plan, Task 5 touched no client files.

Recommendations:

- Fix the five PROTOCOL.md spots above. They are a few minutes of editing.

### 8. 886af27 Rename server state to live line, row, and slot terminology

Does: `activeContent` to `liveText`, `activeLineIdx` to `liveRow`,
`lineSlot` to `slot`, `nextExpectedSeq` to `nextSeq`, line fields `content`
to `text`, `lineIdx` to `row`, `colorSnapshot` to `color`; drops the always
true `committed` flag and `createdAt`; `greatestLineIdx` to `greatestRow`;
join response and roster use the new names; tests and PROTOCOL.md examples
updated. Matches plan Task 6.

Findings: clean. The hand-built line literals from commit 5 were renamed but
not unified with `storeLine` (see commit 5).

Recommendations: none beyond commit 5's.

### 9. 29a5019 Add client protocol types, room-state reducer, and a controllable WebSocket fake

Does: `protocol.ts`, `roomState.ts` with tests, `testing/fakeWebSocket.ts`;
`test-setup.ts` becomes a `MockChatWebSocket` subclass of the fake that still
answers `hello` from a primed in-memory server (intermediate state, gone in
commit 12).

Findings:

- The reducer is well done: identity-preserving returns for no-op `live`
  messages, committed lines in a map keyed by id, `roster` keeps live text
  for known participants, tests cover each case including a truncated later
  snapshot.
- `protocol.ts` mirrors the wire including `joinedAt?` on `LiveLine` and
  `roomId` on `roster` (see commits 5 and 6).

Recommendations: none beyond those.

### 10. 39bc958 Add client socket connection with pending-keystroke replay (TODO tasks 2, 11)

Does: `connection.ts` and `connection.test.ts` with fake timers;
`tsconfig.json` lib bumped to ES2022; global `beforeEach` reset of the fake.
The connection code is the plan's code verbatim.

Findings:

- Silent loss after a page reload (plan defect). After a reload the tab keeps
  its session, the counter restarts at 1, and the server expects, say, 57.
  Keystrokes typed while "Connecting..." is shown are numbered 1, 2, 3;
  on the snapshot `pending.filter(key => key.seq >= 57)`
  (`client/src/connection.ts:53`) discards them, and the counter jumps to
  57. No warning is shown. The filter is right for a reconnect (those
  numbers were applied) and wrong for a fresh page (those numbers were never
  sent). The window is small, one round trip, but the loss is silent.
- On the very first connection attempt a close reports `reconnecting`, so
  a server that is down at page load shows "Reconnecting..." rather than
  "Connecting...". Cosmetic.
- The `tsconfig.json` change reformats two one-line arrays into multi-line
  arrays for no reason; the lib bump exists so that `statuses.at(-1)` in the
  test compiles.

Recommendations:

- Track whether each pending entry has been transmitted. On `snapshot`:
  drop entries that were transmitted with `seq < nextSeq`; renumber the
  survivors consecutively from `nextSeq`; set the counter to follow them;
  then resend. Add a connection test: "keystrokes typed before the first
  snapshot after a reload are sent with the server's numbering" (send two
  keys, deliver `snapshot(57)`, expect keys 57 and 58 on the wire).
- Revert the array reformatting in `tsconfig.json`; keep the lib bump if
  `.at()` stays, or use `statuses[statuses.length - 1]` and drop the bump.

### 11. 2ed9e65 Compute document rows from committed and live lines

Does: `computeDocumentLines(committed, participants)` over the wire types,
row kinds `committed` and `live`, idle participants produce no row,
`resolveLineColor` and `sortParticipantsBySlot` removed, tests rewritten.
Matches plan Task 9.

Findings: none.

### 12. 0d251c6 Render the transcript from server echo over the socket (TODO tasks 10, 11)

Does: `useRoomConnection.ts`, the `App.tsx` rewrite on the hook, `api.ts`
trimmed to five calls, `testing/roomFixtures.tsx`, rendering and roster
suites rewritten, race and regression suites deleted (recreated in commit
13), `test-setup.ts` reduced to installing the plain fake.

Findings:

- The hook and App match the plan: status line, `endSession` on
  `unknown-participant` and `unauthorized`, `command` handling, notices,
  `joinedAt` in the session with rejection of older sessions, input that
  never touches the transcript, paste cap, local caret preview.
- `client/src/App.rendering.test.tsx:15` is named "shows Connecting until
  the snapshot arrives" but `renderJoined` has already delivered the
  snapshot before the first assertion; the test only checks that
  "Connecting..." is absent and that "Reconnecting..." appears after a
  close. The connecting state is untested at the App level.
- Two "not wrapped in act(...)" warnings appear in the client run. They are
  noise today but hide real ones later.
- Newcomer detection (`useRoomConnection.ts:41-47`) plays the chirp for
  anyone who joined during an outage when the reconnect snapshot arrives.
  Reasonable; noting it as a behavior, not a defect.

Recommendations:

- Rewrite the first rendering test: store the session, render, assert
  "Connecting..." is visible, deliver the snapshot, assert it is gone.
- Find the two `act()` warnings (run the client suite and read the stack
  above each warning) and wrap the triggering `serverSend` or timer in
  `act`.

### 13. 34e4220 Cover fast input, reconnect replay, and scrollback under server echo (TODO task 9)

Does: five race tests (A Enter B Backspace C under delayed echo, transient
character from another participant, typing while reconnecting, `seq-gap`
warning, full queue via two 100-character pastes) and five regression tests
(idle row, backspace-to-empty keeps the row, truncated snapshot keeps
scrollback, scroll anchoring both ways, session switch resets the
transcript). Covers the spec's client test list.

Findings:

- Missing: the reload case from commit 10 (needs the fix first).
- Missing: an App-level test that `command leave` closes the socket and no
  reconnect follows. The unit test "close stops reconnecting" covers the
  connection; nothing checks the hook's cleanup path end to end.

Recommendations:

- Add both tests.

### 14. aed2332 Document the socket transport and server echo; close TODO tasks 2, 3, 7, 10, 11

Does: PROTOCOL.md client section, DESIGN.md sections "Server echo, no local
echo" and "Transport: one socket per participant", USER_EXPERIENCE.md
typing and status-line wording, README and AGENTS.md updates, TODO.md
bookkeeping, SPECS_STATUS.md. The message records an end-to-end check with
two scripted socket clients.

Findings:

- The plan's Step 7 asked for a two-tab browser check including a server
  restart ("Reconnecting..." then "Room session ended. Join again."). The
  message reports a scripted socket check instead. The browser path
  (page reload keeping the session, `pagehide` beacon, the caret) has not
  been exercised.
- PROTOCOL.md stale text listed under commit 7 remains, plus line 237
  (`joinedAt` on live lines).
- `AGENTS.md` "Behavior to preserve" now states the last-activity timestamp
  rule from commit 5. Whichever way commit 5 is resolved, this bullet and
  PROTOCOL.md's "Leave, stale cleanup, and `q`" section must agree with the
  code.
- TODO.md tasks 2 and 3 keep "Location" lines naming deleted code
  (`handleSeqOp`, `drainBufferedOps`, the room-state effect). Acceptable as
  history under a done checkbox.
- DESIGN.md and USER_EXPERIENCE.md read well and match the spec.

Recommendations:

- Run the browser check before merging and record it.
- Apply the PROTOCOL.md fixes.

## Plan defects found by this review

For the record, so the plan is not blamed on the executor:

- The reload case in `connection.ts` (commit 10) is the plan's own code.
- Task 2 broke the Enter-latency suite by moving the socket path but only
  deleted it in Task 5.
- Step 6's type check cannot pass on this repo because
  `client/src/theme.test.ts` imports `fs` and `path` without Node types; the
  same errors exist on master. Add `@types/node` to the client dev
  dependencies, or exclude that test from the type check.
