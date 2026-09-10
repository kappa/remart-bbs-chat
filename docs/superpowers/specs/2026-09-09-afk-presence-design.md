# AFK status for participants in background tabs

Design for TODO task 31 (GitHub issue #19). Approved 2026-09-09.

A participant whose browser tab is hidden is marked AFK in everyone's roster.
The client reports tab visibility with a new presence message, the server
stores the shared status and carries it in snapshots and roster broadcasts,
and the roster shows a small text marker beside the handle. Nothing else
changes: the participant keeps their live line, color, and slot, and stale
detection is untouched.

## Terminology

| Term | Meaning |
| --- | --- |
| Hidden | The browser reports `document.hidden === true`: the tab is in the background, minimized, or otherwise not shown. |
| AFK | The server-owned status set from the last visibility report. Shown as a marker in the roster. |
| Liveness | The existing signal: pings, pongs, and keystrokes refresh last-seen; forty seconds of silence makes a participant stale. Separate from AFK. |
| Presence message | The new client message that reports visibility. |

## Decisions settled during design

- **A separate presence message**, not a field on `hello`. The handshake is
  untouched, and the server's post-handshake dispatch becomes a switch on
  message type so later non-keystroke messages (task 18's private message)
  slot in beside it.
- **The stored value survives a reconnect**; the client's report right after
  the snapshot replaces it. The server never resets AFK on `hello`.
- **Roster broadcast only on change.** No announcement line, no live-line
  message, no reordering.
- **Marker text is `afk`**, dim and smaller, after the handle. The handle
  keeps its full color.

## Wire

### Client to server

```ts
{ type: "presence", hidden: boolean }
```

Sent after `hello` only. Not numbered, not queued with keystrokes, no echo of
its own. The client sends it once after every snapshot and again on every
visibility change.

### Roster entries and snapshot live lines

Both gain `afk: boolean`:

```ts
{ type: "roster", roster: Array<{ participantId, handle, color, slot, afk: boolean }> }
snapshot.roster: same shape
snapshot.liveLines: Array<{ participantId, handle, color, slot, afk: boolean, row, text, caret }>
```

Both places carry it because the client builds its participant list from the
snapshot's live lines. `GET /api/roster` is unchanged; nothing reads it for
status.

### Reaction

A presence message that changes the stored value causes one `roster`
broadcast to everyone in the room, the reporter included. An identical report
causes nothing.

## Server

- Each participant gets `afk`, `false` at join.
- After `hello`, the message handler dispatches on `type`: `key` goes to the
  keystroke handler, `presence` to the presence handler, anything else gets
  `error invalid-message`.
- The presence handler requires `hidden` to be a boolean. Otherwise it sends
  `error invalid-message` and changes nothing. A valid report sets `afk` and,
  if the value changed, broadcasts the roster.
- Presence refreshes last-seen like any other socket message. Pongs refresh
  last-seen and never touch `afk`.
- Reconnect: a second `hello` replaces the socket and keeps `afk`. The new
  socket's post-snapshot report replaces the value. A hidden tab that
  reconnects reports hidden and nothing is broadcast. A tab that returns to
  the foreground and reconnects at the same time reports visible and the
  roster updates once. If a reconnecting client never reports, the old value
  stands until the stale sweep removes the participant.
- Leave, `q`, and stale cleanup are untouched; they remove the participant
  and the status with them.

## Client

### `connection.ts`

The connection object gains one method:

```ts
setHidden: (hidden: boolean) => void;
```

It remembers the value, transmits `{ type: "presence", hidden }` at once when
the socket is open and past the snapshot, and re-sends the remembered value
after every snapshot. Until the first `setHidden` call nothing is sent.
Presence never consumes a sequence number and never enters the pending queue.

### `useRoomConnection.ts`

Owns the browser signal. After opening the connection it calls
`setHidden(document.hidden)`, then listens for `visibilitychange` on
`document` and forwards `document.hidden` on each event. The listener is
removed with the connection when the session ends.

The newcomer detection is unchanged: a status-only roster carries no new
participant id, so there is no chirp and no title rotation.

### `protocol.ts` and `roomState.ts`

`RosterEntry` and `LiveLine` gain `afk: boolean`. The reducer's snapshot case
takes it from the live lines; the roster case merges each entry, including
`afk`, onto the existing participant while preserving row, text, and caret as
it does today.

### Display (`App.tsx`, `theme.css`)

- An AFK participant's roster entry reads the handle followed by a `<span
  class="roster-afk">afk</span>` with `title="In a background tab"`. The
  span is dim grey (the roster heading's `#888`), smaller than the handle,
  separated by a normal space. The handle keeps its participant color and the
  color dot is unchanged.
- The marker is text, so screen readers and the browser check see it.
- Transcript rows never show AFK.
- Your own entry shows the marker like anyone else's. Normally you cannot see
  it because your tab is hidden; a stale value after a slow reconnect shows
  briefly, which is honest.

## Docs

- `docs/PROTOCOL.md`: the presence message under client to server; `afk` on
  both schemas; an emission-table row "presence report with a new value:
  `roster`"; a paragraph under Presence and lifetime stating that AFK and
  liveness are separate signals, that the server owns AFK, and how reconnect
  replaces the value; the invalid-message rule for a non-boolean `hidden`.
- `docs/USER_EXPERIENCE.md`: a bullet under Roster and presence describing
  the marker, that it follows the tab being in the background, and that it
  changes nothing else about the participant.
- `AGENTS.md`, Behavior to preserve: one line saying AFK follows tab
  visibility, is server-owned, carried in snapshots and roster broadcasts,
  and is separate from stale detection.

## Tests

### Server (written first, `test-server-ws.js`)

- Presence before `hello` is unauthorized and the socket closes.
- A valid `hidden: true` stores the value and broadcasts a roster with
  `afk: true` to every socket in the room; a repeated identical report
  broadcasts nothing.
- `hidden: "yes"` and a missing `hidden` get `error invalid-message` and
  leave `afk` unchanged.
- A newcomer's snapshot carries the current `afk` on both `liveLines` and
  `roster`.
- A second `hello` for a hidden participant keeps `afk: true`; the new
  socket's `hidden: false` report then broadcasts once.
- Live text and caret survive `hidden: true` then `hidden: false`.
- A pong after a hidden report does not clear `afk`.
- Roster order is unchanged by status changes.

### Reducer (`roomState.test.ts`)

- Snapshot live lines carry `afk` into participants.
- A roster message that changes only `afk` keeps row, text, and caret.

### Connection (`connection.test.ts`)

- `setHidden(true)` before the first snapshot: presence is sent right after
  the snapshot, after any replayed keystrokes.
- `setHidden` while open transmits at once.
- `setHidden` while reconnecting is remembered and sent after the next
  snapshot.
- Presence never changes the next sequence number.

### Component (`App.roster.test.tsx`)

- A roster message with `afk: true` renders the marker beside that handle,
  inside the entry styled in the handle's color.
- A following roster message with `afk: false` removes it.
- A status-only roster message plays no chirp and rotates no title.
- The hook calls `setHidden` with `document.hidden` after open and again on
  `visibilitychange`.

### Browser check (`check-browser.mjs`)

Add one probe step after the tabs are joined. Headless Chrome keeps the
tabs of one window, and `Page.bringToFront` on one tab hides the others and
fires a real `visibilitychange` in them, so the probe uses Chrome's own
signal. (`Page.setWebLifecycleState` with `frozen` leaves
`document.visibilityState` untouched and is not used.)

- The check brings Alice to the front, waits for Bob's page to report
  `hidden`, and asserts that Alice's roster shows `afk` beside Bob and not
  beside herself. It then brings Bob to the front and asserts the marker
  moves to Alice.
- If a switch does not change `visibilityState` within the timeout, the
  check prints a note and falls back to overriding `document.hidden` inside
  the page, which exercises the client and server but not Chrome's signal.

## Out of scope

- AFK by idle time or by lost focus within a visible tab.
- Dimming or restyling the AFK participant's transcript text.
- Carrying `afk` on the HTTP roster endpoint.
