// Pure helper extracted from App.tsx for testing document ordering and color resolution
export type HistoryLine = { id:string, handle:string, content:string, lineIdx:number, committed:boolean, committedAt:number, color?:string };
export type Participant = { id:number, handle:string, color:string, lineSlot:number, activeLineIdx?:number|null, activeContent?:string, joinedAt?:number };

export type CommittedRow = { kind:'committed', key:string, order:number, line:HistoryLine };
export type ActiveRow = { kind:'active', key:string, order:number, participant:Participant };
export type DocumentRow = CommittedRow | ActiveRow;

export function computeDocumentLines(history: HistoryLine[], participants: Participant[]): DocumentRow[] {
  const committedRows = history.map(line => ({
    kind:'committed' as const,
    key:`committed:${line.id}`,
    order: line.lineIdx,
    line,
  }));
  const activeRows = participants.map(p => ({
    kind:'active' as const,
    key:`active:${p.id}`,
    order: p.activeLineIdx ?? Number.MAX_SAFE_INTEGER,
    participant: p,
  }));
  return [...committedRows, ...activeRows].sort((l,r)=>{
    if(l.order !== r.order) return l.order - r.order;
    return l.key.localeCompare(r.key);
  });
}

export function resolveLineColor(line: HistoryLine, colorByHandle: Map<string,string>): string {
  // Prefer stored snapshot, then roster, then dim for system lines handled elsewhere but default to text
  return (line as any).color ?? colorByHandle.get(line.handle) ?? 'var(--text)';
}

export function sortParticipantsBySlot(participants: Participant[]): Participant[] {
  return [...participants].sort((a,b)=>a.lineSlot - b.lineSlot);
}

export function isValidChar(char: string): boolean {
  if (typeof char !== 'string') return false;
  const arr = Array.from(char);
  if (arr.length !== 1) return false;
  if (char === '\n' || char === '\r') return false;
  const code = char.charCodeAt(0);
  if (code < 32 && char !== ' ' && char !== '\t') return false;
  if (code === 127) return false;
  return true;
}
