# Remart BBS Chat — Design

Why the system behaves the way `USER_EXPERIENCE.md` describes. This is the
decision log: the choices, the trade-offs, and the reasoning. Read the UX doc
first for *what*; this is *why*.

## Product identity

Remart is a DOS-terminal-styled **shared typing space**, not a message feed.
The defining interaction is watching language being produced — characters,
hesitations, backspaces — not receiving finished messages. That is why there
is one shared document instead of per-user message bubbles, and why a
Backspace is a first-class visible event rather than something hidden until
Enter.

It is not IRC and not a generic BBS door game. Comparisons to those systems
are not a design input.

## One shared ordered document

- All clients render the same document: committed lines plus live lines,
  ordered by a single **line index**. The server assigns indices and is
  authoritative; clients never reorder by heuristics.
- A row's position comes only from its index, never from whether it is
  committed or live. Enter therefore turns a live row into a committed row
  **without moving it**.

## Deferred ownership: a line is claimed by its first character

- Nobody owns a line until they type into it. Pressing Enter does not reserve
  the next row; the next row is claimed by whoever types the next first
  character.
- The first typer keeps the earlier position. This is what makes concurrent
  typing fair without any locking or turn-taking.

## Idle participants own no row

- An idle participant contributes no shared row. Reserving one would push
  other people's lines apart and lie about who is actually writing.
- Instead, each client renders a **local cursor preview** below the
  transcript for its own idle user. It has no shared identity, no ordering
  effect, and is invisible to everyone else.

## Server echo, no local echo

- The client never shows text it has not received from the server. A
  keystroke is sent and forgotten until the server echoes the whole live
  line back; that echo is what renders, for the typist and for everyone else.
- The price is one round trip before a character appears. The gain is that
  there is exactly one rendering path and no reconciliation: no guessed row
  numbers, no pending commits, no rollback, no finished-line bookkeeping.
- Typing does not wait for echoes. Keystrokes are numbered and streamed; the
  server applies them in order and echoes each. Fast `A`, Enter, `B`,
  Backspace, `C` produces the same transcript on every screen.
- Commands (`?`, `q`) are recognized by the server against the real live
  line, so a lagging screen cannot turn a command into chat or vice versa.

## Transport: one socket per participant

- One authenticated WebSocket carries everything that happens inside a room,
  both directions. There is no polling and no HTTP heartbeat: the open socket
  is presence, and a snapshot on every (re)connect is recovery.
- Unconfirmed keystrokes are kept until the server echoes them and are resent
  after a reconnect. The server ignores replays by sequence number, so a
  brief disconnect heals itself instead of losing or duplicating text. A gap
  the server cannot fill is reported, not silently swallowed.
- HTTP remains for what happens outside a room: listing and creating rooms,
  joining, leaving, and the roster button.

## Scrollback belongs to the viewer

- The snapshot sent on connect carries only the last 100 committed lines — enough for a reconnecting client to catch
  up, not a full archive.
- Each client accumulates everything it has seen since joining and never
  discards it. The snapshot cutoff therefore never deletes text from under
  someone reading upward.
- A newcomer sees the last 20 committed lines from before the join, then
  everything since. At join the server records the window's starting row
  (`historyFromRow`) and the current committed-line count. The server uses
  row and append order to select snapshot history; timestamps cannot reliably
  separate commits from a join in the same millisecond. The client accumulates
  everything delivered, including old live rows committed after joining.
  Scrollback is browser-local, not server history.
- New arrivals never force-scroll a viewer who has scrolled up to read.

## Identity and color

- Color is assigned at join and identifies the author; that is why ordinary
  rows carry no name prefix.
- Author colors come from the approved 20-color hybrid participant
  palette: six ColorBrewer Set2 colors, selected original/VGA colors,
  white tenth, and nine Glasbey additions, all chosen for distinction at
  chat text size on the black terminal background. Black is excluded.
  The first unused color in that order goes to each newcomer. Rooms hold
  ten participants, so the eleventh color onward waits for a possible
  future capacity increase.
