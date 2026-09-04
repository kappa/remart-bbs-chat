> **EVOLVED — 2026-09-04** — This spec is approved product intent with explicit uncertainties, but Section 7 V1 decisions (80-cell, ASCII-only, paste 20 chars, 10 cps) have been superseded by current implementation (Unicode including Cyrillic, no 80-cell limit, paste up to 100, no throttling, deferred ownership, empty Enters, WS live updates, typing-hint hidden desktop). See `docs/SPECS_STATUS.md` and `README.md` for current truth.

---

# Remart BBS Chat — final specification

**Status:** Approved for prototype, with explicit historical uncertainties  
**Date:** September 1, 2026  
**Basis:** Alex’s memory of Remart BBS. No original binary, manual, or command reference has yet been verified.

## 1. Vision

Rebuild the distinctive Remart BBS chat as a web application that anyone can join through a link. Success means that simultaneous character-by-character typing, visible corrections, independently owned lines, and a color-coded roster immediately feel unlike IRC or a modern message composer.

This is not a general BBS emulator. The prototype exists to test one interaction model: conversation as a live, shared character grid.

---

## 2. Historical boundary

### Remembered with confidence

- Typing was transmitted character by character rather than after Enter.
- Backspaces and corrections were visible to everyone as they happened.
- Every participant had a unique color.
- The participant roster was pinned in the top-right corner, with each name shown in its assigned color.
- The chat used one shared monospace scrolling area.
- Each participant typed on a separately owned line; several people could type simultaneously.
- Pressing Enter committed the current line and gave that participant another empty line at the bottom.
- The terminal emulator supplied independent local scrollback.
- A newly joined participant did not receive the earlier conversation.
- Lines did not scroll horizontally and were hard-limited.
- The software worked across common terminal heights.
- A room supported only a small number of people, probably about ten.
- Remart could create more chat rooms as needed, while a user could occupy only one room at a time.
- Known one-character commands included `l` for roster refresh, `?` for help, and `q` for leaving.
- Private messages existed outside the room interface, not inside this character-by-character model.

### Remembered incompletely

- The exact participant limit.
- The complete command set and exact command output.
- Whether join and leave events appeared as lines or only changed the roster.
- What happened when a participant reached the physical end of a line.
- How Remart reconciled clients with different terminal widths.
- Whether users logged into the BBS but outside chat could be listed from the room.

### Prototype decisions, not historical claims

- Use ten participants and ten reusable colors per room.
- Add visible join and leave system lines because technical disconnects otherwise go unnoticed.
- Use an 80-cell logical line in the first prototype.
- Accept printable ASCII only in the first prototype.
- Ignore Backspace in column zero and Enter on an empty line.
- Make rooms ephemeral and remove them after the final participant leaves.
- Provide a room lobby and automatically offer another room when one is full.
- Remember a handle in browser storage and permit `?name=` overrides for multi-user testing.

---

## 3. Core interaction model

### 3.1 Joining

A visitor chooses a handle and joins one room. The server assigns:

- one of ten available colors;
- an empty active line in the shared stream;
- a blinking caret at column zero of that line.

The participant immediately appears in the top-right roster. The participant sees only events that occur from that join onward, including their own join event.

### 3.2 Active lines

Each participant owns exactly one active line. Only its owner can change it.

Characters appear on every connected client as they are typed. Backspace removes the last character from that active line on every client. There is no local draft and no “send message” operation: visible partial text is already part of the conversation.

Other participants retain their own active lines and can type at the same time. Their characters never interleave within someone else’s line.

### 3.3 Enter and multiline passages

Enter commits the participant’s current line as immutable history. The server then appends a new empty active line for that same participant at the bottom of the shared stream.

This operation must be atomic. If several people press Enter at nearly the same time, each committed line and replacement line receives a unique position in server order.

A multiline passage is simply several consecutively committed lines in the same color. When people take turns, the result resembles traditional chat, except that lines have no nickname prefixes; color supplies identity.

### 3.4 Leaving and disconnecting

On a deliberate leave or detected disconnect:

- the participant disappears from the roster;
- their color returns to the room’s pool;
- an untouched empty active line is removed;
- an active line containing even one character remains in the stream as committed text;
- a leave system line is appended after any preserved partial line.

A later participant may receive the same color, but committed lines must retain a snapshot of their original color. Historical rendering must not derive color from the current roster.

---

## 4. Shared screen and visual language

