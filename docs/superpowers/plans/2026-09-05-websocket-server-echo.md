# WebSocket Transport with Server Echo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry every keystroke over one authenticated WebSocket per participant, render text only after the server echoes it, replay unconfirmed keystrokes after a reconnect, and delete the HTTP chat routes, polling, heartbeat, and Vite dev server.

**Architecture:** The server binds a socket to a participant on `hello`, answers with a `snapshot`, and echoes each applied keystroke as the participant's whole live line (`live`) or a committed record (`committed`). The client keeps a bounded queue of unconfirmed keystrokes, a pure reducer that applies server messages to room state, and one rendering path from that state. HTTP remains for rooms, join, leave, and roster.

**Tech Stack:** Node 18+ ES modules, Express 4, `ws` 8, React 19, TypeScript 5, Vite 6 (bundler and Vitest transform only), Vitest 3 with Testing Library, Node's built-in test runner for the server.

**Spec:** `docs/superpowers/specs/2026-09-05-websocket-server-echo-design.md`

## Global Constraints

- Work on branch `websocket-server-echo`, created from `master` in Task 1. Do not commit to `master`.
- Test first for every code change: write the failing test, run it and see it fail for the right reason, make the minimal change, run it green, then commit. Never commit with a failing suite.
- One commit per task. Commit messages end with `Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq`.
- Vocabulary in code, comments, docs, and tests: **live line** (`liveText`, `liveRow`), **committed line**, **row**, **keystroke** (`key`), **sequence number** (`seq`), **snapshot**, **announcement**. Do not introduce "draft", "op", "activeContent", "lineIdx", or "history" in new code.
- Wire shapes are exactly those in the spec's Messages section. Socket path is `/ws`. Snapshot committed lines are the last 100 appended, sorted by row. Pending queue bound is 200. Reconnect delay is 1200 ms. Server ping interval is 12 s; stale timeout stays 40 s; sweep stays 15 s.
- Task 12 (last 20 lines on join) is out of scope. Do not add a 20-line window anywhere.
- Server tests: `NODE_ENV=test node --test test-server-*.js` from the repo root, or one file with `NODE_ENV=test node --test <file>`. Client tests: `npm --prefix client test`, or one file with `npm --prefix client test -- src/<file>`. Client build: `npm --prefix client run build`. The build is not a type check.
- Never include `client/dist/`, `node_modules/`, or lockfiles in a commit.
- Keep `docs/PROTOCOL.md` describing implemented behavior in the same commit as the code it describes.

---

## File structure

**Server**

- `server/index.js` (modify throughout): in-memory model, HTTP routes for rooms/join/leave/roster/health, socket handshake, keystroke handling, broadcasts, presence pings, stale sweep, static serving. Stays one file, matching the repo's pattern; it shrinks once the HTTP chat routes go.
- `test-support.js` (create, Task 2): shared server-test helpers: start server on port 0, HTTP `post`, `newRoom`, `join`, `openSocket`, `connect`, `settle`. Not matched by the `test-server-*.js` glob, so it is not run as a suite.
- `test-server-ws.js` (create, Task 2; extend Tasks 3, 4, 5): the socket protocol suite.
- `test-server-api.js` (modify, Tasks 5, 6): surviving HTTP cases only.
- `test-server-logic.js` (modify, Task 6): pure helpers with renamed fields.
- Deleted in Task 5: `test-server-seq.js`, `test-server-regression-enter-latency.js`. Deleted in Task 2: `test-server-websocket.js`.

**Client**

- `client/src/protocol.ts` (create, Task 7): wire message types shared by the connection, reducer, hook, and tests.
- `client/src/roomState.ts` (create, Task 7): pure reducer `applyServerMessage` and `sortedCommitted`.
- `client/src/connection.ts` (create, Task 8): `openRoomConnection`: socket lifecycle, `hello`, pending queue, acknowledgements, reconnect, replay, `seq-gap`.
- `client/src/useRoomConnection.ts` (create, Task 10): React hook wiring the connection and reducer into state and app events.
- `client/src/documentLines.ts` (modify, Task 9): `computeDocumentLines` over the new types; `isValidChar` stays here and App imports it.
- `client/src/App.tsx` (modify, Task 10): lobby unchanged; session view rendered from `useRoomConnection`.
- `client/src/api.ts` (modify, Task 10): rooms, join, leave, roster, keepalive leave only.
- `client/src/testing/fakeWebSocket.ts` (create, Task 7): controllable WebSocket fake with a static instance registry.
- `client/src/testing/roomFixtures.tsx` (create, Task 10): session, participant, snapshot, and line fixtures plus `renderJoined`.
- `client/src/test-setup.ts` (modify, Task 7): installs the fake and resets it before each test.
- Tests: `roomState.test.ts` (Task 7), `connection.test.ts` (Task 8), `App.documentLines.test.ts` (Task 9), `App.rendering.test.tsx`, `App.roster.test.tsx` (Task 10), `App.race.test.tsx`, `App.regression.test.tsx` (Task 11). `App.test.tsx` and `theme.test.ts` stay.

**Tooling and docs**

- `client/vite.config.ts`, `client/package.json`, `package.json` (Task 1).
- `docs/PROTOCOL.md` (Tasks 1, 5, 12), `docs/DESIGN.md`, `docs/USER_EXPERIENCE.md`, `README.md`, `AGENTS.md`, `TODO.md`, `docs/SPECS_STATUS.md` (Tasks 1, 12).

---

### Task 1: Branch, Vite dev server removal, terminology section

**Files:**
- Modify: `client/vite.config.ts`, `client/package.json`, `package.json`
- Modify: `docs/PROTOCOL.md` (top of file), `AGENTS.md` (Install, run, and validate), `README.md` (Run standalone)

**Interfaces:**
- Produces: the Terminology table later tasks and docs refer to.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b websocket-server-echo master
```

- [ ] **Step 2: Write the check that fails while the dev server exists**

There is no unit test for package scripts; the check is a shell assertion. Run it now and confirm it fails:

```bash
! grep -q '"dev"' package.json client/package.json && ! grep -q 'server:' client/vite.config.ts && echo OK
```

Expected: no `OK` printed (the greps match, so the command fails).

- [ ] **Step 3: Remove the dev server**

`client/vite.config.ts` becomes:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins:[react()],
  build:{outDir:'dist'},
  test:{
    environment:'jsdom',
    setupFiles:['./src/test-setup.ts'],
    include:['src/**/*.test.{ts,tsx}'],
    globals:true,
  }
});
```

`client/package.json` scripts become `{"build":"vite build","test":"vitest run"}` (delete `dev` and `preview`).

Root `package.json` scripts become `{"build":"npm --prefix client run build","start":"node server/index.js","test":"NODE_ENV=test node --test test-server-*.js"}` (delete `dev`).

- [ ] **Step 4: Run the check, the client suite, and the build**

```bash
! grep -q '"dev"' package.json client/package.json && ! grep -q 'server:' client/vite.config.ts && echo OK
npm --prefix client test
npm --prefix client run build
```

Expected: `OK`, 40 client tests pass, build succeeds.

- [ ] **Step 5: Add the Terminology section to PROTOCOL.md**

Insert after the "Sources:" paragraph (before "## Transport and conventions"):

```markdown
## Terminology

| Term | Meaning | Name in code |
| --- | --- | --- |
| Live line | The line a participant is typing right now. At most one per participant; none while idle. | `liveText`, `liveRow` |
| Committed line | A line finished with Enter, or preserved when its author leaves. Never changes again. | `room.lines` |
| Row | A position in the shared transcript, assigned by the server. Live and committed lines share one numbering. | `row` |
| Keystroke | One client message: a character, a backspace, or Enter. | `key` |
| Sequence number | The client's running count of its keystrokes, starting at 1, used to detect replayed duplicates. | `seq` |
| Snapshot | Everything needed to render a room, sent when a socket connects. | `snapshot` |
| Announcement | A committed line the server writes when someone joins or leaves. | content starts with `* ` |

Until the socket transport lands, code still uses the older names `activeContent`, `activeLineIdx`, `lineIdx`, and `room-state` for these ideas.
```

Also in PROTOCOL.md "Transport and conventions", replace the bullet "Vite serves on port 5173 and proxies `/api` and `/health` to port 3000. It does not proxy the application's root WebSocket connection." with "There is no development proxy: the client is always served by Express from `client/dist`."

- [ ] **Step 6: Update run instructions**

In `AGENTS.md`, replace the paragraph starting "For client hot reload, run `npm run dev`..." with:

```markdown
There is no development server. After a client change, rebuild with
`npm --prefix client run build` and reload the page served by Express on
port 3000. Restart `npm start` after a server change.
```

Also delete the sentence "The root `build` script and the README's `--workspace=client` example do not match the current package setup; use the explicit `--prefix client` command." (it is stale since task 6).

In `README.md` after the "Run standalone" block add:

```markdown
There is no dev server: rebuild the client and reload after client changes.
```

- [ ] **Step 7: Commit**

```bash
git add client/vite.config.ts client/package.json package.json docs/PROTOCOL.md AGENTS.md README.md
git commit -m "Remove Vite dev server and document transcript terminology (TODO task 7)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 2: Socket handshake, snapshot, presence

**Files:**
- Create: `test-support.js`, `test-server-ws.js`
- Delete: `test-server-websocket.js`
- Modify: `server/index.js` (room objects at lines 74 and 320, `broadcastRoom` 152-158, `broadcastChar` 160-166, `wss` block 578-603, exports 620-642)

**Interfaces:**
- Produces (server): `sendWs(ws, msg)`, `sendTo(participant, msg)`, `broadcast(room, msg)`, `rosterOf(room)`, `publicLine(line)`, `liveLineOf(participant)`, `snapshotMessage(room, participant)`, exported `pingSockets()`. Participant gains `socket: WebSocket | null`. Room loses `wsClients`.
- Produces (tests): `test-support.js` exports `startServer()`, `post(baseUrl, path, body)`, `newRoom(baseUrl)`, `join(baseUrl, roomId, handle)`, `openSocket(wsUrl)`, `connect(wsUrl, creds)`, `settle(ms)`.

- [ ] **Step 1: Write the test helpers**

`test-support.js`:

```js
import WebSocket from 'ws';

process.env.NODE_ENV = 'test';
export const serverModule = await import('./server/index.js');

// Binds the shared Express/WebSocket server to a free port. Returns the base
// HTTP URL, the socket URL, and a close function for `after`.
export function startServer() {
  return new Promise((resolve) => {
    const httpServer = serverModule.server.listen(0, () => {
      const { port } = httpServer.address();
      resolve({
        baseUrl: `http://localhost:${port}`,
        wsUrl: `ws://localhost:${port}/ws`,
        close: () => new Promise((res) => httpServer.close(res)),
      });
    });
  });
}

export async function post(baseUrl, path, body) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

export async function newRoom(baseUrl) {
  return (await post(baseUrl, '/api/rooms', { forceNew: true })).json.room.id;
}

// Joins over HTTP and returns the credentials a socket `hello` needs.
export async function join(baseUrl, roomId, handle) {
  const { json } = await post(baseUrl, '/api/join', { roomId, handle });
  return { roomId, participantId: json.participant.id, token: json.participant.token, handle, color: json.participant.color };
}

// A raw socket that records every parsed message in arrival order.
export function openSocket(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const client = { ws, messages: [], cursor: 0 };
  client.opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  client.closed = new Promise((res) => ws.on('close', res));
  ws.on('message', (raw) => client.messages.push(JSON.parse(raw.toString())));
  client.send = (msg) => ws.send(JSON.stringify(msg));
  // Resolves with the next not-yet-consumed message matching `predicate`.
  client.next = (predicate = () => true, timeoutMs = 2000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      for (let i = client.cursor; i < client.messages.length; i++) {
        if (predicate(client.messages[i])) { client.cursor = i + 1; return resolve(client.messages[i]); }
      }
      if (Date.now() > deadline) return reject(new Error(`timeout; unconsumed: ${JSON.stringify(client.messages.slice(client.cursor))}`));
      setTimeout(poll, 5);
    };
    poll();
  });
  return client;
}

// Opens a socket, sends hello, and waits for the snapshot.
export async function connect(wsUrl, creds) {
  const client = openSocket(wsUrl);
  await client.opened;
  client.send({ type: 'hello', roomId: creds.roomId, participantId: creds.participantId, token: creds.token });
  client.snapshot = await client.next((m) => m.type === 'snapshot');
  return client;
}

export function settle(ms = 50) { return new Promise((res) => setTimeout(res, ms)); }
```

- [ ] **Step 2: Write the failing handshake tests**

`test-server-ws.js`:

```js
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { serverModule, startServer, post, newRoom, join, openSocket, connect, settle } from './test-support.js';

const { resetForTests, rooms } = serverModule;
let baseUrl, wsUrl, closeServer;

before(async () => { ({ baseUrl, wsUrl, close: closeServer } = await startServer()); });
after(async () => { await closeServer(); });
beforeEach(() => resetForTests());

describe('Socket handshake', () => {
  it('hello with a valid token receives a snapshot', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const client = await connect(wsUrl, alice);
    const snap = client.snapshot;
    assert.equal(snap.roomId, roomId);
    assert.deepEqual(snap.you, { participantId: alice.participantId, nextSeq: 1 });
    assert.deepEqual(snap.roster, [{ participantId: alice.participantId, handle: 'Alice', color: alice.color, slot: 0 }]);
    assert.deepEqual(snap.liveLines, [{ participantId: alice.participantId, handle: 'Alice', color: alice.color, slot: 0, row: null, text: '' }]);
    assert.equal(snap.committed.length, 1);
    const announcement = snap.committed[0];
    assert.equal(announcement.text, '* Alice joined');
    assert.equal(announcement.row, 0);
    assert.equal(announcement.handle, 'Alice');
    assert.equal(announcement.color, alice.color);
    assert.equal(typeof announcement.id, 'string');
    assert.equal(typeof announcement.committedAt, 'number');
    assert.ok(!JSON.stringify(snap).includes(alice.token), 'token must not appear in the snapshot');
    client.ws.close();
  });

  it('hello with a wrong token is rejected and the socket is closed', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const client = openSocket(wsUrl);
    await client.opened;
    client.send({ type: 'hello', roomId, participantId: alice.participantId, token: 'wrong' });
    const err = await client.next((m) => m.type === 'error');
    assert.equal(err.code, 'unauthorized');
    await client.closed;
  });

  it('a first message other than hello is rejected', async () => {
    const client = openSocket(wsUrl);
    await client.opened;
    client.send({ type: 'key', seq: 1, kind: 'char', char: 'A' });
    const err = await client.next((m) => m.type === 'error');
    assert.equal(err.code, 'unauthorized');
    await client.closed;
  });

  it('hello for a participant that no longer exists reports unknown-participant', async () => {
    const roomId = await newRoom(baseUrl);
    const keeper = await join(baseUrl, roomId, 'Keeper');
    const alice = await join(baseUrl, roomId, 'Alice');
    await post(baseUrl, '/api/leave', { roomId, participantId: alice.participantId, token: alice.token });
    const client = openSocket(wsUrl);
    await client.opened;
    client.send({ type: 'hello', roomId, participantId: alice.participantId, token: alice.token });
    const err = await client.next((m) => m.type === 'error');
    assert.equal(err.code, 'unknown-participant');
    await client.closed;
    assert.ok(keeper);
  });

  it('a second hello for the same participant replaces the first socket', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const first = await connect(wsUrl, alice);
    const second = await connect(wsUrl, alice);
    await first.closed;
    assert.equal(second.ws.readyState, WebSocket.OPEN);
    second.ws.close();
  });

  it('closing the socket does not remove the participant', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const client = await connect(wsUrl, alice);
    client.ws.close();
    await client.closed;
    const res = await fetch(`${baseUrl}/api/roster?roomId=${roomId}`);
    const { participants } = await res.json();
    assert.deepEqual(participants.map((p) => p.handle), ['Alice']);
  });

  it('malformed JSON after hello gets invalid-message and the socket stays open', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const client = await connect(wsUrl, alice);
    client.ws.send('not json');
    const err = await client.next((m) => m.type === 'error');
    assert.equal(err.code, 'invalid-message');
    assert.equal(client.ws.readyState, WebSocket.OPEN);
    client.ws.close();
  });

  it('only the /ws path accepts socket connections', async () => {
    const root = new WebSocket(wsUrl.replace(/\/ws$/, '/'));
    await assert.rejects(new Promise((res, rej) => { root.on('open', res); root.on('error', rej); }));
  });
});

