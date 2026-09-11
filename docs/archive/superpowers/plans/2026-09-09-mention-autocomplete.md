# Handle Autocomplete After `@` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `@` in your live line opens a floating list of the other participants' handles next to the caret; typing filters it, Up/Down choose, Tab or Enter insert the rest of the handle as ordinary `char` keystrokes, Escape closes it.

**Architecture:** A pure module `client/src/mentions.ts` derives the active token from the server-echoed own live text and caret and filters the roster. `App.tsx` keeps two pieces of local state (highlighted participant id, dismissed token start), derives everything else on render, intercepts Up/Down/Tab/Enter/Escape while the list is open, and renders a small `MentionList` component anchored to the caret span. No wire change.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (client), Node test runner (server, untouched), headless Chrome browser check.

**Spec:** `docs/superpowers/specs/2026-09-09-mention-autocomplete-design.md`

## Global Constraints

- TODO task 25, GitHub issue #13. One task per branch; commit messages are plain sentences with no trailers, links, or tool names.
- Text renders only from server echo; the list derives from `ownParticipant.text` and `ownParticipant.caret`, never from local keystrokes.
- A pick sends only the completion code points as `char` keystrokes through the existing ordered stream. No new wire message. No trailing space.
- A zero-remaining pick sends nothing and closes the list.
- Keep the existing key handling for everything else; Escape stays a no-op in chat when the list is closed.
- Before claiming done run, from the repository root, and paste the results in the report:

  ```sh
  npm test
  npm --prefix client test
  npm --prefix client run typecheck
  npm --prefix client run build
  npm run check:browser
  ```

- Docs in the same commit as the code they describe: `docs/USER_EXPERIENCE.md` (Typing section), the help dialog in `App.tsx`, and the code map in `AGENTS.md`.

## Repository orientation

- `client/src/App.tsx`: one component. Key facts for this plan:
  - `ownParticipant` (around line 214) is your own `LiveLine` from `room.participants`, with server-echoed `text` and `caret`.
  - `participants` (line 213) is the roster in slot order, each entry a `LiveLine` which extends `RosterEntry` (`participantId`, `handle`, `color`, `slot`).
  - `handleChatKey` (around line 420) maps keydown events to keystrokes and returns `true` when it consumed the key. It is called from a document-level `keydown` listener installed by a `useEffect` with `[session]` deps (around line 258), which captures the `handleChatKey` closure from the render when the effect ran. Task 2 fixes that with a ref.
  - `onKeyboardInput` (around line 468) handles the hidden textarea's `input` events for phones; `insertLineBreak` means Enter.
  - `appendCharacter(char)` sends `{ kind: "char", char }`; `submitActiveLine()` sends `{ kind: "enter" }`.
  - The own live-line row (around line 675) renders the caret as `<span className="caret-char">` mid-line or `<span className="caret">` at the end.
- `client/src/testing/roomFixtures.tsx`: `renderJoined(snapshot)` renders the app with a stored session (Alice, participant 10) and answers the hello with the snapshot; `serverSend(ws, msg)` pushes a server message; `alice`, `bob` roster entries; `idle(entry)`, `typing(entry, row, text, caret)` build live lines. `ws.keys()` lists sent keystrokes.
- Tests run with `npm --prefix client test -- src/<file>`; the `--` passes the path to Vitest.

---

### Task 1: Pure mention helpers

**Files:**
- Create: `client/src/mentions.ts`
- Create: `client/src/mentions.test.ts`

**Interfaces:**
- Produces:
  - `type MentionToken = { start: number; prefix: string }`
  - `mentionTokenBefore(text: string, caret: number): MentionToken | null`
  - `mentionCandidates(prefix: string, roster: RosterEntry[], ownParticipantId: number): RosterEntry[]`
  - `mentionCompletion(handle: string, prefix: string): string[]`

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/mentions.test.ts
import { describe, it, expect } from 'vitest';
import { mentionTokenBefore, mentionCandidates, mentionCompletion } from './mentions';
import type { RosterEntry } from './protocol';

const alice: RosterEntry = { participantId: 10, handle: 'Alice', color: '#fff', slot: 0 };
const bob: RosterEntry = { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1 };
const carol: RosterEntry = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2 };
const zhenya: RosterEntry = { participantId: 40, handle: 'Женя', color: '#ff0', slot: 3 };
const roster = [alice, bob, carol, zhenya];

