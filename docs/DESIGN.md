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

## Optimistic typing, server reconciliation

- Keystrokes render instantly on the typing client (optimistic UI) and are
  broadcast to others. Waiting for a round trip before showing a character
  would destroy the char-by-char feel.
- The client allocates its draft line optimistically using the same
  greatest-index-plus-one rule as the server. When the server's allocation is
  known it wins; until then the guess stands.
- Correctness never waits for acknowledgement:
  - Enter commits the line locally at once and opens a fresh buffer, even if
    the commit request is still in flight.
  - A finished line stays visible as a **pending commit** until the server's
    history confirms it (matched by author, content, and time — not by
    index, because the optimistic index was only a guess).
  - Every committed index is also remembered in a **finished-draft set**, so
    a delayed pre-commit snapshot — or an out-of-order poll arriving after
    the pending commit was cleaned up — can never resurrect the finished
    line as a live row. Indices are never reused, so this memory is safe.
- Operations carry a per-participant sequence number. The server buffers
  out-of-order operations and applies them in order, and drops duplicates.
  This is what guarantees `x` then Backspace ends empty and `A Enter B`
  commits only `A`, regardless of network timing.

## Transport: live push, polling fallback

- Remote keystrokes, backspaces, and commits arrive over WebSocket and are
  applied directly to the local view, so even a character typed and instantly
  deleted is seen in order.
- A 2-second poll is the fallback for clients that miss socket events.
  Either path converges on the same server state.

## Scrollback belongs to the viewer

- The server keeps only the last 100 committed lines and hands them out as a
  **bounded recovery snapshot** — enough for a reconnecting client to catch
  up, not a full archive.
- Each client accumulates everything it has seen since joining and never
  discards it. The snapshot cutoff therefore never deletes text from under
  someone reading upward.
- Nothing from before you joined is shown: history is filtered by join time.
  Scrollback is browser-local, not server history.
- New arrivals never force-scroll a viewer who has scrolled up to read.

## Identity and color

- Color is assigned at join and identifies the author; that is why ordinary
  rows carry no name prefix.
- Every committed line stores a color snapshot, so history keeps the right
  colors after people leave. Join/leave announcements use the person's own
  color for the same reason.

## Presence and disconnects

- A 12-second client heartbeat against a 40-second server timeout detects
  stale participants. Cleanup preserves a disconnected participant's
  non-empty unsent text; only abandoned empty rows may disappear.
- Duplicate display names are rejected case-insensitively. There is no
  name-reclaim flow: holding a name is holding it.

## Names

- The default display name is remembered across rooms and visits.
- `?name=` is a per-tab override for testing and never overwrites the
  remembered default.

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

## The caret

- A blinking 2 px underline, not a block. The block caret read as "text
  selected"; the thin underline reads as a DOS typing position, which is the
  aesthetic the whole product commits to.

## Typography and layout

- Monospace is mandatory — proportional fonts would break the terminal
  illusion and column alignment.
- Line height is 1.55em: dense enough to feel like a terminal, loose enough
  to read.
- The layout is responsive with no horizontal scrolling. The desktop typing
  hint is hidden (a regular knows where to click); it appears only on narrow
  screens (≤420 px) where the tap target is not obvious.

## Aesthetic notes

- The DOS-terminal look is deliberate and complete. It is not "raw" or
  "unpolished" — those words mistake the aesthetic for an unfinished state.
- Sound is minimal: one two-tone chirp on join, BBS-style. No notification
  sounds for messages; the typing itself is the notification.
