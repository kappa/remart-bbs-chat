# Tasks and review issues

Open tasks only. Done and closed tasks live in
[docs/TODO_ARCHIVE.md](docs/TODO_ARCHIVE.md) with their full text; a ticked task
moves there the next time this file is tidied. Task numbers are stable and
never reused: a new task takes the number after the highest one in either file.

For every protocol-affecting task, update [docs/PROTOCOL.md](docs/PROTOCOL.md)
in the same change as the implementation and tests. Keep schemas, examples,
message direction, ordering, errors, and lifecycle behavior consistent with code.
Describe implemented behavior there; keep future proposals in these tasks.

## Recommended implementation order

Tasks 1 to 35, 37 to 39, 41, and 42 are done or closed; see the archive.
The table below lists only the open tasks, in the order to execute them:

| Order | Task | Reason |
| --- | --- | --- |
| 1 | 36 — Delay AFK by five minutes of invisibility | Client-side timer; found while testing task 31. |
| 2 | 40 — Drive the lobby in the browser check instead of ?name= | Lets the ?name= override go if nothing else needs it. |
| 3 | 43 — Cap the size of a socket frame | Found reviewing task 18: one server option; nothing a user can notice. |
| 4 | 44 — Protect the server from floods | Found reviewing task 18: per-socket and per-address rate limits; after 43. |

## Working a task

The rules for working a task (read `AGENTS.md` first, TDD, one task per
`task-NN` branch and worktree, docs in the same commit, the validation list,
when to stop and ask, and closing the source issue) live in `AGENTS.md` under
"Working a task from TODO.md" and "Branches, worktrees, and landing". Every
task below assumes them.

## Review issues 2026-09-09

Tasks 36 and 40 come from testing the merged build on 2026-09-09, and tasks
43 and 44 from the review of task 18; none has a GitHub issue. Keep their
numbers stable.

## 36. Delay AFK by five minutes of invisibility

- [ ] **Requested change, presence**
- **Source:** Manual testing of task 31 on 2026-09-09.
- **Location:** `client/src/useRoomConnection.ts`, where the
  `visibilitychange` listener calls `connection.setHidden(document.hidden)`;
  `client/src/connection.ts` `setHidden` and the post-snapshot resend;
  `client/src/connection.test.ts` and the visibility test in
  `client/src/App.roster.test.tsx`.
- **Requested behavior:** A tab that goes into the background should not be
  marked AFK at once. The marker appears only after the tab has been hidden
  for five minutes without becoming visible again. Returning to the tab
  clears the marker immediately, as today. The change is entirely
  client-side: the server keeps owning the flag and keeps treating a
  `presence` report as the truth; the client just waits before reporting
  `hidden: true`.
- **Implementation:** On `hidden`, start a five-minute timer instead of
  reporting; on `visible`, cancel the timer and report `hidden: false` at
  once if the tab had been reported hidden. When the timer fires, report
  `hidden: true`. The value the connection re-sends after a snapshot is the
  last reported value, not the raw `document.hidden`, so a reconnect during
  the five minutes does not mark the tab AFK early and a reconnect after it
  keeps the mark. Keep the timer in one place, the hook or the connection,
  and make the delay a named constant.
- **Known limit:** Browsers throttle timers in background tabs. In Chrome a
  timer in a tab hidden for more than five minutes runs at most once a
  minute, so the report can arrive up to about a minute late. That is
  acceptable for an AFK marker; note it in the docs rather than working
  around it.
- **Acceptance:** In two tabs, backgrounding one shows no marker in the
  other for five minutes, then the marker appears; switching back clears it
  at once. A page reload during the five minutes shows no marker; a reload
  after it keeps the marker until the tab is visible again.
- **Tests:** Connection or hook tests with fake timers for: hidden then
  visible before the delay sends nothing; hidden for the delay sends
  `hidden: true`; visible after that sends `hidden: false`; a snapshot
  during the delay resends `false` and one after it resends `true`. Update
  the roster test that expects an immediate `hidden: true`. The browser
  check can shorten the delay through an environment variable or leave the
  timing to the unit tests and assert only the immediate clear.
- **Docs:** `docs/PROTOCOL.md` client behavior (when `presence` is sent),
  `docs/USER_EXPERIENCE.md` roster section, the AFK bullet in `AGENTS.md`,
  and a note in `docs/superpowers/specs/2026-09-09-afk-presence-design.md`.

## 40. Drive the lobby in the browser check instead of `?name=`

- [ ] **Tooling cleanup, check-browser.mjs**
- **Source:** Question while testing on 2026-09-09: the `?name=` override has
  never been used by hand; it exists for the browser check.
- **Location:** The `tab()` helper in `check-browser.mjs` builds every tab URL
  as `/?name=<handle>&room=<id>`; `hasNameOverride` and `initialHandle` in
  `client/src/App.tsx`; the override is described in `docs/USER_EXPERIENCE.md`,
  `docs/PROTOCOL.md`, and `AGENTS.md`. No unit test uses it.
- **Requested behavior:** The browser check joins each participant by driving
  the lobby: open `/`, type the handle into the name field, pick the room,
  press Join. Once nothing depends on the override, remove `?name=` handling
  from the client and its three doc mentions, so the URL carries at most the
  room.
- **Acceptance:** `npm run check:browser` passes 46/46 (or the then-current
  count) without any `?name=` URL; the remembered-handle rule in `AGENTS.md`
  no longer needs the override clause.
- **Tests:** The browser check itself; delete the override branch from the
  handle initialiser and any test that exercised it.
- **Docs:** Remove the override from the three docs in the same change.

## 43. Cap the size of a socket frame

