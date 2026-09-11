# Private Messages From the Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a name in the roster, type one line in an input that opens under that name, press Enter; the recipient sees an ephemeral popup outside the chat area, the sender sees "sent to Bob" or "Bob is not reachable". Nothing is stored, replayed, or rendered in the transcript.

**Architecture:** A `private` client message after `hello` is validated on the server and forwarded to the recipient's socket only, with a `private-sent` result or an `unknown-recipient` error back to the sender. On the client the connection gains `sendPrivate`, the room hook forwards the three messages as events (never through the reducer), and App keeps the input target, its text, and a list of received messages rendered by a `PrivateMessages` overlay pinned over the chat area.

**Tech Stack:** Node.js ES-module Express + `ws` server tested with the Node test runner; React 19 / TypeScript client tested with Vitest and Testing Library; headless Chrome browser check.

**Spec:** `docs/superpowers/specs/2026-09-09-private-messages-design.md`

## Global Constraints

- TODO task 18, GitHub issue #7. One task per branch; commit messages are plain sentences with no trailers, links, or tool names.
- Prerequisite: task 31 (AFK presence) has landed, so the server's post-hello handler is a `switch` on message type and `RosterEntry` carries `afk`. If it has not, add the `switch` exactly as described in Task 1 Step 3 here and drop `afk: false` from the fixtures below.
- Wire: client `{ type: "private", to: number, text: string }`; to the recipient `{ type: "private", from, handle, color, text }`; to the sender `{ type: "private-sent", to, handle }` or `{ type: "error", code: "unknown-recipient", to }`. Bad shape or text is the existing `invalid-message`.
- Text is trimmed at both ends; 1 to 200 code points; every code point passes `isValidChar`. Cap value: `200`.
- Unreachable means: not in the sender's room, the sender themself, or no open socket. All get `unknown-recipient`.
- Nothing is stored; snapshots and reconnects never carry private messages; sequence numbers are untouched.
- The recipient's popup lives in a fixed overlay outside `#chat-area`, rendered from its own state, never from the reducer or the document rows. Popup timeout: `15000` ms.
- Before claiming done run, from the repository root, and paste the results in the report:

  ```sh
  npm test
  npm --prefix client test
  npm --prefix client run typecheck
  npm --prefix client run build
  npm run check:browser
  ```

- Docs in the same commit as the code they describe: `docs/PROTOCOL.md`, `docs/USER_EXPERIENCE.md`, and the "Behavior to preserve" list in `AGENTS.md`.

## Repository orientation

- `server/index.js`: `isValidChar(char)` is the shared character rule; `sendTo(participant, msg)` sends to one participant's socket if present; `room.participants` is a `Map` of id to participant, each with `id`, `handle`, `color`, `socket` (`ws` or `null`). After `hello`, the message handler dispatches on `msg.type` (`key` to `handleKey`, `presence` to `handlePresence`, default `invalid-message`).
- Server tests: `test-server-ws.js` with helpers from `test-support.js` (`newRoom`, `join`, `connect`, `openSocket`, `client.next(predicate)`, `client.send`, `settle`). `roomWithTwo()` in the suite returns `{ roomId, alice, bob, a, b, done }` with both sockets connected; `key(seq, kind, char)` builds a keystroke. Run with `NODE_ENV=test node --test test-server-ws.js`.
- Client: `client/src/protocol.ts` (wire types), `client/src/connection.ts` (`openRoomConnection` returns `{ send, setHidden, close }`; `ready` is true only after a snapshot on the current socket; `transmit(msg)` sends JSON), `client/src/useRoomConnection.ts` (owns the connection; `events` is read through `eventsRef`; returns `{ room, status, send }`), `client/src/App.tsx` (roster in `<aside id="roster">`; `feedback` is a two-second local status row in the chat area; `warning` is a three-second slot in the roster footer; `endSession(message)` tears the session down; `focusKeyboard()` focuses the hidden textarea; `handleChatKey` is the document-level key mapper).
- Client fixtures in `client/src/testing/roomFixtures.tsx`: `renderJoined(snapshot)` renders as Alice (participant 10); `serverSend(ws, msg)`; `alice`, `bob` roster entries; `idle(entry)`; `FakeWebSocket.latest().sent` is everything the client sent. Run one suite with `npm --prefix client test -- src/<file>`.

---

### Task 1: Server delivery and validation

**Files:**
- Modify: `server/index.js`
- Modify: `test-server-ws.js`

**Interfaces:**
- Produces: `handlePrivate(participant, room, msg)` exported; constant `PRIVATE_MAX_CODE_POINTS = 200`.

- [ ] **Step 1: Write the failing server tests**

Append a `describe` block to `test-server-ws.js`:

```js
describe('Private messages (task 18)', () => {
  async function roomWithThree() {
    const two = await roomWithTwo();
    const carol = await join(baseUrl, two.roomId, 'Carol');
    const c = await connect(wsUrl, carol);
    // Drain the join announcement and roster Alice and Bob received.
    await two.a.next((m) => m.type === 'roster');
    await two.b.next((m) => m.type === 'roster');
    return { ...two, carol, c, done: () => { two.done(); c.ws.close(); } };
  }

  it('delivers to the recipient only and confirms to the sender', async () => {
    const { alice, bob, a, b, c, done } = await roomWithThree();
    a.send({ type: 'private', to: bob.participantId, text: '  lunch?  ' });
    const delivered = await b.next((m) => m.type === 'private');
    assert.deepEqual(delivered, { type: 'private', from: alice.participantId, handle: 'Alice', color: alice.color, text: 'lunch?' });
    const sent = await a.next((m) => m.type === 'private-sent');
    assert.deepEqual(sent, { type: 'private-sent', to: bob.participantId, handle: 'Bob' });
    await settle(50);
    assert.equal(c.messages.filter((m) => m.type === 'private').length, 0);
    assert.equal(a.messages.filter((m) => m.type === 'private').length, 0);
    done();
  });

  it('private before hello is unauthorized and the socket closes', async () => {
    const client = openSocket(wsUrl);
    await client.opened;
    client.send({ type: 'private', to: 1, text: 'hi' });
    assert.equal((await client.next((m) => m.type === 'error')).code, 'unauthorized');
    await client.closed;
  });

  it('unknown, self, other-room, and socketless recipients are unknown-recipient', async () => {
    const { alice, bob, a, b, done } = await roomWithTwo();
    const otherRoom = await newRoom(baseUrl);
    const dave = await join(baseUrl, otherRoom, 'Dave');
    const d = await connect(wsUrl, dave);
    for (const to of [999, alice.participantId, dave.participantId]) {
      a.send({ type: 'private', to, text: 'hi' });
      const err = await a.next((m) => m.type === 'error');
      assert.deepEqual(err, { type: 'error', code: 'unknown-recipient', to });
    }
    b.ws.close();
    await b.closed;
    await settle(20);
    a.send({ type: 'private', to: bob.participantId, text: 'hi' });
    assert.deepEqual(await a.next((m) => m.type === 'error'), { type: 'error', code: 'unknown-recipient', to: bob.participantId });
    assert.equal(d.messages.filter((m) => m.type === 'private').length, 0);
    d.ws.close();
    done();
  });

  it('bad shape and bad text are invalid-message and deliver nothing', async () => {
    const { bob, a, b, done } = await roomWithTwo();
    const bad = [
      { type: 'private', to: 'bob', text: 'hi' },
      { type: 'private', to: bob.participantId, text: 42 },
      { type: 'private', to: bob.participantId, text: '' },
      { type: 'private', to: bob.participantId, text: '   ' },
      { type: 'private', to: bob.participantId, text: 'ab' },
      { type: 'private', to: bob.participantId, text: 'x'.repeat(201) },
    ];
    for (const msg of bad) {
      a.send(msg);
      assert.equal((await a.next((m) => m.type === 'error')).code, 'invalid-message', JSON.stringify(msg));
    }
    await settle(50);
    assert.equal(b.messages.filter((m) => m.type === 'private').length, 0);
    done();
  });

  it('exactly 200 code points, including emoji, is delivered', async () => {
    const { bob, a, b, done } = await roomWithTwo();
    const text = '😀'.repeat(200);
    a.send({ type: 'private', to: bob.participantId, text });
    assert.equal((await b.next((m) => m.type === 'private')).text, text);
    done();
  });

  it('leaves no trace in snapshots, sequence numbers, or live lines', async () => {
    const { alice, bob, a, b, done } = await roomWithTwo();
    a.send(key(1, 'char', 'z'));
    await b.next((m) => m.type === 'live' && m.seq === 1);
    a.send({ type: 'private', to: bob.participantId, text: 'psst' });
    await b.next((m) => m.type === 'private');
    b.ws.close();
    await b.closed;
    const again = await connect(wsUrl, bob);
    assert.ok(!JSON.stringify(again.snapshot).includes('psst'));
    assert.equal(again.snapshot.you.nextSeq, 1);
    const ownLine = again.snapshot.liveLines.find((l) => l.participantId === alice.participantId);
    assert.equal(ownLine.text, 'z');
    assert.equal(rooms.get(alice.roomId).participants.get(alice.participantId).nextSeq, 2);
    again.ws.close();
    done();
  });
});
```

- [ ] **Step 2: Run the suite to verify the new tests fail**

Run: `NODE_ENV=test node --test test-server-ws.js`
Expected: the new tests FAIL with `invalid-message` where `private` or `private-sent` is expected.

- [ ] **Step 3: Implement on the server**

In `server/index.js`:

1. Next to `HEARTBEAT_TIMEOUT_MS` add:

   ```js
   const PRIVATE_MAX_CODE_POINTS = 200;
   ```

2. After `handlePresence` add:

   ```js
   // One line to one person, delivered once and never stored. Validation
   // order: shape, text, then recipient. "Unreachable" covers a recipient
   // who left, is in another room, is the sender, or has no open socket.
   function handlePrivate(participant, room, msg){
     if(typeof msg.to !== 'number' || typeof msg.text !== 'string') return sendTo(participant, {type:'error', code:'invalid-message'});
     const text = msg.text.trim();
     const points = Array.from(text);
     if(points.length < 1 || points.length > PRIVATE_MAX_CODE_POINTS || !points.every(isValidChar)) return sendTo(participant, {type:'error', code:'invalid-message'});
     const recipient = room.participants.get(msg.to);
     if(!recipient || recipient.id === participant.id || !recipient.socket || recipient.socket.readyState !== 1) return sendTo(participant, {type:'error', code:'unknown-recipient', to:msg.to});
     sendTo(recipient, {type:'private', from:participant.id, handle:participant.handle, color:participant.color, text});
     sendTo(participant, {type:'private-sent', to:recipient.id, handle:recipient.handle});
   }
   ```