describe('Presence over the socket', () => {
  it('a pong refreshes lastSeen', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const client = await connect(wsUrl, alice);
    const participant = rooms.get(roomId).participants.get(alice.participantId);
    participant.lastSeen = new Date(Date.now() - 30000);
    serverModule.pingSockets();
    await settle();
    assert.ok(Date.now() - participant.lastSeen.getTime() < 1000, 'pong should refresh presence');
    client.ws.close();
  });

  it('a silent participant is still swept after the timeout', async () => {
    const roomId = await newRoom(baseUrl);
    const keeper = await join(baseUrl, roomId, 'Keeper');
    const alice = await join(baseUrl, roomId, 'Alice');
    const room = rooms.get(roomId);
    room.participants.get(alice.participantId).lastSeen = new Date(Date.now() - 60000);
    serverModule.cleanupStaleInRoom(room);
    assert.ok(!room.participants.has(alice.participantId));
    assert.ok(room.participants.has(keeper.participantId));
  });
});

describe('Server static handling', () => {
  it('serves either the built client or the not-built message at /', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.ok(res.status === 200 || res.status === 404);
    assert.ok((await res.text()).length > 0);
  });
});
```

- [ ] **Step 3: Run the new suite and see it fail**

```bash
git rm -q test-server-websocket.js
NODE_ENV=test node --test test-server-ws.js
```

Expected: handshake and presence tests fail (timeouts waiting for `snapshot`/`error`, `pingSockets is not a function`); the static test passes.

- [ ] **Step 4: Implement the handshake**

In `server/index.js`:

Remove `wsClients:new Set()` from both room literals (line 74 in `getOrCreateRoom`, line 320 in `/api/join`). Add `socket: null` to the participant literal in `/api/join` (after `opBuffer: new Map()`).

Replace `broadcastRoom` and `broadcastChar` (lines 152-166) with:

```js
function sendWs(ws, msg){
  try{ if(ws.readyState===1) ws.send(JSON.stringify(msg)); }catch{}
}

function sendTo(participant, msg){
  if(participant.socket) sendWs(participant.socket, msg);
}

// Every participant with an open socket receives room messages, the author included.
function broadcast(room, msg){
  const payload = JSON.stringify(msg);
  for(const p of room.participants.values()){
    const ws = p.socket;
    if(ws && ws.readyState===1){ try{ ws.send(payload); }catch{} }
  }
}

// Legacy notifications for the HTTP chat routes; removed with them.
function broadcastRoom(room){ if(room) broadcast(room, {type:'room-update', roomId:room.id}); }
function broadcastChar(room, participantId, type, data){ broadcast(room, {type, roomId:room.id, participantId, ...data}); }

function rosterOf(room){
  return Array.from(room.participants.values())
    .map(p=>({participantId:p.id, handle:p.handle, color:p.color, slot:p.lineSlot}))
    .sort((a,b)=>a.slot-b.slot);
}

function publicLine(line){
  return {id:line.id, row:line.lineIdx, text:line.content, handle:line.handle, color:line.colorSnapshot, committedAt:line.committedAt};
}

function liveLineOf(p){
  return {participantId:p.id, handle:p.handle, color:p.color, slot:p.lineSlot, row:p.activeLineIdx, text:p.activeContent};
}

// Last 100 appended committed lines, sorted by row: the recovery snapshot.
function snapshotMessage(room, participant){
  return {
    type:'snapshot',
    roomId:room.id,
    you:{participantId:participant.id, nextSeq:participant.nextExpectedSeq},
    liveLines:Array.from(room.participants.values()).sort((a,b)=>a.lineSlot-b.lineSlot).map(liveLineOf),
    committed:room.lines.slice(-100).sort((a,b)=>a.lineIdx-b.lineIdx).map(publicLine),
    roster:rosterOf(room),
  };
}
```

Replace the `wss` block (lines 579-603) with:

```js
const wss = new WebSocketServer({server, path:'/ws'});

wss.on('connection', (ws)=>{
  ws.on('message', (raw)=>{
    let msg;
    try{ msg = JSON.parse(raw.toString()); }catch{ return sendWs(ws, {type:'error', code:'invalid-message'}); }
    if(!ws.participant){
      if(!msg || msg.type!=='hello'){ sendWs(ws, {type:'error', code:'unauthorized'}); return ws.close(); }
      const room = getRoom(msg.roomId);
      const participant = room && room.participants.get(Number(msg.participantId));
      if(!participant){ sendWs(ws, {type:'error', code:'unknown-participant'}); return ws.close(); }
      if(!checkParticipantAuth(participant, msg.token)){ sendWs(ws, {type:'error', code:'unauthorized'}); return ws.close(); }
      // One socket per participant: a reconnecting tab replaces its old connection.
      if(participant.socket && participant.socket!==ws){ try{ participant.socket.close(); }catch{} }
      participant.socket = ws;
      participant.lastSeen = new Date();
      ws.participant = participant;
      ws.room = room;
      return sendWs(ws, snapshotMessage(room, participant));
    }
    const participant = ws.participant;
    if(participant.socket!==ws || !ws.room.participants.has(participant.id)) return;
    participant.lastSeen = new Date();
    sendWs(ws, {type:'error', code:'invalid-message'});
  });
  ws.on('pong', ()=>{ if(ws.participant) ws.participant.lastSeen = new Date(); });
  ws.on('close', ()=>{ if(ws.participant && ws.participant.socket===ws) ws.participant.socket = null; });
});

// Presence is the socket: pings every 12 s, pongs refresh lastSeen.
export function pingSockets(){
  for(const room of rooms.values()){
    for(const p of room.participants.values()){
      const ws = p.socket;
      if(ws && ws.readyState===1){ try{ ws.ping(); }catch{} }
    }
  }
}
let pingInterval = null;
if (process.env.NODE_ENV !== 'test') {
  pingInterval = setInterval(pingSockets, 12000);
}
```

Add `pingInterval`, `broadcast`, `sendTo`, `snapshotMessage`, `rosterOf`, `publicLine`, `liveLineOf` to the `export { ... }` list.

Also: `cleanupStaleInRoom` deletes `room.participants.delete(s.id)`; before that line add `if(s.socket){ try{ s.socket.close(); }catch{} }` so a stale participant's dead socket is released.

- [ ] **Step 5: Run all server suites**

```bash
NODE_ENV=test node --test test-server-*.js
```

Expected: all pass (the old `test-server-seq.js`, enter-latency, and api suites do not use sockets).

- [ ] **Step 6: Commit**

```bash
git add server/index.js test-support.js test-server-ws.js
git commit -m "Bind sockets to participants with hello and snapshot (TODO task 11)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 3: Keystrokes over the socket with sequence rules

**Files:**
- Modify: `test-server-ws.js` (append), `server/index.js` (socket message handler; new apply helpers next to the existing ones)

**Interfaces:**
- Consumes: `broadcast`, `sendTo`, `publicLine`, `greatestLineIdx`.
- Produces: `applyChar(participant, room, char)`, `applyBackspace(participant)`, `commitLive(participant, room, at)` returning the stored line, `liveMessage(participant, seq)`, `committedMessage(line, participantId, seq)`, `handleKey(participant, room, msg)`.

- [ ] **Step 1: Write the failing keystroke tests**

Append to `test-server-ws.js`:

```js
async function roomWithTwo() {
  const roomId = await newRoom(baseUrl);
  const alice = await join(baseUrl, roomId, 'Alice');   // announcement row 0
  const bob = await join(baseUrl, roomId, 'Bob');       // announcement row 1
  const a = await connect(wsUrl, alice);
  const b = await connect(wsUrl, bob);
  return { roomId, alice, bob, a, b, done: () => { a.ws.close(); b.ws.close(); } };
}
const key = (seq, kind, char) => (char === undefined ? { type: 'key', seq, kind } : { type: 'key', seq, kind, char });

describe('Keystrokes', () => {
  it('a character echoes the whole live line to sender and observer', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send(key(1, 'char', 'A'));
    const expected = { type: 'live', participantId: alice.participantId, row: 2, text: 'A', seq: 1 };
    assert.deepEqual(await a.next((m) => m.type === 'live'), expected);
    assert.deepEqual(await b.next((m) => m.type === 'live'), expected);
    done();
  });

  it('backspace shortens the line; on an empty line it still echoes and advances seq', async () => {
    const { alice, a, done } = await roomWithTwo();
    a.send(key(1, 'backspace'));
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: null, text: '', seq: 1 });
    a.send(key(2, 'char', 'A'));
    a.send(key(3, 'char', 'B'));
    a.send(key(4, 'backspace'));
    await a.next((m) => m.type === 'live' && m.seq === 3);
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: 2, text: 'A', seq: 4 });
    done();
  });

  it('enter commits the line in place and clears the live line', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send(key(1, 'char', 'A'));
    a.send(key(2, 'enter'));
    const committed = await b.next((m) => m.type === 'committed');
    assert.equal(committed.participantId, alice.participantId);
    assert.equal(committed.seq, 2);
    assert.equal(committed.line.row, 2);
    assert.equal(committed.line.text, 'A');
    assert.equal(committed.line.handle, 'Alice');
    assert.equal(committed.line.color, alice.color);
    const cleared = await b.next((m) => m.type === 'live');
    assert.deepEqual(cleared, { type: 'live', participantId: alice.participantId, row: null, text: '', seq: 2 });
    assert.ok(a.messages.some((m) => m.type === 'committed' && m.seq === 2), 'sender receives its own commit');
    done();
  });

  it('enter while idle commits an empty line on a fresh row', async () => {
    const { a, done } = await roomWithTwo();
    a.send(key(1, 'enter'));
    const committed = await a.next((m) => m.type === 'committed');
    assert.equal(committed.line.text, '');
    assert.equal(committed.line.row, 2);
    done();
  });

  it('A Enter B Backspace C in one burst: A committed, C live, Bob untouched', async () => {
    const { alice, bob, a, b, done } = await roomWithTwo();
    b.send(key(1, 'char', 'X'));
    await a.next((m) => m.type === 'live' && m.participantId === bob.participantId);
    a.send(key(1, 'char', 'A'));
    a.send(key(2, 'enter'));
    a.send(key(3, 'char', 'B'));
    a.send(key(4, 'backspace'));
    a.send(key(5, 'char', 'C'));
    await b.next((m) => m.type === 'live' && m.seq === 5);
    const aliceEvents = b.messages.filter((m) => m.participantId === alice.participantId).map((m) => (m.type === 'live' ? `live:${m.text}@${m.row}` : `committed:${m.line.text}@${m.line.row}`));
    assert.deepEqual(aliceEvents, ['live:A@3', 'committed:A@3', 'live:@null', 'live:B@4', 'live:@4', 'live:C@4']);
    const fresh = await connect(wsUrl, alice);
    const bobLive = fresh.snapshot.liveLines.find((l) => l.participantId === bob.participantId);
    assert.deepEqual([bobLive.row, bobLive.text], [2, 'X']);
    const aliceLive = fresh.snapshot.liveLines.find((l) => l.participantId === alice.participantId);
    assert.deepEqual([aliceLive.row, aliceLive.text], [4, 'C']);
    assert.ok(fresh.snapshot.committed.some((l) => l.text === 'A' && l.row === 3));
    fresh.ws.close();
    done();
  });

  it('a replayed sequence number is ignored', async () => {
    const { a, done } = await roomWithTwo();
    a.send(key(1, 'char', 'A'));
    a.send(key(1, 'char', 'A'));
    a.send(key(2, 'char', 'B'));
    const last = await a.next((m) => m.type === 'live' && m.seq === 2);
    assert.equal(last.text, 'AB');
    assert.equal(a.messages.filter((m) => m.type === 'live').length, 2);
    done();
  });

  it('a gap in sequence numbers is reported and nothing is applied', async () => {
    const { a, done } = await roomWithTwo();
    a.send(key(3, 'char', 'A'));
    const err = await a.next((m) => m.type === 'error');
    assert.deepEqual(err, { type: 'error', code: 'seq-gap', expected: 1 });
    a.send(key(1, 'char', 'B'));
    assert.equal((await a.next((m) => m.type === 'live')).text, 'B');
    done();
  });

  it('an invalid character is a no-op that still advances seq', async () => {
    const { alice, a, done } = await roomWithTwo();
    a.send(key(1, 'char', '\n'));
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: null, text: '', seq: 1 });
    a.send(key(2, 'char', 'Ж'));
    assert.equal((await a.next((m) => m.type === 'live')).text, 'Ж');
    done();
  });

  it('a key without a numeric seq or with an unknown kind is invalid-message', async () => {
    const { a, done } = await roomWithTwo();
    a.send({ type: 'key', kind: 'char', char: 'A' });
    assert.equal((await a.next((m) => m.type === 'error')).code, 'invalid-message');
    a.send({ type: 'key', seq: 1, kind: 'shout' });
    assert.equal((await a.next((m) => m.type === 'error')).code, 'invalid-message');
    a.send(key(1, 'char', 'A'));
    assert.equal((await a.next((m) => m.type === 'live')).text, 'A');
    done();
  });

  it('a reconnect snapshot carries nextSeq and the last 100 committed lines by row', async () => {
    const { alice, a, done } = await roomWithTwo();
    for (let seq = 1; seq <= 120; seq++) a.send(key(seq, 'enter'));
    await a.next((m) => m.type === 'live' && m.seq === 120);
    const fresh = await connect(wsUrl, alice);
    assert.equal(fresh.snapshot.you.nextSeq, 121);
    const rows = fresh.snapshot.committed.map((l) => l.row);
    assert.equal(rows.length, 100);
    assert.deepEqual(rows, [...rows].sort((x, y) => x - y));
    assert.equal(rows[0], 22);
    assert.equal(rows[99], 121);
    fresh.ws.close();
    done();
  });
});
```

Row arithmetic for the last test: announcements occupy rows 0 and 1; 120 empty commits take rows 2..121; the last 100 are rows 22..121.

- [ ] **Step 2: Run and see the failures**

```bash
NODE_ENV=test node --test test-server-ws.js
```

Expected: every `Keystrokes` test fails with `invalid-message` errors or timeouts.

- [ ] **Step 3: Implement keystroke handling**

