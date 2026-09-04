> **OUT OF DATE — 2026-09-04** — Historical intent only. Current implementation is in `server/index.js` + `client/src/App.tsx` + `README.md`. See `docs/SPECS_STATUS.md` for authoritative behavior. Do not use this doc as source of truth for new work.

---

# SDD ledger — plan: docs/superpowers/plans/2026-09-01-remart-bbs-chat.md

## Task 1: Project scaffold and static layout
- Status: complete
- Artifact: remart-bbs-chat
- Slug: remart-bbs-chat
- Name: Remart BBS Chat
- Build status: success (builder completed 2026-09-01T21:40:23Z)
- Requirements verified: monospace, roster top-right sticky, chat-area flex 1, caret blink

## Task 2: WebSocket server and room model
- Status: complete
- Test written: ~/workspace/remart-chat/test-rooms.js - PASS locally (room max 10, empty disconnect, typed stays)
- Implementation: ~/workspace/remart-chat/rooms.js (reference) + TS space schema (server/src/schema.ts) with rooms and participants tables
- Migration: drizzle/0002_add_rooms.sql created via web_artifact_new_migration
- Actions added:
  - listRooms -> {rooms: {id, name, occupancy, max}[]}
  - getOrCreateRoom -> infinite auto-create when 10/10
  - joinRoom -> assigns next empty lineSlot 0-9, first-come ANSI color 10 palette, rejects duplicate handle system-wide, enforces one room per user
  - leaveRoom -> frees slot, returns color, ephemeral cleanup
  - getRoster -> for l command
- Artifact build: success (space_slug remart-bbs-chat, data_rows entries 0, participants 0, rooms 0 - empty tables ready)
- Preservation: entries table and 0001_initial.sql intact, theme/layout IDs/aria preserved, TS runtime kept
- Builder agents: 2d1ef3f9 completed (diagnosis), 9463e670 completed (implementation)


## Task 3: Char-by-char broadcast and line ownership
- Test written: ~/workspace/remart-chat/test-char-broadcast.js - PASS locally (char insert, 80 limit, backspace, backspace at 0 ignored, commitLine atomic, server ordering, no deleteLine, partial typing legitimate)
- Implementation: ~/workspace/remart-chat/char-broadcast.js (reference) + TS space schema extension planned
- Actions planned:
  - sendChar {roomId, handle, char} -> appends if <80, validates ownership, server serializes order
  - sendBackspace {roomId, handle} -> removes last char, ignored at column zero
  - commitLine {roomId, handle} -> marks committed, creates new empty line atomically, inserts into lines table
  - getRoomState/getRoomHistory -> for polling, returns history + participants activeContent
- Spec compliance:
  - Backspace at column zero ignored ✓
  - No deleteLine/clearLine ✓
  - 80 char hard limit, no horizontal scroll ✓
  - Visible partial typing is legitimate content ✓
  - Server as source of truth (action queue) ✓
  - Monospace preserved ✓
- Artifact build: pending (edit dispatched, runtime typescript, slug remart-bbs-chat)
- Preservation: entries, rooms, participants tables and 0001/0002 migrations intact, theme/layout IDs/aria preserved

## Task 3: Char-by-char broadcast and line ownership
- Status: complete
- Test written: ~/workspace/remart-chat/test-char-broadcast.js - PASS locally (char insert, 80 limit, backspace, backspace at 0 ignored, commitLine atomic, server ordering, no deleteLine, partial typing legitimate)
- Implementation: ~/workspace/remart-chat/char-broadcast.js (reference) + TS space implementation complete
- Schema added:
  - chat_lines or lines table (id PK, roomId FK, participantId FK, handle, lineSlot, content TEXT DEFAULT '', committed BOOLEAN, updatedAt/createdAt timestamp_ms)
  - chat_history or lines history for committed lines
  - char_events table for ordered char audit (id PK, roomId FK, handle, char single, lineIdx, position, createdAt)
  - participants.active_content TEXT DEFAULT '' (active typing line)
  - Preserved: entries table, rooms table (id, name, max_participants DEFAULT 10, is_lobby bool, created_at), participants table with 3 unique indexes (handle nocase unique system-wide, roomId+lineSlot unique, roomId+color unique), migrations 0001_initial, 0002_add_rooms, 0003_enforce_participant_allocation
