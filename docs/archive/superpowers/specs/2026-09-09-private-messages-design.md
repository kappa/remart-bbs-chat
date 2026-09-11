# Private messages from the roster

Design for TODO task 18 (GitHub issue #7). Approved 2026-09-09.

Click a name in the roster, type one line in an input that opens under that
name, press Enter. The recipient sees an ephemeral popup outside the chat
area with the sender's handle in the sender's color. The sender sees a short
"sent to Bob" or "Bob is not reachable". Nothing is stored, nothing is in
snapshots, nothing is replayed, and nothing ever touches the transcript.

This is the first message type outside the shared transcript. It rides on the
post-hello dispatch by message type introduced with task 31's presence
message.

## Terminology

| Term | Meaning |
| --- | --- |
| Private message | One line of text from one participant to one other, delivered once over the socket. |
| Private input | The one-line input that opens under a clicked roster name. |
| Popup | The recipient's ephemeral box showing one private message. Not a transcript row. |
| Result | The server's reply to the sender: `private-sent` or `error unknown-recipient`. |

## Decisions settled during design

- **Input opens inline under the clicked roster name**, pushing the names
  below it down. Not in the footer, not a modal.
- **The recipient's popup is a fixed overlay in the top-right corner over
  the chat area**, rendered from its own state. Private messages never enter
  the reducer, the document row list, or any transcript element, so they
  cannot end up in the transcript by accident.
- **Unreachable recipients** (left, other room, self, or in the room but
  without an open socket) all get the same `unknown-recipient` result. The
  client wording is "Bob is not reachable", which is true for every case.
- **Cap of 200 code points** after trimming, enforced on both sides.
- **Popup timeout of 15 seconds.**

## Wire

### Client to server

```ts
{ type: "private", to: number, text: string }
```

Sent after `hello` only. Not numbered, not queued with keystrokes. A message
attempted while the socket is not open is not queued: the client reports
"Not connected" and keeps the text in the input.

### Server to the recipient only

```ts
{ type: "private", from: number, handle: string, color: string, text: string }
```

### Server to the sender only

```ts
{ type: "private-sent", to: number, handle: string }
{ type: "error", code: "unknown-recipient", to: number }
```

Bad `to` or bad `text` gets the existing `{ type: "error", code:
"invalid-message" }`. The socket stays open in every case.

No roster, live, committed, or snapshot message changes. Snapshots never
contain private messages and reconnect never replays them.

## Server

- The private handler is the third case in the post-hello dispatch, beside
  `key` and `presence`. Anything else stays `invalid-message`.
- Validation, in order:
  1. `to` is a number and `text` is a string; otherwise `invalid-message`.
  2. `text` is trimmed at both ends. The result has 1 to 200 code points and
     every code point passes `isValidChar`; otherwise `invalid-message`.
  3. The recipient is a participant of the sender's own room, is not the
     sender, and has an open socket; otherwise `error unknown-recipient`
     with `to`.
- On success the server sends `private` to the recipient's socket with the
  sender's id, handle, color, and the trimmed text, then `private-sent` to
  the sender with the recipient's id and handle.
- The message refreshes the sender's last-seen like any socket message. It
  does not touch rows, live lines, sequence numbers, or the recipient's
  state. Nothing is stored.

## Client

### `protocol.ts`

`ClientMessage` gains the private message. `ServerMessage` gains `private`
and `private-sent`. `ErrorCode` gains `unknown-recipient`, and the error
message type gains an optional `to`.

### `connection.ts`

The connection object gains:

```ts
sendPrivate: (to: number, text: string) => boolean;
```

It transmits at once when the socket is open and past the snapshot, and
returns false otherwise. It never touches the pending queue or the sequence
number.

### `useRoomConnection.ts`

Exposes `sendPrivate`, returning false when there is no connection. Passes
`private`, `private-sent`, and `unknown-recipient` to App through two new
events, `onPrivate(message)` and `onPrivateResult(result)`, instead of the
reducer. `unknown-recipient` does not end the session; only `unauthorized`
and `unknown-participant` do, as today.

### Sending (`App.tsx`)

- Roster entries become buttons. Clicking a name other than your own sets
  `privateTarget` to that participant id; clicking your own name does
  nothing. Clicking another name moves the input there and keeps the typed
  text.
- The private input renders directly under the target's roster entry as a
  `roster-private` element: a small dim `to` label and a single-line input
  focused on open. It is a real input element, so the document-level key
  handler ignores keys while it has focus, and task 25's autocomplete does
  not apply.
- Enter sends the trimmed text through `sendPrivate`. Empty text closes the
  input. If `sendPrivate` returns false the warning slot shows "Not
  connected, try again" and the input stays open with its text. On success
  the input closes and focus returns to the chat keyboard.
- Escape closes the input, discards the text, and focuses the chat keyboard.
- Text longer than 200 code points is not sent; the warning slot shows
  "Private messages are limited to 200 characters" and the input stays open.
- If the target leaves while the input is open, the input closes and the
  warning slot shows "<handle> is not reachable".

### Sender feedback

Results feed the existing two-second feedback line in the chat area, the
same local row used for "Roster refreshed":

- `private-sent`: "sent to <handle>".
- `unknown-recipient`: "<handle> is not reachable", using the roster's
  handle for `to`; if the handle is no longer in the roster, "not
  delivered".

### Receiving

- Incoming `private` messages go into `privateMessages` in App state: an
  array of `{ id, from, handle, color, text, receivedAt }`. The array is
  cleared when the session ends.
- A `PrivateMessages` component in its own file renders them as a fixed
  stack in the top-right corner over the chat area, newest at the bottom.
  Each box has a 1px `#555` border, black surface, the handle in the
  sender's color as a heading, and the text below in monospace with normal
  wrapping. The stack is `aria-live="polite"`. On phones it spans the width
  of the chat area with the same side padding.
- A message leaves the stack on click on its box, on Escape, or 15 seconds
  after arrival. Escape removes the oldest visible message. If task 25's
  autocomplete list is open, Escape closes that list instead and the next
  Escape reaches the messages. The help dialog's Escape handling is
  unchanged. Escape in the private input closes the input, not a popup.
- Handle and color come from the message itself, so a sender who leaves
  right after sending still shows correctly.
- Nothing here touches the reducer, the document rows, or any element inside
  the chat area's transcript.

### Styling (`theme.css`)

`.roster-entry` becomes a button-styled row keeping its current look, with a
focus outline. `.roster-private` holds the label and input inside the 160px
sidebar (128px on phones). `.private-stack` and `.private-popup` style the
overlay with `position: fixed`, `z-index` above the transcript and below the
help overlay.

## Docs

- `docs/PROTOCOL.md`: the three messages and the error under the WebSocket
  reference; the validation list and the 200 code point cap; the rule that
  private messages are never stored, in snapshots, or replayed; an
  emission-table row "private message: `private` to the recipient,
  `private-sent` or `error unknown-recipient` to the sender".
- `docs/USER_EXPERIENCE.md`: a "Private messages" section describing the
  click, the input, Enter and Escape, the feedback, the popup, its
  dismissal, and that nothing private ever appears in the transcript.
- `AGENTS.md`, Behavior to preserve: one line saying private messages are
  delivered once over the socket and are never stored, replayed, or rendered
  as transcript rows.

## Tests

### Server (written first, `test-server-ws.js`)

- Alice sends to Bob: Bob's socket receives `private` with Alice's id,
  handle, color, and text; Carol receives nothing; Alice receives
  `private-sent` with Bob's id and handle.
- `to` for a participant in another room, for Alice herself, for a departed
  participant, and for a participant whose socket is closed: `error
  unknown-recipient` with `to`, nothing delivered.
- Non-string text, non-number `to`, empty text, whitespace-only text, a text
  containing a control character, and a text of 201 code points: `error
  invalid-message`, nothing delivered. A text of exactly 200 code points is
  delivered. Surrounding whitespace is trimmed.
- Private before `hello` is unauthorized and the socket closes.
- A snapshot for Bob after receiving a private message contains no trace of
  it; Bob's and Alice's `nextSeq` are unchanged.
- Alice's live line and row are unchanged by sending.

### Connection (`connection.test.ts`)

- `sendPrivate` transmits the message when open and returns true.
- `sendPrivate` returns false while connecting or reconnecting and sends
  nothing later.
- Sequence numbers and the pending queue are untouched.

### Component (`App.private.test.tsx`)

- Clicking Bob opens the input under Bob's entry with focus; clicking Alice
  (self) opens nothing; clicking Carol moves the input and keeps the text.
- Enter sends `{ type: "private", to: 20, text: "lunch?" }` through the fake
  socket, closes the input, and focuses the keyboard.
- Escape closes the input without sending and focuses the keyboard.
- Empty Enter closes the input without sending.
- A 201 code point text is not sent and the warning shows.
- `private-sent` shows "sent to Bob"; `unknown-recipient` shows "Bob is not
  reachable"; an unknown `to` shows "not delivered".
- An incoming `private` renders a popup with the handle in the sender's
  color and the text; click removes it; Escape removes the oldest; the
  timer removes it after 15 seconds.
- Two incoming messages stack in arrival order.
- Throughout, the set of transcript rows is unchanged.
- Ending the session clears the popups.

### Browser check (`check-browser.mjs`)

Alice clicks Bob in the roster, types "lunch?", presses Enter. Bob's tab
shows the popup text, Alice's tab shows "sent to Bob", and neither tab gains
a committed line.

## Out of scope

- A private-message history, a reply shortcut, or a sound for private
  messages.
- Sending private messages from the shared live line with a prefix.
- Blocking or muting.
