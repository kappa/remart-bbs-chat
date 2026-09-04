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

## Typing

- Every character appears the moment you type it — for you and for everyone
  else watching.
- Backspace visibly deletes characters for everyone too. At the very start of
  a line, Backspace does nothing.
- Your typing position is marked by a **blinking 2 px underline caret**,
  DOS-style. It is an underline, not a block.
- **Enter** commits your line exactly where it is. Your cursor moves to a
  fresh line below, ready for the next thought. Pressing Enter on an empty
  line commits an empty line — several in a row are fine.
- There is no line-length limit. Any language works, including Cyrillic.
- Pasting is capped at 100 characters; you are told when a paste is trimmed.
- Your line never moves once you start it. If you type the first character
  before someone else starts theirs, your line stays above theirs — even if
  you backspace the whole thing and retype it.

## Being idle

- If you are not typing, you take up **no space** in the transcript. Nobody
  sees an empty row held for you, and other people's lines are never pushed
  apart by idle participants.
- On your own screen only, a blinking caret sits below the transcript showing
  where your next line will begin. Other people cannot see it.
- The moment you type your first character, your line appears in the
  transcript for everyone.

## Commands

Typing exactly one character — `l`, `?`, or `q` — and pressing Enter runs a
command instead of sending chat:

- `l` — refresh the participant roster.
- `?` — show help.
- `q` — leave the room.

Anything longer than that single character is ordinary chat, even if it starts
with one of those letters.

## Roster and presence

- A pinned roster lists everyone in the room, each in their color. It fits
  roughly ten participants.
- When someone new joins, you hear a short two-tone chirp.
- If your connection drops in the middle of a line, your unsent text is kept,
  not thrown away.

## Scrollback and history

- You see everything written **since you joined**. Nothing from before you
  arrived is shown.
- Text you have already seen is never taken away, no matter how long the
  session runs.
- If you scroll up to read earlier lines, new messages will not yank you back
  down.

## On a phone

Everything above works the same. The only difference: a small hint telling
you where to tap to type appears on narrow screens; on desktop it stays out of
the way.