Add after `snapshotMessage` in `server/index.js`:

```js
function liveMessage(p, seq){
  return {type:'live', participantId:p.id, row:p.activeLineIdx, text:p.activeContent, seq};
}

function committedMessage(line, participantId, seq){
  return {type:'committed', participantId, seq, line:publicLine(line)};
}

function newLineId(participant){
  return `line-${participant.id}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
}

function storeLine(room, participant, text, row, at){
  const line = {id:newLineId(participant), handle:participant.handle, content:text, committed:true, lineIdx:row, createdAt:at, committedAt:at.getTime(), colorSnapshot:participant.color};
  room.lines.push(line);
  return line;
}

// The first character claims the next row; backspacing to empty keeps it.
function applyChar(participant, room, char){
  if(participant.activeLineIdx == null) participant.activeLineIdx = greatestLineIdx(room)+1;
  participant.activeContent += char;
}

function applyBackspace(participant){
  participant.activeContent = participant.activeContent.slice(0,-1);
}

function commitLive(participant, room, at){
  const row = participant.activeLineIdx != null ? participant.activeLineIdx : greatestLineIdx(room)+1;
  const line = storeLine(room, participant, participant.activeContent, row, at);
  participant.activeContent = '';
  participant.activeLineIdx = null;
  return line;
}

const KEY_KINDS = new Set(['char','backspace','enter']);

// One ordered socket: equal seq applies, lower is a replay, higher is a gap.
function handleKey(participant, room, msg){
  const seq = msg.seq;
  if(typeof seq !== 'number' || !KEY_KINDS.has(msg.kind)) return sendTo(participant, {type:'error', code:'invalid-message'});
  if(seq < participant.nextExpectedSeq) return;
  if(seq > participant.nextExpectedSeq) return sendTo(participant, {type:'error', code:'seq-gap', expected:participant.nextExpectedSeq});
  participant.nextExpectedSeq++;
  if(msg.kind==='char'){
    if(isValidChar(msg.char)) applyChar(participant, room, msg.char);
    return broadcast(room, liveMessage(participant, seq));
  }
  if(msg.kind==='backspace'){
    applyBackspace(participant);
    return broadcast(room, liveMessage(participant, seq));
  }
  const line = commitLive(participant, room, new Date());
  broadcast(room, committedMessage(line, participant.id, seq));
  broadcast(room, liveMessage(participant, seq));
}
```

In the socket handler, replace the final `sendWs(ws, {type:'error', code:'invalid-message'});` line with:

```js
    if(msg && msg.type==='key') return handleKey(participant, ws.room, msg);
    sendWs(ws, {type:'error', code:'invalid-message'});
```

Add `handleKey`, `applyChar`, `applyBackspace`, `commitLive`, `liveMessage`, `committedMessage` to the exports.

- [ ] **Step 4: Run all server suites**

```bash
NODE_ENV=test node --test test-server-*.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/index.js test-server-ws.js
git commit -m "Apply keystrokes over the socket and echo live lines (TODO task 11)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 4: Commands, one leave path, join/leave/cleanup broadcasts

**Files:**
- Modify: `test-server-ws.js` (append), `server/index.js` (`cleanupStaleInRoom` 88-140, `/api/join` broadcast at 370, `/api/leave` 375-418, `handleKey`)

**Interfaces:**
- Produces: `removeParticipant(room, participant, preservedAt)`, `rosterMessage(room)`, `COMMANDS` map. `cleanupStaleInRoom` and `/api/leave` call `removeParticipant`.

- [ ] **Step 1: Write the failing tests**

Append to `test-server-ws.js`:

```js
describe('Commands', () => {
  it('l clears the line and returns a roster command without committing', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send(key(1, 'char', 'l'));
    a.send(key(2, 'enter'));
    const cleared = await b.next((m) => m.type === 'live' && m.seq === 2);
    assert.deepEqual(cleared, { type: 'live', participantId: alice.participantId, row: null, text: '', seq: 2 });
    assert.deepEqual(await a.next((m) => m.type === 'command'), { type: 'command', name: 'roster' });
    await settle();
    assert.ok(!a.messages.some((m) => m.type === 'committed' && m.line.text === 'l'));
    assert.ok(!b.messages.some((m) => m.type === 'command'), 'observers do not receive commands');
    done();
  });

  it('? returns a help command', async () => {
    const { a, done } = await roomWithTwo();
    a.send(key(1, 'char', '?'));
    a.send(key(2, 'enter'));
    assert.deepEqual(await a.next((m) => m.type === 'command'), { type: 'command', name: 'help' });
    done();
  });

  it('a command letter with surrounding spaces is ordinary chat', async () => {
    const { a, done } = await roomWithTwo();
    a.send(key(1, 'char', ' '));
    a.send(key(2, 'char', 'q'));
    a.send(key(3, 'enter'));
    const committed = await a.next((m) => m.type === 'committed');
    assert.equal(committed.line.text, ' q');
    done();
  });

  it('q leaves: sender gets the command and is closed, observers get the announcement and roster', async () => {
    const { alice, bob, a, b } = await roomWithTwo();
    a.send(key(1, 'char', 'q'));
    a.send(key(2, 'enter'));
    assert.deepEqual(await a.next((m) => m.type === 'command'), { type: 'command', name: 'leave' });
    await a.closed;
    const left = await b.next((m) => m.type === 'committed' && m.line.text === '* Alice left');
    assert.equal(left.participantId, null);
    assert.equal(left.seq, null);
    assert.equal(left.line.color, alice.color);
    const roster = await b.next((m) => m.type === 'roster');
    assert.deepEqual(roster.roster.map((r) => r.participantId), [bob.participantId]);
    assert.ok(!b.messages.some((m) => m.type === 'committed' && m.line.text === 'q'), 'the command text is not preserved');
    b.ws.close();
  });
});

describe('Join, leave, and cleanup broadcasts', () => {
  it('a join sends the announcement then the roster to existing sockets', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const a = await connect(wsUrl, alice);
    const bob = await join(baseUrl, roomId, 'Bob');
    const joined = await a.next((m) => m.type === 'committed');
    assert.equal(joined.line.text, '* Bob joined');
    assert.equal(joined.line.row, 1);
    assert.equal(joined.line.color, bob.color);
    const roster = await a.next((m) => m.type === 'roster');
    assert.deepEqual(roster.roster.map((r) => r.handle), ['Alice', 'Bob']);
    a.ws.close();
  });

  it('HTTP leave preserves nonempty text, announces, updates the roster, and closes the socket', async () => {
    const { alice, a, b } = await roomWithTwo();
    a.send(key(1, 'char', 'h'));
    a.send(key(2, 'char', 'i'));
    await b.next((m) => m.type === 'live' && m.seq === 2);
    await post(baseUrl, '/api/leave', { roomId: alice.roomId, participantId: alice.participantId, token: alice.token });
    const preserved = await b.next((m) => m.type === 'committed');
    assert.deepEqual([preserved.line.text, preserved.line.row, preserved.line.color], ['hi', 2, alice.color]);
    const left = await b.next((m) => m.type === 'committed');
    assert.deepEqual([left.line.text, left.line.row], ['* Alice left', 3]);
    assert.equal((await b.next((m) => m.type === 'roster')).roster.length, 1);
    await a.closed;
    b.ws.close();
  });

  it('leaving with an empty live line preserves nothing', async () => {
    const { alice, b } = await roomWithTwo();
    await post(baseUrl, '/api/leave', { roomId: alice.roomId, participantId: alice.participantId, token: alice.token });
    const first = await b.next((m) => m.type === 'committed');
    assert.equal(first.line.text, '* Alice left');
    b.ws.close();
  });

  it('stale cleanup preserves text at the last-seen time and announces', async () => {
    const { alice, bob, a, b } = await roomWithTwo();
    a.send(key(1, 'char', 'z'));
    await b.next((m) => m.type === 'live');
    const room = rooms.get(alice.roomId);
    const lastSeen = new Date(Date.now() - 60000);
    room.participants.get(alice.participantId).lastSeen = lastSeen;
    serverModule.cleanupStaleInRoom(room);
    const preserved = await b.next((m) => m.type === 'committed');
    assert.deepEqual([preserved.line.text, preserved.line.committedAt], ['z', lastSeen.getTime()]);
    assert.equal((await b.next((m) => m.type === 'committed')).line.text, '* Alice left');
    assert.deepEqual((await b.next((m) => m.type === 'roster')).roster.map((r) => r.participantId), [bob.participantId]);
    b.ws.close();
  });

  it('committed lines keep the author color after leaving', async () => {
    const { alice, a, b } = await roomWithTwo();
    a.send(key(1, 'char', 'x'));
    a.send(key(2, 'enter'));
    await b.next((m) => m.type === 'live' && m.seq === 2);
    await post(baseUrl, '/api/leave', { roomId: alice.roomId, participantId: alice.participantId, token: alice.token });
    await b.next((m) => m.type === 'roster');
    const colors = b.messages.filter((m) => m.type === 'committed' && m.line.handle === 'Alice').map((m) => m.line.color);
    assert.ok(colors.length >= 2);
    assert.ok(colors.every((c) => c === alice.color));
    b.ws.close();
  });
});
```

- [ ] **Step 2: Run and see the failures**

```bash
NODE_ENV=test node --test test-server-ws.js
```

Expected: the command tests see a `committed` with text `l`/`?`/`q` instead of `command`; the broadcast tests time out waiting for `committed`/`roster` (they currently get `room-update`).

- [ ] **Step 3: Implement one leave path and the commands**

In `server/index.js`, add after `committedMessage`:

```js
function rosterMessage(room){ return {type:'roster', roster:rosterOf(room)}; }

// The single exit path for HTTP leave, the q command, and stale cleanup.
// Nonempty live text is preserved as a committed line stamped `preservedAt`.
function removeParticipant(room, participant, preservedAt){
  const preserved = [];
  if(participant.activeContent.length>0){
    const row = participant.activeLineIdx != null ? participant.activeLineIdx : greatestLineIdx(room)+1;
    preserved.push(storeLine(room, participant, participant.activeContent, row, preservedAt));
  }
  preserved.push(storeLine(room, participant, `* ${participant.handle} left`, greatestLineIdx(room)+1, new Date()));
  const ws = participant.socket;
  participant.socket = null;
  room.participants.delete(participant.id);
  if(room.participants.size===0 && !room.isLobby){
    rooms.delete(room.id);
  } else {
    for(const line of preserved) broadcast(room, committedMessage(line, null, null));
    broadcast(room, rosterMessage(room));
  }
  if(ws){ try{ ws.close(); }catch{} }
}
```

Replace the body of `cleanupStaleInRoom` (lines 88-140) with:

```js
function cleanupStaleInRoom(room, excludeId=null){
  const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
  const stale = [];
  for(const p of room.participants.values()){
    if(excludeId && p.id===excludeId) continue;
    if(p.lastSeen.getTime() < cutoff) stale.push(p);
  }
  for(const s of stale) removeParticipant(room, s, s.lastSeen);
  return stale.length;
}
```

`removeParticipant` uses `storeLine`, defined later in the file; function declarations hoist, so order is fine.

Replace the `/api/leave` handler body after the auth check with:

```js
  removeParticipant(room, participant, new Date());
  res.json({freed:true});
```

In `/api/join`, replace the hand-built `room.lines.push({ id:\`join-...\`, ... })` literal (lines 358-367) with:

```js
  const joinLine = storeLine(room, participant, `* ${cleanHandle} joined`, joinLineIdx, now);
```

and replace `broadcastRoom(room);` (line 370) with:

```js
  broadcast(room, committedMessage(joinLine, null, null));
  broadcast(room, rosterMessage(room));
```

(`storeLine` must be declared before use at call time only; it is a hoisted function declaration, and `participant` already carries `handle` and `color`.)

In `handleKey`, replace the enter branch (after the backspace `if`) with:

```js
  const command = COMMANDS[participant.activeContent];
  if(command){
    participant.activeContent = '';
    participant.activeLineIdx = null;
    broadcast(room, liveMessage(participant, seq));
    sendTo(participant, {type:'command', name:command});
    if(command==='leave') removeParticipant(room, participant, new Date());
    return;
  }
  const line = commitLive(participant, room, new Date());
  broadcast(room, committedMessage(line, participant.id, seq));
  broadcast(room, liveMessage(participant, seq));
```

and define near `KEY_KINDS`:

```js
// Exactly one character and Enter: anything else, even with spaces, is chat.
const COMMANDS = {l:'roster', '?':'help', q:'leave'};
```

Export `removeParticipant` and `rosterMessage`.

- [ ] **Step 4: Run all server suites**

```bash
NODE_ENV=test node --test test-server-*.js
```

Expected: all pass. If `test-server-logic.js` "preserves nonempty and deletes empty" fails on `room.lines` order, the preserved line must be pushed before the announcement, as above.

- [ ] **Step 5: Commit**

```bash
git add server/index.js test-server-ws.js
git commit -m "Recognize commands on the server and broadcast join/leave over sockets (TODO task 10)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 5: Delete the HTTP chat routes, heartbeat, polling snapshot, and their tests; rewrite PROTOCOL.md

**Files:**
- Delete: `test-server-seq.js`, `test-server-regression-enter-latency.js`
- Modify: `test-server-api.js`, `server/index.js`, `docs/PROTOCOL.md`

**Interfaces:**
- Removes: `/api/char`, `/api/backspace`, `/api/commit`, `/api/heartbeat`, `/api/room-state`, `/api/room/:id`, `handleSeqOp`, `drainBufferedOps`, `applyCharOperation`, `applyBackspaceOperation`, `applyCommitOperation`, `broadcastRoom`, `broadcastChar`, participant `opBuffer`, room `charEvents` and `nextLineIdx`.

- [ ] **Step 1: Rewrite test-server-api.js to the surviving HTTP surface**

Replace the file's imports and setup with the shared helpers, then keep only these cases. Write the whole file:

```js
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { serverModule, startServer, post, newRoom, join, connect } from './test-support.js';

const { resetForTests, rooms, ANSI_COLORS } = serverModule;
let baseUrl, wsUrl, closeServer;

before(async () => { ({ baseUrl, wsUrl, close: closeServer } = await startServer()); });
after(async () => { await closeServer(); });
beforeEach(() => resetForTests());

async function get(path) { const res = await fetch(baseUrl + path); return { status: res.status, json: await res.json() }; }
async function snapshotFor(creds) { const c = await connect(wsUrl, creds); c.ws.close(); return c.snapshot; }

describe('/health', () => {
  it('returns ok', async () => {
    const { status, json } = await get('/health');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(typeof json.rooms, 'number');
  });
});

describe('Room creation and occupancy', () => {
  it('creates rooms via POST /api/rooms', async () => {
    const { status, json } = await post(baseUrl, '/api/rooms', { forceNew: true });
    assert.equal(status, 200);
    assert.ok(json.room.id >= 1);
    assert.match(json.room.name, /^Room \d+$/);
  });

  it('lists rooms with occupancy', async () => {
    const roomId = await newRoom(baseUrl);
    await join(baseUrl, roomId, 'a');
    await join(baseUrl, roomId, 'b');
    const { json } = await get('/api/rooms');
    const room = json.rooms.find((r) => r.id === roomId);
    assert.equal(room.occupancy, 2);
    assert.equal(room.max, 10);
  });

  it('enforces max 10 participants', async () => {
    const roomId = await newRoom(baseUrl);
    for (let i = 0; i < 10; i++) assert.equal((await post(baseUrl, '/api/join', { roomId, handle: `u${i}` })).status, 200);
    const { status, json } = await post(baseUrl, '/api/join', { roomId, handle: 'eleventh' });
    assert.equal(status, 409);
    assert.equal(json.error, 'room full');
  });

  it('deletes the room when the last participant leaves', async () => {
    const roomId = await newRoom(baseUrl);
    const only = await join(baseUrl, roomId, 'only');
    await post(baseUrl, '/api/leave', { roomId, participantId: only.participantId, token: only.token });
    assert.equal(rooms.has(roomId), false);
  });
});

