# Repository guidance

## Project and source of truth

Remart BBS Chat is a DOS-terminal-styled shared typing space: characters and
backspaces appear live in one ordered transcript. Chat travels over one
WebSocket per participant; text renders only from server echo. It uses a
React 19/TypeScript client and a Node.js ES-module Express/WebSocket server.
Rooms and participants live in process memory; restarting the server loses
their state. There is no database or authentication service.

Read `docs/USER_EXPERIENCE.md` for behavior and `docs/DESIGN.md` for rationale.
Together with `README.md` and the wire reference `docs/PROTOCOL.md`, these are
the maintained product docs. Follow
`docs/SPECS_STATUS.md`: everything under `docs/archive/` is historical. Do not
execute the archived plan or restore its superseded ASCII-only, 80-column, or
typing-throttle requirements. `docs/superpowers/` holds active specs and plans;
the WebSocket server-echo plan there is implemented. Finished review
documents and superseded specs move to `docs/archive/`. When docs and
implementation disagree, inspect the code and tests and correct the maintained
docs as part of the relevant change.

## Code map

- `server/index.js`: in-memory state, room lifecycle, REST routes for
  rooms/join/leave/roster, socket handshake, keystroke echo and presence
  dispatch, stale sweep, and static serving.
- `client/src/App.tsx`: lobby/session UI, rendering from room state, and input
  dispatch.
- `client/src/connection.ts`: socket lifecycle and keystroke replay.
- `client/src/roomState.ts`: server messages to room state (pure reducer).
- `client/src/sessionLock.ts`: the per-participant Web Lock that keeps a
  session to one tab.
- `client/src/useRoomConnection.ts`: React binding between the connection and
  app events; also owns the `visibilitychange` listener that feeds AFK.
- `client/src/protocol.ts`: wire message types.
- `client/src/api.ts`: REST client for rooms, join, leave, and roster.
- `client/src/documentLines.ts`: document row ordering and character helpers.
- `client/src/mentions.ts`: pure mention token, candidate, and completion
  helpers for handle autocomplete and committed-text mention detection.
- `client/src/notifications.ts`: typed join and mention notifications with
  title and sound channels.
- `client/src/MentionList.tsx`: the floating handle list rendered next to
  the caret.
- `client/src/PrivateMessages.tsx`: the stack of private-message popups over
  the chat area, kept outside room state.
- `client/src/theme.css`: terminal appearance and responsive layout.
- `client/src/main.tsx`: React entry point and QueryClient provider.
- `client/src/testing/`: FakeWebSocket and shared room fixtures for tests.
- `test-server-*.js`: Node test-runner suites for logic, HTTP, and WebSockets,
  sharing `test-support.js` helpers.
- `client/src/*.test.{ts,tsx}`: Vitest/Testing Library suites covering the
  reducer, connection replay, rendering, roster, fast input, and transcript
  regressions. `test-setup.ts` installs the WebSocket fake and an audio stub.
- `Dockerfile` and `fly.toml`: client build plus a single server deployment.

## Install, run, and validate

Use Node.js 18 or newer (the Docker image uses Node 20). The root and `client/`
are separate npm packages; there is no npm workspace declaration. Lockfiles
are gitignored; never commit `package-lock.json`. Run these commands from the
repository root:

```sh
npm install
npm --prefix client install
npm --prefix client run build
npm start
```

The server defaults to `http://localhost:3000`; `PORT` overrides the port.
Build the client before starting the server so static serving is enabled.

There is no development server: rebuild the client with
`npm --prefix client run build` and reload the page served by Express after
client changes; restart `npm start` after server changes.

```sh
npm test
npm --prefix client test
npm --prefix client run build
```

Run the suites relevant to a change; run both for changes to the typing
protocol or echo behavior. Targeted examples:

```sh
NODE_ENV=test node --test test-server-ws.js
npm --prefix client test -- src/App.race.test.tsx
```

`npm run check:browser` runs a two-tab end-to-end check (`check-browser.mjs`)
in a headless Chrome driven over the DevTools protocol: typing, Backspace,
Enter, the `?` and `q` commands, handle autocomplete in a third tab, the
AFK marker driven by real tab switches, a page reload, a duplicated tab, and
a server restart.
It needs a built client and a `google-chrome` binary (`CHROME` overrides) and
is not part of `npm test`. Use it for changes to the typing protocol, the
socket connection, or the transcript rendering; a plan's end-to-end step can
point at it instead of a manual browser session.

Server tests set `NODE_ENV=test` before dynamically importing the server, reset
shared state with `resetForTests()`, and bind integration servers to port 0.
Test mode disables automatic listening and the periodic cleanup timer. Preserve
this isolation: both socket-using suites await `closeAllSockets()` after each
test, and `startServer()` also drains accepted sockets before closing the HTTP
server. Keep explicit closes when testing normal socket behavior.
`test-server-harness.js` runs bounded child processes to verify failure cleanup
and isolation; its deliberately failing probes must exit with code 1.

