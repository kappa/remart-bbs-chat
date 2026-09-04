# Remart BBS Chat — Design Spec

**Date:** 2026-09-01
**Status:** Draft — awaiting review
**Source:** Alex's memory (no Remart binary found in public archives)
**Classification:** Architectural (new web prototype)

## 1. Purpose

Rebuild Remart BBS chat as a modern web prototype anyone can join via link. Success is when the character-by-character typing with visible corrections and color-coded roster feels like the original.

## 2. Core Chat Mechanics

- Typing is character-by-character, broadcast immediately. Backspaces are visible live.
- One shared scrolling area, monospace required so simultaneous lines stay aligned.
- Each line is owned by one member. On join you get the next empty line slot, with a blinking caret at the leftmost position.
- You type on your line, others type on theirs at the same time. On Enter your line is committed to history and you get the next available line at the bottom. No race for lines.

## 3. Presence and Roster

- Roster pinned top-right (not top-left — top-left would be busy with chat lines scrolling up).
- Each entry is a participant name in their assigned unique color.
- Names: prompt on join for display name (BBS-handle style), 3-20 chars, one name per user across all rooms (not per-room nick). Stored in localStorage and reused on next visits. System-wide unique — if name taken anywhere, prompt for another. This matches original BBS where handle was your login.
- For prototype testing: allow same browser to log in as many users with different names (e.g., override via query param `?name=`, or per-tab name override, or clear/change name button). Needed so one person can test multi-user interaction without multiple devices.
- On join your name/color appears in roster, on leave it disappears.
- System lines in scrolling area for join/leave — added even if original maybe didn't, because disconnects were common and hard to notice without them. Format keeps color coding.
- Color assignment: fixed palette of 10 distinct colors, first-come on join, freed on leave. Low limit makes this work.
- On join you see blinking caret at leftmost of your empty line slot plus your entry in roster.

## 4. Rooms and Limits

- Max ~10 participants per room — low limit that made color assignment work.
- BBS auto-creates infinite number of chat rooms as needed. When a room fills, next joiner gets a new room.
- You can only be in one room at a time — to join another you leave current.
- Rooms are ephemeral in V1 — when empty they can be removed, except a default lobby. Chat history is in-memory per room, not persisted long-term.
- No history on join — since scrollback was client-side, you only saw what happened after you arrived. That's a privacy feature. Keep in V1, but note toggle: faithful = no history, modern = optional last N lines.

## 5. Client and Rendering

- Monospace font is a hard requirement — without it simultaneous lines don't align.
- Responsive height — chat area fills available space, works on any viewport height.
- No horizontal scrolling, lines are hard-limited. Different widths is an open edge case.
- Scrollback is client-side (browser native scroll), so independent scroll is free — you can scroll up while others keep typing.
- Blinking caret at leftmost of your empty line slot.
- Emergent property: if people type in order one after another, screen looks almost like IRC, just no nicknames at line start — color does identity. Works with multiline passages.

## 6. Commands

- Single-character commands on your line:
  - `l` — update / refresh roster
  - `?` — show list of commands
  - `q` — leave the room
- Possible extra: see list of other BBS users logged in but not in chat — remembered as maybe existing, include as optional.
- No private messages inside the chat room — in Remart they were implemented outside the chat interface. Out of scope for V1.
- Real command list from Remart binary would be ideal if binary is ever found.

## 7. Edge Cases and Open Questions

### From original memory

- **End of line:** What happens when typing reaches end of line and next line is already taken? No horizontal scrolling, lines hard-limited. Need to prototype options: block further typing until Enter, truncate, wrap to next free line if available. Original behavior unknown.
- **Different widths / no horizontal scroll:** Lines hard-limited, no horizontal scroll — enforce same width (e.g., 80) in V1 or let each client wrap independently (breaks alignment)?
- **History on join:** Original = no history (client-side scrollback only). Keep in V1, toggle for modern.

### Additional hardening (new cases)

- **Empty line on disconnect:** If someone joins, gets a slot, but disconnects without typing a single character, their empty slot should be freed. If they typed anything — even 1 char — that line is already part of shared history and stays.
- **Simultaneous Enter:** Two people hit Enter at same instant and both get assigned same next line — need atomic next-line allocation on server.
- **Backspace at start / empty Enter:** Backspace at column 0 = ignore (no line deletion). Enter on empty line = ignore/skip.
- **Paste / flood:** Pasting 500 chars char-by-char — rate limit or collapse into one broadcast? Need rate limiting to avoid flooding.
- **Unicode width:** Monospace assumes 1 char = 1 cell, but emoji / wide chars break alignment — restrict to single-width (ASCII + single-width) in V1?
- **Latency / ordering:** Network jitter could make chars arrive out of order to different clients — server is single source of truth for char order per line.
- **Room full:** 10/10 — auto-create new room and redirect, or show lobby?
- **Tab hidden:** Browser tab in background throttles WebSocket — buffer and replay missed chars on focus.
- **Mobile:** Monospace + blinking caret + on-screen keyboard — keyboard covers half screen, need layout handling.

## 8. Non-Goals (V1)

- No private messages inside chat (they were outside chat interface in Remart)
- No moderation / kick / ban
- No persistent history / search
- No file transfers / BBS mail / conferences (other Remart subsystems)
- No user accounts — anonymous names with colors, like original BBS

## 9. V2 Ideas

- Lobby that lists rooms with occupancy, auto-creates new room when full
- Toggle for history on join (last N lines)
- Subtle join/leave system lines improvement
- Real command list extracted from Remart binary if found
- Private messages outside chat (separate interface)
- BBS-style login / user list

## 10. Open Questions for Prototype

1. End-of-line behavior when next line occupied — which option feels right?
2. Different terminal widths handling — enforce 80 chars?
3. History on join — faithful (none) or modern (last N)?
4. Unicode — ASCII-only in V1 or allow wide chars with alignment breaks?
5. Paste handling — rate limit threshold?

---

**Next step:** Review this spec, then create implementation plan via writing-plans skill.
