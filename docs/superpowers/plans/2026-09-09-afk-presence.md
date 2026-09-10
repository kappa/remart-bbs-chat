# AFK Status for Background Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A participant whose browser tab is hidden is marked `afk` in everyone's roster; the mark clears when the tab is visible again. Nothing else about the participant changes.

**Architecture:** The client sends a new `presence` message after every snapshot and on every `visibilitychange`. The server stores `afk` per participant, carries it on snapshot live lines and roster entries, and broadcasts the roster only when the value changes. The post-hello message handler becomes a dispatch on message type so later non-keystroke messages slot in beside `presence`. The roster shows a dim text marker.

**Tech Stack:** Node.js ES-module Express + `ws` server tested with the Node test runner; React 19 / TypeScript client tested with Vitest and Testing Library; headless Chrome browser check.

**Spec:** `docs/superpowers/specs/2026-09-09-afk-presence-design.md`

## Global Constraints

- TODO task 31, GitHub issue #19. One task per branch; commit messages are plain sentences with no trailers, links, or tool names.
- Wire: client `{ type: "presence", hidden: boolean }` after `hello`; `afk: boolean` on every roster entry and snapshot live line. `GET /api/roster` is unchanged.
- Server-owned status: the stored value survives a reconnect; only a client report changes it; a report that changes nothing broadcasts nothing.
- Pongs and keystrokes keep refreshing `lastSeen` and never touch `afk`. Stale cleanup is unchanged.
- Marker text is exactly `afk`, dim, beside the handle; participant colors are not dimmed; transcript rows are untouched.
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

- `server/index.js`: single file. Participants are created in the `POST /api/join` handler (object literal with `liveRow`, `liveText`, `liveCaret`, `lastSeen`, `nextSeq`, `socket`). `rosterOf(room)` and `liveLineOf(p)` build the wire shapes. `rosterMessage(room)` wraps the roster. `broadcast(room, msg)` sends to every open socket in the room; `sendTo(participant, msg)` to one. The `wss.on('connection')` handler validates `hello`, then for later messages does `if(msg && msg.type==='key') return handleKey(...)`, else sends `invalid-message`.
- Server tests: `test-server-ws.js` with helpers from `test-support.js`: `startServer()`, `newRoom(baseUrl)`, `join(baseUrl, roomId, handle)` (HTTP join returning credentials), `connect(wsUrl, creds)` (opens a socket, sends hello, stores `client.snapshot`), `client.next(predicate)` (next unconsumed message matching), `client.send(msg)`, `client.closed`, `settle(ms)`. `serverModule.rooms` exposes room state; `serverModule.pingSockets()` pings every socket. The file defines `roomWithTwo()` returning `{ roomId, alice, bob, a, b, done }` with both sockets connected.
- Run one server suite with `NODE_ENV=test node --test test-server-ws.js`.
- Client: `client/src/protocol.ts` (wire types), `client/src/connection.ts` (socket lifecycle; `openRoomConnection` returns `{ send, close }`), `client/src/useRoomConnection.ts` (React binding; owns the connection in a `useEffect`), `client/src/roomState.ts` (reducer; the `roster` case spreads each entry onto the existing participant), `client/src/App.tsx` (roster rendering in `<aside id="roster">`), `client/src/theme.css`.
- Client test fixtures in `client/src/testing/roomFixtures.tsx`: `alice`, `bob` roster entries; `renderJoined(snapshot)`; `serverSend(ws, msg)`; `idle(entry)`. `FakeWebSocket.latest().sent` lists everything the client sent.
- Run one client suite with `npm --prefix client test -- src/<file>`.

---

### Task 1: Server stores and broadcasts AFK

**Files:**
- Modify: `server/index.js`
- Modify: `test-server-ws.js`

**Interfaces:**
- Produces: `handlePresence(participant, room, msg)` (exported for tests, like `handleKey`); `afk: boolean` on `rosterOf` entries and `liveLineOf` lines; client message `{ type: 'presence', hidden: boolean }`.

- [ ] **Step 1: Write the failing server tests**

Add a new `describe` block to `test-server-ws.js` after the `'Presence over the socket'` block:

```js
describe('AFK presence (task 31)', () => {
  it('presence before hello is unauthorized and the socket closes', async () => {
    const client = openSocket(wsUrl);
    await client.opened;
    client.send({ type: 'presence', hidden: true });
    const err = await client.next((m) => m.type === 'error');
    assert.equal(err.code, 'unauthorized');
    await client.closed;
  });

  it('a hidden report broadcasts a roster with afk to everyone; a repeat broadcasts nothing', async () => {
    const { alice, bob, a, b, done } = await roomWithTwo();
    assert.deepEqual(a.snapshot.roster.map((r) => r.afk), [false, false]);
    assert.deepEqual(a.snapshot.liveLines.map((l) => l.afk), [false, false]);
    a.send({ type: 'presence', hidden: true });
    const seenByBob = await b.next((m) => m.type === 'roster');
    const seenByAlice = await a.next((m) => m.type === 'roster');
    for (const roster of [seenByBob.roster, seenByAlice.roster]) {
      assert.deepEqual(roster.map((r) => [r.participantId, r.afk]), [[alice.participantId, true], [bob.participantId, false]]);
    }
    b.cursor = b.messages.length;
    a.send({ type: 'presence', hidden: true });
    await settle(100);
    assert.deepEqual(b.messages.slice(b.cursor), []);
    done();
  });

  it('a visible report clears afk and broadcasts once', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send({ type: 'presence', hidden: true });
    await b.next((m) => m.type === 'roster');
    a.send({ type: 'presence', hidden: false });
    const roster = await b.next((m) => m.type === 'roster');
    assert.equal(roster.roster.find((r) => r.participantId === alice.participantId).afk, false);
    done();
  });

  it('a non-boolean or missing hidden is invalid-message and changes nothing', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send({ type: 'presence', hidden: 'yes' });
    assert.equal((await a.next((m) => m.type === 'error')).code, 'invalid-message');
    a.send({ type: 'presence' });
    assert.equal((await a.next((m) => m.type === 'error')).code, 'invalid-message');
    await settle(50);
    assert.equal(rooms.get(alice.roomId).participants.get(alice.participantId).afk, false);
    assert.equal(b.messages.filter((m) => m.type === 'roster').length, 0);
    done();
  });

  it('a newcomer\'s snapshot carries the current afk on live lines and roster', async () => {
    const { alice, a, done } = await roomWithTwo();
    a.send({ type: 'presence', hidden: true });
    await a.next((m) => m.type === 'roster');
    const carol = await join(baseUrl, alice.roomId, 'Carol');
    const c = await connect(wsUrl, carol);
    assert.equal(c.snapshot.roster.find((r) => r.participantId === alice.participantId).afk, true);
    assert.equal(c.snapshot.liveLines.find((l) => l.participantId === alice.participantId).afk, true);
    assert.equal(c.snapshot.roster.find((r) => r.participantId === carol.participantId).afk, false);
    c.ws.close();
    done();
  });

  it('a reconnect keeps afk until the new socket reports, then one roster follows', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send({ type: 'presence', hidden: true });
    await b.next((m) => m.type === 'roster');
    a.ws.close();
    await a.closed;
    const again = await connect(wsUrl, alice);
    assert.equal(again.snapshot.roster.find((r) => r.participantId === alice.participantId).afk, true);
    b.cursor = b.messages.length;
    again.send({ type: 'presence', hidden: true });
    await settle(50);
    assert.deepEqual(b.messages.slice(b.cursor), []);
    again.send({ type: 'presence', hidden: false });
    const roster = await b.next((m) => m.type === 'roster');
    assert.equal(roster.roster.find((r) => r.participantId === alice.participantId).afk, false);
    again.ws.close();
    done();
  });

  it('live text, caret, row, and roster order survive hidden and visible reports', async () => {
    const { alice, bob, a, b, done } = await roomWithTwo();
    a.send(key(1, 'char', 'h'));
    a.send(key(2, 'char', 'i'));
    a.send(key(3, 'left'));
    await b.next((m) => m.type === 'live' && m.seq === 3);
    a.send({ type: 'presence', hidden: true });
    const hidden = await b.next((m) => m.type === 'roster');
    assert.deepEqual(hidden.roster.map((r) => r.participantId), [alice.participantId, bob.participantId]);
    a.send({ type: 'presence', hidden: false });
    await b.next((m) => m.type === 'roster');
    const p = rooms.get(alice.roomId).participants.get(alice.participantId);
    assert.deepEqual([p.liveText, p.liveCaret, p.liveRow !== null], ['hi', 1, true]);
    assert.equal(b.messages.filter((m) => m.type === 'committed').length, 0);
    done();
  });

  it('a pong never clears afk', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send({ type: 'presence', hidden: true });
    await b.next((m) => m.type === 'roster');
    const p = rooms.get(alice.roomId).participants.get(alice.participantId);
    p.lastSeen = new Date(Date.now() - 30000);
    serverModule.pingSockets();
    await settle();
    assert.ok(Date.now() - p.lastSeen.getTime() < 1000, 'pong refreshes lastSeen');
    assert.equal(p.afk, true);
    done();
  });
});
```