3. In the `wss.on('connection')` message handler's `switch`, add a case before `default`:

   ```js
         case 'private': return handlePrivate(participant, ws.room, msg);
   ```

   If the handler is still the pre-task-31 `if(msg && msg.type==='key')` form, replace it with:

   ```js
       switch(msg && msg.type){
         case 'key': return handleKey(participant, ws.room, msg);
         case 'private': return handlePrivate(participant, ws.room, msg);
         default: return sendWs(ws, {type:'error', code:'invalid-message'});
       }
   ```

4. Add `handlePrivate,` to the exported object.

- [ ] **Step 4: Run all server suites**

Run: `npm test`
Expected: PASS, including the six new tests.

- [ ] **Step 5: Document the wire change**

In `docs/PROTOCOL.md`:

1. Under "Client to server", add to the code block:

   ```ts
   { type: "private", to: number, text: string }
   ```

   and after the `presence` paragraph add:

   ```markdown
   `private` sends one line to one participant in the same room. `text` is
   trimmed at both ends and must then be 1 to 200 code points, each passing
   the character rule under [Edge cases](#edge-cases-1). It is not numbered
   and does not enter the keystroke sequence.
   ```

2. Under "Server to the sender only", add to the code block:

   ```ts
   { type: "private-sent", to: number, handle: string }
   ```

   change the error line to:

   ```ts
   { type: "error", code: "unauthorized" | "unknown-participant" | "seq-gap" | "invalid-message" | "unknown-recipient",
     expected?: number, to?: number }
   ```

   and add a new subsection after it:

   ```markdown
   ### Server to one recipient

   ```ts
   { type: "private", from: number, handle: string, color: string, text: string }
   ```

   Sent only to the participant named by `to` in the sender's `private`
   message. Nothing is stored: private messages never appear in snapshots and
   are never replayed on reconnect. The sender receives `private-sent` on
   delivery, or `error unknown-recipient` (with `to`) when the recipient is
   not in the sender's room, is the sender, or has no open socket at that
   moment; a `to` that is not a number or a `text` that fails the rule above
   is `error invalid-message`. The socket stays open in every case.
   ```

3. In the Emission order table add:

   ```markdown
   | `private` | `private` to the recipient, then `private-sent` to the sender; or `error unknown-recipient` to the sender |
   ```

- [ ] **Step 6: Commit**

```bash
git add server/index.js test-server-ws.js docs/PROTOCOL.md
git commit -m "Deliver private messages to one recipient over the socket

A private message after hello is validated for shape, trimmed text of 1 to
200 valid code points, and a reachable recipient in the sender's room, then
forwarded to that socket only with a private-sent result to the sender.
Nothing is stored, replayed, or numbered."
```

---

### Task 2: Client wire types, `sendPrivate`, and hook events

**Files:**
- Modify: `client/src/protocol.ts`
- Modify: `client/src/connection.ts`
- Modify: `client/src/connection.test.ts`
- Modify: `client/src/useRoomConnection.ts`

**Interfaces:**
- Produces: `RoomConnection.sendPrivate(to: number, text: string): boolean`; hook return gains `sendPrivate`; `RoomEvents` gains `onPrivate(message: PrivateIncoming)` and `onPrivateResult(result: PrivateResult)` with
  - `type PrivateIncoming = { from: number; handle: string; color: string; text: string }`
  - `type PrivateResult = { ok: true; to: number; handle: string } | { ok: false; to: number }`

- [ ] **Step 1: Write the failing connection tests**

Append to the `describe('openRoomConnection', ...)` block in `client/src/connection.test.ts`:

```ts
  it('sendPrivate transmits when open and leaves sequence numbers alone', () => {
    const { connection } = open();
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(1));
    expect(connection.sendPrivate(20, 'lunch?')).toBe(true);
    connection.send({ kind: 'enter' });
    expect(ws.sent.slice(1)).toEqual([
      { type: 'private', to: 20, text: 'lunch?' },
      { type: 'key', seq: 1, kind: 'enter' },
    ]);
  });

  it('sendPrivate returns false before the snapshot and while reconnecting, and sends nothing later', () => {
    const { connection } = open();
    expect(connection.sendPrivate(20, 'early')).toBe(false);
    vi.runOnlyPendingTimers();
    const first = FakeWebSocket.latest();
    first.serverSend(snapshot(1));
    first.serverClose();
    expect(connection.sendPrivate(20, 'gone')).toBe(false);
    vi.runOnlyPendingTimers();
    vi.runOnlyPendingTimers();
    const second = FakeWebSocket.latest();
    second.serverSend(snapshot(1));
    expect(second.sent.filter((m) => m.type === 'private')).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix client test -- src/connection.test.ts`
Expected: FAIL, `sendPrivate` is not a function.

- [ ] **Step 3: Extend the wire types**

In `client/src/protocol.ts`:

```ts
export type ErrorCode = 'unauthorized' | 'unknown-participant' | 'seq-gap' | 'invalid-message' | 'unknown-recipient';
```

Add to the `ServerMessage` union:

```ts
  | { type: 'private'; from: number; handle: string; color: string; text: string }
  | { type: 'private-sent'; to: number; handle: string }
```

and change the error member to:

```ts
  | { type: 'error'; code: ErrorCode; expected?: number; to?: number };
```

Add to `ClientMessage`:

```ts
export type PrivateMessageOut = { type: 'private'; to: number; text: string };
export type ClientMessage = { type: 'hello'; roomId: number; participantId: number; token: string } | KeyMessage | PresenceMessage | PrivateMessageOut;
```

