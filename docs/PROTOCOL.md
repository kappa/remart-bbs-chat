# Client/server protocol

This describes the implemented behavior: chat input travels over one WebSocket
per participant, the server is the single authority that echoes every keystroke,
and HTTP serves rooms, join, leave, and roster. There is no optimistic client
rendering and no HTTP chat mutation endpoint.

Sources: [server routes and socket handlers](../server/index.js),
[HTTP client](../client/src/api.ts), [socket connection](../client/src/connection.ts),
and [client behavior](../client/src/App.tsx). Server behavior is the source of
truth for wire fields.

## Terminology

| Term | Meaning | Name in code |
| --- | --- | --- |
| Live line | The line a participant is typing right now. At most one per participant; none while idle. | `liveText`, `liveRow` |
| Committed line | A line finished with Enter, or preserved when its author leaves. Never changes again. | `room.lines` |
| Row | A position in the shared transcript, assigned by the server. Live and committed lines share one numbering. | `row` |
| Keystroke | One client message: a character, a backspace, or Enter. | `key` |
| Sequence number | The client's running count of its keystrokes, starting at 1, used to detect replayed duplicates. | `seq` |
| Snapshot | Everything needed to render a room, sent when a socket connects. | `snapshot` |
| Announcement | A committed line the server writes when someone joins or leaves. | content starts with `* ` |

## Transport and conventions

| Direction | Transport | Purpose |
| --- | --- | --- |
| Browser → server | HTTP GET | Rooms, roster, health |
| Browser → server | HTTP POST with JSON | Create/select room, join, leave |
| Browser → server | WebSocket JSON at `/ws` | `hello` handshake, then `key` keystrokes |
| Server → requesting browser | HTTP JSON response | Requested data or error |
| Server → participant socket | WebSocket JSON | Snapshot, live-line echo, committed lines, roster, command results, errors |

- Express and the WebSocket server share one HTTP server, on `PORT` or port
  3000. The browser uses relative HTTP URLs on its page origin.
- The browser connects to `ws://<window.location.host>/ws`, or `wss://` for an
  HTTPS page. Only the `/ws` path accepts socket connections.
- There is no development proxy: the client is always served by Express from
  `client/dist`.
- HTTP request/response bodies and socket messages are JSON objects; socket
  frames are JSON text. Unknown fields are ignored.
- Successful HTTP requests return 200. Creation does not use 201. Explicit
  route errors use `{"error":"message"}`. Malformed JSON, oversized bodies, and
  unexpected exceptions use Express's default handling. Unknown API routes
  return an empty 404 when static serving is enabled; otherwise they fall
  through to Express's default handling.
- IDs are JSON numbers in responses. Room and participant lookup generally
  applies JavaScript `Number()` to supplied IDs. Prefer numeric IDs in requests;
  this is not a strictly validated schema.
- `joinedAt` and `committedAt` are milliseconds since Unix epoch. `lastSeen` is
  internal and never sent.
- Joining issues an unpredictable per-participant token (32 lowercase hex
  characters). It authorizes the socket `hello` and HTTP leave. Missing or
  incorrect tokens are rejected and change nothing. No snapshot, roster, or
  broadcast ever exposes the token. Express uses unrestricted `cors()`; the
  socket handler performs no application origin check.

## Identity and stored state

Rooms and participants are in-memory objects. IDs start at 1 and increment
globally within the process; they can repeat after a restart. A room holds its
participants, committed lines, and subscribed sockets. No database, durable
log, or event replay exists; restarting the server loses everything.

Each participant has one live line (its text plus an optional shared row). A
first character allocates `greatestRow(room) + 1`. Committing preserves
that row and clears the live line; committing without an allocated row
creates a fresh one. Backspacing a live line to empty retains its row.
`slot` is a reusable roster slot from 0 to 9, not transcript order.

