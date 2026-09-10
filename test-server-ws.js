import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { serverModule, startServer, closeAllSockets, post, newRoom, join, openSocket, connect, settle } from './test-support.js';

const { resetForTests, rooms } = serverModule;
let baseUrl, wsUrl, closeServer;

before(async () => { ({ baseUrl, wsUrl, close: closeServer } = await startServer()); });
after(async () => { await closeServer(); });
beforeEach(() => resetForTests());
afterEach(closeAllSockets);

describe('Socket handshake', () => {
  it('hello with a valid token receives a snapshot', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const client = await connect(wsUrl, alice);
    const snap = client.snapshot;
    assert.equal(snap.roomId, roomId);
    assert.deepEqual(snap.you, { participantId: alice.participantId, nextSeq: 1 });
    assert.deepEqual(snap.roster, [{ participantId: alice.participantId, handle: 'Alice', color: alice.color, slot: 0, afk: false }]);
    assert.deepEqual(snap.liveLines, [{ participantId: alice.participantId, handle: 'Alice', color: alice.color, slot: 0, afk: false, row: null, text: '', caret: 0 }]);
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

  it('malformed JSON before hello is rejected like any other first message', async () => {
    const client = openSocket(wsUrl);
    await client.opened;
    client.ws.send('not json');
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

  it('a reload keeps identity and live state and stays silent to observers (task 23)', async () => {
    const roomId = await newRoom(baseUrl);
    const alice = await join(baseUrl, roomId, 'Alice');
    const bob = await join(baseUrl, roomId, 'Bob');
    const observer = await connect(wsUrl, bob);
    const first = await connect(wsUrl, alice);
    first.send({ type: 'key', seq: 1, kind: 'char', char: 'h' });
    first.send({ type: 'key', seq: 2, kind: 'char', char: 'i' });
    await first.next((m) => m.type === 'live' && m.text === 'hi');
    // Reload: the old socket drops without a leave, then the same
    // credentials return on a new socket.
    first.ws.close();
    await first.closed;
    observer.cursor = observer.messages.length;
    const second = await connect(wsUrl, alice);
    assert.equal(second.snapshot.you.participantId, alice.participantId);
    const own = second.snapshot.liveLines.find((l) => l.participantId === alice.participantId);
    assert.equal(own.text, 'hi');
    assert.equal(own.row !== null, true);
    assert.equal(second.snapshot.you.nextSeq, 3);
    await settle(100);
    // Only committed/roster would announce a departure or newcomer; an
    // in-flight live echo from before the cursor is not a join/leave signal.
    const noise = observer.messages.slice(observer.cursor).filter((m) =>
      m.type === 'committed' || m.type === 'roster');
    assert.deepEqual(noise, []);
    second.ws.close();
    observer.ws.close();
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

describe('Liveness over the socket', () => {
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

  it("a newcomer's snapshot carries the current afk on live lines and roster", async () => {
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

describe('Server static handling', () => {
  it('serves either the built client or the not-built message at /', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.ok(res.status === 200 || res.status === 404);
    assert.ok((await res.text()).length > 0);
  });
});

async function roomWithTwo() {
  const roomId = await newRoom(baseUrl);
  const alice = await join(baseUrl, roomId, 'Alice');
  const bob = await join(baseUrl, roomId, 'Bob');
  const a = await connect(wsUrl, alice);
  const b = await connect(wsUrl, bob);
  return { roomId, alice, bob, a, b, done: () => { a.ws.close(); b.ws.close(); } };
}
const key = (seq, kind, char) => (char === undefined ? { type: 'key', seq, kind } : { type: 'key', seq, kind, char });

describe('Keystrokes', () => {
  it('a character echoes the whole live line to sender and observer', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send(key(1, 'char', 'A'));
    const expected = { type: 'live', participantId: alice.participantId, row: 2, text: 'A', caret: 1, seq: 1 };
    assert.deepEqual(await a.next((m) => m.type === 'live'), expected);
    assert.deepEqual(await b.next((m) => m.type === 'live'), expected);
    done();
  });

  it('backspace shortens the line; on an empty line it still echoes and advances seq', async () => {
    const { alice, a, done } = await roomWithTwo();
    a.send(key(1, 'backspace'));
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: null, text: '', caret: 0, seq: 1 });
    a.send(key(2, 'char', 'A'));
    a.send(key(3, 'char', 'B'));
    a.send(key(4, 'backspace'));
    await a.next((m) => m.type === 'live' && m.seq === 3);
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: 2, text: 'A', caret: 1, seq: 4 });
    done();
  });

  it('backspace deletes an emoji as one code point and keeps the row (task 5)', async () => {
    const { alice, a, done } = await roomWithTwo();
    a.send(key(1, 'char', '\u{1F600}'));
    await a.next((m) => m.type === 'live' && m.seq === 1);
    a.send(key(2, 'backspace'));
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: 2, text: '', caret: 0, seq: 2 });
    done();
  });

  it('backspace after aЖ😀 deletes one code point at a time (task 5)', async () => {
    const { alice, a, done } = await roomWithTwo();
    a.send(key(1, 'char', 'a'));
    a.send(key(2, 'char', 'Ж'));
    a.send(key(3, 'char', '\u{1F600}'));
    await a.next((m) => m.type === 'live' && m.seq === 3);
    a.send(key(4, 'backspace'));
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: 2, text: 'aЖ', caret: 2, seq: 4 });
    a.send(key(5, 'backspace'));
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: 2, text: 'a', caret: 1, seq: 5 });
    done();
  });

  it('a combining mark is its own code point and takes its own backspace (task 5)', async () => {
    const { alice, a, done } = await roomWithTwo();
    a.send(key(1, 'char', 'e'));
    a.send(key(2, 'char', '\u0301'));
    await a.next((m) => m.type === 'live' && m.seq === 2);
    a.send(key(3, 'backspace'));
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: 2, text: 'e', caret: 1, seq: 3 });
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
    assert.deepEqual(cleared, { type: 'live', participantId: alice.participantId, row: null, text: '', caret: 0, seq: 2 });
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
    assert.deepEqual(await a.next((m) => m.type === 'live'), { type: 'live', participantId: alice.participantId, row: null, text: '', caret: 0, seq: 1 });
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

describe('Caret editing (task 14)', () => {
  // Types the characters one keystroke each so the caret is placed by the
  // keys themselves, exactly as a client would.
  async function typeLine(a, chars) {
    chars.forEach((ch, i) => a.send(key(i + 1, 'char', ch)));
    await a.next((m) => m.type === 'live' && m.seq === chars.length);
  }

  it('left then char inserts at the caret and reports it', async () => {
    const { alice, a, done } = await roomWithTwo();
    await typeLine(a, ['a', 'b', 'c', ' ', 'd', 'e', 'f']);
    a.send(key(8, 'left'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 8), { type: 'live', participantId: alice.participantId, row: 2, text: 'abc def', caret: 6, seq: 8 });
    a.send(key(9, 'char', 'x'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 9), { type: 'live', participantId: alice.participantId, row: 2, text: 'abc dexf', caret: 7, seq: 9 });
    done();
  });

  it('home then delete drops the first code point', async () => {
    const { alice, a, done } = await roomWithTwo();
    await typeLine(a, ['a', 'b', 'c', ' ', 'd', 'e', 'f']);
    a.send(key(8, 'home'));
    await a.next((m) => m.type === 'live' && m.seq === 8);
    a.send(key(9, 'delete'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 9), { type: 'live', participantId: alice.participantId, row: 2, text: 'bc def', caret: 0, seq: 9 });
    done();
  });

  it('delete at the end and left at 0 are no-ops that still echo', async () => {
    const { alice, a, done } = await roomWithTwo();
    await typeLine(a, ['a', 'b', 'c']);
    a.send(key(4, 'delete'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 4), { type: 'live', participantId: alice.participantId, row: 2, text: 'abc', caret: 3, seq: 4 });
    a.send(key(5, 'home'));
    await a.next((m) => m.type === 'live' && m.seq === 5);
    a.send(key(6, 'left'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 6), { type: 'live', participantId: alice.participantId, row: 2, text: 'abc', caret: 0, seq: 6 });
    done();
  });

  it('word-left twice from the end lands at 0', async () => {
    const { alice, a, done } = await roomWithTwo();
    await typeLine(a, ['a', 'b', 'c', ' ', 'd', 'e', 'f']);
    a.send(key(8, 'word-left'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 8), { type: 'live', participantId: alice.participantId, row: 2, text: 'abc def', caret: 4, seq: 8 });
    a.send(key(9, 'word-left'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 9), { type: 'live', participantId: alice.participantId, row: 2, text: 'abc def', caret: 0, seq: 9 });
    done();
  });

  it('word-right from 0 lands after abc', async () => {
    const { alice, a, done } = await roomWithTwo();
    await typeLine(a, ['a', 'b', 'c', ' ', 'd', 'e', 'f']);
    a.send(key(8, 'home'));
    await a.next((m) => m.type === 'live' && m.seq === 8);
    a.send(key(9, 'word-right'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 9), { type: 'live', participantId: alice.participantId, row: 2, text: 'abc def', caret: 3, seq: 9 });
    done();
  });

  it('left then backspace removes Ж from aЖ😀', async () => {
    const { alice, a, done } = await roomWithTwo();
    await typeLine(a, ['a', 'Ж', '\u{1F600}']);
    a.send(key(4, 'left'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 4), { type: 'live', participantId: alice.participantId, row: 2, text: 'aЖ😀', caret: 2, seq: 4 });
    a.send(key(5, 'backspace'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 5), { type: 'live', participantId: alice.participantId, row: 2, text: 'a😀', caret: 1, seq: 5 });
    done();
  });

  it('the snapshot live line carries caret', async () => {
    const { alice, a, done } = await roomWithTwo();
    await typeLine(a, ['a', 'b']);
    a.send(key(3, 'left'));
    await a.next((m) => m.type === 'live' && m.seq === 3);
    const fresh = await connect(wsUrl, alice);
    const live = fresh.snapshot.liveLines.find((l) => l.participantId === alice.participantId);
    assert.deepEqual(live, { participantId: alice.participantId, handle: 'Alice', color: alice.color, slot: 0, afk: false, row: 2, text: 'ab', caret: 1 });
    fresh.ws.close();
    done();
  });

  it('enter commits regardless of caret and resets it to 0', async () => {
    const { alice, a, done } = await roomWithTwo();
    await typeLine(a, ['a', 'b']);
    a.send(key(3, 'home'));
    await a.next((m) => m.type === 'live' && m.seq === 3);
    a.send(key(4, 'enter'));
    const committed = await a.next((m) => m.type === 'committed' && m.seq === 4);
    assert.equal(committed.line.text, 'ab');
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 4), { type: 'live', participantId: alice.participantId, row: null, text: '', caret: 0, seq: 4 });
    done();
  });

  it('movement on an idle line is a no-op that echoes', async () => {
    const { alice, a, done } = await roomWithTwo();
    a.send(key(1, 'right'));
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 1), { type: 'live', participantId: alice.participantId, row: null, text: '', caret: 0, seq: 1 });
    done();
  });
});