(If `PresenceMessage` does not exist because task 31 has not landed, omit it.)

- [ ] **Step 4: Add `sendPrivate` to the connection**

In `client/src/connection.ts`, extend `RoomConnection`:

```ts
  // Sends one private line now, or reports false when the socket is not open.
  // Never queued: nothing private is replayed.
  sendPrivate: (to: number, text: string) => boolean;
```

and in the returned object:

```ts
    sendPrivate(to, text) {
      if (!ready) return false;
      transmit({ type: 'private', to, text });
      return true;
    },
```

- [ ] **Step 5: Forward the messages as events in the hook**

In `client/src/useRoomConnection.ts`:

1. Add the types and extend `RoomEvents`:

   ```ts
   export type PrivateIncoming = { from: number; handle: string; color: string; text: string };
   export type PrivateResult = { ok: true; to: number; handle: string } | { ok: false; to: number };
   export type RoomEvents = {
     onCommand: (name: CommandName) => void;
     onSessionEnded: () => void;
     onNewcomer: (entry: { handle: string }) => void;
     onNotice: (text: string) => void;
     onPrivate: (message: PrivateIncoming) => void;
     onPrivateResult: (result: PrivateResult) => void;
   };
   ```

2. Add a ref next to `sendRef`:

   ```ts
     const sendPrivateRef = useRef<(to: number, text: string) => boolean>(() => false);
   ```

3. In `onMessage`, before the `command` line, add:

   ```ts
           // Private traffic never reaches the reducer or the document rows.
           if (msg.type === 'private') return eventsRef.current.onPrivate({ from: msg.from, handle: msg.handle, color: msg.color, text: msg.text });
           if (msg.type === 'private-sent') return eventsRef.current.onPrivateResult({ ok: true, to: msg.to, handle: msg.handle });
   ```

   and inside the `error` branch, before the session-ending check:

   ```ts
             if (msg.code === 'unknown-recipient') return eventsRef.current.onPrivateResult({ ok: false, to: msg.to ?? -1 });
   ```

4. After `sendRef.current = connection.send;` add `sendPrivateRef.current = connection.sendPrivate;`, and in the cleanup add `sendPrivateRef.current = () => false;`.

5. Return it:

   ```ts
     const sendPrivate = (to: number, text: string) => sendPrivateRef.current(to, text);
     return { room, status, send, sendPrivate };
   ```

- [ ] **Step 6: Run the suites and the type check**

Run: `npm --prefix client test -- src/connection.test.ts && npm --prefix client run typecheck`
Expected: the connection tests PASS. The type check fails in `App.tsx` because the events object lacks `onPrivate` and `onPrivateResult`; add temporary no-op handlers there (`onPrivate: () => {}, onPrivateResult: () => {}`) so this commit type-checks. Task 3 replaces them.

- [ ] **Step 7: Commit**

```bash
git add client/src/protocol.ts client/src/connection.ts client/src/connection.test.ts client/src/useRoomConnection.ts client/src/App.tsx
git commit -m "Add the private message wire types, sendPrivate, and hook events

The connection sends a private line only when the socket is open and
never queues it. The room hook forwards incoming private messages and
delivery results as events so they never enter the reducer."
```

---

### Task 3: Sending from the roster and sender feedback

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/theme.css`
- Create: `client/src/App.private.test.tsx`

**Interfaces:**
- Consumes: `sendPrivate` from the hook (Task 2).
- Produces (inside App): `privateTarget: { participantId: number; handle: string } | null`, `privateText: string`, `closePrivate()`.

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/App.private.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, alice, bob, idle } from './testing/roomFixtures';
import type { RosterEntry } from './protocol';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const carol: RosterEntry = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2, afk: false };
const three = () => snapshot({ liveLines: [idle(alice), idle(bob), idle(carol)], roster: [alice, bob, carol] });
const privates = (ws: any) => ws.sent.filter((m: any) => m.type === 'private');
const committedTexts = () => Array.from(document.querySelectorAll('.committed-line')).map((e) => e.textContent);

async function openTo(handle: string) {
  const user = userEvent.setup();
  const { ws } = await renderJoined(three());
  await screen.findByText('Carol');
  await user.click(screen.getByRole('button', { name: `Message ${handle}` }));
  const input = await screen.findByLabelText(`Private message to ${handle}`);
  return { user, ws, input };
}

describe('Sending a private message', () => {
  it('clicking a name opens a focused input under that entry', async () => {
    const { input } = await openTo('Bob');
    expect(document.activeElement).toBe(input);
    expect(input.closest('.roster-entry-block')?.querySelector('.roster-handle')?.textContent).toBe('Bob');
  });

  it('clicking your own name opens nothing', async () => {
    const user = userEvent.setup();
    await renderJoined(three());
    await screen.findByText('Carol');
    expect(screen.queryByRole('button', { name: 'Message Alice' })).toBeNull();
    await user.click(screen.getByText('Alice'));
    expect(screen.queryByLabelText(/Private message to/)).toBeNull();
  });

  it('clicking another name moves the input and keeps the text', async () => {
    const { user, input } = await openTo('Bob');
    await user.type(input, 'lun');
    await user.click(screen.getByRole('button', { name: 'Message Carol' }));
    const moved = await screen.findByLabelText('Private message to Carol');
    expect(moved).toHaveValue('lun');
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
  });

  it('Enter sends the trimmed text, closes the input, and refocuses the keyboard', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, '  lunch?  {Enter}');
    expect(privates(ws)).toEqual([{ type: 'private', to: 20, text: 'lunch?' }]);
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
    expect(committedTexts()).toEqual([]);
  });

  it('Escape closes without sending and refocuses the keyboard', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'never{Escape}');
    expect(privates(ws)).toEqual([]);
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
  });

  it('Enter on empty text closes without sending', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, '   {Enter}');
    expect(privates(ws)).toEqual([]);
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
  });

  it('text over 200 code points is not sent and a warning shows', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'x'.repeat(201));
    await user.keyboard('{Enter}');
    expect(privates(ws)).toEqual([]);
    expect(await screen.findByText('Private messages are limited to 200 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Private message to Bob')).toHaveValue('x'.repeat(201));
  });

  it('keys typed in the private input never become chat keystrokes', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'abc');
    expect(ws.keys()).toEqual([]);
  });

  it('the input closes with a warning when the target leaves', async () => {
    const { ws } = await openTo('Bob');
    serverSend(ws, { type: 'roster', roster: [alice, carol] });
    await waitFor(() => expect(screen.queryByLabelText('Private message to Bob')).toBeNull());
    expect(await screen.findByText('Bob is not reachable')).toBeInTheDocument();
  });
});

describe('Sender feedback', () => {
  it('private-sent shows "sent to Bob"', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, { type: 'private-sent', to: 20, handle: 'Bob' });
    expect(await screen.findByText('sent to Bob')).toBeInTheDocument();
  });

  it('unknown-recipient shows the handle when known, "not delivered" otherwise', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, { type: 'error', code: 'unknown-recipient', to: 30 });
    expect(await screen.findByText('Carol is not reachable')).toBeInTheDocument();
    serverSend(ws, { type: 'error', code: 'unknown-recipient', to: 999 });
    expect(await screen.findByText('not delivered')).toBeInTheDocument();
    expect(screen.getByLabelText('Shared chat area')).toBeInTheDocument();
  });
});
```