- [ ] **Step 2: Run the suite to verify the new tests fail**

Run: `NODE_ENV=test node --test test-server-ws.js`
Expected: the new tests FAIL (`afk` is `undefined`, and `presence` gets `invalid-message` after hello).

- [ ] **Step 3: Implement on the server**

In `server/index.js`:

1. In the `POST /api/join` participant literal, after `nextSeq: 1,` add:

   ```js
       afk: false,
   ```

2. Change `rosterOf` and `liveLineOf`:

   ```js
   function rosterOf(room){
     return Array.from(room.participants.values())
       .map(p=>({participantId:p.id, handle:p.handle, color:p.color, slot:p.slot, afk:p.afk}))
       .sort((a,b)=>a.slot-b.slot);
   }
   ```

   ```js
   function liveLineOf(p){
     return {participantId:p.id, handle:p.handle, color:p.color, slot:p.slot, afk:p.afk, row:p.liveRow, text:p.liveText, caret:p.liveCaret};
   }
   ```

3. After `rosterMessage` add the presence handler:

   ```js
   // AFK is the client's tab visibility, stored here so everyone sees the
   // same value. It is separate from liveness: pongs never touch it, and a
   // reconnecting socket keeps the old value until it reports.
   function handlePresence(participant, room, msg){
     if(typeof msg.hidden !== 'boolean') return sendTo(participant, {type:'error', code:'invalid-message'});
     if(participant.afk === msg.hidden) return;
     participant.afk = msg.hidden;
     broadcast(room, rosterMessage(room));
   }
   ```

4. In the `wss.on('connection')` message handler, replace the tail

   ```js
       if(msg && msg.type==='key') return handleKey(participant, ws.room, msg);
       sendWs(ws, {type:'error', code:'invalid-message'});
   ```

   with a dispatch on type:

   ```js
       switch(msg && msg.type){
         case 'key': return handleKey(participant, ws.room, msg);
         case 'presence': return handlePresence(participant, ws.room, msg);
         default: return sendWs(ws, {type:'error', code:'invalid-message'});
       }
   ```

5. Add `handlePresence,` to the exported object next to `handleKey,`.

- [ ] **Step 4: Update existing expectations that spell out roster and live-line shapes**

The first test in `test-server-ws.js` (`hello with a valid token receives a snapshot`) uses `assert.deepEqual` on `snap.roster` and `snap.liveLines`; add `afk: false` to both expected objects. Search the three server suites for other `deepEqual` calls against full roster entries or live lines (`grep -n "slot: 0" test-server-*.js`) and add `afk: false` there too.

- [ ] **Step 5: Run all server suites**

Run: `npm test`
Expected: PASS, including the eight new tests.

- [ ] **Step 6: Document the wire change**

In `docs/PROTOCOL.md`:

1. Under "Client to server", after the `key` lines in the code block add:

   ```ts
   { type: "presence", hidden: boolean }
   ```

   and after the paragraph that starts "`hello` must be the first message" add:

   ```markdown
   `presence` reports the tab's visibility (`document.hidden`). The client
   sends it once after every snapshot and again whenever visibility changes.
   It is not numbered and does not enter the keystroke sequence.
   ```

2. In the snapshot schema and the `roster` schema, add `afk: boolean` after `slot: number` in the `liveLines` and `roster` entry types (three places: snapshot `liveLines`, snapshot `roster`, and the broadcast `roster`).