- **Monospace is mandatory.** Every character occupies one logical cell so simultaneous lines remain aligned.
- **Chat occupies the main surface.** It is one vertical stream containing committed lines, live active lines, and system lines.
- **Roster stays top-right.** It remains visible while the chat scrolls under its own viewport.
- **Identity is color, not a prefix.** Ordinary chat lines do not begin with a handle.
- **Caret shows ownership.** Each user sees a blinking caret at the end of their own active line; on join it blinks at the leftmost cell.
- **Corrections animate naturally.** Backspace removes characters without replacing them with edit markers.
- **No horizontal scrolling.** A line never expands the page sideways.
- **Height is responsive.** The chat uses the available viewport height; the roster remains fixed relative to it.
- **Scrollback is independent.** A participant may scroll upward without freezing anyone else. Automatic scrolling resumes only while that participant remains near the bottom.

System lines are visually quieter than conversation lines but remain in the same stream. Join and leave lines use the affected participant’s color snapshot.

---

## 5. Identity, presence, and rooms

### Handles

The browser remembers one default handle in local storage. A query override such as `?name=Alice` applies only to that tab or URL and must not overwrite the saved default. This allows one tester to open several sessions under different names.

The server rejects a handle that is currently active anywhere in the system, case-insensitively. This prevents two simultaneous users from impersonating one active handle.

**Boundary:** browser storage is not authentication. The prototype cannot establish permanent ownership of a name across devices or after a session ends. Permanent system-wide identity would require accounts and is outside V1.

### Rooms

- A room holds at most ten active participants.
- A participant can occupy only one room at a time.
- The lobby lists active rooms and occupancy.
- When every available room is full, a new room can be created on demand.
- “Infinite rooms” means no fixed product-level count; operational resource limits still apply.
- Non-default rooms disappear after becoming empty.
- Room conversation is not retained as a user-visible archive.

### Presence

Join and leave events update both the roster and the stream. Unexpected network loss requires a server-side presence lease or heartbeat; closing a tab is not the only form of disconnect.

---

## 6. Commands

A command is recognized only when the trimmed active line contains exactly one command character and the participant presses Enter.

- **`l` — roster:** refresh the room roster.
- **`?` — help:** show the available commands.
- **`q` — quit:** leave the current room.

A command character inside ordinary text is not a command. For example, `hello` and `hello l` commit as chat.

Because character-by-character transmission makes the command visible before Enter, V1 clears the command character from the shared active line when executing it. Help and roster results are local interface output, not public chat lines. Quit produces the normal leave event.

The command set is provisional until an original Remart executable or manual is found. A list of BBS users outside chat may later be added as a separate command. Private messaging remains a separate subsystem.

---

## 7. Width, text, and input rules

### V1 logical grid

The server enforces a maximum of 80 single-width cells per line. Once a line reaches 80 cells, additional character input is ignored until the participant presses Enter or Backspace.

Printable ASCII is the allowed V1 character set. Control characters, emoji, combining marks, and wide Unicode characters are rejected because they break the one-character/one-cell invariant.

### Input behavior

- Backspace at column zero does nothing.
- Enter on an empty line does nothing.
- Paste is treated as a bounded sequence of character events, not as an instant completed message.
- A paste accepts at most 20 valid characters and cannot exceed the remaining cells.
- Character input is limited to ten accepted characters per second per participant in the current prototype.
- Server validation is authoritative; client checks exist only for immediate feedback.

### Unresolved width problem

An 80-cell line and “no horizontal scrolling” conflict on narrow phone screens. The prototype may clip, shrink, or adapt the presentation, but it must not silently wrap one logical line into several shared lines because that destroys line ownership and cross-client alignment. The final responsive policy requires testing.

---

## 8. History and event ordering

“No history on join” is a visibility rule, not a claim that the server stores nothing. The server may retain room events while the room exists so connected clients can recover from short delays.

Each room event receives a monotonically increasing server sequence number. A joining client records the current sequence and renders only later events. Sequence numbers are preferred over timestamps because simultaneous events can share a timestamp or arrive out of order.

The server is authoritative for:

- participant membership and colors;
- active-line ownership;
- character order within each line;
- commit order;
- roster state;
- join and leave events.

Clients may render their own keystroke optimistically, but they must reconcile to server state. A temporary client pause may replay events that occurred after joining; it must never reveal events from before joining.

---

## 9. Technical architecture

### Required behavior

The public application has a browser client and an authoritative server. The transport must preserve each accepted character and correction as a distinct ordered event.