If task 31 has not landed, drop `afk: false` from `carol`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix client test -- src/App.private.test.tsx`
Expected: FAIL, no button named "Message Bob".

- [ ] **Step 3: Add state and handlers to App.tsx**

1. Constants near the other constants at the top:

   ```ts
   const PRIVATE_MAX_CODE_POINTS = 200;
   ```

2. A type after `Session`:

   ```ts
   type PrivateTarget = { participantId: number; handle: string };
   ```

3. State next to the other `useState` calls:

   ```ts
     // Private input: who it is addressed to and the text so far. The
     // recipient's popups live in Task 4's `privateMessages`.
     const [privateTarget, setPrivateTarget] = useState<PrivateTarget | null>(null);
     const [privateText, setPrivateText] = useState("");
   ```

4. Destructure `sendPrivate` from the hook and replace the temporary no-op events:

   ```ts
     const { room, status, send, sendPrivate } = useRoomConnection(session, {
       ...
       onPrivate: () => {},
       onPrivateResult: (result) => {
         if (result.ok) { setFeedback(`sent to ${result.handle}`); return; }
         const handle = room.participants.find((p) => p.participantId === result.to)?.handle;
         setFeedback(handle ? `${handle} is not reachable` : "not delivered");
       },
     });
   ```

   `room` is declared by this same statement, so read the roster through a ref instead: declare `const participantsRef = useRef<LiveLine[]>([]);` above the hook call, assign `participantsRef.current = room.participants;` right after it, and use `participantsRef.current.find(...)` inside `onPrivateResult`. Import `type LiveLine` from `./protocol`.

5. In `endSession`, add `setPrivateTarget(null); setPrivateText("");`.

6. After `focusKeyboard` is defined, add the private input handlers:

   ```ts
     const openPrivate = (entry: { participantId: number; handle: string }) => {
       if (!session || entry.participantId === session.participantId) return;
       setPrivateTarget({ participantId: entry.participantId, handle: entry.handle });
     };
     const closePrivate = () => {
       setPrivateTarget(null);
       setPrivateText("");
       focusKeyboard();
     };
     const onPrivateKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
       if (event.key === "Escape") { event.preventDefault(); closePrivate(); return; }
       if (event.key !== "Enter" || !privateTarget) return;
       event.preventDefault();
       const text = privateText.trim();
       if (!text) { closePrivate(); return; }
       if (Array.from(text).length > PRIVATE_MAX_CODE_POINTS) { setWarning("Private messages are limited to 200 characters"); return; }
       if (!sendPrivate(privateTarget.participantId, text)) { setWarning("Not connected, try again"); return; }
       closePrivate();
     };

     // The target leaving closes the input: there is nobody to send to.
     useEffect(() => {
       if (!privateTarget || participants.some((p) => p.participantId === privateTarget.participantId)) return;
       setWarning(`${privateTarget.handle} is not reachable`);
       setPrivateTarget(null);
       setPrivateText("");
     }, [participants, privateTarget]);
   ```

   Add `type KeyboardEvent as ReactKeyboardEvent` to the React import. Place this block after `participants` is declared.

7. Replace the roster entry rendering. The current entry is a `div.roster-entry` with the color dot and handle. Wrap it so the input can sit under the clicked name:

   ```tsx
           participants.map((participant) => (
             <div className="roster-entry-block" key={participant.participantId}>
               {participant.participantId === session.participantId ? (
                 <div className="roster-entry" style={{ color: participant.color }}>
                   <span className="roster-color-dot" style={{ backgroundColor: participant.color }} aria-hidden="true" />
                   <span className="roster-handle">{participant.handle}</span>
                   {participant.afk ? <span className="roster-afk" title="In a background tab">afk</span> : null}
                 </div>
               ) : (
                 <button
                   type="button"
                   className="roster-entry"
                   style={{ color: participant.color }}
                   aria-label={`Message ${participant.handle}`}
                   onClick={() => openPrivate(participant)}
                 >
                   <span className="roster-color-dot" style={{ backgroundColor: participant.color }} aria-hidden="true" />
                   <span className="roster-handle">{participant.handle}</span>
                   {participant.afk ? <span className="roster-afk" title="In a background tab">afk</span> : null}
                 </button>
               )}
               {privateTarget?.participantId === participant.participantId ? (
                 <div className="roster-private">
                   <span className="roster-private-label">to</span>
                   <input
                     aria-label={`Private message to ${participant.handle}`}
                     value={privateText}
                     onChange={(event) => setPrivateText(event.target.value)}
                     onKeyDown={onPrivateKey}
                     autoComplete="off"
                     spellCheck={false}
                     autoFocus
                   />
                 </div>
               ) : null}
             </div>
           ))
   ```

   Drop the `afk` spans if task 31 has not landed. The existing roster test reads `.roster-entry` text content, which is unchanged. The `aria-label` on the button replaces its accessible name, so `screen.getByText('Bob')` still finds the span while `getByRole('button', { name: 'Message Bob' })` finds the button.

- [ ] **Step 4: Style it**

In `client/src/theme.css`, after the `.roster-handle` rule add:

```css
.roster-entry-block { display:block; }
button.roster-entry { width:100%; border:0; padding:0; background:none; font:inherit; text-align:left; cursor:pointer; }
button.roster-entry:focus-visible { outline:1px solid var(--accent); outline-offset:1px; }
.roster-private { display:flex; align-items:center; gap:0.3rem; margin:0.15rem 0 0.35rem; }
.roster-private-label { flex:0 0 auto; color:var(--dim); font-size:0.72rem; }
.roster-private input { min-width:0; flex:1; border:1px solid var(--accent); border-radius:0; padding:0.15rem 0.3rem; background:var(--surface); color:var(--text); font:inherit; font-size:0.82rem; outline:none; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix client test -- src/App.private.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 6: Run the client suite and the type check**

Run: `npm --prefix client test && npm --prefix client run typecheck`
Expected: PASS. If `App.roster.test.tsx` counts `.roster-entry` elements or reads their text, the wrapper keeps both intact.

- [ ] **Step 7: Commit**

```bash
git add client/src/App.tsx client/src/theme.css client/src/App.private.test.tsx
git commit -m "Send private messages from an input under the clicked roster name

Other participants' roster entries are buttons that open a one-line input
beneath them. Enter sends the trimmed text through the socket, Escape
cancels, both return focus to the chat, and delivery results show as the
existing feedback line."
```

---

### Task 4: The recipient's popup

**Files:**
- Create: `client/src/PrivateMessages.tsx`
- Create: `client/src/PrivateMessages.test.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/theme.css`
- Modify: `client/src/App.private.test.tsx`

**Interfaces:**
- Produces: `PrivateMessages` component with props `{ messages: PrivateMessage[]; onDismiss: (id: number) => void }`; `type PrivateMessage = { id: number; from: number; handle: string; color: string; text: string; receivedAt: number }`; `PRIVATE_TIMEOUT_MS = 15000`.

- [ ] **Step 1: Write the failing component tests (isolated, fake timers)**

```tsx
// client/src/PrivateMessages.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrivateMessages, PRIVATE_TIMEOUT_MS, type PrivateMessage } from './PrivateMessages';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

const msg = (id: number, handle: string, text: string, color = '#0ff'): PrivateMessage =>
  ({ id, from: id * 10, handle, color, text, receivedAt: Date.now() });

describe('PrivateMessages', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<PrivateMessages messages={[]} onDismiss={() => {}} />);
    expect(container.querySelector('.private-stack')).toBeNull();
  });

  it('shows sender in color and text, oldest first, in a polite live region', () => {
    render(<PrivateMessages messages={[msg(1, 'Bob', 'lunch?'), msg(2, 'Carol', 'later', '#f0f')]} onDismiss={() => {}} />);
    const stack = document.querySelector('.private-stack');
    expect(stack).toHaveAttribute('aria-live', 'polite');
    const popups = Array.from(document.querySelectorAll('.private-popup'));
    expect(popups.map((p) => p.querySelector('.private-from')?.textContent)).toEqual(['Bob', 'Carol']);
    expect(popups[0].querySelector('.private-from')).toHaveStyle({ color: '#0ff' });
    expect(popups[1].querySelector('.private-text')?.textContent).toBe('later');
  });

  it('click dismisses that message', () => {
    const onDismiss = vi.fn();
    render(<PrivateMessages messages={[msg(1, 'Bob', 'lunch?'), msg(2, 'Carol', 'later')]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('later'));
    expect(onDismiss).toHaveBeenCalledWith(2);
  });

  it('the oldest message expires after the timeout, then the next', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<PrivateMessages messages={[msg(1, 'Bob', 'a')]} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(PRIVATE_TIMEOUT_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledWith(1);
    const second = { ...msg(2, 'Carol', 'b'), receivedAt: Date.now() - 5000 };
    rerender(<PrivateMessages messages={[second]} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(PRIVATE_TIMEOUT_MS - 5000);
    expect(onDismiss).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Write the failing App-level tests**

Append to `client/src/App.private.test.tsx`:

```tsx
describe('Receiving a private message', () => {
  const incoming = (text: string, handle = 'Bob', color = '#0ff', from = 20) =>
    ({ type: 'private' as const, from, handle, color, text });

  it('renders a popup outside the chat area with the sender in color; the transcript is unchanged', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, incoming('lunch?'));
    const text = await screen.findByText('lunch?');
    const popup = text.closest('.private-popup');
    expect(popup).not.toBeNull();
    expect(popup?.closest('#chat-area')).toBeNull();
    expect(popup?.querySelector('.private-from')).toHaveTextContent('Bob');
    expect(popup?.querySelector('.private-from')).toHaveStyle({ color: '#0ff' });
    expect(committedTexts()).toEqual([]);
    expect(document.querySelectorAll('.chat-line').length).toBe(document.querySelectorAll('#chat-area .chat-line').length);
  });

  it('two messages stack in arrival order; click removes one, Escape removes the oldest', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, incoming('first'));
    serverSend(ws, incoming('second', 'Carol', '#f0f', 30));
    await screen.findByText('second');
    expect(Array.from(document.querySelectorAll('.private-text')).map((e) => e.textContent)).toEqual(['first', 'second']);
    await user.click(screen.getByText('second'));
    await waitFor(() => expect(screen.queryByText('second')).toBeNull());
    serverSend(ws, incoming('third', 'Carol', '#f0f', 30));
    await screen.findByText('third');
    await user.click(screen.getByLabelText('Shared chat area'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('first')).toBeNull());
    expect(screen.getByText('third')).toBeInTheDocument();
    expect(ws.keys()).toEqual([]);
  });

  it('a sender who left still shows with the handle and color from the message', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, { type: 'roster', roster: [alice, carol] });
    serverSend(ws, incoming('bye'));
    const popup = (await screen.findByText('bye')).closest('.private-popup');
    expect(popup?.querySelector('.private-from')).toHaveTextContent('Bob');
  });

  it('ending the session clears the popups', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, incoming('lunch?'));
    await screen.findByText('lunch?');
    serverSend(ws, { type: 'error', code: 'unknown-participant' });
    await waitFor(() => expect(screen.queryByText('lunch?')).toBeNull());
  });
});
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `npm --prefix client test -- src/PrivateMessages.test.tsx src/App.private.test.tsx`
Expected: FAIL, `./PrivateMessages` cannot be resolved; no popup in the App tests.

