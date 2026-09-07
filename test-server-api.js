import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { serverModule, startServer, closeAllSockets, post, newRoom, join, connect } from './test-support.js';

const { resetForTests, rooms, ANSI_COLORS } = serverModule;
let baseUrl, wsUrl, closeServer;

before(async () => { ({ baseUrl, wsUrl, close: closeServer } = await startServer()); });
after(async () => { await closeServer(); });
beforeEach(() => resetForTests());
afterEach(closeAllSockets);

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
      slots.add(json.participant.slot);
      assert.ok(ANSI_COLORS.includes(json.participant.color));
    }
    assert.equal(colors.size, 5);
    assert.equal(slots.size, 5);
  });

  it('defers ownership: no row until the first character', async () => {
    const roomId = await newRoom(baseUrl);
    const { json } = await post(baseUrl, '/api/join', { roomId, handle: 'deferred' });
    assert.equal(json.participant.liveRow, null);
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
    const slots = json.participants.map((p) => p.slot);
    assert.deepEqual(slots, [...slots].sort((a, b) => a - b));
  });

  it('404s for a missing room', async () => {
    assert.equal((await get('/api/roster?roomId=424242')).status, 404);
  });
});

describe('Join history window (task 12)', () => {
  const key = (seq, kind) => ({ type: 'key', seq, kind });

  // Drives `count` committed lines through a socket with Enter, as the
  // snapshot tests do, then returns the participant field of a fresh join.
  async function historyFromRowAfter(count) {
    const roomId = await newRoom(baseUrl);
    const writer = await join(baseUrl, roomId, 'Writer');
    if (count > 0) {
      const client = await connect(wsUrl, writer);
      for (let seq = 1; seq <= count; seq++) client.send(key(seq, 'enter'));
      await client.next((m) => m.type === 'live' && m.seq === count);
      client.ws.close();
    }
    const { json } = await post(baseUrl, '/api/join', { roomId, handle: 'Newcomer' });
    const snap = await snapshotFor({ roomId, participantId: json.participant.id, token: json.participant.token });
    const expectedStart = Math.max(0, count - 19);
    assert.deepEqual(snap.committed.map((line) => line.row),
      Array.from({ length: count + 2 - expectedStart }, (_, i) => expectedStart + i));
    return json.participant.historyFromRow;
  }

  it('the first snapshot contains exactly 20 prior lines even when every timestamp ties', async () => {
    const roomId = await newRoom(baseUrl);
    const writer = await join(baseUrl, roomId, 'Writer');
    const client = await connect(wsUrl, writer);
    try {
      for (let seq = 1; seq <= 25; seq++) client.send(key(seq, 'enter'));
      await client.next((m) => m.type === 'live' && m.seq === 25);
      const newcomer = await join(baseUrl, roomId, 'Newcomer');
      const room = rooms.get(roomId);
      const joinedAt = room.participants.get(newcomer.participantId).joinedAt.getTime();
      // Model commits and join happening in one millisecond without relying on scheduling.
      for (const line of room.lines) line.committedAt = joinedAt;
      const snap = await snapshotFor(newcomer);
      assert.deepEqual(snap.committed.map((line) => line.row), Array.from({ length: 21 }, (_, i) => i + 6));
      assert.ok(snap.committed.every((line) => line.committedAt === joinedAt));
    } finally {
      client.ws.close();
    }
  });

  it('reconnect keeps an earlier live row committed after join with an older timestamp', async () => {
    const roomId = await newRoom(baseUrl);
    const slow = await join(baseUrl, roomId, 'Slow');
    const writer = await join(baseUrl, roomId, 'Writer');
    const a = await connect(wsUrl, slow);
    const b = await connect(wsUrl, writer);
    try {
      a.send({ type: 'key', seq: 1, kind: 'char', char: 'x' });
      const live = await a.next((m) => m.type === 'live' && m.participantId === slow.participantId);
      for (let seq = 1; seq <= 25; seq++) b.send(key(seq, 'enter'));
      await b.next((m) => m.type === 'live' && m.participantId === writer.participantId && m.seq === 25);
      const newcomer = await join(baseUrl, roomId, 'Newcomer');
      const first = await snapshotFor(newcomer);
      assert.equal(first.committed.length, 21);
      assert.ok(first.liveLines.some((line) => line.row === live.row && line.text === 'x'));
      // Stale cleanup preserves a line at last activity, before the newcomer joined.
      const room = rooms.get(roomId);
      const participant = room.participants.get(slow.participantId);
      const beforeJoin = new Date(room.participants.get(newcomer.participantId).joinedAt.getTime() - 1);
      serverModule.removeParticipant(room, participant, beforeJoin);
      const recovered = await snapshotFor(newcomer);
      assert.ok(recovered.committed.some((line) => line.row === live.row && line.text === 'x' && line.committedAt === beforeJoin.getTime()));
      assert.equal(recovered.committed.length, 23); // window, join, preserved line, leave
    } finally {
      a.ws.close();
      b.ws.close();
    }
  });

  it('a join response carries historyFromRow', async () => {
    const historyFromRow = await historyFromRowAfter(0);
    assert.equal(typeof historyFromRow, 'number');
  });

  it('with no committed lines the boundary is the join announcement row', async () => {
    assert.equal(await historyFromRowAfter(0), 0);
  });

  it('with 5 committed lines the boundary is the oldest line row', async () => {
    // The writer's announcement (row 0) plus 5 entered lines (rows 1..5).
    assert.equal(await historyFromRowAfter(5), 0);
  });

  it('with 20 committed lines the boundary is the oldest of the last 20', async () => {
    // Announcement row 0 plus rows 1..20: the last 20 start at row 1.
    assert.equal(await historyFromRowAfter(20), 1);
  });

  it('with 25 committed lines the boundary is the row of the 20th-newest line', async () => {
    // Announcement row 0 plus rows 1..25: the last 20 start at row 6.
    assert.equal(await historyFromRowAfter(25), 6);
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