3. In the paragraph after the broadcast schemas, after "`roster` follows any join or leave." add: "It also follows a `presence` report that changes the participant's `afk` value; a report that changes nothing sends nothing."

4. In the Emission order table add a row:

   ```markdown
   | `presence` with a new value | `roster` to everyone; nothing when the value is unchanged |
   ```

5. Under "Edge cases", add a bullet:

   ```markdown
   - A `presence` message whose `hidden` is not a boolean: `error
     invalid-message`, nothing changes.
   ```

6. Under "Presence and lifetime", add a bullet:

   ```markdown
   - AFK is separate from liveness. The server owns each participant's `afk`
     flag, set only by that participant's `presence` reports and carried in
     snapshots and roster broadcasts. Pongs and keystrokes refresh `lastSeen`
     and never change `afk`. A reconnecting socket keeps the stored value
     until its post-snapshot report replaces it, so a hidden tab that
     reconnects never flashes active. Stale cleanup removes the participant
     and the flag with them.
   ```

- [ ] **Step 7: Commit**

```bash
git add server/index.js test-server-ws.js docs/PROTOCOL.md
git commit -m "Store and broadcast AFK status from client presence reports

A presence message after hello sets a server-owned afk flag carried on
snapshot live lines and roster entries. Only a changed value broadcasts a
roster, pongs never touch it, and the stored value survives a reconnect
until the new socket reports. The post-hello handler now dispatches on
message type."
```

---

### Task 2: Client wire types, connection report, and reducer

**Files:**
- Modify: `client/src/protocol.ts`
- Modify: `client/src/connection.ts`
- Modify: `client/src/connection.test.ts`
- Modify: `client/src/roomState.test.ts`
- Modify: `client/src/testing/roomFixtures.tsx` and any test that builds a `RosterEntry` inline

**Interfaces:**
- Produces: `RoomConnection.setHidden(hidden: boolean): void`; `afk: boolean` on `RosterEntry` and `LiveLine`; `ClientMessage` gains `{ type: 'presence'; hidden: boolean }`.

- [ ] **Step 1: Write the failing connection tests**

Append to the `describe('openRoomConnection', ...)` block in `client/src/connection.test.ts`:

```ts
  it('setHidden before the first snapshot sends presence right after it, after replayed keystrokes', () => {
    const { connection } = open();
    connection.setHidden(true);
    connection.send({ kind: 'char', char: 'A' });
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    expect(ws.sent.filter((m) => m.type === 'presence')).toEqual([]);
    ws.serverSend(snapshot(1));
    expect(ws.sent.slice(1)).toEqual([
      { type: 'key', seq: 1, kind: 'char', char: 'A' },
      { type: 'presence', hidden: true },
    ]);
  });

  it('setHidden while open transmits at once and does not consume a sequence number', () => {
    const { connection } = open();
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(1));
    connection.setHidden(true);
    connection.setHidden(false);
    connection.send({ kind: 'enter' });
    expect(ws.sent.slice(1)).toEqual([
      { type: 'presence', hidden: true },
      { type: 'presence', hidden: false },
      { type: 'key', seq: 1, kind: 'enter' },
    ]);
  });

  it('setHidden while reconnecting is remembered and sent after the next snapshot', () => {
    const { connection } = open();
    vi.runOnlyPendingTimers();
    const first = FakeWebSocket.latest();
    first.serverSend(snapshot(1));
    first.serverClose();
    connection.setHidden(true);
    // First pass fires the reconnect delay, second pass opens the new fake socket.
    vi.runOnlyPendingTimers();
    vi.runOnlyPendingTimers();
    const second = FakeWebSocket.latest();
    expect(second).not.toBe(first);
    expect(second.sent).toEqual([{ type: 'hello', ...creds }]);
    second.serverSend(snapshot(1));
    expect(second.sent).toEqual([{ type: 'hello', ...creds }, { type: 'presence', hidden: true }]);
  });

  it('nothing is sent until setHidden has been called', () => {
    open();
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(1));
    expect(ws.sent.filter((m) => m.type === 'presence')).toEqual([]);
  });
```

Note: the third test relies on the fake socket opening on the next macrotask after the reconnect delay, which `vi.runOnlyPendingTimers()` covers because both are timers.

