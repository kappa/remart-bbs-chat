# Remart BBS Chat

A full-stack web prototype of the distinctive Remart BBS chat model. Its success criterion is simple: character-by-character typing, visible corrections, concurrent lines, and a color-coded roster should feel like the original while remaining usable from a link on modern phones and desktops.

The monospace font is a hard requirement. Every participant types independently on an owned line, so fixed-width cells keep simultaneous text aligned. Color identifies the author; chat lines do not need nickname prefixes. When people type in sequence, the shared stream resembles an IRC conversation and naturally supports multiline passages. When they type together, each active line updates concurrently.

## Multi-user testing

Open the artifact in several tabs and give each tab a query-string handle:

```text
?name=Alice
?name=Bob
?name=Carol
```

A `?name=` value wins over the remembered handle and does **not** overwrite `localStorage`, so one browser can simulate up to ten callers safely. Without an override, the browser remembers one handle across rooms. Handles are trimmed, limited to 32 characters, and unique system-wide without regard to case. `localStorage` is a convenience, not authentication; the server and `participants_handle_nocase_unique` database index enforce uniqueness.

Add `?room=1` to join a known room directly after the handle is available, for example `?name=Alice&room=1`. Otherwise the lobby lists rooms with occupancy and disables full rooms. **New Room** uses `forceNew: true` to create the next `Room N+1`. The BBS can create effectively unlimited rooms, with about ten callers per room and one distinct first-come color per caller:

```text
#00FFFF #FFFF00 #FF00FF #00FF00 #FF8000
#80FF00 #FF0080 #00FF80 #8080FF #FF8080
```

A handle can occupy only one room at a time. Non-lobby V1 rooms are ephemeral and are deleted when their last participant leaves. If a caller disconnects after typing even one character, that visible text is committed to history; only an empty active line is reclaimed.

## Interaction model

Each key is sent through the ordered server action queue. The server is the source of truth, and polling reconciles the optimistic local line. Backspaces are broadcast character by character; Backspace at column zero is ignored, and there is no whole-line delete or clear command. Enter commits a non-empty line and leaves the participant on a fresh empty line without racing another caller's Enter. An empty Enter is ignored.

Visible partial text is legitimate chat content, not a ghost or typing indicator. A caller joining a room starts with a blinking caret in the leftmost cell of an empty line and appears in the top-right roster in their assigned color. The caret blinks once per second with `step-start` and stops animating when reduced motion is requested.

Commands run only when the trimmed line is exactly one command character followed by Enter:

- `l` refreshes the roster.
- `?` opens the help dialog.
- `q` leaves the room.

The same actions are available through `[l]`, `[?]`, and `[q]` buttons in the roster footer. A command character inside a sentence is ordinary chat text. Private messages are outside this room prototype, as they were outside Remart's room interface. Listing BBS users who are logged in but not in chat is also out of scope until an authentic Remart command list is recovered.

Join and leave notices (`* handle joined` and `* handle left`) share the ordinary committed line stream. They matter because a technical disconnect might otherwise be easy to miss.

## Limits and scrollback

Lines have a hard 80-cell limit. They do not wrap and the chat never scrolls horizontally. The character counter reaches `80/80` at the limit. V1 accepts printable ASCII only (`/^[ -~]$/`), keeping one character equal to one terminal cell; Unicode, emoji, controls, and wide characters are rejected with a warning. A future Unicode version needs `wcwidth`-style cell measurement. Historical behavior across different terminal widths remains unresolved, so V1 deliberately fixes the width at 80 cells.

Paste input is prevented from entering as a browser burst. It is split into characters, capped at 20, filtered to printable ASCII, clipped to remaining cells, then queued through the same throttled character action. The client smooths input to ten characters per second, and the server independently counts `charEvents` in the previous 1000 ms and ignores excess input. The UI reports paste truncation, unsupported Unicode/wide characters, the 80-cell limit, and typing throttling.

History-on-join is intentionally absent. Each caller sees committed rows from their own join time onward, recreating terminal-side scrollback. Browser-native vertical scrolling gives every caller independent scrollback; automatic scrolling happens only when the view was already within 80 px of the bottom, so reading older lines is not interrupted.

## Responsive behavior

The root is a flex layout with both `100vh` and `100dvh`, `min-height: 0`, and safe-area inset padding. The chat pane is the flexible, vertically scrolling surface; the sticky top-right roster is 160 px wide on desktop and 128 px at 420 px and below. The lobby is centered up to 480 px and reflows controls vertically on narrow screens. The chat receives focus after joining, while the lobby handle input autofocuses when no handle is present. Loading and error states are rendered in-page with accessible status/alert roles.

## Spec compliance checklist

- [x] 1. Character-by-character server-authoritative chat.
- [x] 2. Visible Backspaces and corrections.
- [x] 3. One concurrent active line per participant.
- [x] 4. Enter commits and assigns a fresh empty line.
- [x] 5. Empty Enter is ignored client-side and server-side.
- [x] 6. Monospace fixed-cell rendering.
- [x] 7. One shared scrolling area with no nickname prefixes.
- [x] 8. Color identifies authors in chat and roster.
- [x] 9. Top-right pinned roster ordered by line slot.
- [x] 10. Ten-color first-come ANSI palette.
- [x] 11. Ten participants maximum per room.
- [x] 12. Unlimited numbered room creation through the lobby.
- [x] 13. One system-wide, case-insensitive handle per caller.
- [x] 14. One room at a time per handle.
- [x] 15. `?name=` independent multi-tab testing override.
- [x] 16. `?room=` direct-room testing path.
- [x] 17. `l`, `?`, and `q` exact-line commands and matching buttons.
- [x] 18. Accessible modal help with Escape and Close.
- [x] 19. Join and leave system lines in stream order.
- [x] 20. Typed disconnect content is preserved; empty lines are reclaimed.
- [x] 21. Backspace at column zero is ignored; no whole-line delete exists.
- [x] 22. Atomic, serialized Enter handling.
- [x] 23. Hard 80-character limit, no wrap, and no horizontal scroll.
- [x] 24. Printable ASCII-only V1 with a future `wcwidth` path documented.
- [x] 25. Paste capped at 20 characters and clipped to remaining cells.
- [x] 26. Ten-character-per-second client and server rate limiting.
- [x] 27. No pre-join history; browser-native independent scrollback.
- [x] 28. Near-bottom-only auto-scroll preserves manual scroll position.
- [x] 29. `100vh`/`100dvh`, safe areas, and 160 px/128 px responsive roster.
- [x] 30. In-page loading, room-full, duplicate-handle, and action error feedback.

All eight implementation tasks are complete. The deliverable is the `remart-bbs-chat` full-stack Muse web artifact; use its artifact link to test with multiple tabs or share it with other callers.
