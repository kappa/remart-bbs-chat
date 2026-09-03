import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANSI_COLORS = ["#00FFFF","#FFFF00","#FF00FF","#00FF00","#FF8000","#80FF00","#FF0080","#00FF80","#8080FF","#FF8080"];
const MAX_LINE_LENGTH = 80;
const HEARTBEAT_TIMEOUT_MS = 40000;
const PRINTABLE_ASCII = /^[\x20-\x7E]$/;

let nextRoomId = 1;
let nextParticipantId = 1;
const rooms = new Map(); // id -> room

function getRoom(id){ return rooms.get(Number(id)); }

function listRooms(){
  const now = Date.now();
  const cutoff = now - HEARTBEAT_TIMEOUT_MS;
  const result = [];
  for(const room of rooms.values()){
    let occ = 0;
    for(const p of room.participants.values()){
      if(p.lastSeen.getTime() >= cutoff) occ++;
    }
    result.push({id:room.id, name:room.name, occupancy:occ, max:10, isLobby:false});
  }
  result.sort((a,b)=>a.id-b.id);
  return result;
}

function getOrCreateRoom(preferredId, forceNew){
  const now = Date.now();
  const cutoff = now - HEARTBEAT_TIMEOUT_MS;
  if(!forceNew && preferredId && rooms.has(Number(preferredId))){
    const r = rooms.get(Number(preferredId));
    let occ=0;
    for(const p of r.participants.values()) if(p.lastSeen.getTime()>=cutoff) occ++;
    if(occ < 10) return r;
  }
  if(!forceNew){
    for(const r of rooms.values()){
      let occ=0;
      for(const p of r.participants.values()) if(p.lastSeen.getTime()>=cutoff) occ++;
      if(occ < 10) return r;
    }
  }
  const id = nextRoomId++;
  const room = {id, name:`Room ${id}`, createdAt:new Date(), maxParticipants:10, isLobby:false, participants:new Map(), lines:[], charEvents:[], wsClients:new Set(), nextLineIdx:0};
  rooms.set(id, room);
  return room;
}

function greatestLineIdx(room){
  let max=-1;
  for(const l of room.lines) if(l.lineIdx>max) max=l.lineIdx;
  for(const p of room.participants.values()) if(p.activeLineIdx>max) max=p.activeLineIdx;
  return max;
}

function cleanupStaleInRoom(room, excludeId=null){
  const now = Date.now();
  const cutoff = now - HEARTBEAT_TIMEOUT_MS;
  const stale = [];
  for(const p of room.participants.values()){
    if(excludeId && p.id===excludeId) continue;
    if(p.lastSeen.getTime() < cutoff) stale.push(p);
  }
  if(stale.length===0) return 0;
  let nextIdx = greatestLineIdx(room)+1;
  for(const s of stale){
    // Spec 3.4 + 10: nonempty active line remains as committed text; empty disappears
    if(s.activeContent && s.activeContent.length>0){
      room.lines.push({
        id:`line-${s.id}-${Date.now()}`,
        handle:s.handle,
        content:s.activeContent,
        committed:true,
        lineIdx:s.activeLineIdx,
        createdAt:new Date(s.lastSeen.getTime()),
        committedAt:s.lastSeen.getTime(),
        colorSnapshot:s.color
      });
    }
    room.lines.push({
      id:`leave-${s.id}-${Date.now()}-${nextIdx}`,
      handle:s.handle,
      content:`* ${s.handle} left`,
      committed:true,
      lineIdx:nextIdx++,
      createdAt:new Date(),
      committedAt:Date.now(),
      colorSnapshot:s.color
    });
    room.charEvents = room.charEvents.filter(e=>e.handle!==s.handle);
    room.participants.delete(s.id);
  }
  // ephemeral room cleanup
  if(room.participants.size===0 && !room.isLobby){
    rooms.delete(room.id);
    return stale.length; // room gone, caller should handle
  }
  broadcastRoom(room);
  return stale.length;
}

