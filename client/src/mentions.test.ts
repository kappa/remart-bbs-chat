import { describe, it, expect } from 'vitest';
import { mentionTokenBefore, mentionCandidates, mentionCompletion, splitMentions, mentionsHandle } from './mentions';
import type { RosterEntry } from './protocol';

const alice: RosterEntry = { participantId: 10, handle: 'Alice', color: '#fff', slot: 0, afk: false };
const bob: RosterEntry = { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1, afk: false };
const carol: RosterEntry = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2, afk: false };
const zhenya: RosterEntry = { participantId: 40, handle: 'Женя', color: '#ff0', slot: 3, afk: false };
const roster = [alice, bob, carol, zhenya];

describe('mentionTokenBefore', () => {
  it('finds a token at the end of the line', () => {
    expect(mentionTokenBefore('hello @c', 8)).toEqual({ start: 6, prefix: 'c' });
  });
  it('finds a bare @', () => {
    expect(mentionTokenBefore('@', 1)).toEqual({ start: 0, prefix: '' });
  });
  it('finds a token mid-line when the caret is followed by a space', () => {
    expect(mentionTokenBefore('@ca rest', 3)).toEqual({ start: 0, prefix: 'ca' });
  });
  it('counts code points, not UTF-16 units', () => {
    expect(mentionTokenBefore('😀 @Же', 5)).toEqual({ start: 2, prefix: 'Же' });
  });
  it('rejects a token that does not start with @', () => {
    expect(mentionTokenBefore('foo@c', 5)).toBeNull();
  });
  it('rejects a caret inside the token', () => {
    expect(mentionTokenBefore('@carol', 3)).toBeNull();
  });
  it('rejects a caret after whitespace and an empty line', () => {
    expect(mentionTokenBefore('@carol ', 7)).toBeNull();
    expect(mentionTokenBefore('', 0)).toBeNull();
  });
});

describe('mentionCandidates', () => {
  it('matches by case-insensitive prefix and keeps roster order', () => {
    expect(mentionCandidates('c', roster, 10).map((e) => e.handle)).toEqual(['Carol']);
    expect(mentionCandidates('B', roster, 10).map((e) => e.handle)).toEqual(['Bob']);
  });
  it('matches Cyrillic case-insensitively', () => {
    expect(mentionCandidates('же', roster, 10).map((e) => e.handle)).toEqual(['Женя']);
  });
  it('excludes the own participant by id and returns everyone for an empty prefix', () => {
    expect(mentionCandidates('', roster, 10).map((e) => e.handle)).toEqual(['Bob', 'Carol', 'Женя']);
    expect(mentionCandidates('a', roster, 10)).toEqual([]);
  });
  it('returns nothing when no handle matches', () => {
    expect(mentionCandidates('x', roster, 10)).toEqual([]);
  });
});

describe('mentionCompletion', () => {
  it('returns the code points after the prefix', () => {
    expect(mentionCompletion('Carol', 'c')).toEqual(['a', 'r', 'o', 'l']);
    expect(mentionCompletion('Женя', 'же')).toEqual(['н', 'я']);
  });
  it('returns nothing when the prefix already spells the handle', () => {
    expect(mentionCompletion('Carol', 'carol')).toEqual([]);
  });
});

describe('splitMentions', () => {
  const mention = (text: string, entry: typeof alice) => ({ kind: 'mention', text, handle: entry.handle, participantId: entry.participantId, color: entry.color });
  it('colors a mention at the start, after a space, and before punctuation', () => {
    expect(splitMentions('@Alice hi', roster)).toEqual([mention('@Alice', alice), { kind: 'text', text: ' hi' }]);
    expect(splitMentions('hi @Bob, and @Carol?', roster)).toEqual([
      { kind: 'text', text: 'hi ' }, mention('@Bob', bob), { kind: 'text', text: ', and ' }, mention('@Carol', carol), { kind: 'text', text: '?' },
    ]);
    expect(splitMentions('(@Alice)', roster)).toEqual([{ kind: 'text', text: '(@Alice)' }]);
  });
  it('matches case-insensitively, including Cyrillic', () => {
    expect(splitMentions('@alice @ЖЕНЯ', roster)).toEqual([mention('@alice', alice), { kind: 'text', text: ' ' }, mention('@ЖЕНЯ', zhenya)]);
  });
  it('requires equality, not a prefix, and ignores unknown names', () => {
    expect(splitMentions('@Al @Alicee @Dave', roster)).toEqual([{ kind: 'text', text: '@Al @Alicee @Dave' }]);
  });
  it('ignores @ inside a word or an address', () => {
    expect(splitMentions('foo@Alice name@example.com', roster)).toEqual([{ kind: 'text', text: 'foo@Alice name@example.com' }]);
  });
  it('returns one text segment for plain and empty text', () => {
    expect(splitMentions('hello', roster)).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(splitMentions('', roster)).toEqual([{ kind: 'text', text: '' }]);
  });
});

describe('mentionsHandle', () => {
  it('answers the same cases', () => {
    expect(mentionsHandle('hi @alice!', 'Alice')).toBe(true);
    expect(mentionsHandle('hi @Al', 'Alice')).toBe(false);
    expect(mentionsHandle('foo@Alice', 'Alice')).toBe(false);
    expect(mentionsHandle('@Женя', 'женя')).toBe(true);
    expect(mentionsHandle('', 'Alice')).toBe(false);
  });
});
