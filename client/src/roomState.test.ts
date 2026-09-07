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
// Third argument of applyServerMessage: what the join gave the client.
const seen = (historyFromRow = 0) => ({ joinedAt: JOINED_AT, historyFromRow });

describe('applyServerMessage', () => {
  it('snapshot builds participants sorted by slot and keeps only post-join lines', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('old', 0, 'before', 1), line('new', 1, 'after', 4)] }), seen(1));
    expect(room.participants.map((p) => p.handle)).toEqual(['Alice', 'Bob']);
    expect(sortedCommitted(room).map((l) => l.id)).toEqual(['new']);
  });

  it('live replaces one participant line and returns the same object when unchanged', () => {
    const room = applyServerMessage(emptyRoom(), snapshot(), seen());
    const typed = applyServerMessage(room, { type: 'live', participantId: 20, row: 2, text: 'hi', seq: 1 }, seen());
    expect(typed.participants.find((p) => p.participantId === 20)).toMatchObject({ row: 2, text: 'hi' });
    expect(typed.participants.find((p) => p.participantId === 10)).toMatchObject({ row: null, text: '' });
    expect(applyServerMessage(typed, { type: 'live', participantId: 20, row: 2, text: 'hi', seq: 2 }, seen())).toBe(typed);
    expect(applyServerMessage(typed, { type: 'live', participantId: 99, row: 2, text: 'x', seq: null }, seen())).toBe(typed);
  });

  it('committed adds a line once by id and orders by row', () => {
    let room = applyServerMessage(emptyRoom(), snapshot(), seen());
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 2, line: line('b', 5, 'second') }, seen());
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 3, line: line('a', 4, 'first') }, seen());
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 3, line: line('a', 4, 'first') }, seen());
    expect(sortedCommitted(room).map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('committed lines from before the join are ignored', () => {
    const room = applyServerMessage(applyServerMessage(emptyRoom(), snapshot(), seen(1)), { type: 'committed', participantId: null, seq: null, line: line('old', 0, 'x', 1) }, seen(1));
    expect(room.committed.size).toBe(0);
  });

  it('roster removes departed participants and keeps live text of the rest', () => {
    let room = applyServerMessage(emptyRoom(), snapshot(), seen());
    room = applyServerMessage(room, { type: 'live', participantId: 10, row: 2, text: 'keep', seq: 1 }, seen());
    room = applyServerMessage(room, { type: 'roster', roster: [alice, { participantId: 30, handle: 'Carol', color: '#f0f', slot: 1 }] }, seen());
    expect(room.participants.map((p) => p.handle)).toEqual(['Alice', 'Carol']);
    expect(room.participants[0]).toMatchObject({ row: 2, text: 'keep' });
    expect(room.participants[1]).toMatchObject({ row: null, text: '' });
  });

  it('a later snapshot never drops committed lines already seen', () => {
    let room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('a', 0, 'a'), line('b', 1, 'b'), line('c', 2, 'c')] }), seen());
    room = applyServerMessage(room, snapshot({ committed: [line('c', 2, 'c')] }), seen());
    expect(sortedCommitted(room).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('command and error messages leave the room unchanged', () => {
    const room = applyServerMessage(emptyRoom(), snapshot(), seen());
    expect(applyServerMessage(room, { type: 'command', name: 'help' }, seen())).toBe(room);
    expect(applyServerMessage(room, { type: 'error', code: 'seq-gap', expected: 4 }, seen())).toBe(room);
  });
});

describe('join history window (task 12)', () => {
  // Lines committed before the join (committedAt 1 < JOINED_AT 3), rows 0..24.
  const preJoin = (n: number) => Array.from({ length: n }, (_, row) => line(`l${row}`, row, `t${row}`, 1));

  it('exactly the last 20 lines are shown from 25', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: preJoin(25) }), seen(5));
    expect(sortedCommitted(room).map((l) => l.row)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5));
  });

  it('all lines are shown when fewer than 20 exist', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: preJoin(5) }), seen(0));
    expect(sortedCommitted(room).map((l) => l.row)).toEqual([0, 1, 2, 3, 4]);
  });

  it('a line below the boundary but committed after joining is shown', () => {
    // Row was claimed before the join; the newcomer watched it being typed.
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('late', 0, 'watched', 4)] }), seen(5));
    expect(sortedCommitted(room).map((l) => l.id)).toEqual(['late']);
  });

  it('a line below the boundary committed before joining is hidden', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('old', 0, 'x', 1)] }), seen(5));
    expect(room.committed.size).toBe(0);
  });

  it('a later truncated snapshot adds nothing older and removes nothing', () => {
    let room = applyServerMessage(emptyRoom(), snapshot({ committed: preJoin(25) }), seen(5));
    room = applyServerMessage(room, snapshot({ committed: [line('l24', 24, 't24', 1)] }), seen(5));
    const rows = sortedCommitted(room).map((l) => l.row);
    expect(rows.length).toBe(20);
    expect(rows[0]).toBe(5);
    expect(rows[19]).toBe(24);
  });

  it('a committed message below the boundary and before the join is ignored', () => {
    const room = applyServerMessage(applyServerMessage(emptyRoom(), snapshot(), seen(5)), { type: 'committed', participantId: null, seq: null, line: line('old', 0, 'x', 1) }, seen(5));
    expect(room.committed.size).toBe(0);
  });
});