A WebSocket is the preferred production transport. Server-sent events plus HTTP actions can also satisfy the model. Polling is acceptable for an early artifact demonstration only if it preserves all character events, but batching several fast keystrokes into one visible update weakens the defining experience.

### Suggested server state

- **Room:** ID, display name, capacity, event sequence, creation time.
- **Participant:** session ID, handle, color, active line ID, join sequence, presence lease.
- **Line:** ID, room ID, owner handle, color snapshot, content, active/committed state, sequence position.
- **Event:** sequence, room ID, type, actor, payload, server time.

### Essential operations

- join room;
- leave room;
- refresh roster;
- append one character;
- remove one character;
- atomically commit a line and append the owner’s next line;
- read events after a session’s join sequence;
- renew presence lease.

Room state may live in memory for V1. If a database is used, empty-room cleanup must also remove transient character events so a public deployment does not grow without bound.

---

## 10. Failure and abuse handling

- **Abrupt disconnect:** expire the presence lease after a short grace period, preserve nonempty active text, remove an empty line, then emit leave.
- **Reconnect:** treat it as a new join unless a short-lived session token safely resumes the same participant.
- **Duplicate handle:** reject the second active session with a clear name-taken response.
- **Room fills during join:** make admission atomic; route the loser to the lobby or a new room.
- **Concurrent Enter:** serialize commit-and-append on the server.
- **Late or duplicate action:** use event/action IDs so retries cannot append the same character twice.
- **Hidden tab:** buffer ordered events and catch up from the last acknowledged sequence.
- **Injection:** render all handles and chat as text, never HTML.
- **Flooding:** enforce limits on the server, not only in JavaScript.
- **Stale rooms:** delete empty ephemeral rooms and their transient events.
- **Color reuse:** persist a color snapshot with every committed or system line.

---

## 11. V1 acceptance tests

The prototype is successful only when these tests pass with real concurrent browser sessions:

1. **Public entry:** Two people can open the same public link, choose different handles, and enter a room without setup.
2. **Character visibility:** One participant types slowly; the other sees every character before Enter.
3. **Visible correction:** The first participant types a mistake and presses Backspace; the second sees the character appear and disappear.
4. **Simultaneous lines:** At least three participants type at once; each line remains separate, aligned, and correctly colored.
5. **Line lifecycle:** Enter freezes the current line and puts a new blinking caret on a new line at the bottom.
6. **Multiline passage:** Several Enter presses produce consecutive same-color lines without handle prefixes.
7. **Roster:** Names and colors update at the top right on join and leave.
8. **No prior history:** A late joiner sees no conversation from before their join boundary.
9. **Independent scroll:** One participant scrolls up while another types; the scrolled participant’s view does not jump to the bottom.
10. **Disconnect preservation:** An empty abandoned line disappears, while a one-character abandoned line remains.
11. **Atomic concurrency:** Simultaneous Enter presses never assign two participants the same new line position.
12. **Capacity:** The eleventh participant cannot enter a ten-person room and can reach another room.
13. **Commands:** Exact-line `l`, `?`, and `q` work; those characters inside normal sentences remain chat.
14. **Multi-tab testing:** `?name=Alice`, `?name=Bob`, and other overrides work in one browser without changing the saved default handle.
15. **Limits:** An 81st character, unsupported wide character, and oversized paste cannot corrupt alignment.
16. **Reconnect/order:** A temporarily paused client catches up in server order without seeing pre-join events.

The decisive test is experiential: a second participant must see the first participant thinking through the act of typing, not receive a completed phrase in delayed chunks.

---

## 12. Non-goals for V1

- Private messages inside the room.
- Permanent user accounts or permanent handle ownership.
- Moderation tools such as kick, ban, and reports.
- Persistent history, search, or transcripts.
- File transfer, BBS mail, conferences, or other Remart subsystems.
- Rich text, emoji, attachments, reactions, typing indicators, or edited messages.
- A complete visual emulation of a particular DOS terminal.

---

## 13. Independent design review

The concept is coherent and unusually testable: the smallest valuable prototype is the shared character grid, not a complete BBS. The strongest design choices are per-participant active lines, visible Backspace, color-only attribution, top-right roster, and absence of pre-join history.

The review found the following risks that must not be hidden by a polished interface:

- **Polling can betray the premise.** A 250 ms state poll may make fast typing arrive in chunks. The prototype can validate layout this way, but a faithful implementation should use an event stream.
- **A fixed slot is not a new line.** Reusing the same vertical slot after Enter differs from appending a genuinely new active line at the bottom. The intended model is append-only line chronology with one current line per participant.
- **Disconnects need leases.** A server action for explicit quit cannot detect a dead network or crashed browser. Heartbeats are required before empty-line reclamation and leave messages are reliable.
- **Color cannot depend on the current roster.** If a departed user’s color is reused, old lines become ambiguous unless each line stores its original color.
- **Timestamps are an unsafe join boundary.** Use server event sequence numbers to prevent history leakage and ordering ambiguity.
- **Name uniqueness is not identity.** Local storage plus active-session uniqueness is sufficient for testing, not for durable BBS-style accounts.
- **Mobile input is not solved by key handlers alone.** On-screen keyboards and IME composition normally require a focused input surface, while the visible caret remains in the grid.
- **Responsive width is still unresolved.** Eighty cells, no horizontal scrolling, and narrow phones cannot all be satisfied without a deliberate presentation policy.
- **Public access adds basic security duties.** Text escaping, server-side rate limits, bounded storage, and atomic admission are required even though moderation is out of scope.

### Current prototype alignment

The artifact implementation covers the room model, ten-color roster, character and Backspace actions, line commits, commands, lobby, multi-tab name overrides, ASCII/80-cell limits, and basic desktop/mobile layout checks.

Its known gaps against this final specification are:

- live updates are simulated by periodic state polling rather than a true character event stream;
- the current line model reuses participant slots instead of always appending a new active line at the bottom;
- abrupt disconnect cleanup is not yet backed by a verified presence lease;
- the narrow-screen 80-column policy needs user testing;
- a stable public sharing URL and real multi-user end-to-end test still need verification.

These are prototype gaps, not changes to the intended interaction model.

---

## 14. Questions for a second-pass review

1. **Line-end behavior:** Is blocking at 80 cells the best approximation, or should Enter be triggered automatically? What alternative preserves simultaneous ownership when the following visual line is occupied?
2. **Responsive grid:** How should an 80-cell logical line render on a 360 px-wide phone without horizontal scrolling, wrapping, or unreadably small text?
3. **Transport:** What is the simplest public architecture that guarantees visible per-character delivery, ordered replay after temporary interruption, and low operational complexity?
4. **Line state machine:** Are `active`, `committed`, and `abandoned-nonempty` sufficient states? Which transitions need idempotency keys or transactions?
5. **Command visibility:** Should a one-character command remain briefly visible before Enter, be locally concealed, or be represented as a normal visible correction when cleared?
6. **Presence timing:** What heartbeat interval and disconnect grace period preserve the BBS feel without making departures look stale?
7. **Reconnect semantics:** Should a short reconnect resume the same active line, or should every reconnect visibly leave and rejoin?
8. **Color reuse:** Is a ten-color palette sufficiently distinguishable on black for common color-vision differences while retaining the original color-only identity model?
9. **Unicode path:** Can a later version support Unicode correctly with grapheme segmentation and terminal-cell width calculation without compromising deterministic alignment?
10. **No-history guarantee:** What is the cleanest sequence-based protocol that supports catch-up after joining while proving that pre-join events cannot be returned?
11. **Room assignment:** Should a full room send the next visitor directly to a new room, or should the lobby always make room choice explicit?
12. **Mobile keyboard:** Which hidden-input or contenteditable pattern produces reliable Backspace, Enter, paste, and composition events while keeping the visible caret in the shared grid?

### Suggested review tasks

- Derive a formal state machine for participants, active lines, room events, and disconnects.
- Produce adversarial concurrency traces for simultaneous join, Enter, quit, retry, and reconnect.
- Compare WebSocket, SSE plus actions, and low-latency polling against the acceptance tests.
- Propose two or three narrow-screen layouts without changing the logical interaction model.
- Identify any way a late joiner could receive pre-join text through snapshots, retries, caches, or reconnects.
- Challenge whether join/leave lines improve the experience enough to justify departing from uncertain historical behavior.

---

## 15. Decision summary

The prototype should optimize for the unique experience, not for feature count. Its invariant is simple: every connected participant owns one visible active line; every accepted character and Backspace is shared immediately; Enter commits that line and appends a new one; color identifies authors; the roster stays top-right; and each participant’s history begins at their own join boundary.

Everything else—lobby, commands, persistence, responsive treatment, and future accounts—must preserve that invariant or remain outside the room interface.
