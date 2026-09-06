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