- [ ] **Step 2: Write the failing reducer tests**

In `client/src/roomState.test.ts`, add `afk: false` to the `alice` and `bob` constants at the top, and append to the `describe('applyServerMessage', ...)` block:

```ts
  it('snapshot live lines carry afk into participants', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({
      liveLines: [{ ...bob, afk: true, row: null, text: '', caret: 0 }, { ...alice, row: null, text: '', caret: 0 }],
    }));
    expect(room.participants.map((p) => [p.handle, p.afk])).toEqual([['Alice', false], ['Bob', true]]);
  });

  it('a roster message that changes only afk keeps row, text, and caret', () => {
    let room = applyServerMessage(emptyRoom(), snapshot());
    room = applyServerMessage(room, { type: 'live', participantId: 20, row: 2, text: 'hi', caret: 1, seq: 1 });
    room = applyServerMessage(room, { type: 'roster', roster: [{ ...bob, afk: true }, alice] });
    expect(room.participants.find((p) => p.participantId === 20)).toMatchObject({ afk: true, row: 2, text: 'hi', caret: 1 });
  });
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `npm --prefix client test -- src/connection.test.ts src/roomState.test.ts`
Expected: FAIL. `setHidden` is not a function; `afk` is `undefined` on the reducer output only if the type change is missing (the reducer spreads entries, so the second reducer test may already pass once the fixtures carry `afk`; that is fine).

- [ ] **Step 4: Change the wire types**

In `client/src/protocol.ts`:

```ts
export type LiveLine = { participantId: number; handle: string; color: string; slot: number; afk: boolean; row: number | null; text: string; caret: number };
export type RosterEntry = { participantId: number; handle: string; color: string; slot: number; afk: boolean };
```

and extend `ClientMessage`:

```ts
export type PresenceMessage = { type: 'presence'; hidden: boolean };
export type ClientMessage = { type: 'hello'; roomId: number; participantId: number; token: string } | KeyMessage | PresenceMessage;
```

- [ ] **Step 5: Add `setHidden` to the connection**

In `client/src/connection.ts`:

1. Extend the returned type:

   ```ts
   export type RoomConnection = {
     // Numbers and queues a keystroke; false means the queue is full and it was dropped.
     send: (key: KeyInput) => boolean;
     // Reports tab visibility. Sent at once when open, and again after every snapshot.
     setHidden: (hidden: boolean) => void;
     close: () => void;
   };
   ```

2. Inside `openRoomConnection`, after `let reconnectTimer ...` add:

   ```ts
     // Presence is not a keystroke: no number, no queue, no replay. The last
     // value is re-sent after every snapshot so a reconnect reports the
     // current visibility rather than leaving a stale value on the server.
     let hidden: boolean | null = null;
     const sendPresence = () => { if (hidden != null && ready) transmit({ type: 'presence', hidden }); };
   ```

3. In `receive`, in the snapshot branch, after `ready = true;` and before `handlers.onStatus('open');` add:

   ```ts
         sendPresence();
   ```

4. In the returned object add:

   ```ts
       setHidden(next) {
         hidden = next;
         sendPresence();
       },
   ```

- [ ] **Step 6: Carry `afk` through the fixtures and inline entries**

- `client/src/testing/roomFixtures.tsx`: add `afk: false` to `alice` and `bob`.
- `client/src/roomState.test.ts`: `alice`, `bob` (done in Step 2) and the inline `Carol` entry in the `'roster removes departed participants'` test.
- `client/src/App.roster.test.tsx`: the inline `carol` constant.
- Any other inline `RosterEntry` object the type check reports (`npm --prefix client run typecheck` lists them), for example `carol` in `client/src/App.mentions.test.tsx` and `client/src/mentions.test.ts` if task 25 has landed.

The reducer itself needs no change: its `roster` case spreads each entry, so `afk` flows through, and its `live` case keeps the existing participant fields.

- [ ] **Step 7: Run the suites and the type check**

Run: `npm --prefix client test && npm --prefix client run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/protocol.ts client/src/connection.ts client/src/connection.test.ts client/src/roomState.test.ts client/src/testing/roomFixtures.tsx client/src/App.roster.test.tsx
git commit -m "Report tab visibility over the socket and carry afk in room state

