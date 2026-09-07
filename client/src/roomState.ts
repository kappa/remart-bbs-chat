import type { CommittedLine, LiveLine, ServerMessage } from './protocol';

// Everything the session view renders. `participants` carries roster fields
// plus each person's live line; `committed` accumulates every line inside
// the join window plus everything seen since joining, and is never trimmed,
// so scrollback outlives snapshots.
export type RoomState = { participants: LiveLine[]; committed: Map<string, CommittedLine> };

export function emptyRoom(): RoomState {
  return { participants: [], committed: new Map() };
}

const bySlot = (lines: LiveLine[]) => [...lines].sort((a, b) => a.slot - b.slot);

// What the join response gave the client: the timestamp of the join and the
// row where the newcomer's 20-line history window starts.
export type JoinBoundary = { joinedAt: number; historyFromRow: number };

// A committed line is shown when it sits inside the 20-line window chosen at
// join (row >= historyFromRow), or when it was committed after the join — a
// line the newcomer watched being typed must not vanish when it commits.
const inWindow = (line: CommittedLine, boundary: JoinBoundary) =>
  line.row >= boundary.historyFromRow || line.committedAt >= boundary.joinedAt;

// Applies one server message. Returns the same object when nothing changed
// so React skips the re-render.
export function applyServerMessage(room: RoomState, msg: ServerMessage, boundary: JoinBoundary): RoomState {
  switch (msg.type) {
    case 'snapshot': {
      const committed = new Map(room.committed);
      for (const line of msg.committed) if (inWindow(line, boundary)) committed.set(line.id, line);
      return { participants: bySlot(msg.liveLines), committed };
    }
    case 'live': {
      const index = room.participants.findIndex((p) => p.participantId === msg.participantId);
      if (index === -1) return room;
      const current = room.participants[index];
      if (current.row === msg.row && current.text === msg.text) return room;
      const participants = room.participants.slice();
      participants[index] = { ...current, row: msg.row, text: msg.text };
      return { ...room, participants };
    }
    case 'committed': {
      if (!inWindow(msg.line, boundary)) return room;
      const committed = new Map(room.committed);
      committed.set(msg.line.id, msg.line);
      return { ...room, committed };
    }
    case 'roster': {
      const known = new Map(room.participants.map((p) => [p.participantId, p]));
      const participants = msg.roster.map((entry) => {
        const previous = known.get(entry.participantId);
        return { ...entry, row: previous?.row ?? null, text: previous?.text ?? '' };
      });
      return { ...room, participants: bySlot(participants) };
    }
    default:
      return room;
  }
}

export function sortedCommitted(room: RoomState): CommittedLine[] {
  return Array.from(room.committed.values()).sort((a, b) => a.row - b.row);
}
