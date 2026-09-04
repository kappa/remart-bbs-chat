import { describe, it, expect } from 'vitest';
import { computeDocumentLines, resolveLineColor, sortParticipantsBySlot, isValidChar, type HistoryLine, type Participant } from './documentLines';

describe('computeDocumentLines ordering', ()=>{
  it('orders committed + active by order, active with null at bottom', ()=>{
    const history: HistoryLine[] = [
      {id:'1', handle:'a', content:'hi', lineIdx:0, committed:true, committedAt:1},
      {id:'2', handle:'b', content:'yo', lineIdx:1, committed:true, committedAt:2},
    ];
    const participants: Participant[] = [
      {id:10, handle:'a', color:'#fff', lineSlot:0, activeLineIdx:2, activeContent:'typing'},
      {id:11, handle:'c', color:'#0f0', lineSlot:1, activeLineIdx:null, activeContent:''},
    ];
    const rows = computeDocumentLines(history, participants);
    expect(rows.map(r=>r.order)).toEqual([0,1,2, Number.MAX_SAFE_INTEGER]);
    expect(rows[0].key).toBe('committed:1');
    expect(rows[2].key).toBe('active:10');
    expect(rows[3].key).toBe('active:11');
  });

  it('preserves committed line at same order after Enter (no redraw)', ()=>{
    const history: HistoryLine[] = [
      {id:'1', handle:'a', content:'first', lineIdx:0, committed:true, committedAt:1},
    ];
    const participants: Participant[] = [
      {id:10, handle:'a', color:'#fff', lineSlot:0, activeLineIdx:1, activeContent:''},
    ];
    const rows = computeDocumentLines(history, participants);
    // committed stays at 0, new active at 1
    expect(rows[0].kind).toBe('committed');
    expect(rows[1].kind).toBe('active');
  });

  it('allows multiple empty committed lines', ()=>{
    const history: HistoryLine[] = [
      {id:'1', handle:'a', content:'', lineIdx:0, committed:true, committedAt:1},
      {id:'2', handle:'a', content:'', lineIdx:1, committed:true, committedAt:2},
    ];
    const participants: Participant[] = [
      {id:10, handle:'a', color:'#fff', lineSlot:0, activeLineIdx:2, activeContent:''},
    ];
    const rows = computeDocumentLines(history, participants);
    expect(rows.filter(r=>r.kind==='committed').length).toBe(2);
  });
});

describe('color persistence', ()=>{
  it('prefers line.color snapshot over roster', ()=>{
    const line: HistoryLine = {id:'1', handle:'a', content:'hi', lineIdx:0, committed:true, committedAt:1, color:'#123456'};
    const map = new Map([['a','#ffffff']]);
    expect(resolveLineColor(line, map)).toBe('#123456');
  });
  it('falls back to roster color when no snapshot', ()=>{
    const line: HistoryLine = {id:'1', handle:'a', content:'hi', lineIdx:0, committed:true, committedAt:1};
    const map = new Map([['a','#abcdef']]);
    expect(resolveLineColor(line, map)).toBe('#abcdef');
  });
  it('handles history after author left (no roster entry)', ()=>{
    const line: HistoryLine = {id:'1', handle:'left', content:'bye', lineIdx:0, committed:true, committedAt:1, color:'#ff00ff'};
    const map = new Map<string,string>([]);
    expect(resolveLineColor(line, map)).toBe('#ff00ff');
  });
});

describe('roster sorting', ()=>{
  it('sorts by lineSlot', ()=>{
    const ps: Participant[] = [
      {id:2, handle:'b', color:'#0f0', lineSlot:2},
      {id:1, handle:'a', color:'#fff', lineSlot:0},
      {id:3, handle:'c', color:'#00f', lineSlot:1},
    ];
    const sorted = sortParticipantsBySlot(ps);
    expect(sorted.map(p=>p.handle)).toEqual(['a','c','b']);
  });
});

describe('isValidChar', ()=>{
  it('allows unicode including Cyrillic', ()=>{
    expect(isValidChar('п')).toBe(true);
    expect(isValidChar('Я')).toBe(true);
    expect(isValidChar('a')).toBe(true);
    expect(isValidChar(' ')).toBe(true);
  });
  it('rejects newline and control', ()=>{
    expect(isValidChar('\n')).toBe(false);
    expect(isValidChar('\r')).toBe(false);
    expect(isValidChar('\u0000')).toBe(false);
    expect(isValidChar(String.fromCharCode(127))).toBe(false);
  });
  it('rejects multi-codepoint', ()=>{
    expect(isValidChar('ab')).toBe(false);
    expect(isValidChar('')).toBe(false);
  });
});

describe('empty line rendering helper', ()=>{
  it('empty committed line should render as space (logic)', ()=>{
    const line: HistoryLine = {id:'1', handle:'a', content:'', lineIdx:0, committed:true, committedAt:1};
    const rendered = line.content || ' ';
    expect(rendered).toBe(' ');
  });
});
