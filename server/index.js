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
const HEARTBEAT_TIMEOUT_MS = 40000;

function isValidChar(char){
  if(typeof char !== 'string') return false;
  const arr = Array.from(char);
  if(arr.length !== 1) return false;
  if(char === '\n' || char === '\r') return false;
  // Allow any printable Unicode (including Cyrillic), exclude C0 controls except space
  const code = char.charCodeAt(0);
  if(code < 32 && char !== ' ' && char !== '\t') return false;
  if(code === 127) return false;
  return true;
}

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
  for(const p of room.participants.values()){
    if(p.activeLineIdx != null && p.activeLineIdx>max) max=p.activeLineIdx;
  }
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
      const commitIdx = s.activeLineIdx != null ? s.activeLineIdx : nextIdx++;
      room.lines.push({
        id:`line-${s.id}-${Date.now()}`,
        handle:s.handle,
        content:s.activeContent,
        committed:true,
        lineIdx:commitIdx,
        createdAt:new Date(s.lastSeen.getTime()),
        committedAt:s.lastSeen.getTime(),
        colorSnapshot:s.color
      });
      // keep nextIdx in sync if we used it
      if(s.activeLineIdx == null) {
        // nextIdx already incremented
      } else {
        // ensure nextIdx stays ahead
        if(commitIdx >= nextIdx) nextIdx = commitIdx+1;
      }
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

// --- Ordered operation helpers with seq buffering ---
function applyCharOperation(participant, room, char, seqForBroadcast){
  if(participant.activeLineIdx == null){
    participant.activeLineIdx = greatestLineIdx(room)+1;
  }
  const content = participant.activeContent + char;
  participant.activeContent = content;
  participant.lastSeen = new Date();
  room.charEvents.push({handle:participant.handle, char, lineIdx:participant.activeLineIdx, position:content.length-1, createdAt:new Date()});
  if(room.charEvents.length>1000) room.charEvents = room.charEvents.slice(-800);
  broadcastChar(room, participant.id, 'char', {char, lineIdx:participant.activeLineIdx, position:content.length-1, handle:participant.handle, seq:seqForBroadcast});
  broadcastRoom(room);
  return {content, lineIdx:participant.activeLineIdx, position:content.length-1, participantId:participant.id};
}

function applyBackspaceOperation(participant, room, seqForBroadcast){
  if(participant.activeContent.length===0){
    participant.lastSeen = new Date();
    return {content:'', lineIdx:participant.activeLineIdx, participantId:participant.id};
  }
  const content = participant.activeContent.slice(0,-1);
  participant.activeContent = content;
  participant.lastSeen = new Date();
  room.charEvents.push({handle:participant.handle, char:'\b', lineIdx:participant.activeLineIdx, position:content.length, createdAt:new Date()});
  if(room.charEvents.length>1000) room.charEvents = room.charEvents.slice(-800);
  broadcastChar(room, participant.id, 'backspace', {lineIdx:participant.activeLineIdx, position:content.length, handle:participant.handle, seq:seqForBroadcast});
  broadcastRoom(room);
  return {content, lineIdx:participant.activeLineIdx, participantId:participant.id};
}

