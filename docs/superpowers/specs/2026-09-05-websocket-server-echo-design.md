# WebSocket chat transport with server echo

Design for TODO tasks 11 (WebSocket as the chat transport), 10 (server echo,
no local echo), and 7 (development socket routing), absorbing issues 2 (lost
keystrokes stall input) and 3 (transient poll failures end the session).
Approved 2026-09-05.

Task 12 (last 20 lines on join) is deliberately not designed here. It stays
independent and adds what it needs to the snapshot when it is implemented.
This overrides the TODO's instruction to design task 12's window during task 11.

## Terminology

These words are used in this spec, in the maintained docs, and in code
identifiers and comments touched by this change.

| Term | Meaning | Replaces |
| --- | --- | --- |
| Live line | The line a participant is typing right now. At most one per participant; none while idle. | `activeContent`, `activeLineIdx`, "draft" |
| Committed line | A line finished with Enter, or preserved when its author leaves. Never changes again. | `room.lines`, "history" |
| Row | A position in the shared transcript, assigned by the server. Live and committed lines share one numbering. | `lineIdx` |
| Keystroke | One client message: a character, a backspace, or Enter. | "op", "operation" |
| Sequence number | The client's running count of its keystrokes, starting at 1, used to detect replayed duplicates. | `seq` |
| Snapshot | Everything needed to render a room, sent when a socket connects. | `room-state` |
| Announcement | A committed line the server writes when someone joins or leaves. | "system line" |

Where the code is touched, identifiers are renamed to match: `activeContent`
becomes `liveText`, `activeLineIdx` becomes `liveRow`, `lineIdx` becomes `row`,
and "draft" disappears from comments. Untouched code keeps its names.

## Goals

- The chat stream, both directions, travels over one WebSocket per joined
  participant. HTTP serves only what happens outside a room.
- The client shows text only after the server confirms it. No optimistic
  rendering, no reconciliation.
- A brief disconnect heals itself: unconfirmed keystrokes are replayed once.
  Lost input can never stall later input.
- The session does not end because of a transient failure.
- Fewer moving parts: no polling, no HTTP heartbeat, no out-of-order buffer,
  no Vite development server.

## Shape of the system

One WebSocket per joined participant, at path `/ws`, carries everything that
happens inside a room. HTTP keeps: list rooms, create room, join, leave, roster.

Session lifecycle:

1. Join over HTTP as today. The response carries the participant token.
2. Open the socket and send `hello` with room, participant, and token. The
   server checks the token, binds the socket to the participant, and replies
   with a `snapshot`. Then it streams events.
3. Keystrokes go up the socket, one message each, numbered in order. The
   server applies each and sends the resulting live line, or the committed
   line on Enter, to everyone in the room including the sender.
4. The client renders nothing from its own keystrokes. Text appears when the
   server's message arrives. The blinking caret below the transcript remains
   as a local affordance and does not predict text.
5. If the socket drops, the client reconnects, sends `hello` again, receives a
   fresh snapshot, and resends keystrokes the server has not echoed. The
   server ignores ones it already applied.
6. Presence is the socket: every message and every WebSocket pong refreshes
   `lastSeen`. The 40-second timeout and 15-second sweep stay.

## Messages

All messages are JSON text frames. Unknown fields are ignored.

### Client to server

```ts
{ type: "hello", roomId: number, participantId: number, token: string }
{ type: "key", seq: number, kind: "char", char: string }
{ type: "key", seq: number, kind: "backspace" }
{ type: "key", seq: number, kind: "enter" }
```

`hello` must be the first message on a socket. `key` carries one keystroke.
Paste is a burst of `char` keystrokes, capped at 100 code points on the
client as today. `char` must satisfy the existing `isValidChar` rule.

### Server to the sender only

```ts
{ type: "snapshot", roomId: number,
  you: { participantId: number, nextSeq: number },
  liveLines: Array<{ participantId: number, handle: string, color: string,
                     slot: number, row: number | null, text: string }>,
  committed: Array<{ id: string, row: number, text: string, handle: string,
                     color: string, committedAt: number }>,
  roster: Array<{ participantId: number, handle: string, color: string, slot: number }> }
{ type: "command", name: "roster" | "help" | "leave" }
{ type: "error", code: "unauthorized" | "unknown-participant" | "seq-gap" | "invalid-message",
  expected?: number }
```