describe('Join semantics', () => {
  it('blocks duplicate handle case-insensitively', async () => {
    const roomId = await newRoom(baseUrl);
    await join(baseUrl, roomId, 'Alice');
    const { status, json } = await post(baseUrl, '/api/join', { roomId, handle: 'alice' });
    assert.equal(status, 409);
    assert.equal(json.error, 'Handle already active');
  });

  it('blocks duplicate handle globally across rooms', async () => {
    const r1 = await newRoom(baseUrl);
    const r2 = await newRoom(baseUrl);
    await join(baseUrl, r1, 'Alice');
    assert.equal((await post(baseUrl, '/api/join', { roomId: r2, handle: 'ALICE' })).status, 409);
  });

  it('assigns unique colors and slots', async () => {
    const roomId = await newRoom(baseUrl);
    const colors = new Set(); const slots = new Set();
    for (let i = 0; i < 5; i++) {
      const { json } = await post(baseUrl, '/api/join', { roomId, handle: `u${i}` });
      colors.add(json.participant.color);
      slots.add(json.participant.lineSlot);
      assert.ok(ANSI_COLORS.includes(json.participant.color));
    }
    assert.equal(colors.size, 5);
    assert.equal(slots.size, 5);
  });

  it('defers ownership: no row until the first character', async () => {
    const roomId = await newRoom(baseUrl);
    const { json } = await post(baseUrl, '/api/join', { roomId, handle: 'deferred' });
    assert.equal(json.participant.activeLineIdx, null);
  });

  it('rejects missing, empty, and overlong handles', async () => {
    const roomId = await newRoom(baseUrl);
    assert.equal((await post(baseUrl, '/api/join', { roomId })).status, 400);
    assert.equal((await post(baseUrl, '/api/join', { roomId, handle: '   ' })).status, 400);
    assert.equal((await post(baseUrl, '/api/join', { roomId, handle: 'x'.repeat(33) })).status, 400);
    assert.equal((await post(baseUrl, '/api/join', { roomId: 9999, handle: 'nobody' })).status, 404);
  });
});

describe('Roster', () => {
  it('is ordered by slot', async () => {
    const roomId = await newRoom(baseUrl);
    for (let i = 0; i < 3; i++) await join(baseUrl, roomId, `u${i}`);
    const { json } = await get(`/api/roster?roomId=${roomId}`);
    const slots = json.participants.map((p) => p.lineSlot);
    assert.deepEqual(slots, [...slots].sort((a, b) => a - b));
  });

  it('404s for a missing room', async () => {
    assert.equal((await get('/api/roster?roomId=424242')).status, 404);
  });
});

describe('Participant authorization (task 1)', () => {
  it('join issues an unpredictable token kept out of public state', async () => {
    const roomId = await newRoom(baseUrl);
    const a = await join(baseUrl, roomId, 'authed');
    const b = await join(baseUrl, roomId, 'authed2');
    assert.ok(a.token.length >= 16 && b.token.length >= 16);
    assert.notEqual(a.token, b.token);
    const snap = await snapshotFor(b);
    assert.ok(!JSON.stringify(snap).includes(a.token));
    const { json: roster } = await get(`/api/roster?roomId=${roomId}`);
    assert.ok(!JSON.stringify(roster).includes(a.token));
  });

  it('leave without or with a wrong token is rejected and changes nothing', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'alice');
    const bob = await join(baseUrl, roomId, 'bob');
    assert.equal((await post(baseUrl, '/api/leave', { roomId, participantId: alice.participantId })).status, 401);
    assert.equal((await post(baseUrl, '/api/leave', { roomId, participantId: alice.participantId, token: bob.token })).status, 401);
    const { json: roster } = await get(`/api/roster?roomId=${roomId}`);
    assert.deepEqual(roster.participants.map((p) => p.handle).sort(), ['alice', 'bob']);
  });

  it('leave with the right token works', async () => {
    const roomId = await newRoom(baseUrl);
    await join(baseUrl, roomId, 'keeper');
    const alice = await join(baseUrl, roomId, 'alice');
    const { json } = await post(baseUrl, '/api/leave', { roomId, participantId: alice.participantId, token: alice.token });
    assert.equal(json.freed, true);
  });
});

