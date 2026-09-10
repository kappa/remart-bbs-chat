# Handle autocomplete after `@`

Design for TODO task 25 (GitHub issue #13). Approved 2026-09-09.

Typing `@` in your live line opens a small list of the other participants'
handles next to your caret. Typing filters it, Up and Down choose, Tab or
Enter insert the rest of the handle, Escape closes it. Nothing new goes over
the wire: the completion is sent as ordinary `char` keystrokes.

Task 17 (mention highlighting and bell) is not designed here. It will reuse
the token rule from this spec for committed lines.

## Terminology

| Term | Meaning |
| --- | --- |
| Live line | The line you are typing, as echoed by the server, with the server-owned caret. |
| Mention token | A whitespace-delimited run of code points that begins with `@`. |
| Prefix | The code points of the mention token after the `@`, up to the caret. |
| Candidate | A roster participant, other than you, whose handle starts with the prefix. |
| Completion | The code points of the chosen handle after the prefix. |
| List | The floating box of candidates shown next to the caret. |

## Decisions settled during design

- **No trailing space.** Picking a handle sends only the completion. The user
  types the following space or punctuation.
- **Zero-remaining pick closes the list and sends nothing.** When the token
  already spells a handle in full (typed by hand, or `@Al` with both Al and
  Alice present), Tab or Enter closes the list. The next Enter commits as
  usual. Enter never means two things at once.
- **Floating box near the caret**, not a transcript row and not a strip in the
  roster footer.

## Rules

### Active token

Derived from the echoed own live text and caret; never from local keystrokes.

1. Take the run of non-whitespace code points that ends at the caret.
2. It is a mention token only if its first code point is `@` and the code
   point at the caret is whitespace or the end of the line.
3. The result is the code-point index of the `@` (the token start) and the
   prefix.

Examples with `|` as the caret: `hello @c|` and `@|` are tokens; `foo@c|`,
`@ca|rol`, and `@carol |` are not.

### Candidates

Roster participants in slot order, excluding yourself by participant id,
whose handle matches the prefix: compare the first N code points of the
handle with the prefix, both lowercased with `toLowerCase()`, where N is the
prefix's code-point length. An empty prefix matches everyone. Roster order is
preserved; there is no ranking.

### Completion

The handle's code points from index N on, joined. With N equal to the
handle's length the completion is empty.

### Open, closed, dismissed

The list is open when all of these hold:

- there is an active token,
- the token start is not the dismissed token start,
- at least one candidate matches.

The dismissed token start is the `@` index of the token that was closed by
Escape or by a pick. It clears as soon as the echoed live line has no active
token at that index. Backspacing to a shorter prefix keeps the same start and
so stays dismissed; deleting the `@` or committing the line clears it, and a
new `@` reopens the list. A pick marks the token dismissed so the completed
token does not reopen the list showing the handle just inserted.

### Highlight

The highlighted entry is remembered by participant id. If that participant is
no longer a candidate, the first candidate is highlighted. Up and Down move
with wrap-around.

### Keys while the list is open

| Key | Effect |
| --- | --- |
| Up, Down | Move the highlight, wrapping. |
| Tab | Pick the highlighted handle. Focus does not move. |
| Enter | Pick the highlighted handle. No `enter` keystroke is sent. |
| Escape | Dismiss the list for this token. |
| Tap or click on an entry | Pick that handle. Focus does not move. |
| Anything else | Ordinary meaning: characters, Backspace, Delete, caret moves. |

Pick sends the completion, one `char` keystroke per code point, through the
existing ordered stream, then marks the token dismissed. The server observes
the typed `@` and prefix followed by the completion, exactly as if the user
had typed it. With an empty completion nothing is sent.

While the list is closed every key keeps its current meaning. Escape stays a
no-op in chat, and the help dialog's own Escape handler is unchanged.

### Delayed echo

Everything derives from echoed state. Between a keystroke and its echo the
list reflects the previous text and caret. After a pick the token is
dismissed locally at once, so a second Enter pressed before the echo arrives
commits the line. This is the intended "Enter, Enter" flow: complete, then
send.

## Implementation

### `client/src/mentions.ts` (new, pure)

```ts
export type MentionToken = { start: number; prefix: string };
export function mentionTokenBefore(text: string, caret: number): MentionToken | null;
export function mentionCandidates(prefix: string, roster: RosterEntry[], ownParticipantId: number): RosterEntry[];
export function mentionCompletion(handle: string, prefix: string): string[];
```

No React, no DOM. Task 17 will add a function that finds every mention token
in a committed line using the same token definition.

### `client/src/App.tsx`

Two pieces of local state:

- `mentionSelection: number | null`, the highlighted participant id.
- `mentionDismissedAt: number | null`, the dismissed token start.

Everything else is derived on render from `ownParticipant.text`,
`ownParticipant.caret`, and `participants`. An effect clears
`mentionDismissedAt` when the derived token is absent or starts elsewhere.

One `pickMention()` function performs the pick. One `onEnter()` function
picks when the list is open and commits otherwise; both the document keydown
path (`handleChatKey`) and the mobile input path (`onKeyboardInput`, on
`insertLineBreak`) call it. `handleChatKey` checks the list state before its
ordinary mapping for Up, Down, Tab, Enter, and Escape.

The list renders inside the own live-line row, right after the caret span
(`.caret` at line end or `.caret-char` mid-line). If the row rendering grows
unwieldy, the box moves into a small `MentionList` component in its own file
with props for candidates, the highlighted id, and an `onPick` callback.

### Placement and appearance

- A zero-size `inline-block` anchor span follows the caret span. The box is
  `position: absolute` below the anchor. No caret measurement is needed for
  placement, and the box scrolls with the transcript because it lives inside
  the chat area.
- One layout effect measures the box against the chat area's right edge and
  shifts it left when it would be clipped. This is the only measurement.
- Styling in `theme.css`: black surface, 1px `#555` border, monospace, each
  candidate in its participant color, the highlighted entry with a leading
  `>` and a dim background, `z-index` above transcript rows, at most about
  eight visible rows with vertical scroll.
- Roles: the box is a `listbox`, entries are `option` with `aria-selected`.
- The box adds to the chat area's scroll height when your line is last. The
  existing near-bottom follow logic runs on document changes and keeps it in
  view for a viewer at the bottom. A viewer reading older text is never
  force-scrolled; nothing here changes that rule.

### Help dialog and docs

- One row in the help dialog: `@` — "type @ and a name; Up/Down choose, Tab
  or Enter insert, Escape closes".
- A bullet in the Typing section of `docs/USER_EXPERIENCE.md` describing the
  list, its keys, and that it never inserts a space.
- No change to `docs/PROTOCOL.md`.

## Tests

### Pure (`client/src/mentions.test.ts`)

- Token at line end, after whitespace, alone (`@`), mid-line with the caret
  followed by a space.
- No token for `foo@bar`, for a caret inside the token (`@ca|rol`), for a
  caret after a space (`@carol |`), and for an empty line.
- Case-insensitive matching, including Cyrillic handles and prefixes.
- Own handle excluded by participant id; roster order preserved; empty
  prefix returns everyone but yourself; no match returns an empty list.
- Completion code points, including a multi-code-point handle and the
  zero-remaining case.

### Component (`client/src/App.mentions.test.tsx`)

Using the shared fixtures with Alice as the own participant and Bob and Carol
(and a third candidate where needed) in the roster:

- Echo of `@` opens the list with Bob and Carol; echo of `@c` filters to
  Carol; echo of `@x` closes it.
- Down and Up wrap through the candidates; the highlight is marked.
- Tab sends exactly the completion keystrokes, in order, as `char` messages
  with consecutive sequence numbers, and the keyboard element keeps focus.
- Enter with the list open sends the completion and no `enter` keystroke;
  Enter with the list closed sends `enter`.
- With the token already complete, Enter sends nothing and closes the list;
  the next Enter sends `enter`.
- Escape closes the list; a later echo with a new `@` at another index
  reopens it; Backspace echo that shortens the same token keeps it closed.
- Backspace echo from `@x` to `@` reopens the list.
- A `roster` message adds a new candidate and removes a departed one.
- A keystroke with no echo yet leaves the list unchanged; the echo updates
  it.
- A click on an entry sends its completion.

### Browser check (`check-browser.mjs`)

Add a sequence with a third tab joined as Carol. Bob types `@c`, presses
Enter, and the check reads `@carol` in Bob's live line with no new committed
line. Bob presses Enter again and the committed line reads `@carol`.

## Out of scope

- Mention coloring and the bell (task 17).
- Ranking candidates by recency or fuzzy matching.
- Completing anything other than roster handles.