function globalHandleExists(handleLower){
  const lower = handleLower.toLowerCase();
  for(const room of rooms.values()){
    for(const p of room.participants.values()){
      if(p.handle.toLowerCase()===lower) return true;
    }
  }
  return false;
}

function broadcastRoom(room){
  if(!room || !room.wsClients || room.wsClients.size===0) return;
  const payload = JSON.stringify({type:'room-update', roomId:room.id});
  for(const ws of room.wsClients){
    try{ if(ws.readyState===1) ws.send(payload); }catch{}
  }
}

function broadcastChar(room, participantId, type, data){
  if(!room.wsClients) return;
  const msg = JSON.stringify({type, roomId:room.id, participantId, ...data});
  for(const ws of room.wsClients){
    try{ if(ws.readyState===1) ws.send(msg); }catch{}
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// health
app.get('/health', (req,res)=> res.json({ok:true, rooms:rooms.size, uptime:process.uptime()}));

// rooms
app.get('/api/rooms', (req,res)=> res.json({rooms:listRooms()}));

app.post('/api/rooms', (req,res)=>{
  const {preferredId, forceNew}=req.body||{};
  const room=getOrCreateRoom(preferredId, forceNew);
  res.json({room:{id:room.id, name:room.name}});
});

app.get('/api/room/:id', (req,res)=>{
  const room=getRoom(req.params.id);
  if(!room) return res.status(404).json({error:'not found'});
  res.json({participants:Array.from(room.participants.values()).map(p=>({id:p.id, handle:p.handle, color:p.color, lineSlot:p.lineSlot, activeLineIdx:p.activeLineIdx, activeContent:p.activeContent, joinedAt:p.joinedAt.getTime()})), history:room.lines});
});

// join
app.post('/api/join', (req,res)=>{
  const {roomId, handle}=req.body||{};
  if(!roomId || !handle) return res.status(400).json({error:'roomId and handle required'});
  const cleanHandle = String(handle).trim();
  if(!cleanHandle) return res.status(400).json({error:'handle required'});
  if(cleanHandle.length>32) return res.status(400).json({error:'handle too long'});

  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});

  // cleanup stale first (reconciled behavior: preserve nonempty)
  cleanupStaleInRoom(room);

  // global case-insensitive duplicate check per final spec
  if(globalHandleExists(cleanHandle)){
    return res.status(409).json({error:'Handle already active'});
  }

  if(room.participants.size>=10) return res.status(409).json({error:'room full'});

  const usedSlots = new Set(Array.from(room.participants.values()).map(p=>p.lineSlot));
  let slot=0; while(usedSlots.has(slot) && slot<10) slot++;
  if(slot>=10) return res.status(409).json({error:'room full'});

  const usedColors = new Set(Array.from(room.participants.values()).map(p=>p.color));
  const color = ANSI_COLORS.find(c=>!usedColors.has(c)) || ANSI_COLORS[slot%ANSI_COLORS.length];

  const now = new Date();
  const gIdx = greatestLineIdx(room);
  const joinLineIdx = gIdx+1;
  const activeLineIdx = joinLineIdx+1;

  const participant = {
    id: nextParticipantId++,
    roomId: room.id,
    handle: cleanHandle,
    color,
    lineSlot: slot,
    activeLineIdx,
    activeContent: '',
    joinedAt: now,
    lastSeen: now
  };
  room.participants.set(participant.id, participant);
  room.lines.push({
    id:`join-${participant.id}-${Date.now()}`,
    handle:cleanHandle,
    content:`* ${cleanHandle} joined`,
    committed:true,
    lineIdx:joinLineIdx,
    createdAt:now,
    committedAt:now.getTime(),
    colorSnapshot:color
  });

  const roster = Array.from(room.participants.values()).map(p=>({handle:p.handle, color:p.color, lineSlot:p.lineSlot}));
  broadcastRoom(room);
  res.json({participant:{id:participant.id, roomId:participant.roomId, handle:participant.handle, color:participant.color, lineSlot:participant.lineSlot, activeLineIdx:participant.activeLineIdx, joinedAt:participant.joinedAt.getTime()}, roster, room:{id:room.id, name:room.name}});
});