Join and leave announcements are ordinary committed records whose content is
`* <handle> joined` or `* <handle> left`. The wire format has no system-line
flag. Stored colors survive the author's departure. Colors are allocated from:

```json
["#A6D854","#FFD92F","#FC8D62","#8080FF","#00FFFF",
 "#E78AC3","#8DA0CB","#FF00FF","#FF5555","#FFFFFF",
 "#66C2A5","#867924","#926D75","#00A600","#108A92",
 "#D70082","#9E59BA","#CABE9A","#E3CAFF","#BE5900"]
```

This is the approved hybrid participant palette in assignment order: six
ColorBrewer Set2 colors, selected original/VGA colors, white tenth, and
nine Glasbey additions. Black is excluded. The first participant to join
takes the first unused color in this order. Rooms hold ten participants,
so only the first ten are assigned; the tail is reserved for a possible
future capacity increase.

The browser stores
`{roomId, roomName, participantId, handle, token, joinedAt, historyFromRow}`
under `remart-bbs-chat.session` in sessionStorage. Sessions without a token or
numeric `joinedAt`/`historyFromRow` are treated as expired: the client
discards them and the
user rejoins. Its default
handle is stored under `remart-bbs-chat.handle` in localStorage. `?name=`
overrides the default without overwriting it; `?room=` requests a preferred
room through the normal room selection endpoint. These URL parameters are
client conveniences, not server authentication or socket parameters.

## HTTP endpoint reference

All endpoints below are browser → server requests. Response shapes use
TypeScript-like notation only to describe JSON: `?` means optional, `| null`
means an explicit JSON null is possible, and arrays are JSON arrays.

### GET /health

No body or query parameters. Returns:

```ts
{ ok: true, rooms: number, uptime: number }
```

`rooms` is the number of stored rooms, including empty ones; `uptime` is process
uptime in seconds. The main UI does not call this endpoint.

### GET /api/rooms

No body. Returns rooms sorted by ID:

```ts
{ rooms: Array<{
  id: number, name: string, occupancy: number, max: 10, isLobby: false
}> }
```

Occupancy counts participants whose last activity is at most 40 seconds old.
Listing does not remove stale participants. The lobby polls this every second.

### POST /api/rooms

Request and response:

```ts
// Request; {} is valid
{ preferredId?: number, forceNew?: boolean }
// 200 response
{ room: { id: number, name: string } }
```

With `forceNew` truthy, creates a new empty room. Otherwise chooses the preferred
room if it exists and has fewer than ten non-stale occupants, then the first
available room in insertion order, then creates a room. A preferred ID is a hint,
not a requirement. New names are `Room <id>`. This does not join a participant.
There is no configured room-count limit or explicit route validation error.

### POST /api/join

```json
{"roomId":1,"handle":"Alice"}
```

Example response (timestamps illustrative):

```json
{
  "participant": {
    "id":1,"roomId":1,"handle":"Alice","token":"9f2c…(32 hex chars)",
    "color":"#A6D854","slot":0,"liveRow":null,"joinedAt":1788600000000,
    "historyFromRow":0
  },
  "roster":[{"handle":"Alice","color":"#A6D854","slot":0}],
  "room":{"id":1,"name":"Room 1"}
}
```