`snapshot.committed` holds the same lines `/api/room-state` returns today: the
last 100 appended committed lines, sorted by row. `you.nextSeq` is the
sequence number the server expects next from this participant. `liveLines`
lists every participant; idle ones have `row: null` and `text: ""`.

### Server to everyone in the room

```ts
{ type: "live", participantId: number, row: number | null, text: string, seq: number | null }
{ type: "committed", participantId: number | null, seq: number | null,
  line: { id: string, row: number, text: string, handle: string, color: string, committedAt: number } }
{ type: "roster", roster: Array<{ participantId: number, handle: string, color: string, slot: number }> }
```

`live` replaces the named participant's live line entirely. `row: null` with
empty text means idle. `committed` adds one committed line; after a commit the
server also sends `live` with `row: null` for that participant. `seq` is the
keystroke that caused the message, or null for server-initiated changes such
as leave preservation and announcements. `roster` follows any join or leave.

### Sequence rules

For each `key` the server compares `seq` with the participant's expected value:

| Incoming seq | Action |
| --- | --- |
| Equal | Apply, advance, echo |
| Lower | Ignore silently: a replay of an applied keystroke |
| Higher | Send `error seq-gap` with `expected`; apply nothing |

There is no buffer for out-of-order keystrokes. A single socket delivers in
order; a gap can only come from a client bug or a lost replay, and the client
recovers by resyncing.

### Commands

Enter on a live line whose text is exactly `l`, `?`, or `q` does not commit.
The server clears the live line, broadcasts `live` with empty text and
`row: null`, and sends `command` to the sender. For `q` the server then runs
the leave logic (preserve nonempty text, announcement, roster) and closes the
socket. Surrounding whitespace makes it ordinary chat, as the UX doc says.

### Edge cases

- Backspace on an empty live line: advance the sequence number and echo `live`
  unchanged, so the sender's queue drains. No row is allocated.
- Enter on an idle participant: commit an empty line on a fresh row, as today.
- A second `hello` for a participant that already has a socket replaces the
  old socket, which is closed. This covers a tab reconnecting before its old
  connection times out.
- Anything other than `hello` as the first message, or a `hello` with a bad
  token: `error unauthorized` and close. `hello` for a room or participant
  that no longer exists: `error unknown-participant` and close.
- Malformed JSON or an unknown `type` after `hello`: `error invalid-message`,
  connection stays open. A `key` without a numeric `seq` or with an unknown
  `kind` is also `invalid-message` and is not applied.
- A `char` keystroke whose character fails validation is applied as a no-op:
  it advances the sequence number and echoes `live` unchanged. An unexpected
  character can therefore never wedge the stream. The client validates before
  sending, as today.

## Client

State for a joined session:

- `session`: room, participant id, handle, token, in sessionStorage as today.
- `room`: last snapshot, updated in place by `live`, `committed`, `roster`.
  Committed lines live in a map keyed by id and are never removed while the
  session lasts, so scrollback survives snapshot truncation. Lines committed
  before the participant's own join time are filtered out, as today.
- `pending`: unconfirmed keystrokes in order, each with its sequence number.
  Bounded at 200.
- `connection`: `connecting`, `open`, or `reconnecting`, shown as a one-line
  status in the terminal chrome.

Sending: assign the next sequence number, append to `pending`, send if the
socket is open. Nothing on screen changes. A `live` or `committed` message
carrying the own participant id and a sequence number drops everything in
`pending` up to and including that number. Typing is accepted while echoes
are in flight, so `A`, Enter, `B`, Backspace, `C` typed quickly are numbered
and sent in order without waiting.

Backspace and Enter are always sent, even when the visible live line is
empty, because the visible line may lag the real one. The only local decisions
are paste trimming and character validation.

Reconnect: on close, set `reconnecting`, wait 1.2 seconds, open a new socket,
send `hello`. On `snapshot`, replace live lines and roster, merge committed
lines into the map, then resend `pending` in order. If `pending` is full while
disconnected, further keystrokes are dropped with the warning "Not connected,
input paused." On `seq-gap`: clear `pending`, set the counter to `expected`,
show "Connection recovered, some input was lost."

Session end: only `error unknown-participant` on `hello`, a `command leave`,
or the user's own leave clears the session. Socket loss alone never does.

Commands: Enter is just a keystroke. On `command`: `roster` shows "Roster
refreshed", `help` opens the help overlay, `leave` clears the session. Toolbar
buttons keep calling HTTP roster and leave; the help button opens the overlay
locally. Page exit still sends the HTTP leave beacon.