describe('mentionTokenBefore', () => {
  it('finds a token at the end of the line', () => {
    expect(mentionTokenBefore('hello @c', 8)).toEqual({ start: 6, prefix: 'c' });
  });
  it('finds a bare @', () => {
    expect(mentionTokenBefore('@', 1)).toEqual({ start: 0, prefix: '' });
  });
  it('finds a token mid-line when the caret is followed by a space', () => {
    expect(mentionTokenBefore('@ca rest', 3)).toEqual({ start: 0, prefix: 'ca' });
  });
  it('counts code points, not UTF-16 units', () => {
    expect(mentionTokenBefore('😀 @Же', 4)).toEqual({ start: 2, prefix: 'Же' });
  });
  it('rejects a token that does not start with @', () => {
    expect(mentionTokenBefore('foo@c', 5)).toBeNull();
  });
  it('rejects a caret inside the token', () => {
    expect(mentionTokenBefore('@carol', 3)).toBeNull();
  });
  it('rejects a caret after whitespace and an empty line', () => {
    expect(mentionTokenBefore('@carol ', 7)).toBeNull();
    expect(mentionTokenBefore('', 0)).toBeNull();
  });
});

describe('mentionCandidates', () => {
  it('matches by case-insensitive prefix and keeps roster order', () => {
    expect(mentionCandidates('c', roster, 10).map((e) => e.handle)).toEqual(['Carol']);
    expect(mentionCandidates('B', roster, 10).map((e) => e.handle)).toEqual(['Bob']);
  });
  it('matches Cyrillic case-insensitively', () => {
    expect(mentionCandidates('же', roster, 10).map((e) => e.handle)).toEqual(['Женя']);
  });
  it('excludes the own participant by id and returns everyone for an empty prefix', () => {
    expect(mentionCandidates('', roster, 10).map((e) => e.handle)).toEqual(['Bob', 'Carol', 'Женя']);
    expect(mentionCandidates('a', roster, 10)).toEqual([]);
  });
  it('returns nothing when no handle matches', () => {
    expect(mentionCandidates('x', roster, 10)).toEqual([]);
  });
});

