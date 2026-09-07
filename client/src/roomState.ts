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

// The server selects each participant's history window. Accumulate every
// delivered line; timestamps do not determine whether it belongs to the view.
// Applies one server message. Returns the same object when nothing changed
// so React skips the re-render.
export function applyServerMessage(room: RoomState, msg: ServerMessage): RoomState {
  switch (msg.type) {
    case 'snapshot': {
      const committed = new Map(room.committed);
      for (const line of msg.committed) committed.set(line.id, line);
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