Rendering: one function turns `room` into rows: committed lines from the map
plus one row per non-idle live line, sorted by row number. This is today's
`computeDocumentLines`, now the only path. Deleted: `optimisticContent`,
`pendingCommits`, `draftLineIdx`, `finishedDraftIdxsRef`, the promise queue,
`clearActiveCommand`, and the React Query room-state query. React Query stays
for the lobby room list only. `api.ts` loses `sendChar`, `sendBackspace`,
`commitLine`, `heartbeat`, and `getRoomState`.

## Server

`server/index.js` keeps its in-memory model and the HTTP routes for rooms,
join, leave, roster, and health.

- Socket server bound to path `/ws`. First message must be `hello`; the
  server validates with the existing token check, stores the socket on the
  participant, replies `snapshot`.
- Each `key` follows the sequence rules above. `opBuffer`,
  `drainBufferedOps`, and `handleSeqOp` are deleted. The three apply
  functions are renamed to the new terms and return the message to broadcast
  instead of broadcasting themselves.
- Commands are recognized on the server as described. The leave logic is
  extracted into one function used by the HTTP route, the `q` command, and
  stale cleanup.
- `live`, `committed`, and `roster` replace `char`, `backspace`, `commit`, and
  `room-update`. Join, leave, and stale cleanup send `committed` for each
  announcement or preserved line, then `roster`. `charEvents` is deleted.
- Presence: every socket message refreshes `lastSeen`. The server pings each
  socket every 12 seconds; a pong refreshes `lastSeen`. A socket close does
  not remove the participant; the sweep does, which preserves unsent text
  across a reload.
- Deleted routes: `/api/char`, `/api/backspace`, `/api/commit`,
  `/api/heartbeat`, `/api/room-state`, `/api/room/:id`.
- Unchanged: room creation and selection, join validation and stale-room
  recreation, handle uniqueness, colors and slots, row allocation, line ids,
  the 100-line snapshot rule, `isValidChar`. Unicode deletion stays UTF-16
  based until task 5.

## Tooling

- Delete the client `dev` and `preview` scripts and the `server` block in
  `client/vite.config.ts`. Vite remains as bundler and Vitest transform. The
  root `dev` script is removed; development is build the client, run
  Express, reload the page.
- `client/src/test-setup.ts` keeps a WebSocket stub, but as a controllable
  fake: tests read what the client sent and inject server messages, so client
  tests exercise the real transport code.

## Docs

Updated in the same commit as the code they describe:

- `docs/PROTOCOL.md`: Terminology section, `/ws` handshake, every schema,
  sequence rules, replay and `seq-gap`, presence, emission order, updated
  example exchange. HTTP chat and heartbeat text removed.
- `docs/DESIGN.md`: the optimistic-typing and transport sections rewritten
  to explain server echo and one socket.
- `docs/USER_EXPERIENCE.md`: text appears after the server confirms it; the
  connection status line; paused input when disconnected.
- `README.md`, `AGENTS.md`: run instructions without the dev server, code
  map, and the behavior-to-preserve list rewritten for server echo.
- `docs/SPECS_STATUS.md`: this spec is active.
- `TODO.md`: tasks 2, 3, 7, 10, 11 marked done with a one-line note each;
  task 8 partly done; task 12's "design during task 11" sentence removed.

## Tests

Written first, per task, as AGENTS.md requires.

Server, new `test-server-ws.js`: handshake accept and reject; keystroke echo
to sender and observer; `A` Enter `B` Backspace `C` ordering; duplicate and
gap handling; commands including `q` leaving; presence refresh via pong and
cleanup on silence; one socket per participant; empty backspace and idle
Enter. `test-server-seq.js`, `test-server-websocket.js`, and the
Enter-latency suite are replaced by it; `test-server-api.js` loses its
chat-route cases.

Client, rewritten against the fake socket: nothing renders before echo; echo
renders for sender and observer alike; fast input under delayed echo;
reconnect replays pending keystrokes once; full queue pauses input; `seq-gap`
recovery; commands via `command` messages; scrollback survives a truncated
snapshot; no force-scroll while reading up. Roster, document-lines, and theme
tests stay.

Build: `npm --prefix client run build` passes after each commit.

## Commit order

1. Terminology section in PROTOCOL.md and Vite dev server removal.
2. Server socket protocol with tests; old routes still present.
3. Client switched to the socket with tests.
4. Old HTTP routes, heartbeat, poll, and obsolete tests deleted.
5. Docs sweep for anything not already updated in 1 to 4.