- [ ] **Review finding, server**
- **Source:** Review of task 18 on 2026-09-09. `new WebSocketServer` in
  `server/index.js` uses the `ws` default `maxPayload` of 100 MiB, so a
  client can send a frame far larger than anything the protocol needs;
  `JSON.parse` and the `Array.from` in the private and key handlers then
  run over it before validation rejects it.
- **Location:** `server/index.js`, the `WebSocketServer` construction;
  `test-server-ws.js`; `docs/PROTOCOL.md`, the WebSocket section.
- **Requested behavior:** Nothing a user can notice. The largest legitimate
  client frame is a private message of 200 four-byte code points, under
  one kilobyte; keystroke frames are about 60 bytes.
- **Implementation:** Pass `maxPayload: 4096` to `WebSocketServer`. The
  `ws` library closes an offending socket with code 1009 on its own; no
  handler code changes. Do not add a second length check to the handlers.
- **Known limit:** A closed socket reconnects through the normal path and
  replays pending keystrokes; that is the existing behavior, not something
  to change here.
- **Acceptance:** `npm test` passes; a raw socket sending an 8 KB frame
  after `hello` is closed with 1009 while the other participant's socket
  stays open.
- **Tests:** `test-server-ws.js`: one test as in Acceptance, and one that
  a private message of exactly 200 four-byte code points still arrives
  (the existing emoji test covers this; keep it).
- **Docs:** One sentence in the WebSocket section of `docs/PROTOCOL.md`
  naming the frame cap and the 1009 close.

## 44. Protect the server from floods

- [ ] **Review finding, server**
- **Source:** Review of task 18 on 2026-09-09. The private message handler
  has no rate limit, and neither does anything else: a raw socket can send
  thousands of keystrokes a second, each broadcast to up to ten sockets;
  `POST /api/rooms` with `forceNew` creates a room per call and rooms are
  never capped; `POST /api/join` with a fresh handle each time fills rooms
  and the global handle set. Alex decided the guard belongs on the server
  and applies to every kind of traffic, not only private messages.
- **Location:** `server/index.js`: the socket `message` handler (the
  post-`hello` dispatch that calls `handleKey`, `handlePresence`, and
  `handlePrivate`), the `hello` branch before it, `getOrCreateRoom`, the
  `/api/rooms` and `/api/join` routes, and the constants block near
  `HEARTBEAT_TIMEOUT_MS`; `test-server-ws.js` and `test-server-api.js`;
  `docs/PROTOCOL.md`, the WebSocket section and the REST error tables;
  `client/src/connection.ts`, which reconnects after `RECONNECT_DELAY_MS`.
- **Requested behavior:** Ordinary use never notices anything. A person
  typing at full speed, pasting 100 characters (one keystroke each, sent in
  a burst), correcting with held-down Backspace, and switching tabs stays
  well inside every limit. A socket that sends far more than a person can
  is told once and closed; its client reconnects through the normal path
  and, if it keeps flooding, is closed again. Room creation and joining
  from one address are limited so a script cannot create rooms or handles
  without bound. The room-of-ten rule, stale cleanup, and the transcript
  are unchanged.
- **Implementation:** One token bucket per socket for messages of any
  type, refilled at `SOCKET_MESSAGES_PER_SECOND` (start at 40) with a burst
  of `SOCKET_BURST` (start at 200, so a 100-character paste plus typing
  fits). Count every parsed message after `hello`, including bad ones. On
  overflow send `{type:"error", code:"too-fast"}` and close the socket
  with code 1008; do not process the message. Do not store anything on
  the participant; the bucket lives on the socket object so a reconnect
  starts fresh. For REST, one bucket per client address (`req.ip`, with
  `app.set('trust proxy', 1)` since Fly.io sits in front) shared by
  `POST /api/rooms` and `POST /api/join`, about 10 per minute with a burst
  of 20, answering 429 `{error:"too many requests"}`. Cap the number of
  rooms at `MAX_ROOMS` (start at 50): when every room is full or the cap is
  reached, `/api/rooms` and `/api/join` answer 503 `{error:"no room"}`
  rather than creating one. Stale-swept empty rooms already free their
  slot. All constants are exported for tests; test mode keeps them unless
  a test sets them through `resetForTests()` or a small setter, whichever
  is simpler. No new dependency; a bucket is a timestamp and a count.
- **Known limit:** A person on a shared address (an office, a phone
  network) shares the REST bucket with their neighbours; 10 joins a minute
  per address is generous enough for that. Do not rate-limit `GET`
  routes or the health check. The client is not changed: a closed socket
  already reconnects and replays pending keystrokes, and a flooding client
  is not one we ship.
- **Acceptance:** In two tabs, pasting 100 characters, typing fast, and
  holding Backspace never disconnects anyone. `npm run check:browser`
  passes untouched. A raw socket that sends 1,000 keystrokes without
  pause receives `too-fast` and is closed; the other tab keeps working.
  Creating rooms in a loop stops at the cap with 503, and join in a loop
  from one address gets 429 after the burst.
- **Tests:** `test-server-ws.js`: a burst of 150 keystrokes on one socket
  is fully echoed (under the burst); 300 without pause gets `too-fast` and
  a close with 1008 while the second participant's socket stays open; a
  reconnect after the close gets a snapshot. `test-server-api.js`: the
  REST bucket answers 429 after the burst and recovers after the refill
  time (use a small refill in the test through the setter); rooms stop at
  `MAX_ROOMS` with 503. The browser check is the test that ordinary use
  is unaffected.
- **Docs:** `docs/PROTOCOL.md`: the `too-fast` error and the 1008 close in
  the WebSocket section, the 429 and 503 rows in the REST error tables,
  and the room cap; `docs/DESIGN.md`: one paragraph on why limits are per
  socket and per address and why the numbers are far above human speed;
  AGENTS.md rule list: one line naming the limits.