- [ ] **Step 4: Create the component**

```tsx
// client/src/PrivateMessages.tsx
import { useEffect, useRef } from "react";

export const PRIVATE_TIMEOUT_MS = 15000;

export type PrivateMessage = {
  id: number;
  from: number;
  handle: string;
  color: string;
  text: string;
  receivedAt: number;
};

type Props = { messages: PrivateMessage[]; onDismiss: (id: number) => void };

// Ephemeral popups for private messages, pinned over the chat area in a
// fixed overlay. They are rendered from their own list, never from room
// state, so nothing private can reach the transcript. Messages arrive in
// order, so the first one is always the next to expire.
export function PrivateMessages({ messages, onDismiss }: Props) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const oldest = messages[0];
  const oldestId = oldest?.id;
  const oldestAt = oldest?.receivedAt;

  useEffect(() => {
    if (oldestId == null || oldestAt == null) return;
    const delay = Math.max(0, oldestAt + PRIVATE_TIMEOUT_MS - Date.now());
    const timer = window.setTimeout(() => onDismissRef.current(oldestId), delay);
    return () => window.clearTimeout(timer);
  }, [oldestId, oldestAt]);

  if (!messages.length) return null;
  return (
    <div className="private-stack" aria-live="polite">
      {messages.map((message) => (
        <div key={message.id} className="private-popup" role="status" onClick={() => onDismiss(message.id)}>
          <div className="private-from" style={{ color: message.color }}>{message.handle}</div>
          <div className="private-text">{message.text}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Hold the list in App and render the overlay**

In `client/src/App.tsx`:

1. Import:

   ```ts
   import { PrivateMessages, type PrivateMessage } from "./PrivateMessages";
   ```

2. State and an id counter next to the private input state:

   ```ts
     const [privateMessages, setPrivateMessages] = useState<PrivateMessage[]>([]);
     const privateIdRef = useRef(0);
     const dismissPrivate = (id: number) => setPrivateMessages((list) => list.filter((m) => m.id !== id));
   ```

3. Replace the `onPrivate: () => {}` event with:

   ```ts
       onPrivate: (message) => {
         const id = ++privateIdRef.current;
         setPrivateMessages((list) => [...list, { id, ...message, receivedAt: Date.now() }]);
       },
   ```

4. In `endSession`, add `setPrivateMessages([]);`.

5. In `handleChatKey`, before the `if (event.key === "Backspace")` line (and after the task 25 `if (mentionOpen) { ... }` block if present, so an open handle list takes Escape first), add:

   ```ts
       if (event.key === "Escape" && privateMessages.length) {
         event.preventDefault();
         dismissPrivate(privateMessages[0].id);
         return true;
       }
   ```

   If task 25 has not landed, the document-level key listener still calls the `handleChatKey` closure captured when its effect ran, which would see a stale `privateMessages`. In that case add `const handleChatKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);` next to the other refs, assign `handleChatKeyRef.current = handleChatKey;` right after the function, and make the listener call `handleChatKeyRef.current(event)`.

6. Render the overlay in the session view, after `</aside>` and before the help overlay:

   ```tsx
         <PrivateMessages messages={privateMessages} onDismiss={dismissPrivate} />
   ```

- [ ] **Step 6: Style it**

Append to `client/src/theme.css`:

```css
.private-stack { position:fixed; top:8px; right:176px; z-index:8; display:grid; gap:0.5rem; width:min(320px, calc(100vw - 200px)); }
.private-popup { border:1px solid #555; padding:0.5rem 0.65rem; background:#000; font-family:var(--mono); cursor:pointer; white-space:normal; overflow-wrap:anywhere; }
.private-from { margin-bottom:0.2rem; }
.private-text { color:var(--text); }
@media (max-width:420px){ .private-stack{ right:136px; left:8px; width:auto; } }
```

The help overlay is `z-index:10`, so help still covers popups.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm --prefix client test -- src/PrivateMessages.test.tsx src/App.private.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run the client suite, type check, and build**

Run: `npm --prefix client test && npm --prefix client run typecheck && npm --prefix client run build`
Expected: PASS.

- [ ] **Step 9: Document the behavior**

In `docs/USER_EXPERIENCE.md`, add a section before "Scrollback and history":

```markdown
## Private messages

- Click a name in the roster and a one-line input opens under it. Type,
  press Enter, and that person alone receives it. Escape closes the input
  without sending. Either way you are back on the chat afterwards.
- The recipient sees it as a small popup in the top-right corner with your
  name in your color. It goes away when they click it, press Escape, or
  after fifteen seconds. Several messages stack.
- You see "sent to Bob" under the transcript when it arrives, or "Bob is
  not reachable" if Bob has left or is between connections.
- Private messages are never part of the transcript, are not saved, and are
  not shown again after a reload. They are limited to 200 characters.
```

In `AGENTS.md`, under "Behavior to preserve", add:

```markdown
- Private messages are delivered once over the socket to one recipient and
  are never stored, replayed, or rendered as transcript rows; the client
  keeps them in their own list outside room state.
```

- [ ] **Step 10: Commit**

```bash
git add client/src/PrivateMessages.tsx client/src/PrivateMessages.test.tsx client/src/App.tsx client/src/theme.css client/src/App.private.test.tsx docs/USER_EXPERIENCE.md AGENTS.md
git commit -m "Show received private messages as ephemeral popups over the chat area

Incoming private messages live in their own list and render in a fixed
overlay outside the transcript, dismissed by click, Escape, or a fifteen
second timeout."
```

---

### Task 5: Browser check

**Files:**
- Modify: `check-browser.mjs`

- [ ] **Step 1: Add the sequence**

After the task 31 block (or after the `'"l" Enter shows "Roster refreshed"'` check if neither task 25 nor 31 added anything), insert:

```js
  // Task 18: a private line from Alice reaches Bob as a popup and never the transcript.
  const committedBeforePrivate = JSON.stringify(await bob.eval(text('.committed-line')));
  check('Alice opens the private input under Bob',
    await alice.eval(`(() => { document.querySelector('button[aria-label="Message Bob"]').click(); return document.activeElement?.getAttribute('aria-label'); })()`) === 'Private message to Bob');
  await alice.type('lunch?'); await alice.key('Enter', ENTER);
  check('Bob sees the popup with Alice\'s text', await bob.waitFor(`${text('.private-text')}.includes('lunch?')`), JSON.stringify(await bob.eval(text('.private-text'))));
  check('the popup names Alice', await bob.eval(`${text('.private-from')}.includes('Alice')`));
  check('Alice sees "sent to Bob"', await alice.waitFor(has('sent to Bob')));
  check('neither transcript gained a line',
    JSON.stringify(await bob.eval(text('.committed-line'))) === committedBeforePrivate && !(await alice.eval(`${text('.committed-line')}.some((l) => l.includes('lunch?'))`)));
  check('Alice\'s keyboard is focused again', await alice.eval(`document.activeElement?.classList.contains('keyboard-capture')`));
  await bob.key('Escape', ESCAPE);
  check('Escape dismisses Bob\'s popup', await bob.waitFor(`!document.querySelector('.private-popup')`));
```

Bob's tab must have keyboard focus on the chat for the Escape check; add `await bob.focus();` before the Escape key if the check fails for that reason.

- [ ] **Step 2: Build and run the check**

Run: `npm --prefix client run build && npm run check:browser`
Expected: all PASS including the seven new lines.

- [ ] **Step 3: Run everything**

```sh
npm test
npm --prefix client test
npm --prefix client run typecheck
npm --prefix client run build
npm run check:browser
```

Expected: all PASS. Paste the results in the report.

- [ ] **Step 4: Commit**

```bash
git add check-browser.mjs
git commit -m "Check private messages end to end in the browser

Alice sends a private line to Bob from the roster; Bob's popup shows it,
Alice sees the confirmation, neither transcript changes, and Escape
dismisses the popup."
```

---

### Task 6: Close out

- [ ] **Step 1: Mark the task done**

In `TODO.md`, change task 18's checkbox to `- [x] **Requested feature** (done: ...)` with a one-line summary, remove its row from the "Recommended implementation order" table, and add 18 to the done list above it.

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "Mark task 18 complete"
```

- [ ] **Step 3: After merge**

Close GitHub issue #7 with a one-line comment naming the merge commit.
