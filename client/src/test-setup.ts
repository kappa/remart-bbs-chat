import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement WebSocket by default; provide a stub for App's WS effect.
// Tests control the stub via the test-setup helpers below.
type LiveLine = { participantId: number; handle: string; color: string; slot: number; row: number | null; text: string };
type ServerState = {
  roomId: number;
  liveLines: LiveLine[];
  committed: Array<{ id: string; handle: string; content: string; lineIdx: number; committed: boolean; committedAt: number; color?: string }>;
  roster: Array<{ handle: string; color: string; lineSlot: number }>;
  nextSeq: number;
  nextLineIdx: number;
  sockets: Array<{ ws: any; participantId: number; lastSeq: number }>;
};

const server: ServerState = {
  roomId: 0,
  liveLines: [],
  committed: [],
  roster: [],
  nextSeq: 1,
  nextLineIdx: 0,
  sockets: [],
};

const sockets: any[] = [];

class MockWebSocket {
  url: string;
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  sentKeys: Array<{ kind: 'char' | 'backspace' | 'enter'; seq: number; char?: string }> = [];
  helloMsg: any = null;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'hello') {
      this.helloMsg = msg;
      // Each live line carries its own joinedAt so the client can filter
      // history relative to its own join. The "self" participant (matching
      // the hello) gets joinedAt = now; others get the value supplied in the
      // mock (defaulting to 0 = show all history).
      const liveLines = server.liveLines.map((l) => ({
        ...l,
        // For the "self" participant, default joinedAt to 0 so tests can
        // pre-seed history without it being filtered as pre-join. Tests that
        // want strict pre-join filtering can supply their own joinedAt.
        joinedAt: (l as any).joinedAt ?? (l.participantId === msg.participantId ? 0 : 0),
      }));
      const snapshot = {
        type: 'snapshot',
        roomId: server.roomId,
        you: { participantId: msg.participantId, nextSeq: server.nextSeq },
        liveLines,
        committed: server.committed,
        roster: server.roster,
      };
      this.deliver(snapshot);
      return;
    }
    if (msg.type === 'key') {
      this.sentKeys.push({ kind: msg.kind, seq: msg.seq, char: msg.char });
    }
  }

  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  deliver(msg: any) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) });
  }
}

(globalThis as any).WebSocket = MockWebSocket;

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

// Default fetch mock for tests that don't bring their own. Returns state
// derived from the live chat server mock so room-state polling agrees with
// the WebSocket snapshot and doesn't mark the session invalid.
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
    if (u.includes('/api/room-state')) {
      // Build a room-state view that matches the primed snapshot. joinedAt
      // matches what the WebSocket snapshot delivered (default 0 = show all
      // history) so the polling path and socket path agree.
      const participants = (server.liveLines ?? []).map((l) => ({
        id: l.participantId,
        handle: l.handle,
        color: l.color,
        lineSlot: l.slot,
        activeLineIdx: l.row,
        activeContent: l.text,
        joinedAt: (l as any).joinedAt ?? 0,
        nextExpectedSeq: server.nextSeq,
      }));
      return ok({
        roomId: server.roomId,
        history: server.committed,
        participants,
        roster: server.roster,
      });
    }
    if (u.includes('/api/roster')) return ok({ participants: server.roster });
    if (u.includes('/api/leave')) return ok({ freed: true });
    return ok({});
  };
  (fetchMock as any).__isMocked = true;
  globalThis.fetch = fetchMock as any;
}

// --- Test helpers ---
// Tests call these from beforeEach to drive the mock WebSocket / fake server.

export function resetChatState() {
  server.roomId = 0;
  server.liveLines = [];
  server.committed = [];
  server.roster = [];
  server.nextSeq = 1;
  server.nextLineIdx = 0;
  server.sockets = [];
  sockets.length = 0;
}

export function primeChatSnapshot(opts: {
  roomId: number;
  history?: Array<{ id: string; handle: string; content: string; lineIdx: number; committed: boolean; committedAt: number; color?: string }>;
  liveLines?: LiveLine[];
  roster?: Array<{ handle: string; color: string; lineSlot: number }>;
}) {
  server.roomId = opts.roomId;
  server.liveLines = opts.liveLines ?? [];
  server.committed = opts.history ?? [];
  server.roster = opts.roster ?? [];
  // Compute a sensible next line index from the seed
  let maxIdx = 0;
  for (const l of server.committed) if (l.lineIdx >= maxIdx) maxIdx = l.lineIdx + 1;
  for (const l of server.liveLines) if (l.row != null && l.row >= maxIdx) maxIdx = l.row + 1;
  server.nextLineIdx = maxIdx;
}

export function getSockets() {
  return sockets;
}

export function getLastSocket() {
  return sockets[sockets.length - 1];
}

export function broadcastFromServer(msg: any) {
  for (const ws of sockets) {
    ws.deliver(msg);
  }
}

export function getServerState() {
  return server;
}
