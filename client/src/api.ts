// Standalone API client for Fly deployment
type Room = {id:number, name:string, occupancy?:number, max?:number, isLobby?:boolean};
type Participant = {id:number, roomId?:number, handle:string, token?:string, color:string, lineSlot:number, activeLineIdx?:number, activeContent?:string, joinedAt?:number};
type RosterEntry = {handle:string, color:string, lineSlot:number};
type HistoryLine = {id:string, handle:string, content:string, lineIdx:number, committed:boolean, committedAt:number, color?:string};

async function fetchJson(url:string, init?:RequestInit){
  const res = await fetch(url, {headers:{'Content-Type':'application/json'}, ...init});
  if(!res.ok){
    const txt = await res.text().catch(()=>res.statusText);
    let msg = txt;
    try{ const j=JSON.parse(txt); if(j.error) msg=j.error; }catch{}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  listRooms:():Promise<{rooms:Room[]}> => fetchJson('/api/rooms'),
  getOrCreateRoom:(args:{preferredId?:number, forceNew?:boolean}):Promise<{room:Room}> => fetchJson('/api/rooms', {method:'POST', body:JSON.stringify(args)}),
  joinRoom:(args:{roomId:number, handle:string}):Promise<{participant:Participant & {token:string}, roster:RosterEntry[], room?:Room}> => fetchJson('/api/join', {method:'POST', body:JSON.stringify(args)}),
  leaveRoom:(args:{roomId:number, participantId:number, token?:string}):Promise<{freed:boolean}> => fetchJson('/api/leave', {method:'POST', body:JSON.stringify(args)}),
  getRoster:(args:{roomId:number}):Promise<{participants:RosterEntry[]}> => fetchJson(`/api/roster?roomId=${args.roomId}`),
};

export const keepaliveApi = {
  leaveRoom:(args:{roomId:number, participantId:number, token?:string})=>{
    try{
      const blob = new Blob([JSON.stringify(args)], {type:'application/json'});
      // @ts-ignore
      if(navigator.sendBeacon) return navigator.sendBeacon('/api/leave', blob);
    }catch{}
    fetch('/api/leave', {method:'POST', body:JSON.stringify(args), headers:{'Content-Type':'application/json'}, keepalive:true}).catch(()=>{});
    return true;
  }
};

// --- WebSocket chat protocol ---
export type WsMessage =
  | { type: 'snapshot'; roomId: number; you: { participantId: number; nextSeq: number }; liveLines: Array<{ participantId: number; handle: string; color: string; slot: number; row: number | null; text: string }>; committed: HistoryLine[]; roster: RosterEntry[] }
  | { type: 'live'; participantId: number; row: number | null; text: string; seq: number }
  | { type: 'committed'; participantId: number | null; seq: number | null; line: HistoryLine }
  | { type: 'roster'; roomId: number; roster: RosterEntry[] }
  | { type: 'command'; name: string }
  | { type: 'error'; code: string }
  | { type: 'pong' };

export type WsClientMessage =
  | { type: 'hello'; roomId: number; participantId: number; token: string }
  | { type: 'key'; kind: 'char' | 'backspace' | 'enter'; seq: number; char?: string };

export class SocketRejected extends Error {
  code: string;
  constructor(code: string) {
    super(`WebSocket rejected: ${code}`);
    this.code = code;
  }
}

// Opens the socket, performs the hello handshake, and resolves with the
// connection plus the initial snapshot. The snapshot is delivered to the
// caller because the socket's message handler is not attached until after
// the handshake resolves; re-reading it from the socket is impossible.
export function openChatSocket(session: { roomId: number; participantId: number; token: string }): Promise<{ socket: WebSocket; snapshot: Extract<WsMessage, { type: 'snapshot' }> }> {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      reject(e);
      return;
    }
    let settled = false;
    const cleanup = () => {
      ws.onopen = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.onmessage = null;
    };
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: 'hello', roomId: session.roomId, participantId: session.participantId, token: session.token }));
      } catch (e) {
        if (!settled) { settled = true; cleanup(); reject(e); }
        try { ws.close(); } catch {}
      }
    };
    ws.onmessage = (event) => {
      if (settled) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'error') {
          settled = true;
          cleanup();
          reject(new SocketRejected(msg.code ?? 'error'));
          try { ws.close(); } catch {}
          return;
        }
        if (msg.type === 'snapshot') {
          settled = true;
          cleanup();
          resolve({ socket: ws, snapshot: msg });
        }
      } catch {}
    };
    ws.onerror = () => {
      if (!settled) { settled = true; cleanup(); reject(new SocketRejected('connection-failed')); }
    };
    ws.onclose = () => {
      if (!settled) { settled = true; cleanup(); reject(new SocketRejected('closed-before-snapshot')); }
    };
    setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        try { ws.close(); } catch {}
        reject(new SocketRejected('handshake-timeout'));
      }
    }, 5000);
  });
}

export function sendKey(ws: WebSocket, msg: WsClientMessage) {
  ws.send(JSON.stringify(msg));
}