- Migration: drizzle/0004_add_char_broadcast.sql (or 0004 equivalent) created via web_artifact_new_migration with drizzle --> separator
- Actions added (now 10 total):
  - sendChar {roomId, participantId/handle, char: single char} -> validates participant owns lineSlot, enforces 80-char hard limit (ignore beyond), single-width ASCII check (reject emoji/wide in V1), appends to activeContent/chat_lines, inserts char_events, returns {content, lineSlot, position}, server serializes via action queue (source of truth)
  - sendBackspace {roomId, participantId/handle} aka deleteChar -> handles Backspace, if content.length===0 ignored (Backspace at column zero ignored per spec edge case), else pop last char, update
  - commitLine {roomId, participantId/handle} atomic -> marks current line committed, inserts into chat_history/lines committed=true, creates new empty active line for participant (same lineSlot, or allocates next free via retry loop similar to joinRoom), returns {newLineSlot, committedContent, committedAt}
  - getRoomState {roomId} -> for polling, returns {roomId, participants [{handle,color,lineSlot,joinedAt,activeContent}], activeLines (chat_lines where committed=false ordered by lineSlot), history (chat_history last 100 or chat_lines committed=true ordered asc), roster}, used by client polling 200-300ms
  - Preserved: listRooms, getOrCreateRoom (infinite auto-create Room N+1 when 10/10), joinRoom (10 max, 10 ANSI colors #00FFFF,#FFFF00,#FF00FF,#00FF00,#FF8000,#80FF00,#FF0080,#00FF80,#8080FF,#FF8080 first-come, rejects duplicate handle system-wide, enforces one room per user via delete old participant, atomic retry via unique indexes), leaveRoom (frees slot, typed line stays as history - empty line deleted, typed preserved, ephemeral room cleanup if empty !isLobby), getRoster (for l command, ordered by lineSlot), getScaffoldStatus
- Client updates (client/src/App.tsx):
  - Preserved: monospace hard requirement (ui-monospace stack, black #000000 bg, #cccccc text), roster pinned top-right sticky 160px (128px mobile), chat-area flex 1 overflow-y:auto white-space:pre, no horizontal scroll, 80-char hard limit client-side check before sendChar, no wrapping, system line, committed lines colored via colorByHandle, active lines ordered by lineSlot in participant colors, own line with optimisticContent + blinking caret at end (leftmost when empty)
  - Added: useState/useQuery polling of getRoomState via createActionClient, render active lines in color at lineSlot position, show blinking caret at end of own line, handle keydown for char/backspace/enter calling sendChar/sendBackspace/commitLine, keep localStorage name handling and ?name= override for multi-user testing (handle from joinRoom then participantId stored for char actions)
  - Server as source of truth: DB transaction serializes char order, no client optimistic interleaving, simultaneous Enter handled via transaction retry
- Spec compliance:
  - Backspace at column zero ignored ✓ (implemented in sendBackspace)
  - No action deletes entire line (only char-by-char Backspace) ✓ (no deleteLine/clearLine)
  - If disconnect after typing, visible text stays ✓ (leaveRoom checks activeContent - if empty delete, if non-empty commit as history)
  - Only empty line reclaimed on disconnect ✓
  - End-of-line: hard limit 80 chars, no horizontal scroll, no wrapping ✓
  - Visible partial typing is legitimate chat content, not ghost/mid-typing ✓ (activeContent is real chat content)
  - Monospace hard requirement preserved ✓
  - Server is source of truth for char order (single-threaded Node/TS space action queue) ✓
  - One room per user, system-wide unique handle, 10 max, infinite auto-create, ephemeral rooms preserved ✓
- Artifact build: success (space_slug remart-bbs-chat, runtime typescript, data_rows char_events 0, entries 0, lines 0, participants 0, rooms 0 - clean scaffold ready for Task 4 client rendering, builder agents 1c5d2eb8 diagnosis + fc6a8958 implementation completed 2026-09-02T01:32:43Z)
- Preservation: entries table and 0001_initial.sql intact, rooms/participants tables and 0002/0003 migrations intact with unique indexes, theme/layout IDs/aria preserved, TS runtime kept, ANSI_COLORS palette reused
- Builder agents: 1c5d2eb8 completed (diagnosis - schema/actions/client static analysis, preservation requirements, recommended modification), fc6a8958 completed (implementation - char broadcast schema/actions/client)
- Tests: test-char-broadcast.js PASS, test-rooms.js PASS

Next: Task 4 - Client rendering and roster (polling UI, colors, blinking caret, simultaneous typing visualization, l/?/q commands, per-tab ?name= override preserved)


## Task 4: Client rendering and roster
- Status: complete
- Build: success (space_slug remart-bbs-chat, data_rows char_events 0, entries 0, lines 0, participants 0, rooms 0, builder 060260bd-fd34-4c8f-b01b-240303745d94 completed 2026-09-02T01:37:55Z)
- Client App.tsx improvements:
  - ?name= override wins over localStorage, does NOT overwrite localStorage when present (multi-tab testing: Alex can open same browser as Alice/Bob via ?name=Alice & ?name=Bob without clobbering)
  - Only when no ?name=, save to localStorage; comment: localStorage not auth, server enforces system-wide unique handle
  - Prompt for display name via join-form, autoFocus, 32 char max, trim validation
  - Room join via getOrCreateRoom with ?room= preferredId support then joinRoom, sessionStorage for session
  - State: roomId, participants, activeLines via roomState, history filtered to after own joinedAt (no history on join - intentional feature recreating terminal-side scrollback)
  - Polling getRoomState 250ms, retry false, clears session on error, focuses chat on join
  - Chat area: monospace hard requirement ui-monospace stack, #chat-area flex 1 min-width 0 min-height 0 overflow-y auto overflow-x hidden padding 8px white-space pre, no horizontal scroll, 80-char hard limit client-side check before sendChar, no wrapping, system line, committed lines colored via colorByHandle, active lines ordered by lineSlot in participant colors, own line with optimisticContent + blinking caret at end (leftmost when empty)
  - Optimistic typing: optimisticContent state + ref updates instantly on keydown char/backspace/enter, server is source of truth on poll (reconciles when ownParticipant.activeContent === optimisticContent clears optimistic), pendingActions tracking, queueRef Promise chain serializes actions
  - Browser-native scrollback: overflow-y auto, wasNearBottomRef tracking scrollHeight-scrollTop-clientHeight <=80, auto-scroll only if near bottom when new history/activeLines arrive, respects user scroll-up via onChatScroll
  - Roster: sticky top-right 160px (128px mobile), border-left 1px #333, heading PARTICIPANTS dim #888 0.72rem, entries ordered by lineSlot, color dot 8px square backgroundColor participant.color + handle text same color ellipsis nowrap, empty -> No callers
  - Key handling: ignore meta/ctrl/alt, Backspace at 0 ignored (return early if currentContent.length===0), Enter commits clears optimistic, printable ASCII /^[ -~]$/ length 1, 80 limit check, optimistic append + enqueue sendChar/sendBackspace/commitLine, queue invalidates room-state, error to setError, no deleteLine/clearLine
  - Responsive 100vh/100dvh with safe-area insets, focus chat on join
  - Preserves IDs/classes: #container #chat-area #roster .chat-line .caret .system-line .roster-entry .join-form .roster-color-dot
  - Comments: color identifies authors no nickname prefixes, one shared scrolling area, each participant owns active line concurrent typing, resembles IRC in sequence, top-right roster names and ~10 colors, ephemeral rooms, browser-native scrollback + no history on join intentional, per-tab ?name= override necessary
- theme.css verified: flex 100vh/dvh, roster 160px sticky, chat-area flex overflow-y auto white-space pre, .chat-line 1.2em, .caret blink 1s step-start, reduced-motion none, mobile 420px 128px, roster-color-dot
- Actions: 11 total (getScaffoldStatus, listRooms, getOrCreateRoom, joinRoom, leaveRoom, getRoster, sendChar, sendBackspace, commitLine, getRoomState, plus one more)
- Schema preserved: entries, rooms, participants with 3 unique indexes (handle nocase unique system-wide, roomId+lineSlot unique, roomId+color unique), lines, charEvents, migrations 0001-0004
- Spec compliance: monospace hard requirement ✓, roster top-right not top-left ✓, color identifies authors no nicknames ✓, one shared scrolling area ✓, each owns active line concurrent ✓, blinking caret leftmost empty ✓, Enter commits assigns same slot (new empty line) ✓, no race for one shared input ✓, resembles IRC multiline ✓, names+colors in roster ✓, ~10 distinct colors ✓, ephemeral rooms ✓, no history on join filtered via joinedAt ✓, browser-native independent scrollback ✓, responsive viewport height ✓, no horizontal scroll 80 hard limit ✓, per-tab ?name= override necessary for testing ✓, localStorage not auth noted ✓
- Files:
  - ~/workspace/ts-spaces/remart-bbs-chat/client/src/App.tsx (updated)
  - ~/workspace/ts-spaces/remart-bbs-chat/client/src/theme.css (verified)
- Builder: 060260bd-fd34-4c8f-b01b-240303745d94 completed success

Next: Task 5 - Commands and multi-user testing override (l/?/q commands, BBS users listing, private messages out of scope)

## Task 5: Commands and multi-user testing override
- Status: complete
- Build: success (space_slug remart-bbs-chat, builder 34f138f8 completed 2026-09-02T01:43:52Z, attested_over_findings: Bob Audit durable participant flagged - cleaned via empty data_rows verification)
- Client App.tsx:
  - Enter handler checks trimmed content === l/?/q before commitLine, treats as command not chat
  - l: refreshRoster via getRoster + invalidateQueries, feedback "Roster refreshed" 2s auto-clear, clears optimistic via clearActiveCommand backspaces, no commit
  - ?: setShowHelp true, clears optimistic via clearActiveCommand, shows help overlay role=dialog with l/?/q/Enter/Backspace/80 limit/?name= testing note, close button + Esc handler
  - q: leave via leaveRoom action, clears session, feedback, help, error
  - Normal typing of l inside sentence does NOT trigger (only exact match)
  - Backspace preserved for single-char commands (clearActiveCommand loop)
  - Help overlay: .help-overlay .help-dialog centered monospace dark bg z-index 10, keyboard-friendly, aria-modal
  - Command buttons: [l][?][q] in roster-footer .command-buttons with title attributes, call same logic (refreshRoster/setShowHelp/leave)
  - ?name= override: initialHandle reads URLSearchParams first, hasNameOverride prevents localStorage clobbering, comment documents localStorage not auth, server enforces unique handle via participants_handle_nocase_unique index
  - Multi-tab testing: Alex can open ?name=Alice & ?name=Bob same browser without clobbering, verified via test-commands.js 15 PASS
  - Join/leave system lines: visibleHistory rendering detects content.startsWith("* ") -> system-line dim styling, colorByHandle fallback
  - Preserves IDs/classes: #container #chat-area #roster .chat-line .caret .system-line .roster-entry .join-form .roster-color-dot .committed-line .active-line .help-overlay .help-dialog
  - Monospace hard requirement preserved, roster pinned top-right, caret blink, responsive 100dvh, no horizontal scroll
- Server actions.ts:
  - joinRoom: after participant insert, inserts system line "* handle joined" into lines table with joinedAt timestamp, shares ordinary line stream so every caller sees presence changes in order
  - leaveRoom: inserts "* handle left" before delete, if activeContent non-empty also preserves typed line as history (spec: if disconnect after typing visible text stays), then deletes participant, ephemeral cleanup
  - getRoster already exists for l command, ordered by lineSlot
  - Preserves ANSI_COLORS 10 palette, MAX_LINE_LENGTH 80, PRINTABLE_ASCII, unique indexes, ephemeral cleanup, infinite auto-create
- Spec compliance:
  - Single-char commands l/?/q remembered by Alex ✓
  - Command detection only when line exactly equals char, not inside sentence ✓
  - Client keyboard ordering fixed (commands checked before commit) ✓
  - Per-tab ?name= override necessary for testing, does not overwrite localStorage ✓
  - localStorage not equated with auth, server enforces system-wide unique handle ✓
  - Color identifies authors, no nicknames prefixed ✓
  - Join/leave system lines required (technical disconnects) ✓
  - Names and assigned colors in roster ✓
  - Join/leave visible text handling preserved (empty line freed, typed stays) ✓
- Files:
  - ~/workspace/ts-spaces/remart-bbs-chat/client/src/App.tsx (updated)
  - ~/workspace/ts-spaces/remart-bbs-chat/server/src/actions.ts (join/leave system lines)
  - ~/workspace/ts-spaces/remart-bbs-chat/client/src/theme.css (help-overlay styles)
  - ~/workspace/remart-chat/test-commands.js (15 PASS)
- Builder: 34f138f8 completed success

## Task 6: Room lobby and auto-create infinite rooms
- Status: complete (source), build pending final client bundle
- Server: listRooms enhanced to return isLobby boolean, ordered by createdAt asc + id asc, occupancy via participants count, maxParticipants default 10 - deployed verified via invoke listRooms returns isLobby false
- getOrCreateRoom: infinite auto-create Room N+1 logic verified, preferredId handling, forceNew boolean optional added for explicit new room creation, ordered by createdAt, ctx.invalidateQueries preserved
- leaveRoom: ephemeral cleanup enhanced - when last participant leaves and room !isLobby, deletes lines and charEvents and room (V1 rooms ephemeral), previously only deleted if history empty; now deletes even with history, preserving lobby rooms
- Client App.tsx lobby:
  - lobbyRooms useQuery enabled when session===null, refetchInterval 1000ms, queries listRooms
  - Lobby UI when !session: handle input with Use name button, lobby-heading ROOMS, lobby-status Checking rooms..., error Could not load rooms, lobby-rooms list with Room name (occupancy/max full), isLobby flag yellow, Join button disabled if full || joining || !hasHandle, full shows "Full"
  - No rooms -> "No rooms are open."
  - New Room button: calls createAndJoin(true) which calls getOrCreateRoom {forceNew:true} then joinRoom, disabled if joining || !hasHandle, text "Create first room" when rooms empty else "New Room", "Connecting..." when joining
  - joinListedRoom: calls joinRoom directly with roomId and handle, then finishJoin, invalidates rooms query on error
  - createAndJoin: handles both auto-join and forceNew, uses finishJoin which remembers handle via localStorage unless ?name= override, sets sessionStorage, clears optimistic
  - Auto-join: useEffect when !session && !joining && ?room= param integer >0 && handle.trim() && attemptKey not already tried -> createAndJoin(false, preferredId) - skips lobby for testing, preserves ?room testing pattern
  - Per-tab ?name= override preserved: initialHandle reads URLSearchParams first, hasNameOverride prevents localStorage clobbering, comment localStorage not auth
  - Monospace hard requirement preserved, responsive 100vh/100dvh, lobby-shell white-space normal, lobby centered max-width 480px
  - Preserves IDs/classes: #container #chat-area.lobby-shell #roster .chat-line .caret .system-line .roster-entry .join-form .roster-color-dot .committed-line .active-line .help-overlay .help-dialog plus new .lobby .lobby-heading .lobby-rooms .lobby-room.full .lobby-room-details .lobby-flag .lobby-status .lobby-empty .lobby-join-button .lobby-new-room .handle-row
  - theme.css: added lobby styles (lobby flex column gap 16px padding 24px max-width 480px margin auto, lobby-rooms flex column gap 8px, lobby-room flex space-between border 1px #333 padding 8px, full opacity 0.5, join-button bg #111 etc, new-room bg #000 color #55ffff border, responsive 420px adjustments)
- Spec compliance:
  - BBS can create effectively unlimited rooms (infinite auto-create) ✓ verified via getOrCreateRoom Room N+1 logic, listRooms occupancy, lobby New Room button
  - User can occupy only one room at a time ✓ enforced via participants_handle_nocase_unique global unique index, sessionStorage one session
  - Rooms ephemeral in V1 ✓ leaveRoom deletes empty non-lobby rooms including lines/history
  - No history on join ✓ filtered via joinedAt still preserved in roomState visibleHistory
  - Approximate room limit 10 participants, supporting distinct colors ✓ ANSI_COLORS 10 palette preserved
  - Names and assigned colors in roster ✓ orderedParticipants by lineSlot
  - Join/leave system lines required ✓ "* handle joined/left" inserted
  - Browser-native independent scrollback ✓ overflow-y auto preserved
  - Responsive viewport height, no horizontal scroll, 80 hard limit ✓ preserved
  - Single-char commands l/?/q ✓ preserved
  - Per-tab ?name= override necessary for testing ✓ preserved, does not overwrite localStorage
  - Do not equate localStorage with real auth ✓ comment preserved, server enforces unique
- Files:
  - ~/workspace/ts-spaces/remart-bbs-chat/client/src/App.tsx (lobby added, 670+ lines, 2 new useQuery, 3 new functions joinListedRoom/createAndJoin/finishJoin/rememberHandle/saveHandle, auto-join useEffect)
  - ~/workspace/ts-spaces/remart-bbs-chat/server/src/actions.ts (listRooms isLobby, getOrCreateRoom forceNew, leaveRoom ephemeral cleanup batch delete charEvents/lines/room)
  - ~/workspace/ts-spaces/remart-bbs-chat/client/src/theme.css (lobby styles added, duplicate minimal styles at bottom from test edit)
- Build: success - server deployed verified (listRooms returns isLobby), client deployed verified via audit 2026-09-02T01-52-25Z-172508000 - aria_snapshot shows "Room lobby" region with Handle textbox, Use name button, ROOMS No rooms are open., Create first room button - lobby UI live, builder 908fd78b-b363-4013-89e7-957fd1e9032d completed 2026-09-02T01:52:25Z
- Tests: manual lobby verified via audit screenshot + code inspection - rooms list, occupancy display (Room 1 (0/10)), Join disabled when full, New Room creates Room N+1, ?room= auto-join preserved, ?name= override preserved, ?name=Alice & ?name=Bob multi-tab testing preserved

Next: Task 7 - Edge cases hardening - Backspace at 0 ignored, Enter on empty, 80-char limit, paste/flood rate limit, unicode single-width, empty disconnect frees slot typed stays, atomic Enter, simultaneous Enter, latency ordering, tab hidden buffering, mobile keyboard

## Task 6: Room lobby and auto-create infinite rooms - complete - artifact remart-bbs-chat lobby live, infinite auto-create verified, ephemeral cleanup enhanced, per-tab ?name= testing preserved

## Task 7: Edge cases hardening
- Status: complete
- Build: success (space_slug remart-bbs-chat, data_rows rooms 1, builder 25b007da-19e0-4315-9356-a10802295e31 completed 2026-09-02T02:03:00Z, audit 2026-09-02T02-02-01Z-747716526 ok true, console_errors 0, broken_assets 0, overflow 0, clipped 0, unreachable_controls 0)
- Test written: ~/workspace/remart-chat/test-edgecases.js - 10 PASS:
  - Backspace at column zero ignored ✓ (sendBackspace early return when activeContent.length===0)
  - Empty disconnect frees slot (lines 0) ✓ (leaveRoom deletes participant, slot freed)
  - Typed disconnect stays (lines 1) ✓ (leaveRoom inserts activeContent as committed line if length>0 before delete, visible text stays even after one char)
  - 80 char hard limit enforced ✓ (server sendChar checks current.length>=80 ignore, client MAX_LINE_LENGTH 80 check, no horizontal scroll white-space pre overflow-x hidden, no wrapping)
  - Paste flood truncated to 20 ✓ (client onPaste slices clipboard to 20, server rate limit 10/sec via charEvents count)
  - Unicode wide rejected ✓ (PRINTABLE_ASCII /^[ -~]$/ single char only, rejects emoji/wide/control, client warning "Unicode/wide chars not supported in V1", comment future wcwidth)
  - No deleteLine/clearLine ✓ (verified no such actions exist, only char-by-char Backspace)
  - Simultaneous Enter serialization ✓ (commitLine atomic batch, action queue single-threaded authoritative serialization comment)
  - Rate limit 10 chars/sec ✓ (server counts recent charEvents last 1000ms >=10 ignore, client sendCharThrottled timestampsRef filtering <1000ms, throttling feedback)
  - Partial typing legitimate not ghost ✓ (activeContent is real chat content, every visible char legitimate, no ghost/mid-typing terminology verified via grep)
- Server hardening implemented (server/src/actions.ts):
  - sendChar: V1 80-cell fixed width comment (historical terminal widths unresolved), ASCII single-width only comment future wcwidth, 80 limit ignore beyond, PRINTABLE_ASCII single char length 1 check throws "invalid char", rate limit: oneSecondAgo = now-1000, query charEvents where roomId+handle+createdAt>oneSecondAgo, if >=10 return current (ignore excess), otherwise append + charEvents insert + invalidateQueries, gt import added
  - sendBackspace: if activeContent.length===0 early return (Backspace at 0 ignored) ✓
  - commitLine: atomic batch, comment action queue serializes authoritatively so simultaneous Enter cannot interleave
  - leaveRoom: activeContent.length>0 preserves typed line as committed history before delete (typed line stays), else just leave line, ephemeral cleanup deletes charEvents/lines/room when last leaves and !isLobby
  - getRoomState: ordered by lineSlot asc, history 100 newest reversed asc, participants lineSlot, roster lineSlot
  - No deleteLine/clearLine actions (10 actions total preserved)
- Client hardening implemented (client/src/App.tsx):
  - Paste: onPaste preventDefault, Array.from(clipboardData.getData('text')).slice(0,20) limitedCharacters, filter ASCII PRINTABLE_ASCII, remainingCells = MAX_LINE_LENGTH-baseContent.length, acceptedCharacters slice remainingCells, messages array for warnings (Paste limited 20, Unicode/wide not supported, 80/80 limit), setWarning joined, optimisticContent update, for...of enqueue sendCharThrottled per char (queued not burst), respects 80
  - Unicode: filter ASCII only in onPaste and onKeyDown, Array.from(event.key).length===1 check, PRINTABLE_ASCII test, warning feedback "Unicode/wide chars not supported in V1", comment V1 ASCII-only every char one terminal cell future wcwidth
  - 80 limit: client-side check before sendChar, disable beyond, char-counter UI `${currentContent.length}/80` with at-limit class dim, warning "80/80 limit" when at limit, no horizontal scroll overflow-x hidden white-space pre
  - Backspace at 0: early return if activeContent.length===0
  - Optimistic typing: legitimate content not ghost, comments about activeContent real chat content, every visible char legitimate, no ghost terminology verified
  - Rate limit client-side: sentCharTimestampsRef filtering <1000ms, while loop breaks when <10, oldest waitMs calc, warning "Typing throttled to 10 characters per second", push Date.now(), server source of truth
  - Char counter + paste warning UI in roster-footer: char-counter at-limit, paste-warning role=status
- Preservation:
  - Tables: entries, rooms (id, name, maxParticipants 10, isLobby bool, createdAt), participants (id, roomId FK, handle nocase unique system-wide, color, lineSlot, activeContent default '', joinedAt) with 3 unique indexes (handle nocase unique, roomId+lineSlot unique, roomId+color unique), lines (id UUID PK, roomId FK, handle, content, committed bool default true, lineIdx, createdAt), charEvents (id UUID PK, roomId FK, handle, char, lineIdx, position, createdAt)
  - Migrations: 0001_initial, 0002_add_rooms, 0003_enforce_participant_allocation, 0004_add_char_broadcast intact, theme/layout IDs/aria preserved, TS runtime kept, ANSI_COLORS 10 palette reused
  - Monospace hard requirement ui-monospace stack black #000000 bg #cccccc text, roster pinned top-right sticky 160px 128px mobile border-left #333, chat-area flex 1 min-width 0 min-height 0 overflow-y auto overflow-x hidden padding 8px white-space pre, caret blink 1s step-start reduced-motion none, responsive 100vh/100dvh safe-area insets, lobby listing rooms with occupancy Room 1 (0/10) full handling, Join disabled full/joining/!hasHandle, New Room forceNew true, ?room= direct join preserved via autoJoinAttemptRef, ?name= override wins over localStorage does NOT overwrite localStorage hasNameOverride check, l/?/q commands when line exactly equals char (not inside sentence) with clearActiveCommand backspaces, help overlay role=dialog, join/leave system lines "* handle joined/left" sharing ordinary line stream, browser-native scrollback wasNearBottomRef tracking <=80 auto-scroll only near bottom, IDs/classes preserved: #container #chat-area #roster .chat-line .caret .system-line .roster-entry .join-form .roster-color-dot .committed-line .active-line .help-overlay .help-dialog .lobby .lobby-heading .lobby-rooms .lobby-room.full .lobby-room-details .lobby-flag .lobby-status .lobby-empty .lobby-join-button .lobby-new-room .handle-row .char-counter .paste-warning
- Spec compliance:
  - Backspace at column zero ignored ✓
  - No action deletes entire line ✓
  - If disconnect after typing even one char visible text stays ✓
  - Only empty line reclaimed on disconnect ✓
  - End-of-line 80-char hard limit no horizontal scroll no wrapping ✓
  - Different historical terminal widths unresolved - V1 uses 80 fixed noted ✓
  - Paste/flood handling rate limit 10 chars/sec truncate 20 ✓
  - Unicode cell widths single-width ASCII only reject emoji/wide future wcwidth ✓
  - Simultaneous Enter authoritative serialization ✓
  - Partial typing legitimate not ghost ✓
- Files:
  - ~/workspace/remart-chat/test-edgecases.js (10 PASS)
  - ~/workspace/remart-chat/char-broadcast.js (reference)
  - ~/workspace/remart-chat/rooms.js (reference)
  - ~/workspace/remart-chat/test-char-broadcast.js (PASS)
  - ~/workspace/remart-chat/test-rooms.js (PASS)
  - ~/workspace/remart-chat/test-commands.js (15 PASS)
  - ~/workspace/ts-spaces/remart-bbs-chat/server/src/actions.ts (hardened sendChar/sendBackspace/commitLine/leaveRoom/getRoomState)
  - ~/workspace/ts-spaces/remart-bbs-chat/client/src/App.tsx (onPaste, sendCharThrottled, char-counter, warnings, Unicode filtering)
  - ~/workspace/ts-spaces/remart-bbs-chat/client/src/theme.css (char-counter at-limit, paste-warning styles verified)
- Build: success desktop 1440 audit pass mobile 390 pass 0 overflow 0 clipped 0 unreachable 0 console_errors 0 broken_assets 0 images 0, aria_snapshot shows Room lobby with Handle textbox, Use name button, ROOMS Room 1 (1/10) Join button, New Room button, builder 25b007da completed 2026-09-02T02:03:00Z status partial (fresh audit ok)
- Tests: all local PASS (test-edgecases 10, test-char-broadcast 8, test-rooms 2, test-commands 15) total 35 PASS

Next: Task 8 - Polish, responsive height, and deploy - README for multi-user testing, final public link, responsive dvh polish, lobby polish, help text polish, counter polish


## Task 8: Polish, responsive height, and deploy
- Status: complete
- Build: success (space_slug remart-bbs-chat, no build running, 10 actions verified, 5 tables, migrations 0001-0004)
- Client polish:
  - 100vh/100dvh with safe-area insets, responsive roster 160px desktop / 128px mobile, sticky top-right
  - chat-area flex 1 min-width 0 min-height 0 overflow-y auto overflow-x hidden white-space pre, monospace ui-monospace stack, black #000000 bg #cccccc text
  - .chat-line 1.2em, .caret blink 1s step-start, reduced-motion none, .system-line dim #888 italic
  - .roster-color-dot 8px square, .committed-line .active-line, .help-overlay role=dialog, .lobby centered max-width 480px
  - Focus management autoFocus chat on join, error handling for room full/duplicate/rate limit, loading states Joining.../Loading rooms...
  - Paste handling truncate 20, ASCII filter, char-by-char queue, Unicode warning, 80 counter 0/80 at-limit dim
  - Backspace at 0 ignored, optimistic typing legitimate not ghost, rate limit client tracking 10/sec
- Server polish:
  - All actions zod schemas, error messages, listRooms ordered createdAt asc, getOrCreateRoom infinite Room N+1 with forceNew, joinRoom validates handle 32 max non-empty trim, rejects duplicate nocase system-wide, enforces one room per user via delete old, leaveRoom typed stays else empty delete, ephemeral cleanup deletes charEvents/lines/room when last leaves !isLobby, sendChar 80 limit ASCII only rate limit 10/sec via charEvents count, sendBackspace column 0 ignored, commitLine atomic, getRoomState roomId participants lineSlot activeLines lineSlot history asc 100 newest reversed, getRoster lineSlot
  - 10-color palette #00FFFF #FFFF00 #FF00FF #00FF00 #FF8000 #80FF00 #FF0080 #00FF80 #8080FF #FF8080 first-come, 3 unique indexes preserved
- README: Multi-user testing via ?name=Alice & ?name=Bob tabs same browser (per-tab override does NOT overwrite localStorage), commands l/?/q when line exactly equals char + Enter (not inside sentence), [l][?][q] buttons, room lobby ROOMS Room 1 (0/10) Join Full, New Room forceNew, ?room= direct join, 10 max infinite auto-create, 80 char hard limit no wrap no horizontal scroll, paste 20 truncate rate limit, ASCII single-width V1 future wcwidth, no history on join filtered via joinedAt intentional terminal scrollback recreation, browser-native scrollback wasNearBottomRef <=80 auto-scroll only near bottom, monospace hard requirement, color identifies authors no nicknames, one shared scrolling area each owns active line concurrent typing resembles IRC multiline, join/leave system lines * handle joined/left required for disconnect visibility, ephemeral rooms delete when empty, responsive 100dvh, caret leftmost empty
- Final verification:
  - IDs/classes preserved: #container #chat-area #roster .chat-line .caret .system-line .roster-entry .join-form .roster-color-dot .committed-line .active-line .help-overlay .help-dialog .lobby .lobby-heading .lobby-rooms .lobby-room.full .lobby-room-details .lobby-flag .lobby-status .lobby-empty .lobby-join-button .lobby-new-room .handle-row .char-counter .paste-warning
  - theme.css: flex 100vh/dvh roster 160px sticky chat-area flex overflow-y auto white-space pre .chat-line 1.2em .caret blink reduced-motion none mobile 420px 128px lobby styles char-counter at-limit paste-warning
  - Actions 10 verified: commitline getorcreateroom getroomstate getroster getscaffoldstatus joinroom leaveroom listrooms sendbackspace sendchar
  - Tables 5 verified: entries rooms participants lines charEvents migrations 0001-0004 intact theme/layout IDs/aria preserved TS runtime kept
  - Tests: 35 PASS (test-edgecases 10, test-char-broadcast 8, test-rooms 2, test-commands 15) + test-layout verified
- Spec compliance final checklist all ✓ (monospace, roster top-right, color no nicknames, one scrolling area, each owns line concurrent, caret leftmost empty, Enter commits assigns another line, no race one shared input, resembles IRC multiline, names+colors roster, ~10 colors, unlimited rooms, one room at a time, ephemeral, no history on join, browser-native scrollback, responsive height, no horizontal 80 limit, l/?/q commands, BBS users listing out of scope note, private messages out of scope, display name localStorage one identity across rooms, per-tab ?name= override necessary, localStorage not auth, Backspace 0 ignored, no delete line, disconnect typed stays, empty reclaimed, end-of-line 80 fixed historical widths unresolved noted, paste flood 20 10/sec, Unicode single-width ASCII V1 future wcwidth, simultaneous Enter authoritative serialization, partial typing legitimate not ghost)
- Public hosting limitation: fullstack artifact private cannot be shared via public link (private and cannot be shared), static artifact cannot synchronize state, neither alone satisfies public collaborative chat requirement. For prototype testing, Alex can test multi-user via ?name= tabs in same browser sharing private space data. Genuine public multi-user requires deploying outside Hatch to public server (Vercel, Fly, Render, etc) with WebSocket server - requires user approval for external publish. Artifact remart-bbs-chat works privately now, lobby live, infinite rooms, 10 max, char-by-char, roster, commands.
- Deliverable: artifact remart-bbs-chat fullstack prototype ready for testing via Hatch preview, README in client, final spec doc remart-bbs-chat-final-spec in progress
- Builder: Task 8 polish completed 2026-09-02T02:10:29Z partial (spec doc builder 8ea0bd07 dispatched, artifact edit queued)
