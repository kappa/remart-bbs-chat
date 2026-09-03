// standalone API client for Fly deployment
type Room = {id:number, name:string, occupancy?:number, max?:number, isLobby?:boolean};
type Participant = {id:number, roomId?:number, handle:string, color:string, lineSlot:number, activeLineIdx?:number, activeContent?:string, joinedAt?:number};
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
  joinRoom:(args:{roomId:number, handle:string}):Promise<{participant:Participant, roster:RosterEntry[], room?:Room}> => fetchJson('/api/join', {method:'POST', body:JSON.stringify(args)}),
  leaveRoom:(args:{roomId:number, participantId:number}):Promise<{freed:boolean}> => fetchJson('/api/leave', {method:'POST', body:JSON.stringify(args)}),
  getRoster:(args:{roomId:number}):Promise<{participants:RosterEntry[]}> => fetchJson(`/api/roster?roomId=${args.roomId}`),
  heartbeat:(args:{roomId:number, participantId:number}):Promise<{alive:boolean, removed:number}> => fetchJson('/api/heartbeat', {method:'POST', body:JSON.stringify(args)}),
  sendChar:(args:{roomId:number, participantId:number, char:string}):Promise<{content:string, lineIdx:number, position:number, participantId:number}> => fetchJson('/api/char', {method:'POST', body:JSON.stringify(args)}),
  sendBackspace:(args:{roomId:number, participantId:number}):Promise<{content:string, lineIdx:number, participantId:number}> => fetchJson('/api/backspace', {method:'POST', body:JSON.stringify(args)}),
  commitLine:(args:{roomId:number, participantId:number}):Promise<{newLineIdx:number, committedContent:string, committedAt:number}> => fetchJson('/api/commit', {method:'POST', body:JSON.stringify(args)}),
  getRoomState:(args:{roomId:number}):Promise<{roomId:number, history:HistoryLine[], participants:Participant[], roster:RosterEntry[]}> => fetchJson(`/api/room-state?roomId=${args.roomId}`),
};

export const keepaliveApi = {
  leaveRoom:(args:{roomId:number, participantId:number})=>{
    try{
      const blob = new Blob([JSON.stringify(args)], {type:'application/json'});
      // @ts-ignore
      if(navigator.sendBeacon) return navigator.sendBeacon('/api/leave', blob);
    }catch{}
    // fallback fetch with keepalive
    fetch('/api/leave', {method:'POST', body:JSON.stringify(args), headers:{'Content-Type':'application/json'}, keepalive:true}).catch(()=>{});
    return true;
  }
};