- Every committed line stores a color snapshot, so history keeps the right
  colors after people leave. Join/leave announcements use the person's own
  color for the same reason.

## Presence and disconnects

- The server pings each socket every 12 seconds; a participant silent for
  40 seconds is cleaned up. Cleanup preserves a disconnected participant's
  non-empty unsent text; only abandoned empty rows may disappear.
- Reloading must not look like leaving, and browsers cannot reliably tell a
  reload from a tab close — so the client sends no leave on page exit at
  all. A reload reconnects with the stored session; a closed tab lingers
  until the stale sweep. This trades prompt closed-tab departure (up to
  about a minute of ghost presence) for reload continuity with no timers,
  no provisional state, and no replacement race between a delayed leave
  beacon and an already reconnected socket.
- Duplicate display names are rejected case-insensitively. There is no
  name-reclaim flow: holding a name is holding it.

## Away, not gone

- AFK follows tab visibility, nothing else. A hidden tab is a fact the
  browser reports; idle time and lost focus are guesses about attention,
  and a guess shown to the whole room is worse than no marker.
- The server owns the flag. The client only reports `hidden` after every
  snapshot and on every change, so everyone sees the same value, a
  reconnect keeps the stored one until the tab reports again, and a
  stale sweep never has to reason about it.
- AFK and staleness are two different questions and stay apart: pongs
  keep a socket alive but never clear AFK, and AFK never speeds up
  cleanup. A changed value broadcasts a roster and nothing more: no
  announcement line, because presence is not conversation.

## One tab per session

- A duplicated browser tab copies the stored session, so two tabs once
  held the same participant and traded the socket back and forth every
  second, flickering the AFK marker for the whole room.
- The fix is client-side: a Web Lock named after the participant is claimed
  before the socket opens and released when the session ends or the page
  unloads. The copy finds it taken, drops its stored session, and starts in
  the lobby like a pasted URL. A reload resumes because the old document
  released the lock first. The server is unchanged and never learns about
  tabs.
- A server-side answer (close the older socket with a code the client
  understands) was rejected: it would keep one tab and kill the other,
  while a duplicated tab should let the person join as someone else.

## Names

- The default display name is remembered across rooms and visits.
- `?name=` is a per-tab override for testing and never overwrites the
  remembered default.
- A name is one word: letters, marks, and digits from any script, joined
  with `_` if wanted, and never a leading `@`. The shape is the inverse of
  the mention rule, so `@name` in chat can always find its person; a name
  with a space or punctuation could be offered by the handle list and still
  never be colored or ring. The lobby and the server apply the same rule,
  written once on each side like the character rule. Emoji are rejected
  for now; whether to allow them is an open call.

## Rooms

- Unlimited, ephemeral, one room per participant at a time. The roster is
  pinned and sized for roughly ten participants — this is a room, not an
  auditorium.

## Input rules

- No 80-character limit and no typing throttle: both were tried in the
  original draft spec and removed because they fought the core interaction.
  Unicode, including Cyrillic, is fully allowed.
- Paste is capped at 100 characters with a visible warning. Rationale: a
  paste is not typing, and dumping unbounded text char-by-char would flood
  the shared stream that the whole design is built around.
- Backspace at column zero is a no-op. A line backspaced to empty keeps its
  identity and position — emptiness is not deletion.
- The server owns the caret as it owns the live line. Arrows, Home, End,
  Delete, and word jumps are keystrokes like any other, applied in sequence
  and echoed as a caret position, so a lagging screen can never insert at
  the wrong place. Movement is a no-op echo that never claims a row: moving
  around an empty line is not typing. Only the author's client draws the
  caret, because everyone else is watching text appear, not a cursor.
- Units are code points everywhere (typing, deleting, moving), so a lone
  surrogate can never be left behind.

## Handle autocomplete

