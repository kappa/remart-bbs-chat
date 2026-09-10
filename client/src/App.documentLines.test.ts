import { describe, it, expect } from 'vitest';
import { computeDocumentLines, isValidChar } from './documentLines';
import type { CommittedLine, LiveLine } from './protocol';

const line = (id: string, row: number, text: string): CommittedLine => ({ id, row, text, handle: 'a', color: '#fff', committedAt: 1 });
const live = (participantId: number, row: number | null, text: string): LiveLine => ({ participantId, handle: `p${participantId}`, color: '#0f0', slot: participantId, afk: false, row, text, caret: 0 });

describe('computeDocumentLines', () => {
  it('orders committed and live rows together by row and skips idle participants', () => {
    const rows = computeDocumentLines([line('1', 0, 'hi'), line('2', 1, 'yo')], [live(10, 2, 'typing'), live(11, null, '')]);
    expect(rows.map((r) => [r.kind, r.order])).toEqual([['committed', 0], ['committed', 1], ['live', 2]]);
    expect(rows.map((r) => r.key)).toEqual(['committed:1', 'committed:2', 'live:10']);
  });

  it('keeps a committed line at its row after Enter', () => {
    const rows = computeDocumentLines([line('1', 0, 'first')], [live(10, 1, '')]);
    expect(rows[0].kind).toBe('committed');
    expect(rows[1]).toMatchObject({ kind: 'live', order: 1 });
  });

  it('a live line backspaced to empty keeps its row', () => {
    const rows = computeDocumentLines([line('1', 0, 'x'), line('2', 2, 'later')], [live(10, 1, '')]);
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it('allows multiple empty committed lines', () => {
    expect(computeDocumentLines([line('1', 0, ''), line('2', 1, '')], []).length).toBe(2);
  });

  it('a live row and a committed row never share a row; ties fall back to key order', () => {
    const rows = computeDocumentLines([line('1', 3, 'x')], [live(10, 3, 'y')]);
    expect(rows.map((r) => r.key)).toEqual(['committed:1', 'live:10']);
  });
});

describe('isValidChar', () => {
  it('allows Unicode including Cyrillic, space, and tab', () => {
    for (const c of ['a', 'Ж', 'é', ' ', '\t', '😀']) expect(isValidChar(c)).toBe(true);
  });
  it('rejects newline, controls, DEL, and multi-codepoint strings', () => {
    for (const c of ['\n', '\r', '\u0000', '\u0001', 'ab', '']) expect(isValidChar(c)).toBe(false);
  });
});
