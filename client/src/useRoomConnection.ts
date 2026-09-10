import { useEffect, useRef, useState } from 'react';
import { openRoomConnection, type ConnectionStatus } from './connection';
import type { CommandName, KeyInput, ServerMessage } from './protocol';
import { applyServerMessage, emptyRoom, type RoomState } from './roomState';

export type RoomSession = { roomId: number; participantId: number; token: string; joinedAt: number; historyFromRow: number };
export type RoomEvents = {
  onCommand: (name: CommandName) => void;
  onSessionEnded: () => void;
  onNewcomer: (entry: { handle: string }) => void;
  onNotice: (text: string) => void;
};

// Owns the socket for the current session and turns server messages into
// room state. Events that need app-level reactions (commands, session end,
// join chirp, warnings) go through `events`, read via a ref so callers can
// pass fresh closures every render.
export function useRoomConnection(session: RoomSession | null, events: RoomEvents) {
  const [room, setRoom] = useState<RoomState>(emptyRoom);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  // Keystrokes in flight: typed here but not yet echoed. Zero means the
  // rendered live line is what the server has.
  const [pending, setPending] = useState(0);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const sendRef = useRef<(key: KeyInput) => boolean>(() => false);
  const pendingRef = useRef<() => number>(() => 0);

  const roomId = session?.roomId, participantId = session?.participantId, token = session?.token, joinedAt = session?.joinedAt, historyFromRow = session?.historyFromRow;

  useEffect(() => {
    if (roomId == null || participantId == null || token == null || joinedAt == null || historyFromRow == null) return;
    setRoom(emptyRoom());
    const knownIds = new Set<number>();
    let seeded = false;
    const connection = openRoomConnection({ roomId, participantId, token }, {
      onStatus: setStatus,
      onInputLost: () => eventsRef.current.onNotice('Connection recovered, some input was lost'),
      onMessage: (msg: ServerMessage) => {
        if (msg.type === 'command') return eventsRef.current.onCommand(msg.name);
        if (msg.type === 'error') {
          if (msg.code === 'unknown-participant' || msg.code === 'unauthorized') eventsRef.current.onSessionEnded();
          return;
        }
        if (msg.type === 'roster' || msg.type === 'snapshot') {
          const entries = msg.type === 'roster' ? msg.roster : msg.liveLines;
          const newcomer = seeded
            ? entries.find((e) => !knownIds.has(e.participantId) && e.participantId !== participantId)
            : undefined;
          knownIds.clear();
          for (const e of entries) knownIds.add(e.participantId);
          seeded = true;
          if (newcomer) eventsRef.current.onNewcomer({ handle: newcomer.handle });
        }
        setRoom((prev) => applyServerMessage(prev, msg));
        setPending(pendingRef.current());
      },
    });
    sendRef.current = connection.send;
    pendingRef.current = connection.pendingCount;
    return () => { connection.close(); sendRef.current = () => false; pendingRef.current = () => 0; };
  }, [roomId, participantId, token, joinedAt, historyFromRow]);

  const send = (key: KeyInput) => {
    if (!sendRef.current(key)) eventsRef.current.onNotice('Not connected, input paused');
    setPending(pendingRef.current());
  };

  return { room, status, send, pending };
}
