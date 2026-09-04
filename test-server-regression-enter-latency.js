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

async function createRoom() {
  const { json } = await fetchJson('/api/rooms', { method: 'POST', body: JSON.stringify({ forceNew: true }) });
  return json.room.id;
}

async function join(roomId, handle) {
  const { json } = await fetchJson('/api/join', { method: 'POST', body: JSON.stringify({ roomId, handle }) });
  return json.participant;
}

function wsSubscribe(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', roomId }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        messages.push(msg);
        if (msg.type === 'subscribed' && msg.roomId === roomId) {
          resolve({ ws, messages });
        }
      } catch {}
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws subscribe timeout')), 3000);
  });
}

describe('Regression: A Enter B Backspace C under latency, other participant untouched', () => {
  it('A stays committed, new active is C only, B and deletion are distinct ordered events, other line untouched, no wait for Enter ack required', async () => {
    const roomId = await createRoom();
    const alice = await join(roomId, 'Alice');
    const bob = await join(roomId, 'Bob');
    const observer = await join(roomId, 'Observer');

    // WS observers
    const { ws: aliceWs, messages: aliceMsgs } = await wsSubscribe(roomId);
    const { ws: bobWs, messages: bobMsgs } = await wsSubscribe(roomId);
    const { ws: obsWs, messages: obsMsgs } = await wsSubscribe(roomId);

    // Initial room-state to know lineIdx allocation
    const { json: state0 } = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const aliceP0 = state0.participants.find(p => p.id === alice.id);
    // Alice hasn't typed yet, activeLineIdx should be null (deferred ownership)

    // --- Simulate latency pipeline: fire all ops without waiting for previous acks ---
    // Alice: A (seq1), Enter (seq2), B (seq3), Backspace (seq4), C (seq5)
    // Bob: X (seq1) independently, interleaved

    // Fire concurrently to simulate real browser not waiting for Enter ack before typing B/C
    const aliceOps = [
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'A', seq: 1 }) }),
      fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, seq: 2 }) }),
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'B', seq: 3 }) }),
      fetchJson('/api/backspace', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, seq: 4 }) }),
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'C', seq: 5 }) }),
    ];

    // Bob types independently while Alice chain in flight
    const bobOp = fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: bob.id, char: 'X', seq: 1 }) });

    // Await all, but do not enforce order — they were fired without waiting for Enter ack
    const results = await Promise.all([...aliceOps, bobOp]);

    // All should eventually succeed (200 or 202 for buffered, but final drain should have applied)
    // The first ops may have been buffered if out-of-order arrival simulation caused 202,
    // but our fire order is in-order, so they should all be 200. To also test out-of-order resilience,
    // we test a second sub-case below.

    // Wait a tick for WS broadcasts to arrive
    await new Promise(r => setTimeout(r, 300));

    const { json: finalState } = await fetchJson(`/api/room-state?roomId=${roomId}`);

    // --- Assertions ---

    // 1. A stays committed on its original line
    const committedA = finalState.history.filter(h => h.handle === 'Alice' && h.content === 'A');
    assert.equal(committedA.length, 1, 'Alice A should be committed exactly once');
    const aLineIdx = committedA[0].lineIdx;
    // Ensure A is committed, not active
    assert.ok(committedA[0].committed, 'A should be committed');

    // 2. Your new active line contains only C, identically on every client (server truth)
    const aliceFinal = finalState.participants.find(p => p.id === alice.id);
    assert.ok(aliceFinal, 'Alice should still be present');
    assert.equal(aliceFinal.activeContent, 'C', 'Alice active line should contain only C after A Enter B Backspace C');
    assert.notEqual(aliceFinal.activeLineIdx, aLineIdx, 'New active lineIdx should be distinct from committed A lineIdx (logically separate buffer)');
    assert.ok(aliceFinal.activeLineIdx != null, 'New active line should have allocated lineIdx');

    // 3. Observers receive B and its deletion as distinct, ordered events
    // Filter observer messages for Alice's char/backspace
    const aliceCharEvents = obsMsgs.filter(m => m.type === 'char' && m.participantId === alice.id);
    const aliceBackspaceEvents = obsMsgs.filter(m => m.type === 'backspace' && m.participantId === alice.id);

    // Observer should have seen B char
    const sawB = aliceCharEvents.some(e => e.char === 'B');
    assert.ok(sawB, 'Observer should have received B as distinct char event');

    // Observer should have seen backspace after B
    // Find indices in obsMsgs ordered log
    const bIndex = obsMsgs.findIndex(m => m.type === 'char' && m.participantId === alice.id && m.char === 'B');
    const bsIndex = obsMsgs.findIndex(m => m.type === 'backspace' && m.participantId === alice.id);
    assert.ok(bIndex >= 0, 'Observer should have B char event');
    assert.ok(bsIndex >= 0, 'Observer should have backspace event for B deletion');
    assert.ok(bsIndex > bIndex, 'Backspace deletion should arrive after B char (distinct ordered events)');

    // Also observer should have seen C after backspace
    const cIndex = obsMsgs.findIndex(m => m.type === 'char' && m.participantId === alice.id && m.char === 'C');
    assert.ok(cIndex >= 0, 'Observer should have received C');
    assert.ok(cIndex > bsIndex, 'C should arrive after B deletion');

    // 4. The other participant's line remains untouched
    const bobFinal = finalState.participants.find(p => p.id === bob.id);
    assert.ok(bobFinal, 'Bob should still be present');
    assert.equal(bobFinal.activeContent, 'X', 'Bob line should remain X, untouched by Alice chain');
    // Ensure Bob didn't get Alice's lineIdx
    assert.notEqual(bobFinal.activeLineIdx, aliceFinal.activeLineIdx, 'Bob and Alice should have distinct activeLineIdx');
    // Ensure Bob's activeContent not polluted with Alice's chars
    assert.ok(!bobFinal.activeContent.includes('A') && !bobFinal.activeContent.includes('C'), 'Bob line should not contain Alice chars');

    // 5. Correctness must not depend on waiting for Enter's ack before continuing to type
    // This is demonstrated by firing all ops concurrently without awaiting intermediate responses.
    // Additionally, verify that final history does NOT contain AB or B (only A committed, C active)
    const historyContents = finalState.history.map(h => h.content);
    assert.ok(!historyContents.includes('AB'), 'History should not contain AB together (A and B should be separate buffers)');
    assert.ok(!historyContents.includes('B'), 'B should not be committed (it was typed then deleted before commit)');

    aliceWs.close();
    bobWs.close();
    obsWs.close();
  });

  it('out-of-order arrival still results in same final state (A committed, active C, Bob X untouched)', async () => {
    const roomId = await createRoom();
    const alice = await join(roomId, 'Alice2');
    const bob = await join(roomId, 'Bob2');

    // Simulate network reordering: send B (seq3), Backspace (seq4), Commit (seq2), C (seq5), A (seq1) — all out-of-order
    // Server should buffer and drain in seq order, ending same as in-order case

    const opsOutOfOrder = [
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'B', seq: 3 }) }),
      fetchJson('/api/backspace', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, seq: 4 }) }),
      fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, seq: 2 }) }),
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'C', seq: 5 }) }),
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'A', seq: 1 }) }),
    ];

    const bobOp = fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: bob.id, char: 'X', seq: 1 }) });

    const results = await Promise.all([...opsOutOfOrder, bobOp]);

    // Some should be 202 buffered (seq > expected)
    const bufferedCount = results.filter(r => r.status === 202).length;
    assert.ok(bufferedCount >= 2, `Expected at least 2 buffered ops when sending out-of-order, got ${bufferedCount}`);

    const { json: finalState } = await fetchJson(`/api/room-state?roomId=${roomId}`);

    const committedA = finalState.history.filter(h => h.handle === 'Alice2' && h.content === 'A');
    assert.equal(committedA.length, 1, 'Out-of-order: A should still be committed exactly once after drain');

    const aliceFinal = finalState.participants.find(p => p.id === alice.id);
    assert.equal(aliceFinal.activeContent, 'C', 'Out-of-order: Alice active should be C only after drain');

    const bobFinal = finalState.participants.find(p => p.id === bob.id);
    assert.equal(bobFinal.activeContent, 'X', 'Out-of-order: Bob untouched');
  });

  it('rapid Enter without waiting still separates buffers (empty Enters allowed, A committed, C active)', async () => {
    const roomId = await createRoom();
    const alice = await join(roomId, 'Alice3');

    // A seq1, Enter seq2, Enter seq3 (empty), B seq4, Backspace seq5, C seq6 — all fired concurrently
    const ops = [
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'A', seq: 1 }) }),
      fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, seq: 2 }) }),
      fetchJson('/api/commit', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, seq: 3 }) }), // empty line
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'B', seq: 4 }) }),
      fetchJson('/api/backspace', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, seq: 5 }) }),
      fetchJson('/api/char', { method: 'POST', body: JSON.stringify({ roomId, participantId: alice.id, char: 'C', seq: 6 }) }),
    ];

    await Promise.all(ops);
    const { json: finalState } = await fetchJson(`/api/room-state?roomId=${roomId}`);

    const aliceHistory = finalState.history.filter(h => h.handle === 'Alice3');
    // Should have A and empty commit
    assert.ok(aliceHistory.some(h => h.content === 'A'), 'Should have A committed');
    assert.ok(aliceHistory.some(h => h.content === ''), 'Empty Enter should be allowed and committed');

    const aliceFinal = finalState.participants.find(p => p.id === alice.id);
    assert.equal(aliceFinal.activeContent, 'C', 'After rapid double Enter + B Backspace C, active should be C only');
  });
});