describe('mentionCompletion', () => {
  it('returns the code points after the prefix', () => {
    expect(mentionCompletion('Carol', 'c')).toEqual(['a', 'r', 'o', 'l']);
    expect(mentionCompletion('Женя', 'же')).toEqual(['н', 'я']);
  });
  it('returns nothing when the prefix already spells the handle', () => {
    expect(mentionCompletion('Carol', 'carol')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix client test -- src/mentions.test.ts`
Expected: FAIL, the module `./mentions` cannot be resolved.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/mentions.ts
// Mention tokens for handle autocomplete. Everything here works on the
// server-echoed live text and caret; nothing predicts local keystrokes.
import type { RosterEntry } from './protocol';

export type MentionToken = { start: number; prefix: string };

const isWhitespace = (point: string) => /\s/u.test(point);
const lower = (text: string) => Array.from(text).map((point) => point.toLowerCase());

// The whitespace-delimited run of code points ending at the caret, when it
// starts with `@` and the caret sits at its end. `start` is the code-point
// index of the `@`; `prefix` is what follows it up to the caret.
export function mentionTokenBefore(text: string, caret: number): MentionToken | null {
  const points = Array.from(text);
  const at = Math.min(Math.max(caret, 0), points.length);
  if (at < points.length && !isWhitespace(points[at])) return null;
  let start = at;
  while (start > 0 && !isWhitespace(points[start - 1])) start--;
  if (start === at || points[start] !== '@') return null;
  return { start, prefix: points.slice(start + 1, at).join('') };
}

// Roster entries, in the given order, whose handle starts with the prefix
// comparing lowercased code points. The own participant is never offered.
export function mentionCandidates(prefix: string, roster: RosterEntry[], ownParticipantId: number): RosterEntry[] {
  const wanted = lower(prefix);
  return roster.filter((entry) => {
    if (entry.participantId === ownParticipantId) return false;
    const handle = lower(entry.handle);
    return handle.length >= wanted.length && wanted.every((point, index) => handle[index] === point);
  });
}

// The handle's code points after the prefix: what a pick sends as keystrokes.
export function mentionCompletion(handle: string, prefix: string): string[] {
  return Array.from(handle).slice(Array.from(prefix).length);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix client test -- src/mentions.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/mentions.ts client/src/mentions.test.ts
git commit -m "Add pure mention token helpers for handle autocomplete

The active token derives from echoed live text and caret, candidates come
from the roster in order by case-insensitive code-point prefix excluding
the own participant, and the completion is the handle's remaining code
points."
```

---

### Task 2: List state and key interception in App.tsx

This task adds the state, the derived values, and the key handling. The list is not rendered yet; tests observe what is sent over the socket and whether Enter commits.

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/App.mentions.test.tsx`

**Interfaces:**
- Consumes: `mentionTokenBefore`, `mentionCandidates`, `mentionCompletion` from Task 1.
- Produces (inside App, used by Task 3): `mentionOpen: boolean`, `mentionCandidatesList: RosterEntry[]`, `mentionHighlighted: RosterEntry | undefined`, `pickMention(entry?: RosterEntry): void`.

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/App.mentions.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, alice, bob, idle } from './testing/roomFixtures';
import type { RosterEntry } from './protocol';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const carol: RosterEntry = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2 };
const three = () => snapshot({ liveLines: [idle(alice), idle(bob), idle(carol)], roster: [alice, bob, carol] });

// The server echoes Alice's live line; the list follows the echo only.
const echo = (ws: any, text: string, seq = 1) =>
  serverSend(ws, { type: 'live', participantId: 10, row: 0, text, caret: Array.from(text).length, seq });

const sentKeys = (ws: any) => ws.keys().map((k: any) => [k.seq, k.kind, k.char ?? '']);

async function typingAt(text: string) {
  const user = userEvent.setup();
  const { ws } = await renderJoined(three());
  await screen.findByText('Carol');
  await user.click(await screen.findByLabelText('Shared chat area'));
  echo(ws, text);
  return { user, ws };
}

describe('Handle autocomplete keys', () => {
  it('Tab after an echoed @c sends only the completion keystrokes and keeps focus', async () => {
    const { user, ws } = await typingAt('@c');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'a'], [2, 'char', 'r'], [3, 'char', 'o'], [4, 'char', 'l']]);
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
  });

  it('Enter with the list open sends the completion and no enter keystroke', async () => {
    const { user, ws } = await typingAt('hi @b');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'o'], [2, 'char', 'b']]);
  });

  it('Enter with the list closed commits the line', async () => {
    const { user, ws } = await typingAt('hi @x');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
  });

  it('Enter on a token that already spells the handle sends nothing; the next Enter commits', async () => {
    const { user, ws } = await typingAt('@carol');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([]);
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
  });

  it('Escape dismisses the current token; Enter then commits; a new @ token is live again', async () => {
    const { user, ws } = await typingAt('@c');
    await user.keyboard('{Escape}');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
    echo(ws, '@c x @', 2);
    await user.keyboard('{Tab}');
    expect(sentKeys(ws).slice(1)).toEqual([[2, 'char', 'B'], [3, 'char', 'o'], [4, 'char', 'b']]);
  });

  it('Down wraps through the candidates and Up comes back', async () => {
    const { user, ws } = await typingAt('@');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'C'], [2, 'char', 'a'], [3, 'char', 'r'], [4, 'char', 'o'], [5, 'char', 'l']]);
  });

  it('Down twice wraps back to the first candidate', async () => {
    const { user, ws } = await typingAt('@');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'B'], [2, 'char', 'o'], [3, 'char', 'b']]);
  });

  it('Up from the first candidate wraps to the last', async () => {
    const { user, ws } = await typingAt('@');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)[0]).toEqual([1, 'char', 'C']);
  });

  it('a keystroke with no echo yet leaves the list unchanged until the echo arrives', async () => {
    const { user, ws } = await typingAt('@');
    await user.keyboard('c');
    // Still Bob first: the client has not seen "@c" yet.
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'c'], [2, 'char', 'B'], [3, 'char', 'o'], [4, 'char', 'b']]);
  });

  it('Backspace echo that restores a match reopens the list', async () => {
    // With "@x" nothing matches, so Enter commits. (Never press Tab with the
    // list closed in these tests: user-event would move focus to a sidebar
    // button and later keys would not reach the chat.)
    const { user, ws } = await typingAt('@x');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
    echo(ws, '@', 2);
    await user.keyboard('{Tab}');
    expect(sentKeys(ws).slice(1)).toEqual([[2, 'char', 'B'], [3, 'char', 'o'], [4, 'char', 'b']]);
  });

  it('a roster change updates the candidates', async () => {
    const { user, ws } = await typingAt('@c');
    serverSend(ws, { type: 'roster', roster: [alice, bob] });
    // Carol is gone, so no candidate matches "c" and Enter commits.
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
  });

  it('a phone Enter (insertLineBreak) picks when the list is open', async () => {
    const { ws } = await typingAt('@c');
    const textarea = document.querySelector('.keyboard-capture') as HTMLTextAreaElement;
    textarea.focus();
    const event = new InputEvent('input', { inputType: 'insertLineBreak', bubbles: true });
    textarea.dispatchEvent(event);
    expect(sentKeys(ws)).toEqual([[1, 'char', 'a'], [2, 'char', 'r'], [3, 'char', 'o'], [4, 'char', 'l']]);
  });
});
```

Note on the Escape test: after `@c` is dismissed, the echo `@c x @` puts a new token at index 5, so the list reopens with all candidates and Tab picks Bob.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix client test -- src/App.mentions.test.tsx`
Expected: FAIL. The Tab test sends nothing and the "Enter with the list open" test sends an `enter` keystroke.

- [ ] **Step 3: Add the state, derived values, and handlers to App.tsx**

Add the import near the other local imports at the top of `client/src/App.tsx`:

```ts
import { mentionCandidates, mentionCompletion, mentionTokenBefore } from "./mentions";
import type { RosterEntry } from "./protocol";
```

Add two state hooks next to the other `useState` calls (after `const [soundOn, ...]`):

```ts
  // Handle autocomplete: the highlighted candidate and the `@` index of the
  // token the user dismissed. Everything else derives from the echoed line.
  const [mentionSelection, setMentionSelection] = useState<number | null>(null);
  const [mentionDismissedAt, setMentionDismissedAt] = useState<number | null>(null);
  const handleChatKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
```

Right after the line `const ownParticipant = participants.find(...)` add the derived values and the dismissal-clearing effect:

```ts
  const mentionToken = ownParticipant ? mentionTokenBefore(ownParticipant.text, ownParticipant.caret) : null;
  const mentionCandidatesList: RosterEntry[] =
    mentionToken && session && mentionDismissedAt !== mentionToken.start
      ? mentionCandidates(mentionToken.prefix, participants, session.participantId)
      : [];
  const mentionOpen = mentionCandidatesList.length > 0;
  const mentionIndex = Math.max(0, mentionCandidatesList.findIndex((p) => p.participantId === mentionSelection));
  const mentionHighlighted: RosterEntry | undefined = mentionCandidatesList[mentionIndex];
  const mentionStart = mentionToken?.start;

  // Dismissal is per token: it clears as soon as the echoed line has no token
  // at that index, so a new `@` opens the list again.
  useEffect(() => {
    if (mentionDismissedAt != null && mentionStart !== mentionDismissedAt) setMentionDismissedAt(null);
  }, [mentionStart, mentionDismissedAt]);
```

Change the document-level key effect (the one whose comment starts "Keys are handled at the document level") so it calls the latest handler through the ref instead of the closure captured at effect time:

```ts
      if (handleChatKeyRef.current(event)) focusKeyboard();
```

After the `submitActiveLine` definition add the list actions and the single Enter entry point:

```ts
  const moveMention = (delta: number) => {
    const count = mentionCandidatesList.length;
    if (!count) return;
    setMentionSelection(mentionCandidatesList[(mentionIndex + delta + count) % count].participantId);
  };
  // A pick sends only the handle's remaining code points, so the server sees
  // the typed `@` and prefix followed by the completion, then dismisses the
  // token so the completed handle does not reopen the list.
  const pickMention = (entry?: RosterEntry) => {
    const chosen = entry ?? mentionHighlighted;
    if (!mentionToken || !chosen) return;
    for (const char of mentionCompletion(chosen.handle, mentionToken.prefix)) appendCharacter(char);
    setMentionDismissedAt(mentionToken.start);
  };
  const dismissMention = () => { if (mentionToken) setMentionDismissedAt(mentionToken.start); };
  // Enter picks while the list is open and commits otherwise; both the
  // keydown path and the phone input path come through here.
  const onEnter = () => { if (mentionOpen) pickMention(); else submitActiveLine(); };
```

In `handleChatKey`, after the `if (event.ctrlKey || event.altKey) { ... }` block and before `if (event.key === "Backspace")`, insert:

```ts
    if (mentionOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveMention(event.key === "ArrowDown" ? 1 : -1);
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        pickMention();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissMention();
        return true;
      }
    }
```

Change the existing Enter branch in `handleChatKey` from `submitActiveLine();` to `onEnter();`.

Right after the closing of `handleChatKey` add:

```ts
  handleChatKeyRef.current = handleChatKey;
```

In `onKeyboardInput`, change the `insertLineBreak` branch from `submitActiveLine();` to `onEnter();`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix client test -- src/App.mentions.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole client suite and the type check**

Run: `npm --prefix client test && npm --prefix client run typecheck`
Expected: PASS. If a test about Enter or Tab elsewhere changed behavior, the list was open unexpectedly; check that the fixture's live text has no `@` token.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/App.mentions.test.tsx
git commit -m "Intercept Up, Down, Tab, Enter, and Escape while a handle list is open

The list state derives from the echoed live line and roster. A pick sends
the handle's remaining code points as char keystrokes and dismisses the
token; Enter commits only when no list is open. The document-level key
listener now reads the latest handler through a ref so list state is never
stale."
```

---

### Task 3: Render the floating list next to the caret

**Files:**
- Create: `client/src/MentionList.tsx`
- Modify: `client/src/App.tsx` (own live-line row)
- Modify: `client/src/theme.css`
- Modify: `client/src/App.mentions.test.tsx`

**Interfaces:**
- Consumes: `mentionOpen`, `mentionCandidatesList`, `mentionHighlighted`, `pickMention` from Task 2; `chatRef` (the chat area element ref).
- Produces: `MentionList` component with props `{ candidates: RosterEntry[]; highlightedId: number; onPick: (entry: RosterEntry) => void; container: HTMLElement | null }`.

- [ ] **Step 1: Add the failing rendering tests**

Append to `client/src/App.mentions.test.tsx` inside a new `describe`:

```tsx
describe('Handle autocomplete list', () => {
  it('opens on an echoed @ with the other participants in roster order and highlights the first', async () => {
    const { ws } = await typingAt('@');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['> Bob', '  Carol']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveStyle({ color: '#f0f' });
    echo(ws, '@c', 2);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['> Carol']);
    echo(ws, '@x', 3);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the list sits inside the own live line after the caret', async () => {
    await typingAt('@');
    const listbox = await screen.findByRole('listbox');
    expect(listbox.closest('.live-line')).not.toBeNull();
    expect(listbox.parentElement).toHaveClass('mention-anchor');
  });

  it('Down moves the highlight', async () => {
    const { user } = await typingAt('@');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}');
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['  Bob', '> Carol']);
  });

  it('clicking an entry picks it and keeps keyboard focus', async () => {
    const { user, ws } = await typingAt('@');
    await user.click(await screen.findByRole('option', { name: /Carol/ }));
    expect(sentKeys(ws)).toEqual([[1, 'char', 'C'], [2, 'char', 'a'], [3, 'char', 'r'], [4, 'char', 'o'], [5, 'char', 'l']]);
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
  });

  it('is absent for another participant\'s live line', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, { type: 'live', participantId: 20, row: 0, text: '@', caret: 1, seq: 1 });
    await screen.findByText('@');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix client test -- src/App.mentions.test.tsx`
Expected: FAIL, no element with role `listbox` or `option`.

- [ ] **Step 3: Create the component**

```tsx
// client/src/MentionList.tsx
import { useLayoutEffect, useRef } from "react";
import type { RosterEntry } from "./protocol";

type Props = {
  candidates: RosterEntry[];
  highlightedId: number;
  onPick: (entry: RosterEntry) => void;
  container: HTMLElement | null;
};

// The floating handle list. It hangs off a zero-size inline-block anchor
// placed right after the caret, so no caret measurement is needed for
// placement. The only measurement keeps the box inside the chat area's
// right edge. Spans are used throughout because the anchor sits inside
// an inline run.
export function MentionList({ candidates, highlightedId, onPick, container }: Props) {
  const boxRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !container) return;
    box.style.left = "0px";
    const overflow = box.getBoundingClientRect().right - container.getBoundingClientRect().right + 8;
    if (overflow > 0) box.style.left = `${-overflow}px`;
  });

  return (
    <span className="mention-anchor">
      <span ref={boxRef} className="mention-list" role="listbox" aria-label="Handle suggestions">
        {candidates.map((entry) => {
          const highlighted = entry.participantId === highlightedId;
          return (
            <span
              key={entry.participantId}
              role="option"
              aria-selected={highlighted}
              className={`mention-option${highlighted ? " highlighted" : ""}`}
              style={{ color: entry.color }}
              // mousedown, not click, so the keyboard textarea never loses focus.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(entry);
              }}
            >
              {highlighted ? "> " : "  "}
              {entry.handle}
            </span>
          );
        })}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Render it in the own live-line row**

In `client/src/App.tsx` import the component:

```ts
import { MentionList } from "./MentionList";
```

In the live-row branch of the `documentLines.map(...)`, right after `const caret = Math.min(participant.caret, codePoints.length);`, add:

```tsx
          const mentionList =
            isOwnLine && mentionOpen && mentionHighlighted ? (
              <MentionList
                candidates={mentionCandidatesList}
                highlightedId={mentionHighlighted.participantId}
                onPick={pickMention}
                container={chatRef.current}
              />
            ) : null;
```

Then place `{mentionList}` immediately after the caret in both branches, so the JSX becomes:

```tsx
              {isOwnLine && caret < codePoints.length ? (
                <>
                  {codePoints.slice(0, caret).join("")}
                  <span className="caret-char" aria-label="Your typing position">{codePoints[caret]}</span>
                  {mentionList}
                  {codePoints.slice(caret + 1).join("")}
                </>
              ) : (
                <>
                  {participant.text}
                  {isOwnLine ? (
                    <span className="caret" aria-label="Your typing position"> </span>
                  ) : null}
                  {mentionList}
                </>
              )}
```

- [ ] **Step 5: Style it**

Append to `client/src/theme.css` after the `.caret-char` rules:

```css
.mention-anchor { position:relative; display:inline-block; width:0; height:0; overflow:visible; vertical-align:baseline; }
.mention-list { position:absolute; top:0.45em; left:0; z-index:5; display:block; min-width:8ch; max-height:12.4em; overflow-y:auto; border:1px solid #555; background:#000; white-space:pre; font-family:var(--mono); line-height:1.55em; }
.mention-option { display:block; padding:0 0.5ch; cursor:pointer; }
.mention-option.highlighted { background:#222; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix client test -- src/App.mentions.test.tsx`
Expected: PASS, 17 tests.

- [ ] **Step 7: Run the full client suite, type check, and build**

Run: `npm --prefix client test && npm --prefix client run typecheck && npm --prefix client run build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/MentionList.tsx client/src/App.tsx client/src/theme.css client/src/App.mentions.test.tsx
git commit -m "Render the handle list next to the caret

A zero-size inline anchor after the caret carries an absolutely positioned
listbox, so placement needs no caret measurement; one layout effect keeps
the box inside the chat area's right edge. Entries pick on mousedown so
the keyboard textarea keeps focus."
```

---

### Task 4: Help dialog, user docs, code map, and the browser check

**Files:**
- Modify: `client/src/App.tsx` (help dialog list)
- Modify: `docs/USER_EXPERIENCE.md` (Typing section)
- Modify: `AGENTS.md` (Code map)
- Modify: `check-browser.mjs`
- Modify: `client/src/App.roster.test.tsx` (help dialog test) or `App.mentions.test.tsx`

- [ ] **Step 1: Write the failing help-dialog test**

Append to `client/src/App.mentions.test.tsx`:

```tsx
describe('Help dialog', () => {
  it('lists the @ autocomplete keys', async () => {
    const user = userEvent.setup();
    await renderJoined();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByText('@')).toBeInTheDocument();
    expect(screen.getByText(/Up\/Down choose, Tab or Enter insert, Escape closes/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix client test -- src/App.mentions.test.tsx`
Expected: FAIL, no element with text `@`.

- [ ] **Step 3: Add the help row**

In the help dialog `<dl className="help-list">` in `client/src/App.tsx`, after the Backspace row, add:

```tsx
              <div><dt>@</dt><dd>type @ and a name to pick a handle: Up/Down choose, Tab or Enter insert, Escape closes</dd></div>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --prefix client test -- src/App.mentions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Document the behavior**

In `docs/USER_EXPERIENCE.md`, in the Typing section after the Enter bullet, add:

```markdown
- Typing `@` opens a small list of the other people in the room next to your
  caret. Keep typing to narrow it by the start of a name (case does not
  matter), Up and Down move through it, Tab or Enter insert the rest of the
  name, Escape closes it for that `@`. The list never adds a space; type your
  own. If nothing matches the list disappears, and Backspace can bring it
  back. If you have already typed a full name, Enter just closes the list and
  the next Enter sends the line. `@` followed by something that is not a
  name is ordinary text.
```

In `AGENTS.md`, in the Code map after the `client/src/documentLines.ts` line, add:

```markdown
- `client/src/mentions.ts`: pure mention token, candidate, and completion
  helpers for handle autocomplete.
- `client/src/MentionList.tsx`: the floating handle list rendered next to
  the caret.
```

- [ ] **Step 6: Extend the browser check**

In `check-browser.mjs`:

1. In the `tab` helper, add a `close` method beside `goto`:

   ```js
      close: () => cdp.send('Target.closeTarget', { targetId }),
   ```

2. Add a Tab key constant next to `ESCAPE`:

   ```js
   const TAB = { windowsVirtualKeyCode: 9, code: 'Tab' };
   ```

3. After the `'"l" Enter shows "Roster refreshed"'` check and before the reload section, insert:

   ```js
     // Task 25: handle autocomplete. Carol joins so Bob has two candidates;
     // "@c" filters to Carol, Enter completes without committing, Enter commits.
     const carol1 = await tab('Carol');
     check('Carol joins room 1', await carol1.waitFor(inRoom));
     check('Bob sees Carol in the roster', await bob.waitFor(`${text('.roster-handle')}.includes('Carol')`));
     await bob.focus(); await bob.type('@');
     check('Bob "@": the handle list opens with Alice and Carol',
       await bob.waitFor(`${text('[role="option"]')}.join('|') === '> Alice|  Carol'`), JSON.stringify(await bob.eval(text('[role="option"]'))));
     await bob.type('c');
     check('Bob "@c": the list narrows to Carol', await bob.waitFor(`${text('[role="option"]')}.join('|') === '> Carol'`));
     await bob.key('Enter', ENTER);
     check('Enter completes "@carol" in Bob\'s live line without committing',
       await bob.waitFor(`${text('.live-line')}.includes('@carol')`) && !(await bob.eval(`${text('.committed-line')}.some((l) => l.includes('@carol'))`)),
       JSON.stringify(await bob.eval(text('.live-line'))));
     check('the list is closed after the pick', await bob.waitFor(`!document.querySelector('[role="listbox"]')`));
     await bob.key('Enter', ENTER);
     check('a second Enter commits "@carol" in both tabs',
       await bob.waitFor(`${text('.committed-line')}.includes('@carol')`) && await alice.waitFor(`${text('.committed-line')}.includes('@carol')`));
     await bob.key('Tab', TAB);
     await carol1.close();
   ```

   The `TAB` press at the end is harmless (no list is open) and keeps the constant used; drop it if you prefer, together with the constant.

- [ ] **Step 7: Build and run the browser check**

Run: `npm --prefix client run build && npm run check:browser`
Expected: every line prints PASS, including the six new checks. If `google-chrome` is missing, say so in the report; do not skip silently.

- [ ] **Step 8: Run everything**

Run:

```sh
npm test
npm --prefix client test
npm --prefix client run typecheck
npm --prefix client run build
npm run check:browser
```

Expected: all PASS. Paste the results in the report.

- [ ] **Step 9: Commit**

```bash
git add client/src/App.tsx client/src/App.mentions.test.tsx docs/USER_EXPERIENCE.md AGENTS.md check-browser.mjs
git commit -m "Document handle autocomplete and check it in the browser

The help dialog and the user experience doc describe the @ list and its
keys, the code map names the new modules, and the browser check completes
@c to @carol with a third tab present."
```

---

### Task 5: Close out

- [ ] **Step 1: Mark the task done**

In `TODO.md`, change task 25's checkbox to `- [x] **Requested feature** (done: ...)` with a one-line summary of what landed, and remove its row from the "Recommended implementation order" table, adding 25 to the done list above it.

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "Mark task 25 complete"
```

- [ ] **Step 3: After merge**

Close GitHub issue #13 with a one-line comment naming the merge commit.