Client tests use the FakeWebSocket double
(`client/src/testing/fakeWebSocket.ts`), mock `api`, and reset browser storage
between cases.

There is no configured lint script. The Vite build does not perform TypeScript
type checking; run `npm --prefix client run typecheck` for that, and do not
report a successful build as a passing type check.

## Behavior to preserve

The following describes the current implementation and its regression baseline.

- Server-assigned rows order live and committed lines as one document; the
  roster `slot` never determines transcript order.
- The first character claims a row, Enter commits in place, backspacing to
  empty keeps the row, and an idle participant has no shared row (their own
  client shows a local caret preview). The server owns each participant's
  caret (`liveCaret`), a code-point index into the live line echoed as
  `caret` on `live`: `char` inserts at it and moves it right, `backspace`
  and `delete` remove the code point before/after it, and the movement kinds
  (`left`, `right`, `word-left`, `word-right`, `home`, `end`) move it in
  code-point units, word boundaries being whitespace. Movement is a no-op
  echo that never claims a row, and only the author's client renders the
  caret. Enter on an empty line is valid.
- Text renders only from server echo. Keystrokes are numbered per participant,
  applied in order on one socket, replayed after reconnect, ignored when
  replayed, and reported as `seq-gap` when lost. Nothing renders before the
  echo; test fast sequences like `A`, Enter, `B`, Backspace, `C`.
- The snapshot on connect carries the last 100 committed lines sorted by row;
  clients accumulate everything seen since joining, so snapshot truncation
  never deletes scrollback. A committed line is shown when its row is at or
  above the server-stored `historyFromRow` (the 20-line window recorded at join)
  or it was appended at or after the committed-line count recorded at join.
  The server filters snapshots; clients accumulate all delivered lines without
  timestamp filtering. Do not force-scroll a viewer reading older text.
- Committed lines keep author color snapshots after departure. Leave, stale
  cleanup, and the `q` command share one removal path that preserves nonempty
  live text (stamped at leave time on a deliberate leave, at last activity on
  stale cleanup), announces, broadcasts `committed` then `roster`, and closes
  the socket. The server pings sockets every 12 seconds;
  silence past 40 seconds is stale, swept every 15 seconds and on join.
  Reloads and closed tabs never leave deliberately: the stored session
  reconnects as the same participant with live state intact, while a truly
  closed tab lingers until the stale sweep (up to about a minute).
- Handles are unique case-insensitively across all rooms; rooms allow up to
  ten participants. Browser storage is prototype session convenience. The
  `?name=` override must not overwrite the remembered default handle.
- One tab per session: the client claims a Web Lock per participant before
  connecting and releases it when the session ends. A duplicated tab starts
  in the lobby like a pasted URL; a reload resumes; the server is not
  involved.
- Handle autocomplete follows the echoed live line only, and a pick goes
  over the wire as ordinary `char` keystrokes. Tab or Enter with the list
  open while keystrokes are in flight is parked until the pending count is
  zero, then resolved against the fresh echo: pick if a token with
  candidates remains, otherwise a parked Enter commits.
- Mentions are client-side and render-time: `@handle` in a committed line
  is colored from the current roster, and the bell and title notice fire
  only for a first-seen `committed` message by someone else that names
  the own handle. Notifications go through `notifications.ts`; one Sounds
  switch gates both sounds; it starts on with every page load, is never
  remembered, and `?silent=1` in the address starts it off.
- AFK follows tab visibility: the client reports `document.hidden` after
  every snapshot and on every change, the server owns the resulting `afk`
  flag carried on roster entries and snapshot live lines, and only a changed
  value broadcasts a roster. It is separate from stale detection: pongs never
  clear it, and a reconnecting socket keeps the stored value until it
  reports.
- Private messages are delivered once over the socket to one recipient and
  are never stored, replayed, or rendered as transcript rows; the client
  keeps them in their own list outside room state.
- Commands `?` and `q` are recognized by the server on Enter against the
  exact live line (surrounding whitespace makes it chat); a line containing
  only `l` is ordinary chat. Unicode input
  passes through, paste is capped at 100 characters with a warning, and
  client and server character validation stay aligned. Backspace deletes one
  code point, matching the code-point input unit; a lone surrogate is never
  left behind.
- Preserve the monospace terminal aesthetic, author-colored text, underline
  caret, responsive layout, and ordinary transcript rows without name prefixes.

## Change discipline

Work test-first (TDD): for every code change, write the failing test first,
watch it fail for the right reason, then make the minimal fix that turns it
green. A test that passes before the change proves nothing. Keep code well
covered by meaningful tests. Cover core behavior, failure paths, and important
edge cases; add or update tests alongside behavioral changes. Tests should
verify observable behavior, including interactions across client and server
where relevant, rather than mirror implementation details.