// leave
app.post('/api/leave', (req,res)=>{
  const {roomId, participantId}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.json({freed:false});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.json({freed:false});

  const gIdx = greatestLineIdx(room);
  const now = new Date();

  if(participant.activeContent && participant.activeContent.length>0){
    room.lines.push({
      id:`line-${participant.id}-${Date.now()}`,
      handle:participant.handle,
      content:participant.activeContent,
      committed:true,
      lineIdx:participant.activeLineIdx,
      createdAt:now,
      committedAt:now.getTime(),
      colorSnapshot:participant.color
    });
  }
  room.lines.push({
    id:`leave-${participant.id}-${Date.now()}`,
    handle:participant.handle,
    content:`* ${participant.handle} left`,
    committed:true,
    lineIdx:gIdx+1,
    createdAt:now,
    committedAt:now.getTime(),
    colorSnapshot:participant.color
  });
  room.charEvents = room.charEvents.filter(e=>e.handle!==participant.handle);
  room.participants.delete(participant.id);

  if(room.participants.size===0 && !room.isLobby){
    rooms.delete(room.id);
    return res.json({freed:true});
  }
  broadcastRoom(room);
  res.json({freed:true});
});

// get roster
app.get('/api/roster', (req,res)=>{
  const roomId = Number(req.query.roomId);
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  const participants = Array.from(room.participants.values()).map(p=>({handle:p.handle, color:p.color, lineSlot:p.lineSlot})).sort((a,b)=>a.lineSlot-b.lineSlot);
  res.json({participants});
});

// heartbeat
app.post('/api/heartbeat', (req,res)=>{
  const {roomId, participantId}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.json({alive:false, removed:0});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.json({alive:false, removed:0});

  participant.lastSeen = new Date();
  const removed = cleanupStaleInRoom(room, participant.id);
  res.json({alive:true, removed});
});

// send char
app.post('/api/char', (req,res)=>{
  const {roomId, participantId, char}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.status(404).json({error:'user not in room'});

  const current = participant.activeContent;
  if(current.length >= MAX_LINE_LENGTH){
    return res.json({content:current, lineIdx:participant.activeLineIdx, position:current.length-1, participantId:participant.id});
  }
  if(typeof char!=='string' || char.length!==1 || !PRINTABLE_ASCII.test(char)){
    return res.status(400).json({error:'invalid char'});
  }

  // 10 cps throttling per spec
  const oneSecAgo = Date.now()-1000;
  const recent = room.charEvents.filter(e=>e.handle===participant.handle && e.createdAt.getTime()>oneSecAgo);
  if(recent.length>=10){
    return res.json({content:current, lineIdx:participant.activeLineIdx, position:Math.max(0,current.length-1), participantId:participant.id});
  }

  const content = current + char;
  participant.activeContent = content;
  participant.lastSeen = new Date();
  room.charEvents.push({handle:participant.handle, char, lineIdx:participant.activeLineIdx, position:content.length-1, createdAt:new Date()});
  // keep charEvents bounded
  if(room.charEvents.length>1000) room.charEvents = room.charEvents.slice(-800);

  broadcastChar(room, participant.id, 'char', {char, lineIdx:participant.activeLineIdx, position:content.length-1, handle:participant.handle});
  // also broadcast room for polling clients
  broadcastRoom(room);
  res.json({content, lineIdx:participant.activeLineIdx, position:content.length-1, participantId:participant.id});
});