describe('Stale-room joins (task 4)', () => {
  function age(roomId, participantId, msAgo) { rooms.get(roomId).participants.get(participantId).lastSeen = new Date(Date.now() - msAgo); }

  it('joining a room whose last occupant went stale yields a live session', async () => {
    const roomId = await newRoom(baseUrl);
    const ghost = await join(baseUrl, roomId, 'ghost');
    age(roomId, ghost.participantId, 60000);
    const newcomer = await join(baseUrl, roomId, 'newcomer');
    const snap = await snapshotFor(newcomer);
    assert.ok(snap.roster.some((p) => p.participantId === newcomer.participantId));
    assert.ok(snap.committed.some((l) => l.text === '* newcomer joined'));
    assert.ok(!snap.roster.some((p) => p.handle === 'ghost'));
  });

  it('a stale handle is reusable and a stale nonempty live line is preserved', async () => {
    const roomId = await newRoom(baseUrl);
    const ghost = await join(baseUrl, roomId, 'ghost');
    const socket = await connect(wsUrl, ghost);
    socket.send({ type: 'key', seq: 1, kind: 'char', char: 'h' });
    socket.send({ type: 'key', seq: 2, kind: 'char', char: 'i' });
    await socket.next((m) => m.type === 'live' && m.seq === 2);
    socket.ws.close();
    age(roomId, ghost.participantId, 60000);
    const reborn = await join(baseUrl, roomId, 'ghost');
    const snap = await snapshotFor(reborn);
    assert.ok(snap.committed.some((l) => l.handle === 'ghost' && l.text === 'hi'));
  });
});
```

(`lineSlot` and `activeLineIdx` in the join response are renamed in Task 6.)

- [ ] **Step 2: Delete the obsolete suites and run**

```bash
git rm -q test-server-seq.js test-server-regression-enter-latency.js
NODE_ENV=test node --test test-server-*.js
```

Expected: all pass (the routes still exist; the tests no longer use them).

- [ ] **Step 3: Write a failing test that the routes are gone**

Append to `test-server-api.js`:

```js
describe('Retired HTTP chat routes', () => {
  it('char, backspace, commit, heartbeat, room-state, and room/:id no longer exist', async () => {
    const roomId = await newRoom(baseUrl);
    for (const path of ['/api/char', '/api/backspace', '/api/commit', '/api/heartbeat']) {
      assert.equal((await fetch(baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, path);
    }
    assert.equal((await fetch(`${baseUrl}/api/room-state?roomId=${roomId}`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/room/${roomId}`)).status, 404);
  });
});
```

Run `NODE_ENV=test node --test test-server-api.js`. Expected: this test fails (routes answer 400/200).

- [ ] **Step 4: Delete the routes and the machinery behind them**

In `server/index.js` delete:

- `applyCharOperation`, `applyBackspaceOperation`, `applyCommitOperation`, `drainBufferedOps`, `handleSeqOp` (lines 168-275).
- `broadcastRoom` and `broadcastChar`.
- The handlers `app.get('/api/room/:id', ...)`, `app.post('/api/heartbeat', ...)`, `app.post('/api/char', ...)`, `app.post('/api/backspace', ...)`, `app.post('/api/commit', ...)`, `app.get('/api/room-state', ...)`.
- `opBuffer: new Map()` from the participant literal; `charEvents:[]` and `nextLineIdx:0` from both room literals; every remaining `room.charEvents` reference (grep for it).
- Those names from the `export { ... }` list.

Express returns an empty 404 for unknown API routes when `client/dist` exists, and falls through to its default 404 otherwise; either satisfies the test.

- [ ] **Step 5: Run all server suites**

```bash
NODE_ENV=test node --test test-server-*.js
grep -n "charEvents\|opBuffer\|handleSeqOp\|broadcastRoom\|broadcastChar\|room-state" server/index.js
```

Expected: all pass; grep prints nothing.

- [ ] **Step 6: Rewrite docs/PROTOCOL.md**

Replace everything after the Terminology section with the implemented protocol. Required sections and content:

1. **Transport and conventions**: Express and the WebSocket server share one HTTP server on `PORT` or 3000. HTTP is used for rooms, join, leave, roster, health. The socket is at `/ws`, `ws:` or `wss:` matching the page. All socket messages are JSON text frames; unknown fields are ignored. Keep the existing bullets about IDs, timestamps, and error JSON for HTTP.
2. **Identity and stored state**: keep, with live line / row / announcement wording. Participant token issued at join, required in `hello`. Session storage now also holds `joinedAt`.
3. **HTTP endpoint reference**: `GET /health`, `GET /api/rooms`, `POST /api/rooms`, `POST /api/join` (response example with `activeLineIdx: null` and `lineSlot`; note these are renamed to `liveRow`/`slot` in the next change), `GET /api/roster`, `POST /api/leave` (now preserves text, announces, broadcasts `committed` and `roster`, closes the participant's socket, deletes an emptied room; page-hide beacon unchanged). Delete the char/backspace/commit/heartbeat/room-state/room-id sections and the "Sequence numbers and delivery guarantees" HTTP section.
4. **WebSocket message reference**: copy the schemas from the spec's Messages section verbatim (client to server; server to sender; server to room), then the sequence-rules table, the commands paragraph, and the edge cases list.
5. **Emission order** table: character or backspace: `live`; Enter: `committed` then `live`; command: `live` then `command` (sender only), then for `q` the leave messages; join: `committed` then `roster` to existing sockets, snapshot to the newcomer on `hello`; leave or stale cleanup: `committed` per preserved line and announcement, then `roster`; last participant removed: nothing, room deleted.
6. **Presence and lifetime**: every socket message and every pong refreshes `lastSeen`; server pings every 12 s; stale after 40 s; sweep every 15 s and on join; socket close does not remove the participant; stale cleanup preserves nonempty text stamped at `lastSeen`.
7. **Example session exchange**: a mermaid sequence diagram: `POST /api/rooms`, `POST /api/join`, `WS hello`, `WS snapshot`, `WS key char A seq 1`, `WS live` to both, `WS key enter seq 2`, `WS committed` and `WS live` to both.
8. **Client behavior**: mark as "updated when the client switches to the socket" and keep it one paragraph: the client still uses HTTP chat routes until the next change lands. (Task 12 replaces this section.)

Remove the intro sentence about optimistic display and the "Current limitations" bullets about missing replay and the sequence buffer; keep the Unicode UTF-16 deletion limitation.

- [ ] **Step 7: Commit**

```bash
git add -A server/index.js test-server-api.js test-server-seq.js test-server-regression-enter-latency.js docs/PROTOCOL.md
git commit -m "Retire HTTP chat, heartbeat, and room-state routes; document the socket protocol (TODO tasks 2, 3, 11)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 6: Rename server internals to the terminology

**Files:**
- Modify: `server/index.js`, `test-server-logic.js`, `test-server-api.js`, `docs/PROTOCOL.md` (join and roster examples)

**Interfaces:**
- Produces: participant fields `liveText`, `liveRow`, `slot`, `nextSeq`; line fields `text`, `row`, `color` (no `committed`, no `createdAt`); `greatestRow(room)`. HTTP join response participant `{id, roomId, handle, token, color, slot, liveRow, joinedAt}`; roster entries `{handle, color, slot}`.

- [ ] **Step 1: Update the tests to the new names and see them fail**

In `test-server-logic.js`: rename the import `greatestLineIdx` to `greatestRow`; in every hand-built participant replace `lineSlot` with `slot`, `activeLineIdx` with `liveRow`, `activeContent` with `liveText`; in `greatestLineIdx handles null` replace `lineIdx` with `row` and `activeLineIdx` with `liveRow` and rename the test to `greatestRow handles null liveRow`; in the cleanup test replace `room.lines.map(l => l.content)` with `room.lines.map(l => l.text)`.

In `test-server-api.js`: `json.participant.lineSlot` becomes `json.participant.slot`; `json.participant.activeLineIdx` becomes `json.participant.liveRow`; roster `p.lineSlot` becomes `p.slot`.

```bash
NODE_ENV=test node --test test-server-logic.js test-server-api.js
```

Expected: failures on undefined `greatestRow`, `slot`, `liveRow`, `text`.

- [ ] **Step 2: Rename in server/index.js**

Apply these whole-word renames across the file (check each with grep afterwards):

| Old | New |
| --- | --- |
| `activeContent` | `liveText` |
| `activeLineIdx` | `liveRow` |
| `greatestLineIdx` | `greatestRow` |
| `lineSlot` | `slot` |
| `nextExpectedSeq` | `nextSeq` |
| `colorSnapshot` | `color` (line field) |
| `lineIdx` | `row` (line field) |
| `content` | `text` (line field, in `storeLine` and `publicLine`) |

Then in `storeLine` drop `committed:true` and `createdAt`. Update `publicLine` to `({id, row, text, handle, color, committedAt}) => ({id, row, text, handle, color, committedAt})` style or leave the explicit mapping with the new names. Update `rosterOf`, `liveLineOf`, `snapshotMessage`, `liveMessage` to the new field names. In `/api/join`, the response becomes:

```js
res.json({participant:{id:participant.id, roomId:participant.roomId, handle:participant.handle, token:participant.token, color:participant.color, slot:participant.slot, liveRow:participant.liveRow, joinedAt:participant.joinedAt.getTime()}, roster, room:{id:room.id, name:room.name}});
```

and `/api/roster` maps `({handle:p.handle, color:p.color, slot:p.slot})` sorted by `slot`. The `roster` in the join response uses `slot` too.

```bash
grep -n "activeContent\|activeLineIdx\|greatestLineIdx\|lineSlot\|nextExpectedSeq\|colorSnapshot\|lineIdx\|draft" server/index.js
```

Expected: no output.

- [ ] **Step 3: Run all server suites**

```bash
NODE_ENV=test node --test test-server-*.js
```

Expected: all pass.

- [ ] **Step 4: Update PROTOCOL.md examples**

In the join response example replace `lineSlot` with `slot` and `activeLineIdx` with `liveRow`; in the roster endpoint replace `lineSlot` with `slot`; delete the "renamed in the next change" notes and the Terminology footnote about older names.

- [ ] **Step 5: Commit**

```bash
git add server/index.js test-server-logic.js test-server-api.js docs/PROTOCOL.md
git commit -m "Rename server state to live line, row, and slot terminology

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 7: Client protocol types, WebSocket fake, and room-state reducer

**Files:**
- Create: `client/src/protocol.ts`, `client/src/roomState.ts`, `client/src/roomState.test.ts`, `client/src/testing/fakeWebSocket.ts`
- Modify: `client/src/test-setup.ts`

**Interfaces:**
- Produces: types `LiveLine`, `CommittedLine`, `RosterEntry`, `CommandName`, `ErrorCode`, `ServerMessage`, `KeyInput`, `ClientMessage`; `RoomState`, `emptyRoom()`, `applyServerMessage(room, msg, joinedAt)`, `sortedCommitted(room)`; `FakeWebSocket` with `static instances`, `static latest()`, `static reset()`, `sent`, `serverSend(msg)`, `serverClose()`.

- [ ] **Step 1: Write the protocol types**

`client/src/protocol.ts`:

```ts
// Wire messages between the browser and server/index.js. See docs/PROTOCOL.md.

export type LiveLine = { participantId: number; handle: string; color: string; slot: number; row: number | null; text: string };
export type CommittedLine = { id: string; row: number; text: string; handle: string; color: string; committedAt: number };
export type RosterEntry = { participantId: number; handle: string; color: string; slot: number };
export type CommandName = 'roster' | 'help' | 'leave';
export type ErrorCode = 'unauthorized' | 'unknown-participant' | 'seq-gap' | 'invalid-message';

export type ServerMessage =
  | { type: 'snapshot'; roomId: number; you: { participantId: number; nextSeq: number }; liveLines: LiveLine[]; committed: CommittedLine[]; roster: RosterEntry[] }
  | { type: 'live'; participantId: number; row: number | null; text: string; seq: number | null }
  | { type: 'committed'; participantId: number | null; seq: number | null; line: CommittedLine }
  | { type: 'roster'; roster: RosterEntry[] }
  | { type: 'command'; name: CommandName }
  | { type: 'error'; code: ErrorCode; expected?: number };

export type KeyInput = { kind: 'char'; char: string } | { kind: 'backspace' } | { kind: 'enter' };
export type KeyMessage = { type: 'key'; seq: number } & KeyInput;
export type ClientMessage = { type: 'hello'; roomId: number; participantId: number; token: string } | KeyMessage;
```

- [ ] **Step 2: Write the failing reducer tests**

`client/src/roomState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyServerMessage, emptyRoom, sortedCommitted } from './roomState';
import type { CommittedLine, ServerMessage } from './protocol';

const alice = { participantId: 10, handle: 'Alice', color: '#fff', slot: 0 };
const bob = { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1 };
const line = (id: string, row: number, text: string, committedAt = 5): CommittedLine => ({ id, row, text, handle: 'Alice', color: '#fff', committedAt });
const snapshot = (over: Partial<Extract<ServerMessage, { type: 'snapshot' }>> = {}): ServerMessage => ({
  type: 'snapshot', roomId: 1, you: { participantId: 10, nextSeq: 1 },
  liveLines: [{ ...bob, row: null, text: '' }, { ...alice, row: null, text: '' }],
  committed: [], roster: [bob, alice], ...over,
});
const JOINED_AT = 3;

describe('applyServerMessage', () => {
  it('snapshot builds participants sorted by slot and keeps only post-join lines', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('old', 0, 'before', 1), line('new', 1, 'after', 4)] }), JOINED_AT);
    expect(room.participants.map((p) => p.handle)).toEqual(['Alice', 'Bob']);
    expect(sortedCommitted(room).map((l) => l.id)).toEqual(['new']);
  });

  it('live replaces one participant line and returns the same object when unchanged', () => {
    const room = applyServerMessage(emptyRoom(), snapshot(), JOINED_AT);
    const typed = applyServerMessage(room, { type: 'live', participantId: 20, row: 2, text: 'hi', seq: 1 }, JOINED_AT);
    expect(typed.participants.find((p) => p.participantId === 20)).toMatchObject({ row: 2, text: 'hi' });
    expect(typed.participants.find((p) => p.participantId === 10)).toMatchObject({ row: null, text: '' });
    expect(applyServerMessage(typed, { type: 'live', participantId: 20, row: 2, text: 'hi', seq: 2 }, JOINED_AT)).toBe(typed);
    expect(applyServerMessage(typed, { type: 'live', participantId: 99, row: 2, text: 'x', seq: null }, JOINED_AT)).toBe(typed);
  });

  it('committed adds a line once by id and orders by row', () => {
    let room = applyServerMessage(emptyRoom(), snapshot(), JOINED_AT);
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 2, line: line('b', 5, 'second') }, JOINED_AT);
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 3, line: line('a', 4, 'first') }, JOINED_AT);
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 3, line: line('a', 4, 'first') }, JOINED_AT);
    expect(sortedCommitted(room).map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('committed lines from before the join are ignored', () => {
    const room = applyServerMessage(applyServerMessage(emptyRoom(), snapshot(), JOINED_AT), { type: 'committed', participantId: null, seq: null, line: line('old', 0, 'x', 1) }, JOINED_AT);
    expect(room.committed.size).toBe(0);
  });

  it('roster removes departed participants and keeps live text of the rest', () => {
    let room = applyServerMessage(emptyRoom(), snapshot(), JOINED_AT);
    room = applyServerMessage(room, { type: 'live', participantId: 10, row: 2, text: 'keep', seq: 1 }, JOINED_AT);
    room = applyServerMessage(room, { type: 'roster', roster: [alice, { participantId: 30, handle: 'Carol', color: '#f0f', slot: 1 }] }, JOINED_AT);
    expect(room.participants.map((p) => p.handle)).toEqual(['Alice', 'Carol']);
    expect(room.participants[0]).toMatchObject({ row: 2, text: 'keep' });
    expect(room.participants[1]).toMatchObject({ row: null, text: '' });
  });

  it('a later snapshot never drops committed lines already seen', () => {
    let room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('a', 0, 'a'), line('b', 1, 'b'), line('c', 2, 'c')] }), JOINED_AT);
    room = applyServerMessage(room, snapshot({ committed: [line('c', 2, 'c')] }), JOINED_AT);
    expect(sortedCommitted(room).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('command and error messages leave the room unchanged', () => {
    const room = applyServerMessage(emptyRoom(), snapshot(), JOINED_AT);
    expect(applyServerMessage(room, { type: 'command', name: 'help' }, JOINED_AT)).toBe(room);
    expect(applyServerMessage(room, { type: 'error', code: 'seq-gap', expected: 4 }, JOINED_AT)).toBe(room);
  });
});
```

Run: `npm --prefix client test -- src/roomState.test.ts`. Expected: fails, module `./roomState` not found.

- [ ] **Step 3: Write the reducer**

`client/src/roomState.ts`:

```ts
import type { CommittedLine, LiveLine, ServerMessage } from './protocol';

// Everything the session view renders. `participants` carries roster fields
// plus each person's live line; `committed` accumulates every committed line
// seen since joining and is never trimmed, so scrollback outlives snapshots.
export type RoomState = { participants: LiveLine[]; committed: Map<string, CommittedLine> };

export function emptyRoom(): RoomState {
  return { participants: [], committed: new Map() };
}

const bySlot = (lines: LiveLine[]) => [...lines].sort((a, b) => a.slot - b.slot);

// Applies one server message. Lines committed before `joinedAt` are dropped:
// nothing from before you joined is shown. Returns the same object when
// nothing changed so React skips the re-render.
export function applyServerMessage(room: RoomState, msg: ServerMessage, joinedAt: number): RoomState {
  switch (msg.type) {
    case 'snapshot': {
      const committed = new Map(room.committed);
      for (const line of msg.committed) if (line.committedAt >= joinedAt) committed.set(line.id, line);
      return { participants: bySlot(msg.liveLines), committed };
    }
    case 'live': {
      const index = room.participants.findIndex((p) => p.participantId === msg.participantId);
      if (index === -1) return room;
      const current = room.participants[index];
      if (current.row === msg.row && current.text === msg.text) return room;
      const participants = room.participants.slice();
      participants[index] = { ...current, row: msg.row, text: msg.text };
      return { ...room, participants };
    }
    case 'committed': {
      if (msg.line.committedAt < joinedAt) return room;
      const committed = new Map(room.committed);
      committed.set(msg.line.id, msg.line);
      return { ...room, committed };
    }
    case 'roster': {
      const known = new Map(room.participants.map((p) => [p.participantId, p]));
      const participants = msg.roster.map((entry) => {
        const previous = known.get(entry.participantId);
        return { ...entry, row: previous?.row ?? null, text: previous?.text ?? '' };
      });
      return { ...room, participants: bySlot(participants) };
    }
    default:
      return room;
  }
}

export function sortedCommitted(room: RoomState): CommittedLine[] {
  return Array.from(room.committed.values()).sort((a, b) => a.row - b.row);
}
```

Run: `npm --prefix client test -- src/roomState.test.ts`. Expected: 7 pass.

- [ ] **Step 4: Write the WebSocket fake and install it**

`client/src/testing/fakeWebSocket.ts`:

```ts
// Stand-in for the browser WebSocket. Tests read what the app sent through
// `sent` and push server messages with `serverSend`. Instances open on the
// next macrotask unless `autoOpen` is false.
export class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static autoOpen = true;
  static reset() { FakeWebSocket.instances = []; FakeWebSocket.autoOpen = true; }
  static latest(): FakeWebSocket {
    const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!last) throw new Error('no FakeWebSocket has been opened');
    return last;
  }

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) setTimeout(() => this.open(), 0);
  }
  open() { if (this.readyState !== FakeWebSocket.CONNECTING) return; this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  send(data: string) { if (this.readyState !== FakeWebSocket.OPEN) throw new Error('socket not open'); this.sent.push(JSON.parse(data)); }
  close() { this.serverClose(); }
  serverSend(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  serverClose() { if (this.readyState === FakeWebSocket.CLOSED) return; this.readyState = FakeWebSocket.CLOSED; this.onclose?.(); }
  keys() { return this.sent.filter((m) => m.type === 'key'); }
}
```

In `client/src/test-setup.ts` replace the `MockWebSocket` class and its assignment with:

```ts
import { FakeWebSocket } from './testing/fakeWebSocket';
(globalThis as any).WebSocket = FakeWebSocket;
beforeEach(() => FakeWebSocket.reset());
```

(`beforeEach` is a Vitest global; `globals:true` is set in the Vite config.)

- [ ] **Step 5: Run the whole client suite**

```bash
npm --prefix client test
```

Expected: all pass. The existing App tests only need the socket to open and accept `send`.

- [ ] **Step 6: Commit**

```bash
git add client/src/protocol.ts client/src/roomState.ts client/src/roomState.test.ts client/src/testing/fakeWebSocket.ts client/src/test-setup.ts
git commit -m "Add client protocol types, room-state reducer, and a controllable WebSocket fake

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 8: Client connection with pending queue, replay, and reconnect

**Files:**
- Create: `client/src/connection.ts`, `client/src/connection.test.ts`

**Interfaces:**
- Consumes: `FakeWebSocket`, protocol types.
- Produces: `openRoomConnection(credentials, handlers, options?)` returning `{ send(key): boolean; close(): void }`; `ConnectionStatus`; `socketUrl(location?)`; `MAX_PENDING = 200`.

- [ ] **Step 1: Write the failing tests**

`client/src/connection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeWebSocket } from './testing/fakeWebSocket';
import { openRoomConnection, socketUrl, MAX_PENDING, type ConnectionStatus } from './connection';
import type { ServerMessage } from './protocol';

const creds = { roomId: 1, participantId: 10, token: 'tok' };
const snapshot = (nextSeq: number): ServerMessage => ({ type: 'snapshot', roomId: 1, you: { participantId: 10, nextSeq }, liveLines: [], committed: [], roster: [] });

function open(options = {}) {
  const messages: ServerMessage[] = [];
  const statuses: ConnectionStatus[] = [];
  const onInputLost = vi.fn();
  const connection = openRoomConnection(creds, { onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s), onInputLost }, { url: 'ws://test/ws', reconnectDelayMs: 100, ...options });
  return { connection, messages, statuses, onInputLost };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('openRoomConnection', () => {
  it('sends hello on open and reports open after the snapshot', () => {
    const { statuses } = open();
    expect(statuses).toEqual(['connecting']);
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    expect(ws.url).toBe('ws://test/ws');
    expect(ws.sent).toEqual([{ type: 'hello', ...creds }]);
    ws.serverSend(snapshot(1));
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('queues keystrokes typed before the snapshot and sends them in order after it', () => {
    const { connection } = open();
    expect(connection.send({ kind: 'char', char: 'A' })).toBe(true);
    expect(connection.send({ kind: 'enter' })).toBe(true);
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    expect(ws.keys()).toEqual([]);
    ws.serverSend(snapshot(1));
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'char', char: 'A' }, { type: 'key', seq: 2, kind: 'enter' }]);
    connection.send({ kind: 'backspace' });
    expect(ws.keys()[2]).toEqual({ type: 'key', seq: 3, kind: 'backspace' });
  });

  it('on reconnect resends only keystrokes the server has not echoed', () => {
    const { connection, statuses } = open();
    vi.runOnlyPendingTimers();
    const first = FakeWebSocket.latest();
    first.serverSend(snapshot(1));
    connection.send({ kind: 'char', char: 'A' });
    connection.send({ kind: 'char', char: 'B' });
    connection.send({ kind: 'char', char: 'C' });
    first.serverSend({ type: 'live', participantId: 10, row: 0, text: 'A', seq: 1 });
    first.serverSend({ type: 'live', participantId: 99, row: 1, text: 'x', seq: 2 });
    first.serverClose();
    expect(statuses.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(100);
    vi.runOnlyPendingTimers();
    const second = FakeWebSocket.latest();
    expect(second).not.toBe(first);
    second.serverSend(snapshot(2));
    expect(second.keys().map((k) => k.seq)).toEqual([2, 3]);
    expect(statuses.at(-1)).toBe('open');
  });

  it('drops pending keystrokes the reconnect snapshot shows as already applied', () => {
    const { connection } = open();
    vi.runOnlyPendingTimers();
    const first = FakeWebSocket.latest();
    first.serverSend(snapshot(1));
    connection.send({ kind: 'char', char: 'A' });
    connection.send({ kind: 'char', char: 'B' });
    first.serverClose();
    vi.advanceTimersByTime(100); vi.runOnlyPendingTimers();
    const second = FakeWebSocket.latest();
    second.serverSend(snapshot(3));
    expect(second.keys()).toEqual([]);
    connection.send({ kind: 'char', char: 'C' });
    expect(second.keys()[0].seq).toBe(3);
  });

  it('seq-gap discards the queue, adopts the expected number, and reports lost input', () => {
    const { connection, onInputLost } = open();
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(1));
    connection.send({ kind: 'char', char: 'A' });
    ws.serverSend({ type: 'error', code: 'seq-gap', expected: 7 });
    expect(onInputLost).toHaveBeenCalledTimes(1);
    connection.send({ kind: 'char', char: 'B' });
    expect(ws.keys().at(-1)).toEqual({ type: 'key', seq: 7, kind: 'char', char: 'B' });
  });

  it('refuses keystrokes when the pending queue is full', () => {
    const { connection } = open({ maxPending: 2 });
    expect(connection.send({ kind: 'char', char: 'A' })).toBe(true);
    expect(connection.send({ kind: 'char', char: 'B' })).toBe(true);
    expect(connection.send({ kind: 'char', char: 'C' })).toBe(false);
    expect(MAX_PENDING).toBe(200);
  });

  it('close stops reconnecting', () => {
    const { connection } = open();
    vi.runOnlyPendingTimers();
    const first = FakeWebSocket.latest();
    connection.close();
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    vi.advanceTimersByTime(1000); vi.runOnlyPendingTimers();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('forwards every message to onMessage', () => {
    const { messages } = open();
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(1));
    ws.serverSend({ type: 'command', name: 'help' });
    expect(messages.map((m) => m.type)).toEqual(['snapshot', 'command']);
  });
});

describe('socketUrl', () => {
  it('uses ws for http and wss for https, at /ws on the page host', () => {
    expect(socketUrl({ protocol: 'http:', host: 'localhost:3000' } as Location)).toBe('ws://localhost:3000/ws');
    expect(socketUrl({ protocol: 'https:', host: 'chat.example' } as Location)).toBe('wss://chat.example/ws');
  });
});
```

Run: `npm --prefix client test -- src/connection.test.ts`. Expected: fails, module `./connection` not found.

- [ ] **Step 2: Write the connection**

`client/src/connection.ts`:

```ts
import type { ClientMessage, KeyInput, KeyMessage, ServerMessage } from './protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';
export type ConnectionCredentials = { roomId: number; participantId: number; token: string };
export type ConnectionHandlers = {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  onInputLost: () => void;
};
export type ConnectionOptions = { url?: string; reconnectDelayMs?: number; maxPending?: number };
export type RoomConnection = {
  // Numbers and queues a keystroke; false means the queue is full and it was dropped.
  send: (key: KeyInput) => boolean;
  close: () => void;
};

export const MAX_PENDING = 200;
export const RECONNECT_DELAY_MS = 1200;

export function socketUrl(location: Location = window.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

// One socket per session. Keystrokes are numbered on the way in and held in
// `pending` until the server echoes them back (its echo carries our seq).
// After a reconnect the snapshot says which numbers the server already has;
// the rest are resent. A seq-gap means the server saw a number it never
// received: the queue is discarded and the count restarts at its value.
export function openRoomConnection(credentials: ConnectionCredentials, handlers: ConnectionHandlers, options: ConnectionOptions = {}): RoomConnection {
  const url = options.url ?? socketUrl();
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  const maxPending = options.maxPending ?? MAX_PENDING;

  let socket: WebSocket | null = null;
  let closed = false;
  let ready = false;
  let nextSeq = 1;
  let pending: KeyMessage[] = [];
  let reconnectTimer: number | null = null;

  const transmit = (msg: ClientMessage) => {
    try { socket?.send(JSON.stringify(msg)); } catch { /* the close handler reconnects */ }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
  };

  const receive = (msg: ServerMessage) => {
    if (msg.type === 'snapshot') {
      pending = pending.filter((key) => key.seq >= msg.you.nextSeq);
      if (pending.length === 0) nextSeq = msg.you.nextSeq;
      for (const key of pending) transmit(key);
      ready = true;
      handlers.onStatus('open');
    } else if ((msg.type === 'live' || msg.type === 'committed') && msg.participantId === credentials.participantId && msg.seq != null) {
      const acked = msg.seq;
      pending = pending.filter((key) => key.seq > acked);
    } else if (msg.type === 'error' && msg.code === 'seq-gap') {
      pending = [];
      if (typeof msg.expected === 'number') nextSeq = msg.expected;
      handlers.onInputLost();
    }
    handlers.onMessage(msg);
  };

  const connect = () => {
    if (closed) return;
    let current: WebSocket;
    try { current = new WebSocket(url); } catch { scheduleReconnect(); return; }
    socket = current;
    ready = false;
    current.onopen = () => transmit({ type: 'hello', ...credentials });
    current.onmessage = (event) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(event.data); } catch { return; }
      receive(msg);
    };
    current.onclose = () => {
      if (closed || socket !== current) return;
      ready = false;
      handlers.onStatus('reconnecting');
      scheduleReconnect();
    };
    current.onerror = () => { try { current.close(); } catch { /* close handler runs */ } };
  };

  handlers.onStatus('connecting');
  connect();

  return {
    send(key) {
      if (pending.length >= maxPending) return false;
      const msg: KeyMessage = { type: 'key', seq: nextSeq++, ...key };
      pending.push(msg);
      if (ready) transmit(msg);
      return true;
    },
    close() {
      closed = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      try { socket?.close(); } catch { /* already closed */ }
    },
  };
}
```

Run: `npm --prefix client test -- src/connection.test.ts`. Expected: 9 pass.

- [ ] **Step 3: Run the full client suite and commit**

```bash
npm --prefix client test
git add client/src/connection.ts client/src/connection.test.ts
git commit -m "Add client socket connection with pending-keystroke replay (TODO tasks 2, 11)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 9: Document rows over the new types

**Files:**
- Modify: `client/src/documentLines.ts`, `client/src/App.documentLines.test.ts`

**Interfaces:**
- Produces: `computeDocumentLines(committed: CommittedLine[], participants: LiveLine[]): DocumentRow[]` where `DocumentRow = { kind:'committed'; key; order; line } | { kind:'live'; key; order; participant }`; idle participants (`row === null`) produce no row. `isValidChar` unchanged. `resolveLineColor` and `sortParticipantsBySlot` removed.

- [ ] **Step 1: Rewrite the test file and see it fail**

`client/src/App.documentLines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDocumentLines, isValidChar } from './documentLines';
import type { CommittedLine, LiveLine } from './protocol';

const line = (id: string, row: number, text: string): CommittedLine => ({ id, row, text, handle: 'a', color: '#fff', committedAt: 1 });
const live = (participantId: number, row: number | null, text: string): LiveLine => ({ participantId, handle: `p${participantId}`, color: '#0f0', slot: participantId, row, text });

describe('computeDocumentLines', () => {
  it('orders committed and live rows together by row and skips idle participants', () => {
    const rows = computeDocumentLines([line('1', 0, 'hi'), line('2', 1, 'yo')], [live(10, 2, 'typing'), live(11, null, '')]);
    expect(rows.map((r) => [r.kind, r.order])).toEqual([['committed', 0], ['committed', 1], ['live', 2]]);
    expect(rows.map((r) => r.key)).toEqual(['committed:1', 'committed:2', 'live:10']);
  });

  it('keeps a committed line at its row after Enter', () => {
    const rows = computeDocumentLines([line('1', 0, 'first')], [live(10, 1, '')]);
    expect(rows[0].kind).toBe('committed');
    expect(rows[1]).toMatchObject({ kind: 'live', order: 1 });
  });

  it('a live line backspaced to empty keeps its row', () => {
    const rows = computeDocumentLines([line('1', 0, 'x'), line('2', 2, 'later')], [live(10, 1, '')]);
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it('allows multiple empty committed lines', () => {
    expect(computeDocumentLines([line('1', 0, ''), line('2', 1, '')], []).length).toBe(2);
  });

  it('a live row and a committed row never share a row; ties fall back to key order', () => {
    const rows = computeDocumentLines([line('1', 3, 'x')], [live(10, 3, 'y')]);
    expect(rows.map((r) => r.key)).toEqual(['committed:1', 'live:10']);
  });
});

describe('isValidChar', () => {
  it('allows Unicode including Cyrillic, space, and tab', () => {
    for (const c of ['a', 'Ж', 'é', ' ', '\t', '😀']) expect(isValidChar(c)).toBe(true);
  });
  it('rejects newline, controls, DEL, and multi-codepoint strings', () => {
    for (const c of ['\n', '\r', '', '', 'ab', '']) expect(isValidChar(c)).toBe(false);
  });
});
```

Run: `npm --prefix client test -- src/App.documentLines.test.ts`. Expected: type/shape failures (`order` `MAX_SAFE_INTEGER` row present, `active` kind).

- [ ] **Step 2: Rewrite documentLines.ts**

```ts
import type { CommittedLine, LiveLine } from './protocol';

export type CommittedRow = { kind: 'committed'; key: string; order: number; line: CommittedLine };
export type LiveRow = { kind: 'live'; key: string; order: number; participant: LiveLine };
export type DocumentRow = CommittedRow | LiveRow;

// Committed and live lines are one document ordered by server-assigned row.
// A row's position comes only from its number, never from its kind, so Enter
// turns a live row into a committed row without moving it. Idle participants
// (no row) take no space; their own client shows a local caret instead.
export function computeDocumentLines(committed: CommittedLine[], participants: LiveLine[]): DocumentRow[] {
  const committedRows: DocumentRow[] = committed.map((line) => ({ kind: 'committed', key: `committed:${line.id}`, order: line.row, line }));
  const liveRows: DocumentRow[] = participants.flatMap((participant) =>
    participant.row == null ? [] : [{ kind: 'live' as const, key: `live:${participant.participantId}`, order: participant.row, participant }],
  );
  return [...committedRows, ...liveRows].sort((l, r) => (l.order !== r.order ? l.order - r.order : l.key.localeCompare(r.key)));
}

// Mirrors the server's isValidChar: one code point, no CR/LF, no C0 controls
// except tab, no DEL. Keep the two in step.
export function isValidChar(char: string): boolean {
  if (typeof char !== 'string') return false;
  if (Array.from(char).length !== 1) return false;
  if (char === '\n' || char === '\r') return false;
  const code = char.charCodeAt(0);
  if (code < 32 && char !== ' ' && char !== '\t') return false;
  if (code === 127) return false;
  return true;
}
```

Run: `npm --prefix client test -- src/App.documentLines.test.ts`. Expected: 7 pass. The App suite still passes because App does not import the removed helpers yet.

- [ ] **Step 3: Commit**

```bash
npm --prefix client test
git add client/src/documentLines.ts client/src/App.documentLines.test.ts
git commit -m "Compute document rows from committed and live lines (TODO task 8)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 10: Switch the app to the socket

**Files:**
- Create: `client/src/useRoomConnection.ts`, `client/src/testing/roomFixtures.tsx`
- Modify: `client/src/App.tsx`, `client/src/api.ts`, `client/src/App.rendering.test.tsx`, `client/src/App.roster.test.tsx`, `client/src/App.test.tsx`, `client/src/App.race.test.tsx`, `client/src/App.regression.test.tsx`
- Delete: `client/src/globals.d.ts` stays (CSS module declaration).

**Interfaces:**
- Consumes: `openRoomConnection`, `applyServerMessage`, `sortedCommitted`, `computeDocumentLines`, `isValidChar`.
- Produces: `useRoomConnection(session, events)` returning `{ room, status, send }`; `Session` gains `joinedAt`; `api` without chat methods; fixtures `SESSION`, `alice`, `bob`, `storeSession`, `snapshot`, `line`, `renderJoined`.

- [ ] **Step 1: Write the fixtures**

`client/src/testing/roomFixtures.tsx`:

```tsx
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../App';
import { FakeWebSocket } from './fakeWebSocket';
import type { CommittedLine, LiveLine, RosterEntry, ServerMessage } from '../protocol';

export const SESSION = { roomId: 1, roomName: 'Room 1', participantId: 10, handle: 'Alice', token: 'test-token', joinedAt: 1 };
export const alice: RosterEntry = { participantId: 10, handle: 'Alice', color: '#fff', slot: 0 };
export const bob: RosterEntry = { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1 };

export function storeSession(session = SESSION) {
  sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
}

export function idle(entry: RosterEntry): LiveLine { return { ...entry, row: null, text: '' }; }
export function typing(entry: RosterEntry, row: number, text: string): LiveLine { return { ...entry, row, text }; }

export function line(id: string, row: number, text: string, author: RosterEntry = alice, committedAt = 2): CommittedLine {
  return { id, row, text, handle: author.handle, color: author.color, committedAt };
}

type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;
export function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return { type: 'snapshot', roomId: 1, you: { participantId: 10, nextSeq: 1 }, liveLines: [idle(alice)], committed: [], roster: [alice], ...over };
}

export function queryClient() { return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); }

// Renders the app with a stored session, waits for its hello, and answers
// with `snap`. Returns the fake socket for sending more server messages.
export async function renderJoined(snap: Snapshot = snapshot()) {
  storeSession();
  const view = render(<QueryClientProvider client={queryClient()}><App /></QueryClientProvider>);
  const ws = await waitFor(() => {
    const socket = FakeWebSocket.latest();
    if (!socket.sent.some((m) => m.type === 'hello')) throw new Error('no hello yet');
    return socket;
  });
  act(() => ws.serverSend(snap));
  return { ws, ...view };
}

export function serverSend(ws: FakeWebSocket, msg: ServerMessage) { act(() => ws.serverSend(msg)); }
```

- [ ] **Step 2: Rewrite the rendering and roster tests and see them fail**

`client/src/App.rendering.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle, typing } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
  keepaliveApi: { leaveRoom: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

describe('Rendering from server state', () => {
  it('shows Connecting until the snapshot arrives', async () => {
    const { ws } = await renderJoined(snapshot());
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
    ws.serverClose();
    expect(await screen.findByText('Reconnecting...')).toBeInTheDocument();
  });

  it('committed lines use their stored color, even with the author gone', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, 'old message', bob)] }));
    expect(await screen.findByText('old message')).toHaveStyle({ color: '#0ff' });
  });

  it('an empty committed line renders as a space', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, '')] }));
    await waitFor(() => {
      const lines = Array.from(document.querySelectorAll('.committed-line'));
      expect(lines.some((el) => el.textContent === ' ')).toBe(true);
    });
  });

  it('announcements get the system-line class', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, '* Bob joined', bob)] }));
    expect((await screen.findByText('* Bob joined')).className).toMatch(/system-line/);
  });

  it('lines committed before the join are not shown', async () => {
    await renderJoined(snapshot({ committed: [line('old', 0, 'before', alice, 0), line('new', 1, 'after', alice, 2)] }));
    expect(await screen.findByText('after')).toBeInTheDocument();
    expect(screen.queryByText('before')).not.toBeInTheDocument();
  });

  it('typing sends a keystroke and shows nothing until the server echoes it', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('A');
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'char', char: 'A' }]);
    expect(document.querySelector('.live-line')).toBeNull();
    serverSend(ws, { type: 'live', participantId: 10, row: 1, text: 'A', seq: 1 });
    expect(await screen.findByText('A')).toHaveClass('live-line');
  });

  it('Enter sends enter; the committed echo replaces the live row without moving it', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined(snapshot({ liveLines: [typing(alice, 0, 'typing')] }));
    expect(await screen.findByText('typing')).toHaveAttribute('data-document-order', '0');
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('{Enter}');
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'enter' }]);
    serverSend(ws, { type: 'committed', participantId: 10, seq: 1, line: line('c1', 0, 'typing') });
    serverSend(ws, { type: 'live', participantId: 10, row: null, text: '', seq: 1 });
    const committed = await screen.findByText('typing');
    expect(committed).toHaveClass('committed-line');
    expect(committed).toHaveAttribute('data-document-order', '0');
    expect(document.querySelector('.live-line')).toBeNull();
  });

  it('Backspace is sent even when the visible line is empty', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('{Backspace}');
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'backspace' }]);
  });

  it('a help command from the server opens the overlay; Close dismisses it', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'command', name: 'help' });
    expect(await screen.findByRole('dialog', { name: /help/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a roster command shows feedback; a leave command returns to the lobby', async () => {
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'command', name: 'roster' });
    expect(await screen.findByText('Roster refreshed')).toBeInTheDocument();
    serverSend(ws, { type: 'command', name: 'leave' });
    expect(await screen.findByText('ROOMS')).toBeInTheDocument();
    expect(sessionStorage.getItem('remart-bbs-chat.session')).toBeNull();
  });

  it('paste sends at most 100 characters and warns', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.paste('a'.repeat(150));
    expect(ws.keys().length).toBe(100);
    expect(await screen.findByText(/Paste limited to 100 characters/)).toBeInTheDocument();
  });

  it('unknown-participant ends the session with a message', async () => {
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'error', code: 'unknown-participant' });
    expect(await screen.findByText('Room session ended. Join again.')).toBeInTheDocument();
  });

  it('the caret follows the live row and the local preview appears when idle', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), typing(bob, 0, 'b')] }));
    expect(await screen.findByText('b')).toBeInTheDocument();
    expect(document.querySelector('.local-cursor-preview')).not.toBeNull();
    serverSend(ws, { type: 'live', participantId: 10, row: 1, text: 'a', seq: 1 });
    await screen.findByText('a');
    expect(document.querySelector('.local-cursor-preview')).toBeNull();
    expect(document.querySelectorAll('[aria-label="Your typing position"]').length).toBe(1);
  });
});
```

`client/src/App.roster.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { api } from './api';
import { renderJoined, serverSend, snapshot, alice, bob, idle, typing } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
  keepaliveApi: { leaveRoom: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const carol = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2 };