Value simplicity explicitly when making design and implementation decisions.
Prefer clear control flow, fewer independent state variables, and fewer special
cases. Weigh the complexity cost of abstractions, dependencies, and compatibility
paths against their actual benefit; choose the simplest design that meets the
requirements and remains easy to test and maintain. When a proposed fix would
change nothing the user can notice, say so instead of adding it. Prefer
deleting a tool to configuring it.

Match surrounding code style and keep changes focused; the repository has no
shared formatter configuration. Add focused regression coverage for behavioral
fixes, especially ordering and asynchronous state changes. Do not include
generated `client/dist/`, dependency directories, lockfiles, or unrelated
installation artifacts in a change.

Update the maintained docs in the same commit as the code: `docs/PROTOCOL.md`
for anything on the wire (endpoints, payloads, ordering, transport,
session/history behavior), `docs/USER_EXPERIENCE.md` for anything a user
notices, `docs/DESIGN.md` for a changed rationale, and the "Behavior to
preserve" list above for a changed rule. Document implemented behavior, not
planned behavior. User-facing copy (help text, labels, hover text) is written
in plain, friendly language, not robotic lists; ask Alex to read new copy.

## Working a task from TODO.md

`TODO.md` numbers every task and keeps the open ones in a "Recommended
implementation order" table. Task descriptions are written for an agent that
has only that file, this file, and the repository.

- Read this file first, then the task. The task's **Location** names the
  code to read; read it before changing anything. If the code disagrees with
  the task, the code is right about the present and the task is right about
  the goal: say so in the commit message and do the goal.
- One task per branch named `task-NN`, worked in a worktree at
  `/tmp/remart-bbs-chat-task-NN`. Never edit master or another task's branch
  while working a task. Everything for the task goes on that branch: the code,
  the tests, the docs, any edits to the task description, and the task's
  checkbox tick in `TODO.md`, which is part of the final commit.
- Commit each task separately before starting the next piece of work; never
  mix tasks in one working tree or one commit. Commit messages say what changed
  and why, in plain sentences, with no trailers, links to chat sessions, or
  tool names.
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
- The GitHub issue named in **Source** is closed after the task lands on
  master, with a one-line comment naming the commit (see the
  `sync-github-issues` skill).

## Branches, worktrees, and landing

- Only Alex decides when a branch lands. Landing a single-commit branch is a
  rebase onto master with no merge commit; a multi-commit branch may land with
  a merge commit. Before landing, run the full validation list on the branch
  rebased onto master; a red master is a defect to fix before landing, not a
  follow-up.
- Delete a branch and its worktree only after its commits are reachable from
  master (`git branch --merged master` lists it). Removing a worktree never
  includes deleting its branch.
- Do not create backup branches such as `master-before-x`; tag a commit you
  may want to return to (`before-websocket-server-echo` is the pattern).
- Push only when asked. Never deploy; Alex deploys to Fly.io himself.
- Planning artifacts are committed too: TODO edits, specs, plans, and reviews
  go on master (or the branch Alex names) before work is handed to another
  agent.
- Show git state as a decorated graph with dates
  (`git log --graph --oneline --decorate --date=short --format='%h %ad %d %s'`),
  never as bare commit ids.

## Working with Alex

- A question is a question. Answer it and stop; do not act on it.
- When Alex reports a repro or a non-repro that contradicts the code, say
  so and check the code rather than agreeing.
- Before asking a design question, summarize the current state and the
  forces in play, then ask. Use the vocabulary of `docs/USER_EXPERIENCE.md`
  (live line, committed line, keystroke, handle), not code names.
- Alex tests on real devices and browsers and reports confirmations. A task
  is done when he confirms it or the change is on master, not when tests pass.

## Manual testing

When Alex asks for a server to test, build the client, start `npm start` in
the background with its output in a log file, print the URL, and stop it when
he says so or before the session ends. Never leave a server running. The
`manual-test-server` skill has the commands and the URL conventions.

## Notes for small models and long sessions

- Run tests in the foreground with a timeout; background test runs die
  silently in some harnesses and their results are lost.
- After a context condensation or summary, re-read `TODO.md`, `git status`,
  and `git log --oneline -10` before touching code; summaries have carried
  wrong field names before.
- Executing a plan from `docs/superpowers/plans/`: one commit per plan task,
  run the plan's tests after each, and report the plan's status by task number
  when asked.

## Project skills

Shared, harness-independent procedures live in `.agents/skills/<name>/SKILL.md`
(`.claude/skills` links to the same directory): `todo-status`,
`sync-github-issues`, `write-task`, `land-task-branch`, `review-task-branch`,
and `manual-test-server`. Read the matching skill before doing any of those.