// backspace
app.post('/api/backspace', (req,res)=>{
  const {roomId, participantId}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.status(404).json({error:'user not in room'});

  if(participant.activeContent.length===0){
    return res.json({content:'', lineIdx:participant.activeLineIdx, participantId:participant.id});
  }
  const content = participant.activeContent.slice(0,-1);
  participant.activeContent = content;
  participant.lastSeen = new Date();
  room.charEvents.push({handle:participant.handle, char:'\b', lineIdx:participant.activeLineIdx, position:content.length, createdAt:new Date()});
  if(room.charEvents.length>1000) room.charEvents = room.charEvents.slice(-800);

  broadcastChar(room, participant.id, 'backspace', {lineIdx:participant.activeLineIdx, position:content.length, handle:participant.handle});
  broadcastRoom(room);
  res.json({content, lineIdx:participant.activeLineIdx, participantId:participant.id});
});

// commit
app.post('/api/commit', (req,res)=>{
  const {roomId, participantId}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.status(404).json({error:'user not in room'});

  if(participant.activeContent.trim().length===0){
    return res.json({newLineIdx:participant.activeLineIdx, committedContent:'', committedAt:Date.now()});
  }

  const gIdx = greatestLineIdx(room);
  const newLineIdx = gIdx+1;
  const committedAt = new Date();
  const committedContent = participant.activeContent;

  room.lines.push({
    id:`line-${participant.id}-${Date.now()}`,
    handle:participant.handle,
    content:committedContent,
    committed:true,
    lineIdx:participant.activeLineIdx,
    createdAt:committedAt,
    committedAt:committedAt.getTime(),
    colorSnapshot:participant.color
  });

  participant.activeContent = '';
  participant.activeLineIdx = newLineIdx;
  participant.lastSeen = committedAt;

  broadcastRoom(room);
  res.json({newLineIdx, committedContent, committedAt:committedAt.getTime()});
});

// room state
app.get('/api/room-state', (req,res)=>{
  const roomId = Number(req.query.roomId);
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});

  // return last 100 lines sorted by lineIdx
  const history = room.lines.slice(-100).sort((a,b)=>a.lineIdx-b.lineIdx).map(l=>({
    id:l.id,
    handle:l.handle,
    content:l.content,
    lineIdx:l.lineIdx,
    committed:!!l.committed,
    committedAt:l.committedAt || (l.createdAt?l.createdAt.getTime():Date.now()),
    color:l.colorSnapshot
  }));

  const participants = Array.from(room.participants.values()).map(p=>({
    id:p.id,
    handle:p.handle,
    color:p.color,
    lineSlot:p.lineSlot,
    activeLineIdx:p.activeLineIdx,
    activeContent:p.activeContent,
    joinedAt:p.joinedAt.getTime(),
    lastSeen:p.lastSeen.getTime()
  })).sort((a,b)=>a.lineSlot-b.lineSlot);

  const roster = participants.map(p=>({handle:p.handle, color:p.color, lineSlot:p.lineSlot}));

  res.json({roomId:room.id, history, participants, roster});
});

// static client serving (production)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if(fs.existsSync(clientDist)){
  app.use(express.static(clientDist));
  app.get('*', (req,res)=>{
    // don't intercept api
    if(req.path.startsWith('/api/') || req.path.startsWith('/health')) return res.status(404).end();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req,res)=> res.send('Remart BBS Chat server — client not built yet. Run vite build.'));
}

const server = createServer(app);
const wss = new WebSocketServer({server});

wss.on('connection', (ws)=>{
  ws.on('message', (raw)=>{
    try{
      const msg = JSON.parse(raw.toString());
      if(msg.type==='subscribe' && msg.roomId){
        const room = getRoom(msg.roomId);
        if(room){
          room.wsClients.add(ws);
          ws._roomId = room.id;
          ws.send(JSON.stringify({type:'subscribed', roomId:room.id}));
        }
      } else if(msg.type==='ping'){
        ws.send(JSON.stringify({type:'pong'}));
      }
    }catch{}
  });
  ws.on('close', ()=>{
    if(ws._roomId){
      const room = getRoom(ws._roomId);
      if(room) room.wsClients.delete(ws);
    }
  });
});

// periodic stale sweep every 15s
setInterval(()=>{
  for(const room of Array.from(rooms.values())){
    cleanupStaleInRoom(room);
  }
}, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`Remart BBS standalone server listening on ${PORT}`));
