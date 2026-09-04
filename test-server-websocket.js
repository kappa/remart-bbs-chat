import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const mod = await import('./server/index.js');
const { server, resetForTests } = mod;
import WebSocket from 'ws';

let baseUrl;
let httpServer;
let wsUrl;

before(async () => {
  resetForTests();
  await new Promise((resolve) => {
    httpServer = server.listen(0, () => {
      const addr = httpServer.address();
      baseUrl = `http://localhost:${addr.port}`;
      wsUrl = `ws://localhost:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (httpServer) await new Promise(res => httpServer.close(res));
});

beforeEach(() => resetForTests());

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = { _raw: txt }; }
  return { res, json, status: res.status };
}

function waitForWsMessage(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('WS message timeout'));
    }, timeoutMs);
    function handler(raw) {
      try {
        const msg = JSON.parse(raw.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch {}
    }
    ws.on('message', handler);
  });
}

describe('WebSocket subscription and broadcast', () => {
  it('allows subscription and receives subscribed ack', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.on('open', res);
      ws.on('error', rej);
    });

    ws.send(JSON.stringify({ type: 'subscribe', roomId }));
    const ack = await waitForWsMessage(ws, m => m.type === 'subscribed' && m.roomId === roomId);
    assert.equal(ack.roomId, roomId);
    ws.close();
  });

  it('broadcasts room-update on join', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;

    const ws = new WebSocket(wsUrl);
    await new Promise(res => ws.on('open', res));
    ws.send(JSON.stringify({ type: 'subscribe', roomId }));
    await waitForWsMessage(ws, m => m.type === 'subscribed');

    // Prepare to wait for room-update
    const roomUpdatePromise = waitForWsMessage(ws, m => m.type === 'room-update' && m.roomId === roomId, 3000);

    // Join triggers broadcast
    await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'ws-joiner' }) });

    const upd = await roomUpdatePromise;
    assert.equal(upd.roomId, roomId);
    ws.close();
  });

  it('broadcasts char and room-update on typing', async () => {
    const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
    const roomId = json.room.id;
    const { json: joinJson } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle: 'typer' }) });
    const pid = joinJson.participant.id;

    const ws = new WebSocket(wsUrl);
    await new Promise(res => ws.on('open', res));
    ws.send(JSON.stringify({ type: 'subscribe', roomId }));
    await waitForWsMessage(ws, m => m.type === 'subscribed');

    const charPromise = waitForWsMessage(ws, m => m.type === 'char' && m.handle === 'typer', 3000);
    const roomUpdatePromise = waitForWsMessage(ws, m => m.type === 'room-update', 3000);

    await fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: pid, char: 'z' }) });

    const charMsg = await charPromise;
    assert.equal(charMsg.char, 'z');
    assert.equal(charMsg.handle, 'typer');
    const upd = await roomUpdatePromise;
    assert.equal(upd.roomId, roomId);

    ws.close();
  });

  it('handles ping/pong', async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise(res => ws.on('open', res));
    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await waitForWsMessage(ws, m => m.type === 'pong', 2000);
    assert.equal(pong.type, 'pong');
    ws.close();
  });

  it('does not crash on invalid JSON', async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise(res => ws.on('open', res));
    ws.send('not json at all');
    // Should still be open
    await new Promise(res => setTimeout(res, 100));
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
  });
});

describe('Server static handling', () => {
  it('client dist fallback message when not built', async () => {
    // Depending on whether client/dist exists, this will be either static or message.
    // In test env client/dist likely not built, so expect fallback text.
    const res = await fetch(`${baseUrl}/`);
    const txt = await res.text();
    // Should be either HTML or fallback message, but not 500
    assert.ok(res.status === 200 || res.status === 404);
    assert.ok(txt.length > 0);
  });
});
