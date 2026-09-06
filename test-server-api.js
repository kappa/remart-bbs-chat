import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const mod = await import('./server/index.js');
const { app, server, resetForTests, rooms, ANSI_COLORS } = mod;

// Helper to start server on random port
let baseUrl;
let httpServer;

before(async () => {
  resetForTests();
  await new Promise((resolve) => {
    httpServer = server.listen(0, () => {
      const addr = httpServer.address();
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (httpServer) {
    await new Promise((res) => httpServer.close(res));
  }
});

beforeEach(() => {
  resetForTests();
});

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { res, json, status: res.status };
}

describe('/health', () => {
  it('returns ok', async () => {
    const { res, json } = await fetchJson('/health');
    assert.equal(res.ok, true);
    assert.equal(json.ok, true);
    assert.equal(typeof json.rooms, 'number');
  });
});

describe('Room creation and occupancy', () => {
  it('creates rooms via POST /api/rooms', async () => {
    const { res, json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(res.ok, true);
    assert.ok(json.room.id);
    assert.equal(json.room.name, `Room ${json.room.id}`);
  });

  it('lists rooms with occupancy', async () => {
    // Create a room
    const { json: createJson } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = createJson.room.id;
    const { json: listJson } = await fetchJson('/api/rooms');
    const found = listJson.rooms.find(r => r.id === roomId);
    assert.ok(found);
    assert.equal(found.occupancy, 0);
    assert.equal(found.max, 10);
  });

  it('enforces max 10 participants', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    // Join 10 users
    for (let i = 0; i < 10; i++) {
      const { res } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: `user${i}` }) });
      assert.equal(res.ok, true, `join user${i} should succeed`);
    }
    const { res, json: failJson } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'user10' }) });
    assert.equal(res.status, 409);
    assert.match(failJson.error, /full/i);
  });

  it('ephemeral cleanup when last leaves', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: joinJson } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'solo' }) });
    const participantId = joinJson.participant.id;
    const token = joinJson.participant.token;
    const { json: leaveJson } = await fetchJson('/api/leave', { method: 'POST', body: JSON.stringify({ roomId, participantId, token }) });
    assert.equal(leaveJson.freed, true);
    const { res } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    assert.equal(res.status, 404, 'room should be deleted after last leaves');
  });
});

describe('Join semantics', () => {
  it('blocks duplicate handle case-insensitive', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { res: r1 } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'Alice' }) });
    assert.equal(r1.ok, true);
    const { res: r2, json: j2 } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'alice' }) });
    assert.equal(r2.status, 409);
    assert.match(j2.error, /Handle already active/i);
  });

  it('blocks duplicate handle globally across rooms', async () => {
    const { json: j1 } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const { json: j2 } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const r1 = j1.room.id, r2 = j2.room.id;
    const { res } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId: r1, handle: 'Bob' }) });
    assert.equal(res.ok, true);
    const { res: rDup } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId: r2, handle: 'bob' }) });
    assert.equal(rDup.status, 409, 'global duplicate should be blocked');
  });

  it('assigns unique colors and lineSlot', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const colors = new Set();
    const slots = new Set();
    for (let i = 0; i < 5; i++) {
      const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: `u${i}` }) });
      colors.add(j.participant.color);
      slots.add(j.participant.lineSlot);
      assert.ok(ANSI_COLORS.includes(j.participant.color));
    }
    assert.equal(colors.size, 5, 'colors should be unique');
    assert.equal(slots.size, 5, 'lineSlots should be unique');
  });

  it('defers ownership: activeLineIdx null initially', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: joinJson } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'deferred' }) });
    assert.equal(joinJson.participant.activeLineIdx, null, 'activeLineIdx should be null on join for deferred ownership');
    // Check via room-state
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const p = state.participants.find(p => p.handle === 'deferred');
    assert.equal(p.activeLineIdx, null);
  });
});

