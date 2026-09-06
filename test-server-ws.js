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