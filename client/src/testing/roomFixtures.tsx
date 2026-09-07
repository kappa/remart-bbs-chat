import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../App';
import { FakeWebSocket } from './fakeWebSocket';
import type { CommittedLine, LiveLine, RosterEntry, ServerMessage } from '../protocol';

export const SESSION = { roomId: 1, roomName: 'Room 1', participantId: 10, handle: 'Alice', token: 'test-token', joinedAt: 1, historyFromRow: 0 };
export const alice: RosterEntry = { participantId: 10, handle: 'Alice', color: '#fff', slot: 0 };
export const bob: RosterEntry = { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1 };

export function storeSession(session = SESSION) {
  sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
}

export function idle(entry: RosterEntry): LiveLine { return { ...entry, row: null, text: '', caret: 0 }; }
export function typing(entry: RosterEntry, row: number, text: string, caret = Array.from(text).length): LiveLine { return { ...entry, row, text, caret }; }

export function line(id: string, row: number, text: string, author: RosterEntry = alice, committedAt = 2): CommittedLine {
  return { id, row, text, handle: author.handle, color: author.color, committedAt };
}

type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;
export function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return { type: 'snapshot', roomId: 1, you: { participantId: 10, nextSeq: 1 }, liveLines: [idle(alice)], committed: [], roster: [alice], ...over };
}

export function queryClient() { return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); }

// Renders the app with a stored session, waits for its hello, and answers
// with `snap`. Returns the fake socket for sending more server messages.
export async function renderJoined(snap: Snapshot = snapshot(), session = SESSION) {
  storeSession(session);
  const view = render(<QueryClientProvider client={queryClient()}><App /></QueryClientProvider>);
  const ws = await waitFor(() => {
    const socket = FakeWebSocket.latest();
    if (!socket.sent.some((m) => m.type === 'hello')) throw new Error('no hello yet');
    return socket;
  });
  act(() => ws.serverSend(snap));
  return { ws, ...view };
}

export function serverSend(ws: FakeWebSocket, msg: ServerMessage) { act(() => ws.serverSend(msg)); }
