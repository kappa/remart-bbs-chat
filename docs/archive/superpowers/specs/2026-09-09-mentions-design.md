# Mention highlighting, bell, and a notification library

Design for TODO task 17 (GitHub issue #6). Approved 2026-09-09.

Every `@handle` in a committed line that names a current roster member is
rendered in that member's color, for everyone. When a newly committed line by
someone else mentions you, your client plays a short bell and rotates the tab
title, through a small notification library that also carries the existing
join chirp and join title notice. Client-side only; no wire change.

Task 25 (handle autocomplete) introduces `client/src/mentions.ts` and its
token rule; this design extends that module. Execute task 25 first.

## Terminology

| Term | Meaning |
| --- | --- |
| Mention token | `@` followed by a run of non-whitespace code points, where the `@` starts the text or follows whitespace. Trailing punctuation is stripped before matching. |
| Mention | A mention token whose stripped text equals a current roster handle, case-insensitively. |
| Notification | A typed event (`join` or `mention`) handed to the notifier. |
| Channel | One way of showing a notification: the tab title, a sound, later a browser notification. |
| Notifier | Fans one notification out to every channel; `stop()` silences them all. |

## Decisions settled during design

- **One sound switch**, relabelled "Sounds", covering the chirp and the bell.
  The storage key `remart-bbs-chat.sound` is unchanged so a saved choice
  carries over.
- **The tab title rotates for mentions** as it does for joins: "Alice
  mentioned you ".
- **A notification library** (`notifications.ts`) owns title and sound, so a
  browser Notifications API channel can be added later without touching
  App.
- **Committed lines only.** Live lines are not colored and never ring.
- **Equality, not prefix.** `@Al` with Alice present is plain text.
- **Trailing punctuation** from the set `.,;:!?)]}` is stripped before
  matching and stays plain, like the link splitter does for URLs.

## Mention rule (`client/src/mentions.ts`)

Two helpers join the token functions from task 25:

```ts
export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; participantId: number; color: string };
export function splitMentions(text: string, roster: RosterEntry[]): MentionSegment[];
export function mentionsHandle(text: string, handle: string): boolean;
```

- A candidate token is `@` plus the following non-whitespace code points,
  with the `@` at the start of the text or preceded by whitespace.
  `foo@bar` and `name@example.com` are not candidates.
- Trailing punctuation in `.,;:!?)]}` is removed from the token before
  matching and emitted as text.
- The remaining text after `@` matches a roster handle by lowercased
  code-point equality. The first roster entry that matches wins; handles
  are unique case-insensitively so there is at most one.
- Adjacent text segments are merged, as the link splitter does.
- `mentionsHandle` applies the same tokenizer and compares against one
  handle; it is what the bell rule uses.

## Rendering (`App.tsx`)

- Committed lines run `splitLinks` first, then each text segment through
  `splitMentions` with the current roster. A URL containing `@` therefore
  stays a link.
- A mention segment renders as `<span class="mention" data-handle="Alice"
  style="color: <participant color>">@Alice</span>`. The rest of the line
  keeps the author's color.
- Announcement lines (`* ... joined`) go through the same path; nothing in
  them matches.
- Color comes from the roster at render time, so a mention of someone who
  leaves turns plain, and returns to color if they rejoin with the same
  handle.
- Live lines are rendered as today.

## Notification library (`client/src/notifications.ts`, new)

```ts
export type Notification =
  | { kind: 'join'; handle: string }
  | { kind: 'mention'; handle: string; text: string };
export type NotificationChannel = { notify: (n: Notification) => void; stop: () => void };
export function createNotifier(channels: NotificationChannel[]): { notify: (n: Notification) => void; stop: () => void };
export function titleChannel(doc: Document, baseTitle: string): NotificationChannel;
export function soundChannel(isOn: () => boolean): NotificationChannel;
```

### Title channel

The current rotating title moved out of App.tsx with its behavior intact:

- Text is `"<handle> joined "` for a join and `"<handle> mentioned you "` for
  a mention. The trailing space keeps the end from gluing to the start.
- Rotation is by code point on the existing tick, and the notice ends after
  the existing five seconds, restoring the base title.
- A new notification replaces a running notice cleanly.
- `stop()` clears the timers and restores the base title.
- It runs regardless of the sound switch.

### Sound channel

- `join` plays the existing two-tone square-wave chirp, moved from App.tsx
  unchanged.
- `mention` plays a bell: one sine tone around 1.5 kHz with a fast attack
  and a slow exponential decay over about half a second. It is clearly
  different from the two rising chirp tones.
- `isOn()` is checked at notify time. When false nothing is played.
- Failures (blocked or missing audio) are swallowed as today; the title
  channel is unaffected because channels are independent.
- `stop()` is a no-op.

### Notifier

`notify` calls every channel in order. `stop` calls every channel's `stop`.
App creates one notifier per session with the title and sound channels,
calls `notify` from its event handlers, and calls `stop` on session end and
on unmount. A future browser-notification channel is a third entry in the
array.

## Bell rule

The connection hook gains one event:

```ts
onNewCommittedLine: (line: CommittedLine) => void;
```

It fires for a `committed` message whose line id is not yet in the reducer's
map and whose `participantId` is not the own participant id. Snapshot lines
never pass through it, so reconnects are silent, and a duplicate broadcast of
the same id cannot fire twice. Lines preserved by the leave path
(`participantId: null`) do fire; they are new lines by someone else.

App's handler notifies `{ kind: 'mention', handle: line.handle, text:
line.text }` when `mentionsHandle(line.text, session.handle)` is true.

The join path is unchanged except that it calls `notify({ kind: 'join',
handle })` instead of the chirp and title functions directly.

## Sound switch

The checkbox label becomes "Sounds". The storage key and the on-by-default
rule stay. The help dialog does not mention sounds.

## Docs

- `docs/USER_EXPERIENCE.md`: a Typing bullet saying `@handle` of someone in
  the room is shown in their color once the line is committed; in Roster
  and presence, describe the mention bell, the "mentioned you" title
  rotation, and the renamed Sounds switch covering both sounds.
- `AGENTS.md`, Behavior to preserve: one line saying mentions are detected
  at render time on the client from the current roster, and the bell and
  title notice fire only for a first-seen committed line by someone else.
- No change to `docs/PROTOCOL.md`.

## Tests

### Pure (`mentions.test.ts`)

- Tokens at the start, after a space, before a comma, with `?` and `)`
  stripped; the punctuation is emitted as text.
- `foo@bar` and `name@example.com` do not match.
- `@alice` and `@ALICE` match Alice; a Cyrillic handle matches
  case-insensitively.
- `@Al` with Alice present does not match; `@Alicee` does not match.
- A handle not in the roster stays text.
- Two mentions in one line produce two segments with the right colors.
- `mentionsHandle` for the same cases.

### Notifications (`notifications.test.ts`)

- Title channel: a join rotates "Bob joined " and restores the base title
  after the notice time; a mention rotates "Bob mentioned you "; a second
  notification replaces the first; `stop()` restores the title at once.
  Uses fake timers and a plain object standing in for `document`.
- Sound channel: a join creates two oscillators, a mention creates one with
  a different type and frequency; nothing is created when `isOn()` is
  false; a throwing AudioContext does not throw out.
- Notifier: `notify` reaches every channel in order; `stop` reaches every
  channel.

### Component

- Rendering (`App.rendering.test.tsx`): "hi @Alice" from Bob renders the
  mention span in Alice's color with the rest in Bob's color; `@alice`
  matches; a mention of a departed handle is plain; "see
  https://example.com/@alice" keeps the link and colors nothing; "@Alice,"
  colors the handle and leaves the comma plain.
- Notifications (`App.roster.test.tsx` or a new `App.mentions.test.tsx`),
  with `notifications.ts` mocked: a new committed line mentioning Alice
  notifies a mention exactly once with Bob's handle; the same line id
  arriving again does not; a line mentioning Bob does not; Alice's own line
  mentioning herself does not; a snapshot carrying a mentioning line does
  not; a newcomer still notifies a join; the notifier's `stop` is called on
  leave.
- The checkbox reads "Sounds"; a stored "off" makes the sound channel's
  `isOn()` return false.

### Browser check (`check-browser.mjs`)

Bob types "hi @Alice" and presses Enter. Alice's tab shows a `.mention`
span with Alice's color inside the committed line, and her title contains
"mentioned you" within a second. Bob's title stays the base title.

## Out of scope

- Browser Notifications API (a later channel).
- Coloring mentions in live lines.
- Mentions of handles not in the roster, or fuzzy matching.
- A separate switch for the bell.
