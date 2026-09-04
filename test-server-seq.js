import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const mod = await import('./server/index.js');
const { app, server, resetForTests } = mod;

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

async function createRoomAndJoin(handle='tester'){
  const {json: roomJ} = await fetchJson('/api/rooms', {method:'POST', body:JSON.stringify({forceNew:true})});
  const roomId = roomJ.room.id;
  const {json: joinJ} = await fetchJson('/api/join', {method:'POST', body:JSON.stringify({roomId, handle})});
  return {roomId, participantId: joinJ.participant.id};
}

describe('Seq ordering - x then Backspace reordered', () => {
  it('typing x then Backspace with reordered requests still results in empty', async () => {
    const {roomId, participantId} = await createRoomAndJoin('seqtest1');
    // Simulate client seq: 1=x, 2=Backspace, but server receives 2 before 1
    // Send Backspace seq2 first (out-of-order, should buffer)
    const {res: r2, json: j2} = await fetchJson('/api/backspace', {method:'POST', body:JSON.stringify({roomId, participantId, seq:2})});
    assert.equal(r2.status, 202, 'seq 2 before seq1 should be buffered with 202');
    assert.equal(j2.buffered, true);
    // Check that activeContent is still empty (x not yet applied, backspace buffered)
    const {json: state1} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const p1 = state1.participants.find(p=>p.id===participantId);
    assert.equal(p1.activeContent, '', 'before seq1 arrives, content should be empty (x not applied, backspace buffered)');

    // Now send x with seq1 (should apply x, then drain buffered backspace, resulting in empty)
    const {res: r1, json: j1} = await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'x', seq:1})});
    assert.equal(r1.ok, true);
    // After draining, content should be empty (x then backspace)
    const {json: state2} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const p2 = state2.participants.find(p=>p.id===participantId);
    assert.equal(p2.activeContent, '', 'after x (seq1) then buffered backspace (seq2) drains, content should be empty, not x');
  });

  it('duplicate seq ignored', async () => {
    const {roomId, participantId} = await createRoomAndJoin('dup');
    const {res: r1} = await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'a', seq:1})});
    assert.equal(r1.ok, true);
    const {json: state1} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    assert.equal(state1.participants[0].activeContent, 'a');

    const {res: rDup, json: jDup} = await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'a', seq:1})});
    assert.equal(rDup.ok, true);
    assert.equal(jDup.duplicate, true);
    const {json: state2} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    assert.equal(state2.participants[0].activeContent, 'a', 'duplicate seq should not double-apply');
  });

  it('out-of-order buffering preserves order for multiple chars', async () => {
    const {roomId, participantId} = await createRoomAndJoin('ooo');
    // Send seq3, seq2 first (both buffered)
    await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'c', seq:3})});
    await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'b', seq:2})});
    let {json: s1} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    assert.equal(s1.participants[0].activeContent, '', 'before seq1, buffered ops should not apply');

    await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'a', seq:1})});
    let {json: s2} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    assert.equal(s2.participants[0].activeContent, 'abc', 'after seq1 arrives, buffered seq2,3 should drain in order abc');
  });
});

describe('A Enter B sequence', () => {
  it('commit AB together should not happen, B in new active line', async () => {
    const {roomId, participantId} = await createRoomAndJoin('aeb');
    // Type A seq1
    await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'A', seq:1})});
    // Commit seq2 (commits A)
    const {json: commitJ} = await fetchJson('/api/commit', {method:'POST', body:JSON.stringify({roomId, participantId, seq:2})});
    assert.equal(commitJ.committedContent, 'A');

    // Type B seq3 after commit (should be in new active line, not committed together)
    await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'B', seq:3})});

    const {json: state} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    // History should have A committed
    const hasA = state.history.some(h=>h.content==='A' && h.handle==='aeb');
    assert.ok(hasA, 'history should have committed A');
    // Active should be B only
    const p = state.participants.find(p=>p.id===participantId);
    assert.equal(p.activeContent, 'B', 'active should be B only, not AB');
    assert.ok(p.activeLineIdx != null, 'after B, activeLineIdx should be assigned (new line)');
  });

  it('A Enter B with out-of-order arrival still orders correctly', async () => {
    const {roomId, participantId} = await createRoomAndJoin('aeb2');
    // Send commit seq2 before char seq1 (out-of-order)
    const {res: r2} = await fetchJson('/api/commit', {method:'POST', body:JSON.stringify({roomId, participantId, seq:2})});
    assert.equal(r2.status, 202, 'commit seq2 before char seq1 should buffer');
    // Now send A seq1
    await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'A', seq:1})});
    // After draining, commit should have applied (committing A)
    const {json: state1} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const hasA = state1.history.some(h=>h.content==='A');
    assert.ok(hasA, 'after out-of-order A then commit drains, A should be committed');

    // Now B seq3
    await fetchJson('/api/char', {method:'POST', body:JSON.stringify({roomId, participantId, char:'B', seq:3})});
    const {json: state2} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const p = state2.participants.find(p=>p.id===participantId);
    assert.equal(p.activeContent, 'B');
  });
});

describe('Commit empty allowed', () => {
  it('empty commit with seq still works', async () => {
    const {roomId, participantId} = await createRoomAndJoin('emptyseq');
    const {res} = await fetchJson('/api/commit', {method:'POST', body:JSON.stringify({roomId, participantId, seq:1})});
    assert.equal(res.ok, true);
    const {json: state} = await fetchJson(`/api/room-state?roomId=${roomId}`);
    const emptyCommits = state.history.filter(h=>h.handle==='emptyseq' && h.content==='');
    assert.ok(emptyCommits.length>=1);
  });
});