The server converts a truthy handle to a string, trims it, and limits it to 32
UTF-16 code units. Handles are unique case-insensitively across all rooms.
The target room is cleaned of stale participants before duplicate/capacity
checks. The server assigns a free color, slot, and secret participant token,
initializes the sequence at 1, creates a join announcement, and sends
`committed` (the announcement) and then `roster` to existing sockets. The join
response is the only message that carries the token: it contains neither
history nor `nextSeq` nor live text. `historyFromRow` is the row where the
participant's history window starts: the smallest row among the last 20
committed lines, or the join announcement's row when the room has none. The
server also records the current committed-line count internally, before the
announcement is stored, to distinguish subsequent commits without comparing
timestamps. These boundaries select the participant's snapshot history; see
[Client behavior](#client-behavior).
Its roster follows participant insertion
order, unlike the sorted roster endpoint.

| Status | Error string |
| --- | --- |
| 400 | `roomId and handle required` (either field falsy) |
| 400 | `handle required` (empty after trimming) |
| 400 | `handle too long` |
| 404 | `room not found` |
| 409 | `Handle already active` |
| 409 | `room full` |

If cleanup deletes the room because its last occupant was stale, the handler
recreates the room under the same id and name, carrying over the committed
lines (preserved live lines and leave notices), then completes the join in
that live room. A successful join is therefore always followed by a
discoverable room. Stale handles are reusable once their occupants are cleaned.

### GET /api/roster?roomId=1

```ts
{ participants: Array<{ handle: string, color: string, slot: number }> }
```

Sorted by `slot`. Does not clean stale participants. Missing room:
404 `{"error":"room not found"}`. Note the response key is `participants`,
whereas socket payloads embed this reduced representation under `roster`.

### POST /api/leave

```ts
// Request
{ roomId: number, participantId: number, token: string }
// 200 response
{ freed: boolean }
```

The token is required: a missing or incorrect token returns
`401 {"error":"invalid token"}` and the participant stays in the room.

Missing room or participant returns `{freed:false}`. A successful leave runs
the single leave path (see [Leave, stale cleanup, and `q`](#leave-stale-cleanup-and-q)):
nonempty live text is preserved as a committed line, a leave announcement is
added, the participant's socket is closed, and remaining sockets receive the
`committed` messages and then `roster`. If the room empties it is deleted
without broadcasts.

The browser sends no leave on page exit. A reload reconnects with the
stored session and token (see [Liveness and lifetime](#liveness-and-lifetime));
only explicit Leave and the `q` command end the session at once.

## WebSocket message reference

All messages are JSON text frames. Unknown fields are ignored.

### Client to server

```ts
{ type: "hello", roomId: number, participantId: number, token: string }
{ type: "key", seq: number, kind: "char", char: string }
{ type: "key", seq: number, kind: "backspace" }
{ type: "key", seq: number, kind: "enter" }
{ type: "key", seq: number, kind: "left" | "right" }
{ type: "key", seq: number, kind: "word-left" | "word-right" }
{ type: "key", seq: number, kind: "home" | "end" }
{ type: "key", seq: number, kind: "delete" }
{ type: "presence", hidden: boolean }
```

`hello` must be the first message on a socket. `key` carries one keystroke.
`presence` reports the tab's visibility (`document.hidden`). The client
sends it once after every snapshot and again whenever visibility changes.
It is not numbered and does not enter the keystroke sequence.
Paste is a burst of `char` keystrokes, capped at 100 code points on the
client. `char` must satisfy the character rule described under
[Edge cases](#edge-cases-1). The movement and delete kinds operate on the
server-owned caret, also described there.

### Server to the sender only

```ts
{ type: "snapshot", roomId: number,
  you: { participantId: number, nextSeq: number },
  liveLines: Array<{ participantId: number, handle: string, color: string,
                     slot: number, afk: boolean, row: number | null, text: string, caret: number }>,
  committed: Array<{ id: string, row: number, text: string, handle: string,
                     color: string, committedAt: number }>,
  roster: Array<{ participantId: number, handle: string, color: string, slot: number, afk: boolean }> }
{ type: "command", name: "help" | "leave" }
{ type: "error", code: "unauthorized" | "unknown-participant" | "seq-gap" | "invalid-message",
  expected?: number }
```

`snapshot.committed` starts with the last 100 appended committed lines,
filters them for this participant, then sorts by row. A line is eligible if
its row is at or above the participant's `historyFromRow`, or it was appended
at or after the committed-line count recorded at join. The count is internal
server state, not a wire field. This gives exactly the last 20 pre-join
committed rows plus subsequent commits within the recovery window. Millisecond
ties and stale cleanup's older timestamps cannot change eligibility. The
100-line cap is by append order, not highest row: an earlier live row may
commit later. Reconnect uses the original join boundaries, never a new window.
The client retains previously seen lines beyond the snapshot cap.
`you.nextSeq` is the sequence number the server expects next from this participant. `liveLines` lists every participant, sorted
by slot; idle ones have `row: null` and `text: ""`.

### Server to everyone in the room

```ts
{ type: "live", participantId: number, row: number | null, text: string, caret: number, seq: number }
{ type: "committed", participantId: number | null, seq: number | null,
  line: { id: string, row: number, text: string, handle: string, color: string, committedAt: number } }
{ type: "roster", roster: Array<{ participantId: number, handle: string, color: string, slot: number, afk: boolean }> }
```

`live` replaces the named participant's live line entirely. `row: null` with
empty text means idle. `caret` is the author's typing position as a code-point
index into `text`; the author's client renders it and other clients ignore it. `committed` adds one committed line; after a commit the
server also sends `live` with `row: null` for that participant. `seq` is the
keystroke that caused the message; server-initiated changes (leave
preservation, announcements) use `participantId: null` and `seq: null`.
`roster` follows any join or leave. It also follows a `presence` report that
changes the participant's `afk` value; a report that changes nothing sends
nothing. Every room message reaches all open
participant sockets in the room, the author's included.

### Sequence rules

For each `key` the server compares `seq` with the participant's expected value,
starting at 1:

| Incoming seq | Action |
| --- | --- |
| Equal | Apply, advance, echo |
| Lower | Ignore silently: a replay of an applied keystroke |
| Higher | Send `error seq-gap` with `expected`; apply nothing |

There is no buffer for out-of-order keystrokes. A single socket delivers in
order; a gap can only come from a client bug or a lost send, and the client
recovers by resyncing.

### Commands

Enter on a live line whose text is exactly `?` or `q` does not commit.
The server clears the live line, broadcasts `live` with empty text and
`row: null`, and sends `command` to the sender. For `q` the server then runs
the leave path (preserve nonempty text, announcement, roster) and closes the
socket. A line containing only `l` is ordinary chat, committed through server
echo. Surrounding whitespace makes it ordinary chat: the comparison is exact,
so `" q"` is committed as text.

### Edge cases

- Backspace on an empty live line: advance the sequence number and echo `live`
  unchanged, so the sender's queue drains. No row is allocated.
- Backspace removes one code point. Combining marks are separate code points
  and take a Backspace of their own.
- The server owns each participant's caret: a code-point index into
  `liveText`, sent as `caret` on `live` and in snapshot live lines.
  `char` inserts at the caret and moves it right; `backspace` deletes the
  code point before it; `delete` deletes the code point after it; `left`,
  `right`, `home`, and `end` move it; `word-left` and `word-right` move to
  the start of the word before, or the end of the word after, the caret —
  words are whitespace-delimited. All positions are code points, so emoji
  and Cyrillic move and delete as single characters. Movement or deletion at
  the ends of the line is a no-op that still echoes and advances `seq`.
  Movement on an idle line claims no row; only `char` claims one. Enter
  commits the whole line regardless of caret position and resets the caret
  to 0, and the `?`, `q` commands still match the whole line text.
- Enter on an idle participant: commit an empty line on a fresh row.
- A second `hello` for a participant that already has a socket replaces the
  old socket, which is closed. This covers a tab reconnecting before its old
  connection times out, and every page reload: the reloaded page authenticates
  with its stored credentials and continues as the same participant.
- Anything other than `hello` as the first message, or a `hello` with a bad
  token: `error unauthorized` and close. `hello` for a room or participant
  that no longer exists: `error unknown-participant` and close.
- Malformed JSON or an unknown `type` after `hello`: `error invalid-message`,
  connection stays open. A `key` without a numeric `seq` or with an unknown
  `kind` is also `invalid-message` and is not applied.
- A `presence` message whose `hidden` is not a boolean: `error
  invalid-message`, nothing changes.
- A `char` keystroke whose character fails validation is applied as a no-op:
  it advances the sequence number and echoes `live` unchanged. An unexpected
  character can therefore never wedge the stream. The client validates before
  sending. Validation requires a string with `Array.from(char).length === 1`,
  rejecting CR, LF, DEL, and C0 controls other than tab. Spaces and
  supplementary Unicode characters are allowed. This counts code points, not
  grapheme clusters; it is not comprehensive validation of printable Unicode.

### Emission order

| Trigger | Socket messages, in order |
| --- | --- |
| Character or backspace | `live` |
| Enter (non-command) | `committed`, then `live` (`row: null`, empty text) |
| Command (`?`) | `live` (cleared), then `command` to the sender only |
| Command (`q`) | `live` (cleared), `command` to the sender, then the leave messages below; the sender's socket closes |
| Join | `committed` (announcement), then `roster` to existing sockets; the newcomer receives the snapshot on `hello` |
| `presence` with a new value | `roster` to everyone; nothing when the value is unchanged |
| Leave or stale cleanup with survivors | `committed` per preserved live line, `committed` (announcement), `roster` |
| Last participant removed | Nothing; the room is deleted |

### Leave, stale cleanup, and `q`

HTTP leave, stale cleanup, and the `q` command all run one removal path. A
nonempty live line is preserved as a committed line: a deliberate leave stamps
it at leave time, stale cleanup at the participant's last activity. Then a
`* <handle> left` announcement is added at removal time. Both are broadcast as `committed` with `participantId: null` and
`seq: null`, followed by `roster`. The participant's socket is closed. An
emptied non-lobby room is deleted without broadcasts; newly created rooms that
never had a participant are not removed by the stale sweep.

## Liveness and lifetime

- AFK is separate from liveness. The server owns each participant's `afk`
  flag, set only by that participant's `presence` reports and carried in
  snapshots and roster broadcasts. Pongs and keystrokes refresh `lastSeen`
  and never change `afk`. A reconnecting socket keeps the stored value until
  its post-snapshot report replaces it, so a hidden tab that reconnects never
  flashes active. Stale cleanup removes the participant and the flag with
  them.
- Every socket message and every WebSocket pong refreshes the participant's
  `lastSeen`. The server pings all sockets every 12 seconds (WebSocket control
  frames; browsers answer automatically).
- Stale means `lastSeen < now - 40000`. A sweep runs every 15 seconds and on
  every join. Timeout and physical removal are separate; lists can exclude
  stale occupants before they have been deleted.
- Socket close does not remove the participant: a dropped connection does not
  end the session, and a reconnecting tab replaces its old socket via `hello`.
  Closing the tab sends no leave either: the participant, handle, color, and
  slot persist until the stale sweep removes them, normally 40–55 seconds
  after last activity (40-second threshold, 15-second sweep, plus cleanup on
  join). Joining the same handle from a fresh tab can fail until then;
  explicit Leave and `q` release it promptly.
- A reload reconnects with the stored session and keeps participant ID,
  token, color, slot, live row, text, and caret, sequence position, and the
  join-history boundary. It emits no leave/join announcements and no newcomer
  notification. The new socket replaces the old one through the existing
  authenticated `hello`, receives a recovery snapshot, and resumes numbering
  from the snapshot's `nextSeq`. A reload after participant removal or server
  restart cannot restore the session (`unknown-participant` ends it).
- Full document reload recovers only server-confirmed state. Unacknowledged
  keystrokes live in page memory and are lost on reload (same-document
  reconnect still replays them), and scrollback is capped at the last 100
  committed records filtered by the original join boundary.
- Stale cleanup preserves nonempty text at the last-seen time, matching the
  leave path above.
- Rooms are deleted when leave or stale cleanup removes their last participant.

## Example session exchange

```mermaid
sequenceDiagram
    participant A as Alice browser
    participant S as Server
    participant B as Bob browser
    A->>S: HTTP POST /api/rooms {}
    S-->>A: 200 {room:{id:1,name:"Room 1"}}
    A->>S: HTTP POST /api/join {roomId:1,handle:"Alice"}
    S-->>A: 200 {participant,roster,room}
    A->>S: WS hello {roomId:1,participantId:2,token}
    S-->>A: WS snapshot {you:{nextSeq:1},liveLines,committed,roster}
    Note over A: Renders the snapshot; no local echo
    A->>S: WS key {seq:1,kind:"char",char:"A"}
    S-->>A: WS live {participantId:2,row:1,text:"A",caret:1,seq:1}
    S-->>B: WS live {participantId:2,row:1,text:"A",caret:1,seq:1}
    A->>S: WS key {seq:2,kind:"enter"}
    S-->>A: WS committed {participantId:2,seq:2,line:{row:1,text:"A"}}
    S-->>B: WS committed {participantId:2,seq:2,line:{row:1,text:"A"}}
    S-->>A: WS live {participantId:2,row:null,text:"",caret:0,seq:2}
    S-->>B: WS live {participantId:2,row:null,text:"",caret:0,seq:2}
```

The live line appears on the author's client only when the server echoes it,
exactly as observers see it. A replayed keystroke (`seq` lower than expected)
is ignored; a gap answers `error seq-gap` with `expected`, and the client
resyncs its counter.

## Client behavior

Lifecycle:

| Activity | Client behavior |
| --- | --- |
| Lobby | Polls `GET /api/rooms` every 1 second |
| Joined | Opens `/ws`, sends `hello`, renders the room from the `snapshot` |
| Unexpected close | Reconnects after 1.2 seconds and repeats `hello` |
| Session change or unmount | Closes the socket |
| Page hide | Best-effort HTTP leave via beacon/keepalive |

Pending queue: keystrokes are numbered from 1 (or from the snapshot's
`nextSeq` when nothing is pending), queued up to 200, sent once the snapshot
has arrived, and dropped when an echo carrying the own participant id and a
sequence number at or above theirs arrives. On reconnect the snapshot's
`nextSeq` prunes the queue and the rest is resent in order. A full queue
drops keystrokes with the warning "Not connected, input paused". A `seq-gap`
error clears the queue, adopts `expected`, and shows "Connection recovered,
some input was lost".

Session end: only `error unknown-participant` or `unauthorized`, the
`command leave` reply, or the user's own leave action clears the session.

Session resume: before opening the socket for a stored session the client
claims a Web Lock named `remart-bbs-chat.session.<participantId>` with
`ifAvailable`, and holds it until the session ends or the page unloads. A
duplicated tab (which copies `sessionStorage`) finds the lock taken, drops
its copy, and shows the lobby; a reload gets the lock because the old
document released it. Without Web Locks the claim always succeeds.

Commands: Enter is a plain keystroke; the server decides. `command help`
opens the overlay, `leave` returns to the lobby, and any other name is
ignored. The Leave button calls HTTP leave directly instead of typing `q`.

Rendering: `computeDocumentLines` over accumulated committed lines and live
lines; nothing renders before the echo; the caret sits on the own live row
or, when idle, on a local preview row below the transcript. The server selects
snapshot history using the participant's join boundaries. The client accumulates
every delivered committed line, from snapshots and live events, without filtering
by timestamp or row. A line the newcomer watched being typed therefore stays
visible when it commits, including when stale cleanup stamps it before the join.

Existing protocol coverage is in [HTTP tests](../test-server-api.js),
[server logic tests](../test-server-logic.js), and
[WebSocket tests](../test-server-ws.js). Update this reference alongside future
wire-protocol changes.