function applyCommitOperation(participant, room, seqForBroadcast){
  const commitLineIdx = participant.activeLineIdx != null ? participant.activeLineIdx : greatestLineIdx(room)+1;
  const committedAt = new Date();
  const committedContent = participant.activeContent;
  room.lines.push({
    id:`line-${participant.id}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    handle:participant.handle,
    content:committedContent,
    committed:true,
    lineIdx:commitLineIdx,
    createdAt:committedAt,
    committedAt:committedAt.getTime(),
    colorSnapshot:participant.color
  });
  participant.activeContent = '';
  participant.activeLineIdx = null;
  participant.lastSeen = committedAt;
  broadcastRoom(room);
  if(seqForBroadcast != null){
    // also broadcast commit as room-update with seq for ordering visibility
    broadcastChar(room, participant.id, 'commit', {lineIdx:commitLineIdx, committedContent, seq:seqForBroadcast});
  }
  return {newLineIdx:null, committedContent, committedAt:committedAt.getTime()};
}

function drainBufferedOps(participant, room){
  // Apply any buffered ops that are now in order
  while(participant.opBuffer.has(participant.nextExpectedSeq)){
    const op = participant.opBuffer.get(participant.nextExpectedSeq);
    participant.opBuffer.delete(participant.nextExpectedSeq);
    const seq = participant.nextExpectedSeq;
    participant.nextExpectedSeq++;
    if(op.type==='char'){
      applyCharOperation(participant, room, op.char, seq);
    } else if(op.type==='backspace'){
      applyBackspaceOperation(participant, room, seq);
    } else if(op.type==='commit'){
      applyCommitOperation(participant, room, seq);
    }
  }
}

function handleSeqOp(participant, room, seq, opType, payload){
  // Returns {status: 'applied'|'buffered'|'duplicate'|'legacy', result, expected}
  if(seq == null){
    // legacy client without seq — apply immediately
    let result;
    if(opType==='char') result = applyCharOperation(participant, room, payload.char, null);
    else if(opType==='backspace') result = applyBackspaceOperation(participant, room, null);
    else if(opType==='commit') result = applyCommitOperation(participant, room, null);
    return {status:'legacy', result};
  }
  const expected = participant.nextExpectedSeq || 1;
  if(seq < expected){
    // duplicate/retry — return current state without re-applying
    let cur;
    if(opType==='char' || opType==='backspace'){
      cur = {content: participant.activeContent, lineIdx: participant.activeLineIdx, participantId: participant.id};
    } else {
      cur = {newLineIdx:null, committedContent:'', committedAt:Date.now()};
    }
    return {status:'duplicate', result:cur, expected};
  }
  if(seq === expected){
    // apply immediately, then drain
    let result;
    if(opType==='char') result = applyCharOperation(participant, room, payload.char, seq);
    else if(opType==='backspace') result = applyBackspaceOperation(participant, room, seq);
    else if(opType==='commit') result = applyCommitOperation(participant, room, seq);
    participant.nextExpectedSeq++;
    drainBufferedOps(participant, room);
    return {status:'applied', result, expected:participant.nextExpectedSeq};
  }
  // seq > expected -> buffer
  participant.opBuffer.set(seq, {type:opType, ...payload});
  participant.lastSeen = new Date();
  return {status:'buffered', result:null, expected, received:seq};
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
  const activeLineIdx = null;

  const participant = {
    id: nextParticipantId++,
    roomId: room.id,
    handle: cleanHandle,
    color,
    lineSlot: slot,
    activeLineIdx,
    activeContent: '',
    joinedAt: now,
    lastSeen: now,
    nextExpectedSeq: 1,
    opBuffer: new Map()
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
    const commitIdx = participant.activeLineIdx != null ? participant.activeLineIdx : gIdx+1;
    room.lines.push({
      id:`line-${participant.id}-${Date.now()}`,
      handle:participant.handle,
      content:participant.activeContent,
      committed:true,
      lineIdx:commitIdx,
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
  const {roomId, participantId, char, seq}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.status(404).json({error:'user not in room'});

  if(!isValidChar(char)){
    return res.status(400).json({error:'invalid char'});
  }

  // ensure seq tracking fields exist for legacy participants (e.g., from old code or tests)
  if(participant.nextExpectedSeq == null) participant.nextExpectedSeq = 1;
  if(!participant.opBuffer) participant.opBuffer = new Map();

  const outcome = handleSeqOp(participant, room, seq, 'char', {char});
  if(outcome.status === 'buffered'){
    return res.status(202).json({buffered:true, expected:outcome.expected, received:outcome.received, participantId:participant.id});
  }
  if(outcome.status === 'duplicate'){
    return res.json({...outcome.result, duplicate:true, expected:outcome.expected});
  }
  // applied or legacy
  res.json(outcome.result);
});

// backspace
app.post('/api/backspace', (req,res)=>{
  const {roomId, participantId, seq}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.status(404).json({error:'user not in room'});

  if(participant.nextExpectedSeq == null) participant.nextExpectedSeq = 1;
  if(!participant.opBuffer) participant.opBuffer = new Map();

  // If empty, still need seq ordering to preserve x then Backspace case
  // If activeContent empty and we are at expected seq, we return empty without broadcasting, but still advance seq
  if(participant.activeContent.length===0 && (seq == null || seq === participant.nextExpectedSeq)){
    const outcome = handleSeqOp(participant, room, seq, 'backspace', {});
    if(outcome.status === 'buffered'){
      return res.status(202).json({buffered:true, expected:outcome.expected, received:outcome.received});
    }
    if(outcome.status === 'duplicate'){
      return res.json({...outcome.result, duplicate:true});
    }
    // For empty, applyBackspace returns empty; but handleSeqOp already applied and would return empty
    return res.json(outcome.result || {content:'', lineIdx:participant.activeLineIdx, participantId:participant.id});
  }

  const outcome = handleSeqOp(participant, room, seq, 'backspace', {});
  if(outcome.status === 'buffered'){
    return res.status(202).json({buffered:true, expected:outcome.expected, received:outcome.received, participantId:participant.id});
  }
  if(outcome.status === 'duplicate'){
    return res.json({...outcome.result, duplicate:true, expected:outcome.expected});
  }
  res.json(outcome.result);
});

// commit
app.post('/api/commit', (req,res)=>{
  const {roomId, participantId, seq}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.status(404).json({error:'user not in room'});

  if(participant.nextExpectedSeq == null) participant.nextExpectedSeq = 1;
  if(!participant.opBuffer) participant.opBuffer = new Map();

  const outcome = handleSeqOp(participant, room, seq, 'commit', {});
  if(outcome.status === 'buffered'){
    return res.status(202).json({buffered:true, expected:outcome.expected, received:outcome.received, participantId:participant.id});
  }
  if(outcome.status === 'duplicate'){
    return res.json({...outcome.result, duplicate:true, expected:outcome.expected});
  }
  res.json(outcome.result);
});

// room state
app.get('/api/room-state', (req,res)=>{
  const roomId = Number(req.query.roomId);
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});

  // Bounded recovery snapshot: last 100 committed lines only.
  // Viewer scrollback is accumulated client-side from snapshots seen since join,
  // so truncation here does not delete text the viewer already has.
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
    lastSeen:p.lastSeen.getTime(),
    nextExpectedSeq:p.nextExpectedSeq ?? 1
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
let sweepInterval = null;
if (process.env.NODE_ENV !== 'test') {
  sweepInterval = setInterval(()=>{
    for(const room of Array.from(rooms.values())){
      cleanupStaleInRoom(room);
    }
  }, 15000);
}

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, ()=> console.log(`Remart BBS standalone server listening on ${PORT}`));
}

export {
  sweepInterval,
  app,
  server,
  wss,
  rooms,
  ANSI_COLORS,
  HEARTBEAT_TIMEOUT_MS,
  isValidChar,
  getRoom,
  listRooms,
  getOrCreateRoom,
  greatestLineIdx,
  cleanupStaleInRoom,
  globalHandleExists,
  broadcastRoom,
  broadcastChar,
  handleSeqOp,
  applyCharOperation,
  applyBackspaceOperation,
  applyCommitOperation,
  drainBufferedOps,
};

// Test helpers
export function resetForTests(){
  rooms.clear();
  nextRoomId = 1;
  nextParticipantId = 1;
}
export function setNextIds(roomId, participantId){
  if(roomId != null) nextRoomId = roomId;
  if(participantId != null) nextParticipantId = participantId;
}
