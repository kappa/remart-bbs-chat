import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { FakeWebSocket } from './testing/fakeWebSocket';

// jsdom has no WebSocket; install the shared fake. The app under test
// connects to a fake in-memory chat server whose state tests control through
// the helpers at the bottom of this file: a `hello` is answered with the
// primed snapshot, and `broadcastFromServer` pushes messages to open sockets.
type LiveLine = { participantId: number; handle: string; color: string; slot: number; row: number | null; text: string };

const server: {
  roomId: number;
  liveLines: LiveLine[];
  committed: Array<{ id: string; handle: string; content: string; lineIdx: number; committed?: boolean; committedAt: number; color?: string }>;
  roster: Array<{ handle: string; color: string; slot: number }>;
  nextSeq: number;
} = {
  roomId: 0,
  liveLines: [],
  committed: [],
  roster: [],
  nextSeq: 1,
};

class MockChatWebSocket extends FakeWebSocket {
  // Keystrokes this socket sent, in order (subset of `sent`).
  sentKeys: Array<{ kind: 'char' | 'backspace' | 'enter'; seq: number; char?: string }> = [];

  send(data: string) {
    const msg = JSON.parse(data);
    if (msg.type === 'hello' && server.roomId === msg.roomId) {
      // Every live line carries its own joinedAt so the client can filter
      // history relative to its own join. Tests that want strict pre-join
      // filtering can supply their own joinedAt; the default of 0 shows all
      // primed history.
      const liveLines = server.liveLines.map((l) => ({
        ...l,
        joinedAt: (l as any).joinedAt ?? 0,
      }));
      this.serverSend({
        type: 'snapshot',
        roomId: server.roomId,
        you: { participantId: msg.participantId, nextSeq: server.nextSeq },
        liveLines,
        committed: server.committed,
        roster: server.roster,
      });
    }
    if (msg.type === 'key') {
      this.sentKeys.push({ kind: msg.kind, seq: msg.seq, char: msg.char });
    }
    super.send(data);
  }
}

(globalThis as any).WebSocket = MockChatWebSocket;

// Fresh instance lists for every test, including files that use the fake
// directly instead of the helpers below.
beforeEach(() => FakeWebSocket.reset());

// AudioContext stub for join chirp
class MockAudioContext {
  currentTime = 0;
  createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} } as any; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } as any; }
  close() { }
  destination = {} as any;
}
(globalThis as any).AudioContext = MockAudioContext;
(globalThis as any).webkitAudioContext = MockAudioContext;

// Default fetch mock for tests that don't bring their own: the surviving HTTP
// surface (rooms, roster, leave) backed by the same primed server state.
if (typeof globalThis.fetch === 'undefined' || (globalThis.fetch as any).__isMocked !== true) {
  const fetchMock: any = async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const ok = (body: any) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(body),
      json: async () => body,
    });
    if (u.includes('/api/rooms') && method === 'GET') return ok({ rooms: [] });
    if (u.includes('/api/roster')) return ok({ participants: server.roster });
    if (u.includes('/api/leave')) return ok({ freed: true });
    return ok({});
  };
  (fetchMock as any).__isMocked = true;
  globalThis.fetch = fetchMock as any;
}

// --- Test helpers ---

export function resetChatState() {
  server.roomId = 0;
  server.liveLines = [];
  server.committed = [];
  server.roster = [];
  server.nextSeq = 1;
  FakeWebSocket.reset();
}

export function primeChatSnapshot(opts: {
  roomId: number;
  // Committed lines are passed through to the app verbatim; until the app
  // consumes the wire format directly this is its internal history shape.
  history?: Array<{ id: string; handle: string; content: string; lineIdx: number; committed?: boolean; committedAt: number; color?: string }>;
  liveLines?: LiveLine[];
  roster?: Array<{ handle: string; color: string; slot: number }>;
}) {
  server.roomId = opts.roomId;
  server.liveLines = opts.liveLines ?? [];
  server.committed = opts.history ?? [];
  server.roster = opts.roster ?? [];
}

export function getSockets() {
  return FakeWebSocket.instances as MockChatWebSocket[];
}

export function getLastSocket() {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1] as MockChatWebSocket;
}

export function broadcastFromServer(msg: any) {
  for (const ws of FakeWebSocket.instances) {
    ws.serverSend(msg);
  }
}

export function getServerState() {
  return server;
}
