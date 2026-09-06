type Room = {id:number, name:string, occupancy?:number, max?:number, isLobby?:boolean};
type JoinedParticipant = {id:number, roomId:number, handle:string, token:string, color:string, slot:number, liveRow:number|null, joinedAt:number};
type RosterEntry = {handle:string, color:string, slot:number};

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

// HTTP covers what happens outside a room; chat travels over the socket (connection.ts).
export const api = {
  listRooms:():Promise<{rooms:Room[]}> => fetchJson('/api/rooms'),
  getOrCreateRoom:(args:{preferredId?:number, forceNew?:boolean}):Promise<{room:Room}> => fetchJson('/api/rooms', {method:'POST', body:JSON.stringify(args)}),
  joinRoom:(args:{roomId:number, handle:string}):Promise<{participant:JoinedParticipant, roster:RosterEntry[], room:Room}> => fetchJson('/api/join', {method:'POST', body:JSON.stringify(args)}),
  leaveRoom:(args:{roomId:number, participantId:number, token:string}):Promise<{freed:boolean}> => fetchJson('/api/leave', {method:'POST', body:JSON.stringify(args)}),
  getRoster:(args:{roomId:number}):Promise<{participants:RosterEntry[]}> => fetchJson(`/api/roster?roomId=${args.roomId}`),
};

export const keepaliveApi = {
  leaveRoom:(args:{roomId:number, participantId:number, token:string})=>{
    try{
      const blob = new Blob([JSON.stringify(args)], {type:'application/json'});
      // @ts-ignore
      if(navigator.sendBeacon) return navigator.sendBeacon('/api/leave', blob);
    }catch{}
    fetch('/api/leave', {method:'POST', body:JSON.stringify(args), headers:{'Content-Type':'application/json'}, keepalive:true}).catch(()=>{});
    return true;
  }
};