describe('Commands', () => {
  it('l commits ordinary chat delivered to both participants, with no command', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    a.send(key(1, 'char', 'l'));
    a.send(key(2, 'enter'));
    const mine = await a.next((m) => m.type === 'committed');
    assert.equal(mine.participantId, alice.participantId);
    assert.equal(mine.seq, 2);
    assert.equal(mine.line.text, 'l');
    assert.deepEqual(await a.next((m) => m.type === 'live' && m.seq === 2), { type: 'live', participantId: alice.participantId, row: null, text: '', caret: 0, seq: 2 });
    const theirs = await b.next((m) => m.type === 'committed' && m.line.text === 'l');
    assert.equal(theirs.participantId, alice.participantId);
    await settle();
    assert.ok(!a.messages.some((m) => m.type === 'command'), 'l sends no command');
    assert.ok(!b.messages.some((m) => m.type === 'command'), 'observers do not receive commands');
    done();
  });

  it('a line that names an inherited object property, like constructor, is ordinary chat', async () => {
    const { alice, a, b, done } = await roomWithTwo();
    let seq = 0;
    for (const ch of 'constructor') a.send(key(++seq, 'char', ch));
    a.send(key(++seq, 'enter'));
    const committed = await b.next((m) => m.type === 'committed' && m.line.text === 'constructor');
    assert.equal(committed.participantId, alice.participantId);
    await settle();
    assert.ok(!a.messages.some((m) => m.type === 'command'), 'no command is sent');
    assert.ok(rooms.get(alice.roomId).participants.has(alice.participantId), 'the participant stays in the room');
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
    assert.deepEqual(Object.keys(roster), ['type', 'roster']);
    assert.deepEqual(roster.roster.map((r) => r.handle), ['Alice', 'Bob']);
    a.ws.close();
  });

  it('HTTP leave preserves nonempty text stamped at leave time, announces, updates the roster, and closes the socket', async () => {
    const { alice, a, b } = await roomWithTwo();
    a.send(key(1, 'char', 'h'));
    a.send(key(2, 'char', 'i'));
    await b.next((m) => m.type === 'live' && m.seq === 2);
    rooms.get(alice.roomId).participants.get(alice.participantId).lastSeen = new Date(Date.now() - 5000);
    const leftAt = Date.now();
    await post(baseUrl, '/api/leave', { roomId: alice.roomId, participantId: alice.participantId, token: alice.token });
    const preserved = await b.next((m) => m.type === 'committed');
    assert.deepEqual([preserved.line.text, preserved.line.row, preserved.line.color], ['hi', 2, alice.color]);
    assert.ok(preserved.line.committedAt >= leftAt, 'a deliberate leave stamps the preserved line at leave time');
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