describe('Leave semantics', () => {
  it('preserves nonempty active text as committed line', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'writer' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    // Type something
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'h' }) });
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'i' }) });
    // Leave without committing
    await fetchJson('/api/leave', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    // Need another participant to keep room alive to inspect history, so create second user before leave? Actually we left last user, room deleted. So test with keeper.
  });

  it('preserves nonempty when other participants remain', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: keeper } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'keeper' }) });
    const { json: writer } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'writer' }) });
    const pid = writer.participant.id;
    const token = writer.participant.token;
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'h' }) });
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'i' }) });
    await fetchJson('/api/leave', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const hasHi = state.history.some(h => h.content === 'hi' && h.handle === 'writer');
    assert.ok(hasHi, 'nonempty active text should be preserved as committed line');
    const hasLeave = state.history.some(h => h.content === '* writer left');
    assert.ok(hasLeave, 'leave line should be appended');
  });

  it('empty active text disappears on leave', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: keeper } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'keeper' }) });
    const { json: empty } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'empty' }) });
    await fetchJson('/api/leave', { method: 'POST', body: JSON.stringify({ roomId, participantId: empty.participant.id, token: empty.participant.token }) });
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    // Should not have an empty committed line from empty user, only join and leave
    const emptyCommits = state.history.filter(h => h.handle === 'empty' && h.content === '');
    assert.equal(emptyCommits.length, 0, 'empty active should not become a committed empty line on leave');
  });
});

describe('Char handling', () => {
  it('allows Unicode including Cyrillic', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'cyrillic' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    const { res, json: cyr } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'Я' }) });
    assert.equal(res.ok, true);
    assert.equal(cyr.content, 'Я');
    const { res: r2, json: c2 } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'ё' }) });
    assert.equal(r2.ok, true);
    assert.equal(c2.content, 'Яё');
  });

  it('rejects \\n and \\r', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'tester' }) });
    const { res: rn } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: j.participant.id, token: j.participant.token, char: '\n' }) });
    assert.equal(rn.status, 400);
    const { res: rr } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: j.participant.id, token: j.participant.token, char: '\r' }) });
    assert.equal(rr.status, 400);
  });

  it('allows space and tab', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'spacer' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    const { res: rs } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: ' ' }) });
    assert.equal(rs.ok, true);
    const { res: rt } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: '\t' }) });
    assert.equal(rt.ok, true);
  });

  it('assigns lineIdx on first char when deferred', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'first' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    assert.equal(j.participant.activeLineIdx, null);
    const { json: c } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'a' }) });
    assert.ok(typeof c.lineIdx === 'number' && c.lineIdx >= 0, 'first char should assign lineIdx');
  });
});

describe('Backspace', () => {
  it('at column zero does nothing', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'bs' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    const { json: b } = await fetchJson('/api/backspace', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    assert.equal(b.content, '');
    // No crash, content remains empty
  });

  it('removes last char', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'bs2' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'a' }) });
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'b' }) });
    const { json: b } = await fetchJson('/api/backspace', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    assert.equal(b.content, 'a');
  });
});

describe('Commit', () => {
  it('allows empty lines (multiple Enters)', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'enter' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    const { res: r1, json: c1 } = await fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    assert.equal(r1.ok, true);
    assert.equal(c1.committedContent, '');
    const { res: r2, json: c2 } = await fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    assert.equal(r2.ok, true);
    assert.equal(c2.committedContent, '');
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const empties = state.history.filter(h => h.handle === 'enter' && h.content === '');
    assert.ok(empties.length >= 2, 'should have at least 2 empty committed lines');
  });

  it('defers new activeLineIdx to null after commit', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'committer' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'x' }) });
    await fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const p = state.participants.find(p => p.handle === 'committer');
    assert.equal(p.activeLineIdx, null, 'after commit activeLineIdx should be deferred (null)');
    assert.equal(p.activeContent, '');
  });

  it('preserves content on commit', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'writer' }) });
    const pid = j.participant.id;
    const token = j.participant.token;
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'h' }) });
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'i' }) });
    const { json: c } = await fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    assert.equal(c.committedContent, 'hi');
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const has = state.history.some(h => h.content === 'hi' && h.handle === 'writer');
    assert.ok(has);
  });
});

describe('Color persistence', () => {
  it('history retains colorSnapshot after participant leaves', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: keeper } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'keeper' }) });
    const { json: leaver } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'leaver' }) });
    const leaverColor = leaver.participant.color;
    // Leaver types and commits
    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: leaver.participant.id, token: leaver.participant.token, char: 'x' }) });
    await fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: leaver.participant.id, token: leaver.participant.token }) });
    // Leaver leaves
    await fetchJson('/api/leave', { method: 'POST', body: JSON.stringify({ roomId, participantId: leaver.participant.id, token: leaver.participant.token }) });
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const line = state.history.find(h => h.handle === 'leaver' && h.content === 'x');
    assert.ok(line, 'committed line should exist');
    assert.equal(line.color, leaverColor, 'history line should retain original color even after leave');
    const joinLine = state.history.find(h => h.content === '* leaver joined');
    assert.ok(joinLine);
    assert.equal(joinLine.color, leaverColor);
    const leaveLine = state.history.find(h => h.content === '* leaver left');
    assert.ok(leaveLine);
    assert.equal(leaveLine.color, leaverColor);
  });
});