The connection remembers the last visibility, sends it as a presence
message when open and after every snapshot, and never numbers it. Roster
entries and live lines carry the server-owned afk flag."
```

Add any other test files you touched in Step 6 to the `git add` list.

---

### Task 3: Visibility listener and the roster marker

**Files:**
- Modify: `client/src/useRoomConnection.ts`
- Modify: `client/src/App.tsx` (roster entry)
- Modify: `client/src/theme.css`
- Modify: `client/src/App.roster.test.tsx`

**Interfaces:**
- Consumes: `connection.setHidden` from Task 2.

- [ ] **Step 1: Write the failing component tests**

Append to the `describe('Roster', ...)` block in `client/src/App.roster.test.tsx`:

```tsx
  it('shows a dim afk marker beside a hidden participant and removes it when they return', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    await screen.findByText('Bob');
    expect(screen.queryByText('afk')).toBeNull();
    serverSend(ws, { type: 'roster', roster: [alice, { ...bob, afk: true }] });
    const marker = await screen.findByText('afk');
    expect(marker).toHaveClass('roster-afk');
    expect(marker).toHaveAttribute('title', 'In a background tab');
    expect(marker.closest('.roster-entry')).toHaveStyle({ color: '#0ff' });
    expect(marker.closest('.roster-entry')?.querySelector('.roster-handle')?.textContent).toBe('Bob');
    serverSend(ws, { type: 'roster', roster: [alice, bob] });
    await waitFor(() => expect(screen.queryByText('afk')).toBeNull());
  });

  it('a status-only roster message is not a newcomer: the title does not rotate', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    await screen.findByText('Bob');
    serverSend(ws, { type: 'roster', roster: [alice, { ...bob, afk: true }] });
    await screen.findByText('afk');
    // A newcomer rotates "<handle> joined" through the title; a status change must not.
    expect(document.title).not.toMatch(/joined/);
  });

  it('reports the tab visibility after the snapshot and on every change', async () => {
    const { ws } = await renderJoined();
    await waitFor(() => expect(ws.sent.filter((m: any) => m.type === 'presence')).toEqual([{ type: 'presence', hidden: false }]));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(ws.sent.filter((m: any) => m.type === 'presence')).toEqual([{ type: 'presence', hidden: false }, { type: 'presence', hidden: true }]);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(ws.sent.filter((m: any) => m.type === 'presence').length).toBe(3);
  });
