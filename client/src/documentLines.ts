import type { CommittedLine, LiveLine } from './protocol';

export type CommittedRow = { kind: 'committed'; key: string; order: number; line: CommittedLine };
export type LiveRow = { kind: 'live'; key: string; order: number; participant: LiveLine };
export type DocumentRow = CommittedRow | LiveRow;

// Committed and live lines are one document ordered by server-assigned row.
// A row's position comes only from its number, never from its kind, so Enter
// turns a live row into a committed row without moving it. Idle participants
// (no row) take no space; their own client shows a local caret instead.
export function computeDocumentLines(committed: CommittedLine[], participants: LiveLine[]): DocumentRow[] {
  const committedRows: DocumentRow[] = committed.map((line) => ({ kind: 'committed', key: `committed:${line.id}`, order: line.row, line }));
  const liveRows: DocumentRow[] = participants.flatMap((participant) =>
    participant.row == null ? [] : [{ kind: 'live' as const, key: `live:${participant.participantId}`, order: participant.row, participant }],
  );
  return [...committedRows, ...liveRows].sort((l, r) => (l.order !== r.order ? l.order - r.order : l.key.localeCompare(r.key)));
}

// Mirrors the server's isValidChar: one code point, no CR/LF, no C0 controls
// except tab, no DEL. Keep the two in step.
export function isValidChar(char: string): boolean {
  if (typeof char !== 'string') return false;
  if (Array.from(char).length !== 1) return false;
  if (char === '\n' || char === '\r') return false;
  const code = char.charCodeAt(0);
  if (code < 32 && char !== ' ' && char !== '\t') return false;
  if (code === 127) return false;
  return true;
}