describe('Roster', () => {
  it('lists participants by slot with color dots', async () => {
    await renderJoined(snapshot({ liveLines: [idle(carol), idle(alice), idle(bob)], roster: [carol, alice, bob] }));
    expect(await screen.findByText('PARTICIPANTS')).toBeInTheDocument();
    const entries = document.querySelectorAll('.roster-entry');
    expect(Array.from(entries).map((e) => e.textContent)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(document.querySelectorAll('.roster-color-dot').length).toBe(3);
  });

  it('a roster message adds and removes people', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    await screen.findByText('Bob');
    serverSend(ws, { type: 'roster', roster: [alice, carol] });
    expect(await screen.findByText('Carol')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('the char counter shows the length of the own live line', async () => {
    await renderJoined(snapshot({ liveLines: [typing(alice, 0, 'hello')] }));
    expect(await screen.findByText('5 chars')).toBeInTheDocument();
  });

  it('a newcomer plays the join chirp; the first snapshot does not', async () => {
    const spy = vi.spyOn(globalThis as any, 'AudioContext');
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    expect(spy).not.toHaveBeenCalled();
    serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
```

Also reduce the `vi.mock('./api', ...)` in `client/src/App.test.tsx` to the five surviving functions. Delete `client/src/App.race.test.tsx` and `client/src/App.regression.test.tsx` now (`git rm`); Task 11 recreates them against the socket.

Run: `npm --prefix client test`. Expected: rendering and roster tests fail (the app still polls `getRoomState`, which is now undefined in the mock).

- [ ] **Step 3: Write the hook**

`client/src/useRoomConnection.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { openRoomConnection, type ConnectionStatus } from './connection';
import type { CommandName, KeyInput, ServerMessage } from './protocol';
import { applyServerMessage, emptyRoom, type RoomState } from './roomState';

export type RoomSession = { roomId: number; participantId: number; token: string; joinedAt: number };
export type RoomEvents = {
  onCommand: (name: CommandName) => void;
  onSessionEnded: () => void;
  onNewcomer: () => void;
  onNotice: (text: string) => void;
};

// Owns the socket for the current session and turns server messages into
// room state. Events that need app-level reactions (commands, session end,
// join chirp, warnings) go through `events`, read via a ref so callers can
// pass fresh closures every render.
export function useRoomConnection(session: RoomSession | null, events: RoomEvents) {
  const [room, setRoom] = useState<RoomState>(emptyRoom);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const sendRef = useRef<(key: KeyInput) => boolean>(() => false);

  const roomId = session?.roomId, participantId = session?.participantId, token = session?.token, joinedAt = session?.joinedAt;

  useEffect(() => {
    if (roomId == null || participantId == null || token == null || joinedAt == null) return;
    setRoom(emptyRoom());
    const knownIds = new Set<number>();
    let seeded = false;
    const connection = openRoomConnection({ roomId, participantId, token }, {
      onStatus: setStatus,
      onInputLost: () => eventsRef.current.onNotice('Connection recovered, some input was lost'),
      onMessage: (msg: ServerMessage) => {
        if (msg.type === 'command') return eventsRef.current.onCommand(msg.name);
        if (msg.type === 'error') {
          if (msg.code === 'unknown-participant' || msg.code === 'unauthorized') eventsRef.current.onSessionEnded();
          return;
        }
        if (msg.type === 'roster' || msg.type === 'snapshot') {
          const ids = (msg.type === 'roster' ? msg.roster : msg.liveLines).map((e) => e.participantId);
          const newcomer = seeded && ids.some((id) => !knownIds.has(id) && id !== participantId);
          knownIds.clear();
          for (const id of ids) knownIds.add(id);
          seeded = true;
          if (newcomer) eventsRef.current.onNewcomer();
        }
        setRoom((prev) => applyServerMessage(prev, msg, joinedAt));
      },
    });
    sendRef.current = connection.send;
    return () => { connection.close(); sendRef.current = () => false; };
  }, [roomId, participantId, token, joinedAt]);

  const send = (key: KeyInput) => {
    if (!sendRef.current(key)) eventsRef.current.onNotice('Not connected, input paused');
  };

  return { room, status, send };
}
```

- [ ] **Step 4: Trim api.ts**

`client/src/api.ts` becomes:

```ts
type Room = {id:number, name:string, occupancy?:number, max?:number, isLobby?:boolean};
type JoinedParticipant = {id:number, roomId:number, handle:string, token:string, color:string, slot:number, liveRow:number|null, joinedAt:number};
type RosterEntry = {handle:string, color:string, slot:number};

async function fetchJson(url:string, init?:RequestInit){
  const res = await fetch(url, {headers:{'Content-Type':'application/json'}, ...init});
  if(!res.ok){
    const txt = await res.text().catch(()=>res.statusText);
    let msg = txt;
    try{ const j=JSON.parse(txt); if(j.error) msg=j.error; }catch{}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

// HTTP covers what happens outside a room; chat travels over the socket (connection.ts).
export const api = {
  listRooms:():Promise<{rooms:Room[]}> => fetchJson('/api/rooms'),
  getOrCreateRoom:(args:{preferredId?:number, forceNew?:boolean}):Promise<{room:Room}> => fetchJson('/api/rooms', {method:'POST', body:JSON.stringify(args)}),
  joinRoom:(args:{roomId:number, handle:string}):Promise<{participant:JoinedParticipant, roster:RosterEntry[], room:Room}> => fetchJson('/api/join', {method:'POST', body:JSON.stringify(args)}),
  leaveRoom:(args:{roomId:number, participantId:number, token:string}):Promise<{freed:boolean}> => fetchJson('/api/leave', {method:'POST', body:JSON.stringify(args)}),
  getRoster:(args:{roomId:number}):Promise<{participants:RosterEntry[]}> => fetchJson(`/api/roster?roomId=${args.roomId}`),
};

export const keepaliveApi = {
  leaveRoom:(args:{roomId:number, participantId:number, token:string})=>{
    try{
      const blob = new Blob([JSON.stringify(args)], {type:'application/json'});
      // @ts-ignore
      if(navigator.sendBeacon) return navigator.sendBeacon('/api/leave', blob);
    }catch{}
    fetch('/api/leave', {method:'POST', body:JSON.stringify(args), headers:{'Content-Type':'application/json'}, keepalive:true}).catch(()=>{});
    return true;
  }
};
```

- [ ] **Step 5: Rewrite the session part of App.tsx**

Keep unchanged: `playJoinSound`, the storage helpers, `hasNameOverride`, `initialHandle`, the lobby JSX, `rememberHandle`, `joinListedRoom`, `createAndJoin`, `saveHandle`, the help overlay JSX, the `?room=` auto-join effect, the feedback/warning timers, the help-overlay Escape effect, `focusKeyboard` and its effect, `onChatScroll`, `onKeyDown`, `onKeyboardInput`.

Change:

1. Imports: drop `useQueryClient`; add `import { computeDocumentLines, isValidChar } from "./documentLines";`, `import { sortedCommitted } from "./roomState";`, `import { useRoomConnection } from "./useRoomConnection";`. Delete the local `isValidChar` function.

2. `Session` gains `joinedAt: number`. `readSession` also returns `null` when `typeof parsed.joinedAt !== "number"` (older sessions rejoin). `finishJoin` takes `participant: { id: number; handle: string; token: string; joinedAt: number }` and stores `joinedAt: participant.joinedAt`; drop the `queryClient.removeQueries` call and `setOptimisticContent(null)`.

3. Delete these declarations and everything that references only them: `optimisticContent` state and ref, `setOptimisticContent`, `pendingActions` state and ref, `pendingCommits`, `draftLineIdx`, `finishedDraftIdxsRef`, `queueRef`, `seqRef`, `prevParticipantIdsRef`, `hasInitializedParticipantsRef`, the `roomState` query, the session-expiration effect, the seq-reset effect, the pendingCommits-cleanup effect, the heartbeat effect (keep only the page-hide leave, see below), the WebSocket effect, the seq-sync effect, `ensureDraftAllocated`, `historyAccum` and its two effects, `visibleHistory`, `colorByHandle`, the `documentLines` memo, `documentSignature`, the join-sound effect, the optimistic-clear effect, `enqueue`, `clearActiveCommand`.

4. Add, after the `useState` declarations:

```tsx
  const endSession = (message: string) => {
    storageRemove("session", SESSION_KEY);
    setSession(null);
    setShowHelp(false);
    setFeedback("");
    setWarning("");
    setError(message);
  };

  const { room, status, send } = useRoomConnection(session, {
    onCommand: (name) => {
      if (name === "roster") setFeedback("Roster refreshed");
      else if (name === "help") setShowHelp(true);
      else endSession("");
    },
    onSessionEnded: () => endSession("Room session ended. Join again."),
    onNewcomer: playJoinSound,
    onNotice: setWarning,
  });

  const participants = room.participants;
  const ownParticipant = participants.find((p) => p.participantId === session?.participantId);
  const ownText = ownParticipant?.text ?? "";
  const committedLines = useMemo(() => sortedCommitted(room), [room]);
  const documentLines = useMemo(() => computeDocumentLines(committedLines, participants), [committedLines, participants]);

  useEffect(() => {
    if (!session) return;
    const currentSession = session;
    const leaveOnPageHide = () => {
      void keepaliveApi.leaveRoom({ roomId: currentSession.roomId, participantId: currentSession.participantId, token: currentSession.token });
    };
    window.addEventListener("pagehide", leaveOnPageHide);
    return () => window.removeEventListener("pagehide", leaveOnPageHide);
  }, [session]);

  useEffect(() => {
    const chat = chatRef.current;
    if (chat && wasNearBottomRef.current) chat.scrollTop = chat.scrollHeight;
  }, [documentLines]);
```

5. Replace `refreshRoster`, `leave`, `onPaste`, `appendCharacter`, `eraseCharacter`, `submitActiveLine` with:

```tsx
  const refreshRoster = () => {
    if (!session) return;
    api.getRoster({ roomId: session.roomId })
      .then(() => setFeedback("Roster refreshed"))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Roster failed"));
  };

  const leave = () => {
    if (!session) return;
    api.leaveRoom({ roomId: session.roomId, participantId: session.participantId, token: session.token })
      .catch(() => { /* the server sweeps us if the request is lost */ })
      .finally(() => endSession(""));
  };

  // Input never touches the transcript: the server's echo does.
  const appendCharacter = (char: string) => {
    if (!session || !isValidChar(char)) return;
    send({ kind: "char", char });
  };
  const eraseCharacter = () => { if (session) send({ kind: "backspace" }); };
  const submitActiveLine = () => { if (session) send({ kind: "enter" }); };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    if (!session) return;
    event.preventDefault();
    const characters = Array.from(event.clipboardData.getData("text"));
    if (characters.length > 100) setWarning("Paste limited to 100 characters");
    for (const char of characters.slice(0, 100)) if (isValidChar(char)) send({ kind: "char", char });
  };
```

The toolbar buttons keep calling `refreshRoster()`, `setShowHelp(true)`, and `leave()`; the `[q]` and `Leave` buttons both call `leave()`.

6. Session JSX changes:

- Replace the `documentLines.map` body: committed rows render as before using `line.text` and `line.color` (no `colorByHandle`), with `isSystemLine = line.text.startsWith("* ")`; live rows use `className="chat-line live-line"`, `data-line-slot={participant.slot}`, `style={{ color: participant.color }}`, content `participant.text`, and the caret when `participant.participantId === session.participantId`. Update `client/src/theme.css`: rename the `.active-line` selector to `.live-line` if present (grep; if absent, nothing to do).
- Replace `{roomState.isLoading ? <div className="chat-line system-line">Connecting...</div> : null}` with:

```tsx
        {status !== "open" ? (
          <div className="chat-line system-line" role="status">
            {status === "connecting" ? "Connecting..." : "Reconnecting..."}
          </div>
        ) : null}
```

- Local cursor preview condition becomes `ownParticipant?.row == null`.
- Char counter shows `{ownText.length} chars`.
- Roster renders `participants` (already sorted by slot) keyed by `participant.participantId`.
- Update the long comment above the session JSX: replace "Every participant owns exactly one editable line; Enter commits it in place and allocates a new one at the bottom." with "Text appears only when the server echoes it; Enter commits the live line in place and the next first character claims a new row." and delete "browser-native scrollback plus no history on join are intentional features" wording if it mentions optimistic display.

- [ ] **Step 6: Run the client suite and build**

```bash
npm --prefix client test
npm --prefix client run build
(cd client && npx tsc --noEmit -p tsconfig.json)
```

Expected: all pass, build succeeds. `tsc` must report no errors in files this plan creates or edits (`App.tsx`, `api.ts`, `connection.ts`, `roomState.ts`, `useRoomConnection.ts`, `documentLines.ts`, `protocol.ts`, `testing/*`); the build alone is not a type check. If `tsc` reports errors only in untouched files, note them in the commit body and move on.

- [ ] **Step 7: Commit**

```bash
git add client/src
git commit -m "Render the transcript from server echo over the socket (TODO tasks 10, 11)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 11: Race, reconnect, and scrollback regression tests

**Files:**
- Create: `client/src/App.race.test.tsx`, `client/src/App.regression.test.tsx`

**Interfaces:**
- Consumes: fixtures from Task 10, `FakeWebSocket`.

- [ ] **Step 1: Write the race tests**

`client/src/App.race.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { FakeWebSocket } from './testing/fakeWebSocket';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle, typing } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
  keepaliveApi: { leaveRoom: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const liveRows = () => Array.from(document.querySelectorAll('.live-line')).map((el) => el.textContent?.replace(/\s+$/, ''));

describe('Fast input under delayed echo', () => {
  it('A Enter B Backspace C: nothing renders until echo; then A committed, C live, Bob untouched', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), typing(bob, 2, 'X')], roster: [alice, bob] }));
    await screen.findByText('X');
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('A{Enter}B{Backspace}C');
    expect(ws.keys().map((k) => [k.seq, k.kind, k.char ?? ''])).toEqual([[1, 'char', 'A'], [2, 'enter', ''], [3, 'char', 'B'], [4, 'backspace', ''], [5, 'char', 'C']]);
    expect(liveRows()).toEqual(['X']);
    expect(document.querySelectorAll('.committed-line').length).toBe(0);

    serverSend(ws, { type: 'live', participantId: 10, row: 3, text: 'A', seq: 1 });
    serverSend(ws, { type: 'committed', participantId: 10, seq: 2, line: line('c1', 3, 'A') });
    serverSend(ws, { type: 'live', participantId: 10, row: null, text: '', seq: 2 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: 'B', seq: 3 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: '', seq: 4 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: 'C', seq: 5 });

    await waitFor(() => expect(liveRows()).toEqual(['X', 'C']));
    const committed = screen.getByText('A');
    expect(committed).toHaveClass('committed-line');
    expect(committed).toHaveAttribute('data-document-order', '3');
    expect(screen.getByText('X')).toHaveAttribute('data-document-order', '2');
  });

  it('a transient character then backspace from another participant is shown then cleared', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    serverSend(ws, { type: 'live', participantId: 20, row: 0, text: 'x', seq: 1 });
    expect(await screen.findByText('x')).toBeInTheDocument();
    serverSend(ws, { type: 'live', participantId: 20, row: 0, text: '', seq: 2 });
    await waitFor(() => expect(screen.queryByText('x')).not.toBeInTheDocument());
    expect(liveRows()).toEqual(['']);
  });

  it('keystrokes typed while reconnecting are sent after the new snapshot', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    ws.serverClose();
    expect(await screen.findByText('Reconnecting...')).toBeInTheDocument();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('Z');
    const next = await waitFor(() => {
      const latest = FakeWebSocket.latest();
      if (latest === ws || !latest.sent.some((m) => m.type === 'hello')) throw new Error('not reconnected');
      return latest;
    }, { timeout: 3000 });
    serverSend(next, snapshot());
    expect(next.keys()).toEqual([{ type: 'key', seq: 1, kind: 'char', char: 'Z' }]);
    await waitFor(() => expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument());
  });

  it('seq-gap shows the lost-input warning', async () => {
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'error', code: 'seq-gap', expected: 4 });
    expect(await screen.findByText('Connection recovered, some input was lost')).toBeInTheDocument();
  });

  it('a full pending queue pauses input with a warning', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.paste('a'.repeat(100));
    await user.paste('b'.repeat(100));
    expect(ws.keys().length).toBe(200);
    await user.keyboard('c');
    expect(ws.keys().length).toBe(200);
    expect(await screen.findByText('Not connected, input paused')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the regression tests**

`client/src/App.regression.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { api } from './api';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle, typing } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
  keepaliveApi: { leaveRoom: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const orders = () => Array.from(document.querySelectorAll('[data-document-order]')).map((el) => Number(el.getAttribute('data-document-order')));

describe('Transcript regressions', () => {
  it('an idle participant has no shared row; the local preview sits below', async () => {
    await renderJoined(snapshot({ liveLines: [idle(alice), typing(bob, 1, 'B')], roster: [alice, bob], committed: [line('c0', 0, 'first', bob)] }));
    await screen.findByText('B');
    expect(orders()).toEqual([0, 1]);
    expect(document.querySelector('.local-cursor-preview')).not.toBeNull();
  });

  it('a live line backspaced to empty keeps its row and position', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [typing(alice, 1, 'ab'), idle(bob)], roster: [alice, bob], committed: [line('c0', 0, 'top', bob)] }));
    await screen.findByText('ab');
    serverSend(ws, { type: 'live', participantId: 10, row: 1, text: '', seq: 1 });
    serverSend(ws, { type: 'committed', participantId: null, seq: null, line: line('c2', 2, 'later', bob) });
    await screen.findByText('later');
    expect(orders()).toEqual([0, 1, 2]);
    expect(document.querySelector('.live-line')).toHaveAttribute('data-document-order', '1');
  });

  it('scrollback survives a truncated reconnect snapshot', async () => {
    const { ws } = await renderJoined(snapshot({ committed: [line('a', 0, 'one'), line('b', 1, 'two'), line('c', 2, 'three')] }));
    await screen.findByText('three');
    serverSend(ws, snapshot({ committed: [line('c', 2, 'three')] }));
    await waitFor(() => {
      expect(screen.getByText('one')).toBeInTheDocument();
      expect(screen.getByText('two')).toBeInTheDocument();
    });
  });

  it('a reader scrolled up is not yanked down by new lines; a reader at the bottom follows', async () => {
    const { ws } = await renderJoined(snapshot({ committed: [line('a', 0, 'one')] }));
    const chat = await screen.findByLabelText('Shared chat area');
    Object.defineProperty(chat, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(chat, 'clientHeight', { configurable: true, value: 100 });
    chat.scrollTop = 0;
    fireEvent.scroll(chat);
    serverSend(ws, { type: 'committed', participantId: null, seq: null, line: line('b', 1, 'two') });
    await screen.findByText('two');
    expect(chat.scrollTop).toBe(0);
    chat.scrollTop = 900;
    fireEvent.scroll(chat);
    serverSend(ws, { type: 'committed', participantId: null, seq: null, line: line('c', 2, 'three') });
    await screen.findByText('three');
    expect(chat.scrollTop).toBe(1000);
  });

  it('switching sessions resets the transcript', async () => {
    const { ws, unmount } = await renderJoined(snapshot({ committed: [line('a', 0, 'first room')] }));
    await screen.findByText('first room');
    unmount();
    expect(ws.readyState).toBe(3);
    const second = await renderJoined(snapshot({ roomId: 2, committed: [line('z', 0, 'second room')] }));
    await screen.findByText('second room');
    expect(screen.queryByText('first room')).not.toBeInTheDocument();
    second.unmount();
  });
});
```

- [ ] **Step 3: Run and fix**

```bash
npm --prefix client test
```

Expected: all pass. If the scroll test fails, `onChatScroll` must compute nearness as `scrollHeight - scrollTop - clientHeight <= 80` and the scroll effect must run on `documentLines` change, both from Task 10. If the reconnect test times out, confirm `RECONNECT_DELAY_MS` is 1200 and the `waitFor` timeout is 3000.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.race.test.tsx client/src/App.regression.test.tsx
git commit -m "Cover fast input, reconnect replay, and scrollback under server echo (TODO task 9)

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

---

### Task 12: Docs sweep, TODO bookkeeping, and end-to-end check

**Files:**
- Modify: `docs/PROTOCOL.md` (client behavior section), `docs/DESIGN.md`, `docs/USER_EXPERIENCE.md`, `README.md`, `AGENTS.md`, `TODO.md`, `docs/SPECS_STATUS.md`

- [ ] **Step 1: PROTOCOL.md client behavior**

Replace the placeholder "Client behavior" section from Task 5 with:

- Lifecycle table: lobby polls `/api/rooms` every 1 s; joined: open `/ws`, `hello`, render on `snapshot`; unexpected close: reconnect after 1.2 s and repeat `hello`; session change or unmount: close the socket; page hide: HTTP leave beacon.
- Pending queue: keystrokes are numbered from 1 (or the snapshot's `nextSeq` when nothing is pending), queued up to 200, sent once the snapshot has arrived, and dropped when an echo carrying the own participant id and a sequence number at or above theirs arrives. On reconnect the snapshot's `nextSeq` prunes the queue and the rest is resent in order. A full queue drops keystrokes with the warning "Not connected, input paused". `seq-gap` clears the queue, adopts `expected`, and shows "Connection recovered, some input was lost".
- Session end: only `error unknown-participant`/`unauthorized`, `command leave`, or the user's own leave clears the session.
- Commands: Enter is a plain keystroke; the server decides. `command roster` shows "Roster refreshed", `help` opens the overlay, `leave` returns to the lobby. Toolbar buttons call HTTP roster/leave directly.
- Rendering: `computeDocumentLines` over accumulated committed lines and live lines; nothing renders before echo; the caret sits on the own live row or, when idle, on a local preview row below the transcript. Lines with `committedAt` before the stored `joinedAt` are hidden.

Update the "Example session exchange" note to say the browser shows `A` only when the `live` echo arrives.

- [ ] **Step 2: DESIGN.md**

Replace the section "Optimistic typing, server reconciliation" with:

```markdown
## Server echo, no local echo

- The client never shows text it has not received from the server. A
  keystroke is sent and forgotten until the server echoes the whole live
  line back; that echo is what renders, for the typist and for everyone else.
- The price is one round trip before a character appears. The gain is that
  there is exactly one rendering path and no reconciliation: no guessed row
  numbers, no pending commits, no rollback, no finished-line bookkeeping.
- Typing does not wait for echoes. Keystrokes are numbered and streamed; the
  server applies them in order and echoes each. Fast `A`, Enter, `B`,
  Backspace, `C` produces the same transcript on every screen.
- Commands (`l`, `?`, `q`) are recognized by the server against the real live
  line, so a lagging screen cannot turn a command into chat or vice versa.
```

Replace "Transport: live push, polling fallback" with:

```markdown
## Transport: one socket per participant

- One authenticated WebSocket carries everything that happens inside a room,
  both directions. There is no polling and no HTTP heartbeat: the open socket
  is presence, and a snapshot on every (re)connect is recovery.
- Unconfirmed keystrokes are kept until the server echoes them and are resent
  after a reconnect. The server ignores replays by sequence number, so a
  brief disconnect heals itself instead of losing or duplicating text. A gap
  the server cannot fill is reported, not silently swallowed.
- HTTP remains for what happens outside a room: listing and creating rooms,
  joining, leaving, and the roster button.
```

In "Scrollback belongs to the viewer" replace "The server keeps only the last 100 committed lines and hands them out as a bounded recovery snapshot" with "The snapshot sent on connect carries only the last 100 committed lines". In "Presence and disconnects" replace the heartbeat sentence with "The server pings each socket every 12 seconds; a participant silent for 40 seconds is cleaned up."

- [ ] **Step 3: USER_EXPERIENCE.md**

In "Typing" replace "Every character appears the moment you type it — for you and for everyone else watching." with "Every character appears as soon as the server has it, for you and for everyone else at the same moment. On a normal connection that is immediate; on a slow one your own text lags by the round trip, but what you see is always what everyone sees." Add to "Roster and presence":

```markdown
- A status line reads "Connecting..." or "Reconnecting..." while the room is
  not live. You can keep typing during a short reconnect; your keystrokes are
  delivered when it returns. If the outage is long, input pauses with a notice
  until the connection is back; if something was lost, you are told.
```

- [ ] **Step 4: README.md and AGENTS.md**

README structure list: `client/src/App.tsx` — "UI: rooms, typing, live updates, scrollback" stays; add `client/src/connection.ts` — "socket lifecycle and keystroke replay", `client/src/roomState.ts` — "server messages to room state"; `client/src/api.ts` — "REST client for rooms, join, leave, roster".

AGENTS.md:
- Project paragraph: "characters and backspaces appear live" stays; add "Chat travels over one WebSocket per participant; text renders only from server echo."
- Code map: update `server/index.js` ("in-memory state, room lifecycle, REST routes for rooms/join/leave/roster, socket handshake and keystroke echo, stale sweep, static serving"), `client/src/App.tsx` ("lobby/session UI, rendering from room state, input dispatch"), add `connection.ts`, `roomState.ts`, `useRoomConnection.ts`, `protocol.ts`, `testing/`. Tests: `test-server-ws.js`, `test-support.js`; client suites list.
- Install/run: already updated in Task 1; remove any remaining mention of `npm run dev`.
- "Behavior to preserve": rewrite the bullets to the new contract: server-assigned rows order live and committed lines; first character claims a row, Enter commits in place, backspace to empty keeps the row, idle has no row; text renders only from server echo; keystrokes are numbered per participant and applied in order on one socket, replayed after reconnect, duplicates ignored, gaps reported; snapshot on connect carries the last 100 committed lines, clients accumulate everything seen since joining and hide pre-join lines; presence is the socket with 12 s pings and 40 s timeout; commands are recognized by the server for exactly `l`, `?`, `q`; the rest (colors, handles, paste cap, Unicode, aesthetic) unchanged. Remove the paragraph that says TODO tasks 10–12 will replace optimistic rendering; task 12 remains pending.
- Delete the sentence "It does not configure the application's root WebSocket proxy" wherever it survives.

- [ ] **Step 5: TODO.md and SPECS_STATUS.md**

In `TODO.md`:
- Task 2: `- [x] **High priority** (done: one ordered socket; unconfirmed keystrokes replayed after reconnect, duplicates ignored by seq, gaps reported as seq-gap)`.
- Task 3: `- [x] **Medium priority** (done: no room-state poll remains; a session ends only on unknown-participant, leave command, or the user's own leave)`.
- Task 7: `- [x] **Development workflow** (done: Vite dev server removed; the built client is always served by Express)`.
- Task 10: `- [x] **Requested architecture change** (done: transcript renders only from live/committed echoes; commands recognized on the server)`.
- Task 11: `- [x] **Requested architecture change** (done: /ws carries hello, key, snapshot, live, committed, roster, command, error; HTTP chat routes retired)`.
- Task 8: `- [ ] **Maintainability** (partly done: computeDocumentLines and isValidChar are the only paths; remaining: none known, verify and close)`.
- Task 12: delete the sentence "Design the history contract during task 11;" from **Order** and the "coordinated with task 11" clause in **Work**; leave the task open.
- "Recommended implementation order" table: mark rows 4 and 5 done; the note under it that mentions designing task 12's snapshot now: delete.

In `docs/SPECS_STATUS.md` change the spec bullet to say "implemented 2026-09-05; kept as the design record" and add the plan path.

- [ ] **Step 6: Run everything**

```bash
npm test
npm --prefix client test
npm --prefix client run build
(cd client && npx tsc --noEmit -p tsconfig.json)
grep -rn "activeContent\|activeLineIdx\|lineIdx\|room-state\|heartbeat\|draft" server client/src docs/PROTOCOL.md docs/DESIGN.md docs/USER_EXPERIENCE.md README.md AGENTS.md --include=*.js --include=*.ts --include=*.tsx --include=*.md | grep -v "docs/archive"
```

Expected: both suites pass, build and type check succeed, the grep prints only intentional mentions (for example TODO history notes).

- [ ] **Step 7: End-to-end check with two browser tabs**

```bash
npm --prefix client run build
PORT=3000 npm start
```

Open `http://localhost:3000/?name=Alice` and `http://localhost:3000/?name=Bob` in two tabs, join the same room. Verify: typing in one tab appears in both only after the echo (the caret on the own row moves with the echo); Backspace and Enter behave; `?` Enter opens help in the typing tab only; `l` Enter shows "Roster refreshed"; `q` Enter returns that tab to the lobby and the other tab sees "* Alice left"; stopping and restarting the server shows "Reconnecting..." and then "Room session ended. Join again." (state is in memory). Record the outcome in the commit message body.

- [ ] **Step 8: Commit and hand off**

```bash
git add docs README.md AGENTS.md TODO.md
git commit -m "Document the socket transport and server echo; close TODO tasks 2, 3, 7, 10, 11

Claude-Session: https://claude.ai/code/session_01Pb6DtmrRCjjGMSHkaepEHq"
```

Then use superpowers:finishing-a-development-branch to merge `websocket-server-echo` into `master`.