- The list reads the echoed live line only, like everything else on screen.
  A pick goes over the wire as ordinary `char` keystrokes, so the server has
  no notion of autocomplete and the single rendering path stays single.
- Tab or Enter pressed while keystrokes are still in flight is parked
  until the pending count is zero and then resolved against the fresh echo.
  Resolving it against the stale screen would complete a token the server
  no longer has (`@bob` plus a fast Enter became `@bobb`).
- A pick sends only the missing letters, no trailing space. When the token
  already spells a handle in full, the pick closes the list and sends
  nothing; the next Enter commits. Enter never means two things at once.
- The list floats next to the caret, not in the roster and not as a
  transcript row, because that is where the eyes are.

## Mentions

- Mentions are decided at render time on the client from the current
  roster. The wire carries plain text and the server stores plain text: no
  markup, no server-side parsing, and colors follow whoever holds the name
  now.
- The rule is `@` plus the exact handle, not a prefix: `@Al` with Alice in
  the room is plain text. Trailing punctuation is stripped before matching
  and stays plain, the way the link splitter treats URLs.
- Only committed lines are colored and only a line first seen as a
  `committed` message by someone else can ring. Live lines never ring
  (typing is not saying), own lines never ring, and nothing that arrives
  with a snapshot rings, because a reconnect is recovery, not news.
- Title and sound go through one small notification library with
  isolated channels, so a failing channel cannot silence the other and a
  browser notification channel can be added later without touching the
  app.

## Private messages

- A private message is delivered once over the socket to one recipient and
  then forgotten: never stored, never in a snapshot, never a transcript
  row. The room is ephemeral and the transcript is the shared thing; a
  side channel with history would be a different product.
- The client keeps received messages in their own list outside room state,
  so they cannot reach the reducer, the document rows, or any transcript
  element by accident. They show as popups over the chat area that go away
  on click, on Escape, or after fifteen seconds; only the newest five are
  kept, so a flood cannot cover the screen.
- The input opens under the clicked roster name, and its keystrokes never
  reach the shared live line. If the addressee leaves while it is open, the
  box stays where it is with its text: closing it would drop the next
  keystrokes onto the shared line, which is the one leak that must not
  happen.
- Every failure (left, another room, oneself, no open socket) gets the same
  "not reachable" answer. Distinguishing them would let anyone probe who is
  where.
- The 200-character cap and the character rule match the chat's own limits,
  so the private path cannot carry anything the public one cannot.

## The caret

- A blinking 2 px underline, not a block. The block caret read as "text
  selected"; the thin underline reads as a DOS typing position, which is the
  aesthetic the whole product commits to.

## Typography and layout

- Monospace is mandatory — proportional fonts would break the terminal
  illusion and column alignment. Every terminal surface uses the single
  `--mono` variable (transcript rows previously carried their own shorter
  stack, which is what Chrome on Linux rendered as serif). The stack also
  names explicit Linux-available faces ("Liberation Mono",
  "DejaVu Sans Mono") before the generic family.
- Line height is 1.55em: dense enough to feel like a terminal, loose enough
  to read.
- The layout is responsive with no horizontal scrolling. The desktop typing
  hint is hidden (a regular knows where to click); it appears only on narrow
  screens (≤420 px) where the tap target is not obvious.
- Transcript rows wrap using the browser's available layout width, including
  the space taken by the roster. Preserved whitespace and unbroken text wrap
  too. Resizing reflows both live and committed rows without changing their
  content or server-assigned line indices.

## Aesthetic notes

- The DOS-terminal look is deliberate and complete. It is not "raw" or
  "unpolished" — those words mistake the aesthetic for an unfinished state.
- Sound is minimal: a two-tone chirp on join and a short bell when a sent
  line names you, BBS-style. Ordinary messages make no sound; the typing
  itself is the notification. One Sounds switch covers both, starts on with
  every page load, and `?silent=1` in the address starts it off.
