import { describe, it, expect } from 'vitest';
import { applyServerMessage, emptyRoom, sortedCommitted } from './roomState';
import type { CommittedLine, ServerMessage } from './protocol';

const alice = { participantId: 10, handle: 'Alice', color: '#fff', slot: 0, afk: false };
const bob = { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1, afk: false };
const line = (id: string, row: number, text: string, committedAt = 5): CommittedLine => ({ id, row, text, handle: 'Alice', color: '#fff', committedAt });
const snapshot = (over: Partial<Extract<ServerMessage, { type: 'snapshot' }>> = {}): ServerMessage => ({
  type: 'snapshot', roomId: 1, you: { participantId: 10, nextSeq: 1 },
  liveLines: [{ ...bob, row: null, text: '', caret: 0 }, { ...alice, row: null, text: '', caret: 0 }],
  committed: [], roster: [bob, alice], ...over,
});

describe('applyServerMessage', () => {
  it('snapshot builds participants sorted by slot and keeps all server-selected lines', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('old', 0, 'before', 1), line('new', 1, 'after', 4)] }));
    expect(room.participants.map((p) => p.handle)).toEqual(['Alice', 'Bob']);
    expect(sortedCommitted(room).map((l) => l.id)).toEqual(['old', 'new']);
  });

  it('live replaces one participant line and returns the same object when unchanged', () => {
    const room = applyServerMessage(emptyRoom(), snapshot());
    const typed = applyServerMessage(room, { type: 'live', participantId: 20, row: 2, text: 'hi', caret: 0, seq: 1 });
    expect(typed.participants.find((p) => p.participantId === 20)).toMatchObject({ row: 2, text: 'hi', caret: 0 });
    expect(typed.participants.find((p) => p.participantId === 10)).toMatchObject({ row: null, text: '', caret: 0 });
    expect(applyServerMessage(typed, { type: 'live', participantId: 20, row: 2, text: 'hi', caret: 0, seq: 2 })).toBe(typed);
    expect(applyServerMessage(typed, { type: 'live', participantId: 99, row: 2, text: 'x', caret: 0, seq: null })).toBe(typed);
  });

  it('live carries the caret and keeps identity when the caret is unchanged', () => {
    const room = applyServerMessage(emptyRoom(), snapshot());
    const moved = applyServerMessage(room, { type: 'live', participantId: 20, row: 2, text: 'hi', caret: 1, seq: 1 });
    expect(moved.participants.find((p) => p.participantId === 20)).toMatchObject({ text: 'hi', caret: 1 });
    expect(applyServerMessage(moved, { type: 'live', participantId: 20, row: 2, text: 'hi', caret: 1, seq: 2 })).toBe(moved);
  });

  it('committed adds a line once by id and orders by row', () => {
    let room = applyServerMessage(emptyRoom(), snapshot());
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 2, line: line('b', 5, 'second') });
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 3, line: line('a', 4, 'first') });
    room = applyServerMessage(room, { type: 'committed', participantId: 10, seq: 3, line: line('a', 4, 'first') });
    expect(sortedCommitted(room).map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('roster removes departed participants and keeps live text of the rest', () => {
    let room = applyServerMessage(emptyRoom(), snapshot());
    room = applyServerMessage(room, { type: 'live', participantId: 10, row: 2, text: 'keep', caret: 0, seq: 1 });
    room = applyServerMessage(room, { type: 'roster', roster: [alice, { participantId: 30, handle: 'Carol', color: '#f0f', slot: 1, afk: false }] });
    expect(room.participants.map((p) => p.handle)).toEqual(['Alice', 'Carol']);
    expect(room.participants[0]).toMatchObject({ row: 2, text: 'keep' });
    expect(room.participants[1]).toMatchObject({ row: null, text: '' });
  });

  it('a later snapshot never drops committed lines already seen', () => {
    let room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('a', 0, 'a'), line('b', 1, 'b'), line('c', 2, 'c')] }));
    room = applyServerMessage(room, snapshot({ committed: [line('c', 2, 'c')] }));
    expect(sortedCommitted(room).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('command and error messages leave the room unchanged', () => {
    const room = applyServerMessage(emptyRoom(), snapshot());
    expect(applyServerMessage(room, { type: 'command', name: 'help' })).toBe(room);
    expect(applyServerMessage(room, { type: 'error', code: 'seq-gap', expected: 4 })).toBe(room);
  });

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
});

describe('join history window (task 12)', () => {
  it('keeps a server-selected old row regardless of its timestamp', () => {
    const preserved = line('preserved', 0, 'watched', 1);
    let room = applyServerMessage(emptyRoom(), snapshot());
    room = applyServerMessage(room, { type: 'committed', participantId: null, seq: null, line: preserved });
    expect(sortedCommitted(room)).toEqual([preserved]);
    const recovered = applyServerMessage(emptyRoom(), snapshot({ committed: [preserved] }));
    expect(sortedCommitted(recovered)).toEqual([preserved]);
  });

  // The server sends only the selected history; timestamps are display metadata.
  const preJoin = (n: number) => Array.from({ length: n }, (_, row) => line(`l${row}`, row, `t${row}`, 1));

  it('all 20 server-selected history lines are retained', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: preJoin(25).slice(-20) }));
    expect(sortedCommitted(room).map((l) => l.row)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5));
  });

  it('all lines are shown when fewer than 20 exist', () => {
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: preJoin(5) }));
    expect(sortedCommitted(room).map((l) => l.row)).toEqual([0, 1, 2, 3, 4]);
  });

  it('a line below the boundary but committed after joining is shown', () => {
    // Row was claimed before the join; the newcomer watched it being typed.
    const room = applyServerMessage(emptyRoom(), snapshot({ committed: [line('late', 0, 'watched', 4)] }));
    expect(sortedCommitted(room).map((l) => l.id)).toEqual(['late']);
  });

  it('a later truncated snapshot adds nothing older and removes nothing', () => {
    let room = applyServerMessage(emptyRoom(), snapshot({ committed: preJoin(25).slice(-20) }));
    room = applyServerMessage(room, snapshot({ committed: [line('l24', 24, 't24', 1)] }));
    const rows = sortedCommitted(room).map((l) => l.row);
    expect(rows.length).toBe(20);
    expect(rows[0]).toBe(5);
    expect(rows[19]).toBe(24);
  });

});