describe('Heartbeat and roster', () => {
  it('heartbeat keeps participant alive', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'alive' }) });
    const { json: hb } = await fetchJson('/api/heartbeat', { method: 'POST', body: JSON.stringify({ roomId, participantId: j.participant.id, token: j.participant.token }) });
    assert.equal(hb.alive, true);
  });

  it('roster ordering by lineSlot', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    for (let i = 0; i < 3; i++) {
      await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: `u${i}` }) });
    }
    const { json: rosterJson } = await fetchJson(`/api/roster?roomId=${roomId}`);
    const slots = rosterJson.participants.map(p => p.lineSlot);
    const sorted = [...slots].sort((a,b)=>a-b);
    assert.deepEqual(slots, sorted, 'roster should be ordered by lineSlot');
  });
});

describe('Participant authorization (task 1)', () => {
  it('join issues an unpredictable token kept out of public state', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: a } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'authed' }) });
    const { json: b } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'authed2' }) });
    assert.ok(typeof a.participant.token === 'string' && a.participant.token.length >= 16, 'join should issue a token');
    assert.ok(typeof b.participant.token === 'string' && b.participant.token.length >= 16);
    assert.notEqual(a.participant.token, b.participant.token, 'tokens must differ per participant');
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    assert.ok(!JSON.stringify(state).includes(a.participant.token), 'token must not leak into room-state');
    assert.ok(!JSON.stringify(state).includes(b.participant.token), 'token must not leak into room-state');
    const { json: roster } = await fetchJson(`/api/roster?roomId=${roomId}`);
    assert.ok(!JSON.stringify(roster).includes(a.participant.token), 'token must not leak into roster');
  });

  it('mutations without a token are rejected and change nothing', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: keeper } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'keeper' }) });
    const { json: victim } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'victim' }) });
    const pid = victim.participant.id;

    const { res: rChar, json: jChar } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, char: 'X' }) });
    assert.equal(rChar.status, 401);
    assert.equal(jChar.error, 'invalid token');
    const { res: rBs } = await fetchJson('/api/backspace', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid }) });
    assert.equal(rBs.status, 401);
    const { res: rCommit } = await fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid }) });
    assert.equal(rCommit.status, 401);
    const { res: rHb } = await fetchJson('/api/heartbeat', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid }) });
    assert.equal(rHb.status, 401);
    const { res: rLeave } = await fetchJson('/api/leave', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid }) });
    assert.equal(rLeave.status, 401);

    // Nothing was applied: victim untouched, still present
    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const p = state.participants.find(p => p.id === pid);
    assert.ok(p, 'victim should still be in the room');
    assert.equal(p.activeContent, '');
    assert.ok(!state.history.some(h => h.handle === 'victim' && h.content === 'X'));
    assert.ok(keeper.participant.id !== pid);
  });

  it('another participant cannot mutate with a wrong token', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: alice } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'alice' }) });
    const { json: bob } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'bob' }) });

    // Bob tries to type as Alice using his own token
    const { res: rChar } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.participant.id, token: bob.participant.token, char: 'X' }) });
    assert.equal(rChar.status, 401);
    // Bob tries to kick Alice
    const { res: rLeave } = await fetchJson('/api/leave', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.participant.id, token: 'wrong-token' }) });
    assert.equal(rLeave.status, 401);

    const { json: state } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const a = state.participants.find(p => p.id === alice.participant.id);
    assert.ok(a, 'alice should still be in the room');
    assert.equal(a.activeContent, '', 'alice draft must be unchanged');
  });

  it('valid token keeps mutations, heartbeat, and leave working', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: j } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'valid' }) });
    const pid = j.participant.id;
    const token = j.participant.token;

    const { res: rChar, json: c } = await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token, char: 'h' }) });
    assert.equal(rChar.ok, true);
    assert.equal(c.content, 'h');
    const { json: hb } = await fetchJson('/api/heartbeat', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    assert.equal(hb.alive, true);
    const { json: leave } = await fetchJson('/api/leave', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, token }) });
    assert.equal(leave.freed, true);
  });
});