```

Add `waitFor` to the Testing Library import at the top of the file if it is not there yet. Add an `afterEach` that restores `document.hidden`:

```ts
afterEach(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
```

(and import `afterEach` from vitest).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix client test -- src/App.roster.test.tsx`
Expected: FAIL. No `afk` text; no presence messages sent.

- [ ] **Step 3: Wire the visibility signal in the hook**

In `client/src/useRoomConnection.ts`, inside the `useEffect` that opens the connection, after `sendRef.current = connection.send;` add:

```ts
    // The browser's visibility is the AFK signal. Report it now and on
    // every change; the connection re-sends it after each reconnect.
    connection.setHidden(document.hidden);
    const onVisibility = () => connection.setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
```

and change the cleanup to:

```ts
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      connection.close();
      sendRef.current = () => false;
    };
```

- [ ] **Step 4: Render the marker**

In `client/src/App.tsx`, in the roster entry after `<span className="roster-handle">{participant.handle}</span>` add:

```tsx
              {participant.afk ? (
                <span className="roster-afk" title="In a background tab">afk</span>
              ) : null}
```

- [ ] **Step 5: Style it**

Append to `client/src/theme.css` after the `.roster-handle` rule:

```css
.roster-afk { flex:0 0 auto; color:#888; font-size:0.68rem; line-height:1.4rem; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix client test -- src/App.roster.test.tsx`
Expected: PASS.

- [ ] **Step 7: Run the client suite, type check, and build**

Run: `npm --prefix client test && npm --prefix client run typecheck && npm --prefix client run build`
Expected: PASS.

- [ ] **Step 8: Document the behavior**

In `docs/USER_EXPERIENCE.md`, under "Roster and presence", add a bullet after the first one:

```markdown
- When someone's tab is in the background, a small dim `afk` appears beside
  their name in the roster, and disappears when their tab is visible again.
  Nothing else changes: they keep their color, their unfinished line, and
  their place, and nobody is told they left or joined.
```

In `AGENTS.md`, under "Behavior to preserve", add after the handles bullet:

```markdown
- AFK follows tab visibility: the client reports `document.hidden` after
  every snapshot and on every change, the server owns the resulting `afk`
  flag carried on roster entries and snapshot live lines, and only a changed
  value broadcasts a roster. It is separate from stale detection: pongs never
  clear it, and a reconnecting socket keeps the stored value until it
  reports.
```

- [ ] **Step 9: Commit**

```bash
git add client/src/useRoomConnection.ts client/src/App.tsx client/src/theme.css client/src/App.roster.test.tsx docs/USER_EXPERIENCE.md AGENTS.md
git commit -m "Show an afk marker for participants in background tabs

The room hook reports document.hidden after the socket opens and on every
visibilitychange, and the roster shows a dim afk beside a hidden
participant's handle without touching their color."
```

---

### Task 4: Browser check

**Files:**
- Modify: `check-browser.mjs`

The Chrome DevTools protocol has no reliable switch for `document.visibilityState` in headless mode, so the check emulates the browser signal inside Bob's page by overriding `document.hidden` and dispatching `visibilitychange`. That exercises the client listener, the wire, the server, and Alice's rendering end to end; only the browser's own signal is faked. Record a manual two-tab check for that signal in the commit message.

- [ ] **Step 1: Add the sequence**

In `check-browser.mjs`, after the `'"l" Enter shows "Roster refreshed"'` check (and after the task 25 autocomplete block if it is present), insert:

```js
  // Task 31: AFK follows tab visibility. Emulate the signal in Bob's page.
  const setHidden = (t, hidden) => t.eval(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} });
    document.dispatchEvent(new Event('visibilitychange'));
    return document.hidden === ${hidden};
  })()`);
  const rosterAfk = `Array.from(document.querySelectorAll('.roster-entry')).filter((e) => e.querySelector('.roster-afk')).map((e) => e.querySelector('.roster-handle').textContent)`;
  check('Bob\'s tab reports hidden', await setHidden(bob, true));
  check('Alice sees afk beside Bob', await alice.waitFor(`${rosterAfk}.join('|') === 'Bob'`), JSON.stringify(await alice.eval(rosterAfk)));
  check('Bob\'s color and roster order are unchanged',
    await alice.eval(`${text('.roster-handle')}.join('|') === 'Alice|Bob'`));
  check('Bob\'s tab reports visible', await setHidden(bob, false));
  check('the afk marker disappears', await alice.waitFor(`${rosterAfk}.length === 0`));
```

If the task 25 block added a Carol tab and closed it, the roster order assertion still reads `Alice|Bob`; if Carol is still present, adjust the expected string.

- [ ] **Step 2: Build and run the check**

Run: `npm --prefix client run build && npm run check:browser`
Expected: all PASS including the five new lines.

- [ ] **Step 3: Manual check of the real signal**

With the server running and the client built, open two tabs as Alice and Bob, switch Bob's tab to the background (open another tab in front of it), and watch Alice's roster show `afk` beside Bob; bring Bob's tab back and watch it disappear. Note the browser and result in the commit message.

- [ ] **Step 4: Run everything**

```sh
npm test
npm --prefix client test
npm --prefix client run typecheck
npm --prefix client run build
npm run check:browser
```

Expected: all PASS. Paste the results in the report.

- [ ] **Step 5: Commit**

```bash
git add check-browser.mjs
git commit -m "Check the afk marker end to end in the browser

Bob's page emulates the visibility signal by overriding document.hidden
and dispatching visibilitychange; Alice's roster shows and clears afk.
Manually verified the real signal in <browser>: <result>."
```

---

### Task 5: Close out

- [ ] **Step 1: Mark the task done**

In `TODO.md`, change task 31's checkbox to `- [x] **Requested feature, presence** (done: ...)` with a one-line summary, remove its row from the "Recommended implementation order" table, and add 31 to the done list above it.

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "Mark task 31 complete"
```

- [ ] **Step 3: After merge**

Close GitHub issue #19 with a one-line comment naming the merge commit.
