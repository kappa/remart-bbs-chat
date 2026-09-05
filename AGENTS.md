# Repository guidance

## Project and source of truth

Remart BBS Chat is a DOS-terminal-styled shared typing space: characters and
backspaces appear live in one ordered transcript. It uses a React 19/TypeScript
client and a Node.js ES-module Express/WebSocket server. Rooms and participants
live in process memory; restarting the server loses their state. There is no
database or authentication service.

Read `docs/USER_EXPERIENCE.md` for behavior and `docs/DESIGN.md` for rationale.
Together with `README.md` and the wire reference `docs/PROTOCOL.md`, these are
the maintained product docs. Follow
`docs/SPECS_STATUS.md`: material under `docs/superpowers/`, `docs/final-spec/`,
and `.superpowers/` is historical. Do not restore its superseded ASCII-only,
80-column, or typing-throttle requirements. When docs and implementation
disagree, inspect the code and tests and correct the maintained docs as part of
the relevant change.

## Code map

- `server/index.js`: in-memory state, room lifecycle, REST routes, ordered
  operations, WebSocket broadcasts, stale-participant cleanup, and static serving.
- `client/src/App.tsx`: lobby/session UI, React Query polling, socket updates,
  optimistic typing, pending commits, reconciliation, scrollback, and input.
- `client/src/api.ts`: REST request/response types and page-exit leave requests.
- `client/src/documentLines.ts`: pure ordering, color, roster, and character helpers.
- `client/src/theme.css`: terminal appearance and responsive layout.
- `client/src/main.tsx`: React entry point and QueryClient provider.
- `test-server-*.js`: Node test-runner suites for logic, HTTP, sequencing,
  WebSockets, and Enter latency.
- `client/src/*.test.{ts,tsx}`: Vitest/Testing Library suites, including rendering,
  roster, ordering, and race regressions. `test-setup.ts` stubs audio and WebSocket.
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
The root `build` script and the README's `--workspace=client` example do not
match the current package setup; use the explicit `--prefix client` command.

For client hot reload, run `npm run dev` and `npm --prefix client run dev` in
separate terminals. Vite uses port 5173 and proxies `/api` and `/health` to port
3000. It does not configure the application's root WebSocket proxy; the client
connects its socket to the current page host. Verify real socket behavior using
the built client served by Express on port 3000.

```sh
npm test
npm --prefix client test
npm --prefix client run build
```

Run the suites relevant to a change; run both for changes to the typing protocol
or reconciliation. Targeted examples:

```sh
NODE_ENV=test node --test test-server-seq.js
npm --prefix client test -- src/App.race.test.tsx
```

Server tests set `NODE_ENV=test` before dynamically importing the server, reset
shared state with `resetForTests()`, and bind integration servers to port 0.
Test mode disables automatic listening and the periodic cleanup timer. Preserve
this isolation and close sockets/servers in test teardown. Client tests mock
`api`, provide a QueryClient, and reset browser storage between cases.

There is no configured lint script. The Vite build does not perform TypeScript
type checking; do not report a successful build as a passing type check.

## Behavior to preserve

The following describes the current implementation and its regression baseline.
For the approved rewrite, `TODO.md` tasks 10–12 explicitly replace optimistic
rendering with server echo, HTTP chat input with WebSocket input, and pre-join
history exclusion with a 20-line initial window. Follow that task scope rather
than retaining the superseded mechanisms, and update these instructions and
the maintained docs as each change is implemented. Use TODO's recommended order.

- Server-assigned `lineIdx` orders committed and live rows together. Roster
  `lineSlot` is separate and must not determine transcript order.
- A participant claims a row on the first character. Enter commits in place
  and clears ownership; an idle local cursor preview has no shared row.
  Backspacing an owned row to empty preserves its index. Empty Enter is valid.
- Typing and Enter render optimistically without waiting for acknowledgements.
  Keep pending commits visible until confirmed, and retain finished-draft
  tracking so delayed snapshots cannot resurrect committed drafts.
- Character, backspace, and commit operations share a per-participant sequence.
  The server buffers out-of-order operations and ignores duplicates. Preserve
  the existing legacy path for requests without sequence numbers unless the
  task explicitly changes compatibility. Update API types, server payloads,
  and socket handling together when changing this contract.
- WebSocket events provide live updates; room-state polling provides recovery.
  Preserve both paths and test delayed replies and reordered operations for
  typing changes, particularly `A`, Enter, `B`, Backspace, `C`.
- `/api/room-state` returns the last 100 appended committed records, sorted by
  line index, as a recovery snapshot;
  this is a response limit, not a bound on the server's stored `room.lines`.
  Clients accumulate seen history since joining and preserve it across snapshot
  truncation. Do not force-scroll a viewer reading older text.
- Committed lines retain author color snapshots after departure. Preserve
  nonempty drafts on leave or stale cleanup. Client heartbeats run every 12
  seconds, with a 40-second server timeout and 15-second cleanup sweep.
- Handles are currently unique case-insensitively across all rooms; rooms allow
  up to ten participants. Browser storage is prototype session convenience.
  The `?name=` override must not overwrite the remembered default handle.
- Preserve Unicode input, the 100-character paste cap and warning, and the
  single-character Enter commands `l`, `?`, and `q`. Keep client and server
  character validation aligned.
- Preserve the monospace terminal aesthetic, author-colored text, underline
  caret, responsive layout, and ordinary transcript rows without name prefixes.

## Change discipline

Keep code well covered by meaningful tests. Cover core behavior, failure paths,
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
