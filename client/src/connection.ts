import type { ClientMessage, KeyInput, KeyMessage, ServerMessage } from './protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';
export type ConnectionCredentials = { roomId: number; participantId: number; token: string };
export type ConnectionHandlers = {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  onInputLost: () => void;
};
export type ConnectionOptions = { url?: string; reconnectDelayMs?: number; maxPending?: number };
export type RoomConnection = {
  // Numbers and queues a keystroke; false means the queue is full and it was dropped.
  send: (key: KeyInput) => boolean;
  // Keystrokes sent or queued that no echo has acknowledged yet.
  pendingCount: () => number;
  // Reports tab visibility. Sent at once when open, and again after every snapshot.
  setHidden: (hidden: boolean) => void;
  // Sends one private line now, or false when the socket is not open.
  sendPrivate: (to: number, text: string) => boolean;
  close: () => void;
};

export const MAX_PENDING = 200;
export const RECONNECT_DELAY_MS = 1200;

export function socketUrl(location: Location = window.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

// One socket per session. Keystrokes are numbered on the way in and held in
// `pending` until the server echoes them back (its echo carries our seq).
// Each snapshot says where the server's count stands: keystrokes already sent
// below that count were applied and are dropped; the rest (including any typed
// before the first snapshot, when this page's count was still a guess) are
// renumbered from the server's count and sent. A seq-gap means the server saw
// a number it never received: the queue is discarded and the count restarts
// at its value.
export function openRoomConnection(credentials: ConnectionCredentials, handlers: ConnectionHandlers, options: ConnectionOptions = {}): RoomConnection {
  const url = options.url ?? socketUrl();
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  const maxPending = options.maxPending ?? MAX_PENDING;

  let socket: WebSocket | null = null;
  let closed = false;
  let ready = false;
  let nextSeq = 1;
  let pending: { key: KeyMessage; sent: boolean }[] = [];
  let reconnectTimer: number | null = null;
  let hidden: boolean | null = null;

  const transmit = (msg: ClientMessage) => {
    try { socket?.send(JSON.stringify(msg)); } catch { /* the close handler reconnects */ }
  };

  // Presence is not a keystroke: no number, no queue, no replay. The last
  // value is re-sent after every snapshot so reconnect reports current visibility.
  const sendPresence = () => { if (hidden != null && ready) transmit({ type: 'presence', hidden }); };

  const scheduleReconnect = () => {
    if (closed) return;
    reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
  };

  const receive = (msg: ServerMessage) => {
    if (msg.type === 'snapshot') {
      pending = pending.filter((entry) => !(entry.sent && entry.key.seq < msg.you.nextSeq));
      nextSeq = msg.you.nextSeq;
      for (const entry of pending) {
        entry.key.seq = nextSeq++;
        entry.sent = true;
        transmit(entry.key);
      }
      ready = true;
      sendPresence();
      handlers.onStatus('open');
    } else if ((msg.type === 'live' || msg.type === 'committed') && msg.participantId === credentials.participantId && msg.seq != null) {
      const acked = msg.seq;
      pending = pending.filter((entry) => entry.key.seq > acked);
    } else if (msg.type === 'error' && msg.code === 'seq-gap') {
      pending = [];
      if (typeof msg.expected === 'number') nextSeq = msg.expected;
      handlers.onInputLost();
    }
    handlers.onMessage(msg);
  };

  const connect = () => {
    if (closed) return;
    let current: WebSocket;
    try { current = new WebSocket(url); } catch { scheduleReconnect(); return; }
    socket = current;
    ready = false;
    current.onopen = () => transmit({ type: 'hello', ...credentials });
    current.onmessage = (event) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(event.data); } catch { return; }
      receive(msg);
    };
    current.onclose = () => {
      if (closed || socket !== current) return;
      ready = false;
      handlers.onStatus('reconnecting');
      scheduleReconnect();
    };
    current.onerror = () => { try { current.close(); } catch { /* close handler runs */ } };
  };

  handlers.onStatus('connecting');
  connect();

  return {
    send(key) {
      if (pending.length >= maxPending) return false;
      const msg: KeyMessage = { type: 'key', seq: nextSeq++, ...key };
      pending.push({ key: msg, sent: ready });
      if (ready) transmit(msg);
      return true;
    },
    pendingCount() {
      return pending.length;
    },
    setHidden(next) {
      hidden = next;
      sendPresence();
    },
    sendPrivate(to, text) {
      if (!ready) return false;
      transmit({ type: 'private', to, text });
      return true;
    },
    close() {
      closed = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      try { socket?.close(); } catch { /* already closed */ }
    },
  };
}
