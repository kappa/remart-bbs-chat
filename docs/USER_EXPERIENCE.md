# Remart BBS Chat — User Experience

This document describes what using Remart BBS Chat is like. It treats the
system as a black box: what you see, what you can do, and what you can rely
on. How any of it is implemented is deliberately out of scope.

## What it is

A shared chat room styled like a DOS terminal. Everyone's words appear
**character by character, as they type** — you watch sentences being written,
including the backspaces. Each participant gets their own color; there are no
name prefixes on ordinary lines because the color tells you who is who.

## Joining

- Opening the app shows a lobby of rooms. Join an existing room or create a
  new one. Rooms are ephemeral: they exist while people are in them.
- You pick a display name the first time. It is remembered, so on later visits
  you go straight in.
- Opening the app in a second tab with `?name=Alice` in the URL joins that tab
  as Alice without touching your remembered default name.
- Two people cannot use the same name in a room (case-insensitive). There is no
  way to take someone's name while they hold it.
- You are in one room at a time.
- Reloading the page keeps you in the room as the same person, with your
  unfinished line intact, and nobody sees you leave and rejoin. Only
  explicit Leave and the `q` command depart at once; closing the tab
  without leaving holds your name for up to about a minute.

## The shared transcript

- There is exactly one transcript, shared by everyone, in the same order for
  everyone.
- It holds two kinds of rows: **committed lines** (finished with Enter) and
  **live lines** (someone is typing on them right now).
- A live line belongs to the person typing it and renders in their color.
- Committed lines keep their author's color forever, even after that person
  leaves.
- People joining or leaving appear as announcement lines in that person's
  color.
- Transcript text can be selected with the mouse and copied (Ctrl+C /
  Cmd+C). A plain click still puts the keyboard focus back on the chat
  input, and typing after a selection works without clicking again.
- Addresses starting with `http://` or `https://` in finished lines are
  links that open in a new tab. Half-typed addresses stay plain text
  until their line is committed.

## Typing

- Every character appears as soon as the server has it, for you and for
  everyone else at the same moment. On a normal connection that is
  immediate; on a slow one your own text lags by the round trip, but what
  you see is always what everyone sees.
- Backspace visibly deletes characters for everyone too. At the very start of
  a line, Backspace does nothing. One character means one code point: an emoji
  or a Cyrillic letter is a single character to delete, while a combining mark
  is its own character and takes its own Backspace.
- Your typing position is marked by a **blinking 2 px underline caret**,
  DOS-style. Only the underline blinks; the character above it stays visible.
  It is an underline, not a block. The arrow keys move it, Home
  and End jump to the ends of your line, Ctrl+Left and Ctrl+Right (Alt+Arrow
  on macOS) move by word, and Delete removes the character in front of it.
  Typing inserts where the caret is, so a typo early in a long line no longer
  means deleting everything after it. Everyone always sees your text; only
  you see where your caret is.
- **Enter** commits your line exactly where it is. Your cursor moves to a
  fresh line below, ready for the next thought. Pressing Enter on an empty
  line commits an empty line — several in a row are fine.
- Typing `@` opens a small list of the other people in the room next to your
  caret. Keep typing to narrow it by the start of a name (case does not
  matter), Up and Down move through it, Tab or Enter insert the rest of the
  name, Escape closes it for that `@`. The list never adds a space; type your
  own. If nothing matches the list disappears, and Backspace can bring it
  back. If you have already typed a full name, Enter just closes the list and
  the next Enter sends the line. Tab or Enter pressed while your last
  keystrokes are still on their way waits for them to land, then completes
  what you actually typed, or sends the line if no name is being typed any
  more. `@` followed by something that is not a
  name is ordinary text.
- There is no line-length limit. Any language works, including Cyrillic.
- Long lines wrap to the available transcript width and reflow when the window
  is resized. Wrapping is visual only; it does not insert line breaks into text.
- Pasting is capped at 100 characters; you are told when a paste is trimmed.
- Your line never moves once you start it. If you type the first character
  before someone else starts theirs, your line stays above theirs.

## Being idle

- If you are not typing, you take up **no space** in the transcript. Nobody
  sees an empty row held for you, and other people's lines are never pushed
  apart by idle participants.
- On your own screen only, a blinking caret sits below the transcript showing
  where your next line will begin. Other people cannot see it.
- The moment you type your first character, your line appears in the
  transcript for everyone.

## Commands

Typing exactly one character — `?` or `q` — and pressing Enter runs a
command instead of sending chat:

- `?` — show help.
- `q` — leave the room.

A line containing only `l` is ordinary chat. Anything longer than that single
character is ordinary chat, even if it starts
with one of those letters. A Help button in the sidebar opens the same help
as `?`, and a Leave button leaves the room like `q`. The roster updates
automatically; no command refreshes it.

## Roster and presence

- A pinned roster lists everyone in the room, each in their color. It fits
  roughly ten participants. A Report a problem link at its foot opens the
  issue form in a new tab.
- When someone's tab is in the background, a small dim `afk` appears beside
  their name in the roster, and disappears when their tab is visible again.
  Nothing else changes: they keep their color, their unfinished line, and
  their place, and nobody is told they left or joined.
- When someone new joins, you hear a short two-tone chirp, and the
  browser-tab title rotates their name as `<handle> joined` (with a
  separating space so the end never glues to the start) for five
  seconds before returning to normal. A Join sound checkbox in the
  sidebar turns the chirp off; the choice is remembered in that browser.
  Browsers only allow sound after you have clicked or typed in the page,
  so a tab you have just opened or reloaded stays silent until your first
  keystroke or click; the title still rotates.
- If your connection drops in the middle of a line, your unsent text is kept,
  not thrown away.
- A status line reads "Connecting..." or "Reconnecting..." while the room is
  not live. You can keep typing during a short reconnect; your keystrokes are
  delivered when it returns. If the outage is long, input pauses with a notice
  until the connection is back; if something was lost, you are told.

## Scrollback and history

- When you join you see the **last 20 lines** written before you arrived, in
  their original colors, and then everything written **since you joined**.
  A line finished after you arrive stays visible even if typing started earlier.
- Text you have already seen is never taken away, no matter how long the
  session runs.
- If you scroll up to read earlier lines, new messages will not yank you back
  down.

## On a phone

Everything above works the same. The only difference: a small hint telling
you where to tap to type appears on narrow screens; on desktop it stays out of
the way.

When the on-screen keyboard opens, the session layout follows the visual
viewport, including when you join with the keyboard already open: the caret row and the newest lines stay above the keyboard instead
of hiding behind it, and closing the keyboard restores the layout. A reader
who has scrolled up is never pulled back down by this.
