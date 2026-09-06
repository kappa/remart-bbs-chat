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
the WebSocket server-echo plan there is implemented. When docs and
implementation disagree, inspect the code and tests and correct the maintained
docs as part of the relevant change.

## Code map

- `server/index.js`: in-memory state, room lifecycle, REST routes for
  rooms/join/leave/roster, socket handshake and keystroke echo, stale sweep,
  and static serving.
- `client/src/App.tsx`: lobby/session UI, rendering from room state, and input
  dispatch.
- `client/src/connection.ts`: socket lifecycle and keystroke replay.
- `client/src/roomState.ts`: server messages to room state (pure reducer).
- `client/src/useRoomConnection.ts`: React binding between the connection and
  app events.
- `client/src/protocol.ts`: wire message types.
- `client/src/api.ts`: REST client for rooms, join, leave, roster, and
  page-exit leave requests.
- `client/src/documentLines.ts`: document row ordering and character helpers.
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
are separate npm packages; there is no npm workspace declaration or checked-in
lockfile. Run these commands from the repository root:

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

Server tests set `NODE_ENV=test` before dynamically importing the server, reset
shared state with `resetForTests()`, and bind integration servers to port 0.
Test mode disables automatic listening and the periodic cleanup timer. Preserve
this isolation and close sockets/servers in test teardown. Client tests use the
FakeWebSocket double (`client/src/testing/fakeWebSocket.ts`), mock `api`, and
reset browser storage between cases.

There is no configured lint script. The Vite build does not perform TypeScript
type checking; run `npx tsc --noEmit` inside `client/` for that, and do not
report a successful build as a passing type check.

## Behavior to preserve

The following describes the current implementation and its regression baseline.

- Server-assigned rows order live and committed lines as one document; the
  roster `slot` never determines transcript order.
- The first character claims a row, Enter commits in place, backspacing to
  empty keeps the row, and an idle participant has no shared row (their own
  client shows a local caret preview). Enter on an empty line is valid.
- Text renders only from server echo. Keystrokes are numbered per participant,
  applied in order on one socket, replayed after reconnect, ignored when
  replayed, and reported as `seq-gap` when lost. Nothing renders before the
  echo; test fast sequences like `A`, Enter, `B`, Backspace, `C`.
- The snapshot on connect carries the last 100 committed lines sorted by row;
  clients accumulate everything seen since joining, so snapshot truncation
  never deletes scrollback. Lines committed before the stored `joinedAt` are
  hidden. Do not force-scroll a viewer reading older text.
- Committed lines keep author color snapshots after departure. Leave, stale
  cleanup, and the `q` command share one removal path that preserves nonempty
  live text stamped at last activity, announces, broadcasts `committed` then
  `roster`, and closes the socket. The server pings sockets every 12 seconds;
  silence past 40 seconds is stale, swept every 15 seconds and on join.
- Handles are unique case-insensitively across all rooms; rooms allow up to
  ten participants. Browser storage is prototype session convenience. The
  `?name=` override must not overwrite the remembered default handle.
- Commands `l`, `?`, and `q` are recognized by the server on Enter against the
  exact live line (surrounding whitespace makes it chat). Unicode input
  passes through, paste is capped at 100 characters with a warning, and
  client and server character validation stay aligned.
- Preserve the monospace terminal aesthetic, author-colored text, underline
  caret, responsive layout, and ordinary transcript rows without name prefixes.

## Change discipline

Work test-first (TDD): for every code change, write the failing test first,
watch it fail for the right reason, then make the minimal fix that turns it
green. Commit each task separately before starting the next piece of work;
never bundle independent tasks into one commit. Keep code well covered by meaningful tests. Cover core behavior, failure paths,
and important edge cases; add or update tests alongside behavioral changes.
Tests should verify observable behavior, including interactions across client
and server where relevant, rather than mirror implementation details.

Value simplicity explicitly when making design and implementation decisions.
Prefer clear control flow, fewer independent state variables, and fewer special
cases. Weigh the complexity cost of abstractions, dependencies, and compatibility
paths against their actual benefit; choose the simplest design that meets the
requirements and remains easy to test and maintain.

Match surrounding code style and keep changes focused; the repository has no
shared formatter configuration. Add focused regression coverage for behavioral
fixes, especially ordering and asynchronous state changes. Update maintained
product docs when behavior changes. Keep `docs/PROTOCOL.md` synchronized with
code in the same change whenever endpoints, payloads, authentication, ordering,
transport, or session/history behavior changes; document implemented behavior,
not planned behavior. Do not include generated `client/dist/`,
dependency directories, or unrelated installation artifacts in a change.
