import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Approved 20-color hybrid participant palette in assignment order: six
// ColorBrewer Set2 colors, selected original/VGA colors, white tenth, and
// nine Glasbey additions. Black is excluded. Rooms hold ten participants,
// so only the first ten are reachable today; the tail is reserved for a
// possible future capacity increase.
const PARTICIPANT_COLORS = ["#A6D854","#FFD92F","#FC8D62","#8080FF","#00FFFF",
  "#E78AC3","#8DA0CB","#FF00FF","#FF5555","#FFFFFF",
  "#66C2A5","#867924","#926D75","#00A600","#108A92",
  "#D70082","#9E59BA","#CABE9A","#E3CAFF","#BE5900"];
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

function newParticipantToken(){
  return crypto.randomBytes(16).toString('hex');
}

function checkParticipantAuth(participant, token){
  return typeof token === 'string' && token.length > 0 && participant.token === token;
}

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
  const room = {id, name:`Room ${id}`, createdAt:new Date(), maxParticipants:10, isLobby:false, participants:new Map(), lines:[]};
  rooms.set(id, room);
  return room;
}

function greatestRow(room){
  let max=-1;
  for(const l of room.lines) if(l.row>max) max=l.row;
  for(const p of room.participants.values()){
    if(p.liveRow != null && p.liveRow>max) max=p.liveRow;
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
  for(const s of stale){
    removeParticipant(room, s, new Date(s.lastSeen.getTime()));
    if(!rooms.has(room.id)) return stale.length; // ephemeral room removed
  }
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

function sendWs(ws, msg){
  try{ if(ws.readyState===1) ws.send(JSON.stringify(msg)); }catch{}
}

function sendTo(participant, msg){
  if(participant.socket) sendWs(participant.socket, msg);
}

// Every participant with an open socket receives room messages, the author included.
function broadcast(room, msg){
  const payload = JSON.stringify(msg);
  for(const p of room.participants.values()){
    const ws = p.socket;
    if(ws && ws.readyState===1){ try{ ws.send(payload); }catch{} }
  }
}

function rosterOf(room){
  return Array.from(room.participants.values())
    .map(p=>({participantId:p.id, handle:p.handle, color:p.color, slot:p.slot}))
    .sort((a,b)=>a.slot-b.slot);
}

function publicLine(line){
  return {id:line.id, row:line.row, text:line.text, handle:line.handle, color:line.color, committedAt:line.committedAt};
}

function liveLineOf(p){
  return {participantId:p.id, handle:p.handle, color:p.color, slot:p.slot, row:p.liveRow, text:p.liveText, caret:p.liveCaret};
}

// Filter the last 100 appended lines for this participant, then sort by row.
// Append order, unlike timestamps, distinguishes commits on either side of join.
function snapshotMessage(room, participant){
  const start = Math.max(0, room.lines.length - 100);
  return {
    type:'snapshot',
    roomId:room.id,
    you:{participantId:participant.id, nextSeq:participant.nextSeq},
    liveLines:Array.from(room.participants.values()).sort((a,b)=>a.slot-b.slot).map(liveLineOf),
    committed:room.lines.slice(start)
      .filter((line, index)=>line.row >= participant.historyFromRow || start + index >= participant.joinedLineCount)
      .sort((a,b)=>a.row-b.row).map(publicLine),
    roster:rosterOf(room),
  };
}

// Keystroke handling functions
function liveMessage(p, seq){
  return {type:'live', participantId:p.id, row:p.liveRow, text:p.liveText, caret:p.liveCaret, seq};
}

function committedMessage(line, participantId, seq){
  return {type:'committed', participantId, seq, line:publicLine(line)};
}

function newLineId(participant){
  return `line-${participant.id}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
}

function storeLine(room, participant, text, row, at){
  const line = {id:newLineId(participant), handle:participant.handle, text, row, committedAt:at.getTime(), color:participant.color};
  room.lines.push(line);
  return line;
}

// The caret is a code-point index into liveText, owned by the server like
// the line itself. Every position below is a code point, never a UTF-16
// unit, so emoji and Cyrillic move and delete as single characters.
function editLive(participant, room, kind, char){
  const codePoints = Array.from(participant.liveText);
  const length = codePoints.length;
  let caret = Math.min(Math.max(participant.liveCaret ?? length, 0), length);
  switch(kind){
    case 'char':
      if(participant.liveRow == null) participant.liveRow = greatestRow(room)+1;
      codePoints.splice(caret, 0, char);
      caret++;
      break;
    case 'backspace':
      if(caret > 0){ codePoints.splice(caret - 1, 1); caret--; }
      break;
    case 'delete':
      if(caret < length) codePoints.splice(caret, 1);
      break;
    case 'left':
      if(caret > 0) caret--;
      break;
    case 'right':
      if(caret < length) caret++;
      break;
    case 'home':
      caret = 0;
      break;
    case 'end':
      caret = length;
      break;
    case 'word-left': {
      while(caret > 0 && /\s/.test(codePoints[caret - 1])) caret--;
      while(caret > 0 && !/\s/.test(codePoints[caret - 1])) caret--;
      break;
    }
    case 'word-right': {
      while(caret < length && /\s/.test(codePoints[caret])) caret++;
      while(caret < length && !/\s/.test(codePoints[caret])) caret++;
      break;
    }
  }
  participant.liveText = codePoints.join('');
  participant.liveCaret = caret;
}

function commitLive(participant, room, at){
  const row = participant.liveRow != null ? participant.liveRow : greatestRow(room)+1;
  const line = storeLine(room, participant, participant.liveText, row, at);
  participant.liveText = '';
  participant.liveRow = null;
  participant.liveCaret = 0;
  return line;
}

const KEY_KINDS = new Set(['char','backspace','enter','left','right','word-left','word-right','home','end','delete']);

// One ordered socket: equal seq applies, lower is a replay, higher is a gap.
function handleKey(participant, room, msg){
  const seq = msg.seq;
  if(typeof seq !== 'number' || !KEY_KINDS.has(msg.kind)) return sendTo(participant, {type:'error', code:'invalid-message'});
  if(seq < participant.nextSeq) return;
  if(seq > participant.nextSeq) return sendTo(participant, {type:'error', code:'seq-gap', expected:participant.nextSeq});
  participant.nextSeq++;
  if(msg.kind==='enter'){
    const commandName = Object.hasOwn(COMMANDS, participant.liveText) ? COMMANDS[participant.liveText] : undefined;
    if(commandName){
      participant.liveText = '';
      participant.liveRow = null;
      participant.liveCaret = 0;
      broadcast(room, liveMessage(participant, seq));
      sendTo(participant, {type:'command', name:commandName});
      if(commandName === 'leave'){
        removeParticipant(room, participant, new Date());
      }
      return;
    }
    const line = commitLive(participant, room, new Date());
    broadcast(room, committedMessage(line, participant.id, seq));
    broadcast(room, liveMessage(participant, seq));
    return;
  }
  if(msg.kind==='char'){
    if(isValidChar(msg.char)) editLive(participant, room, 'char', msg.char);
    return broadcast(room, liveMessage(participant, seq));
  }
  editLive(participant, room, msg.kind);
  return broadcast(room, liveMessage(participant, seq));
}

function rosterMessage(room){
  return {type:'roster', roster:rosterOf(room)};
}

// The single exit path for HTTP leave, the q command, and stale cleanup.
// Nonempty live text is preserved as a committed line stamped `preservedAt`:
// leave time for a deliberate leave, last activity for stale cleanup.
function removeParticipant(room, participant, preservedAt){
  const committedLines = [];
  if(participant.liveText && participant.liveText.length>0){
    const commitIdx = participant.liveRow != null ? participant.liveRow : greatestRow(room)+1;
    committedLines.push(storeLine(room, participant, participant.liveText, commitIdx, preservedAt));
  }
  const leaveLine = storeLine(room, participant, `* ${participant.handle} left`, greatestRow(room)+1, new Date());
  if(participant.socket){ try{ participant.socket.close(); }catch{} }
  room.participants.delete(participant.id);
  if(room.participants.size===0 && !room.isLobby){
    rooms.delete(room.id);
    return participant;
  }
  for(const line of committedLines) broadcast(room, committedMessage(line, null, null));
  broadcast(room, committedMessage(leaveLine, null, null));
  broadcast(room, rosterMessage(room));
  return participant;
}

const COMMANDS = { '?':'help', q:'leave' };

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

// join
app.post('/api/join', (req,res)=>{
  const {roomId, handle}=req.body||{};
  if(!roomId || !handle) return res.status(400).json({error:'roomId and handle required'});
  const cleanHandle = String(handle).trim();
  if(!cleanHandle) return res.status(400).json({error:'handle required'});
  if(cleanHandle.length>32) return res.status(400).json({error:'handle too long'});

  let room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});

  // cleanup stale first (reconciled behavior: preserve nonempty)
  cleanupStaleInRoom(room);

  // Cleanup deletes the room when its last occupant was stale. Recreate it
  // under the same id so this join lands in a live, discoverable room
  // instead of a detached object that roster and sockets would never find.
  // Carry over the committed lines (preserved stale live text, leave notices)
  // so no transcript history is lost with the detached object.
  if(!rooms.has(room.id)){
    const orphanedLines = room.lines;
    room = {id:room.id, name:room.name, createdAt:new Date(), maxParticipants:10, isLobby:false, participants:new Map(), lines:orphanedLines};
    rooms.set(room.id, room);
  }

  // global case-insensitive duplicate check per final spec
  if(globalHandleExists(cleanHandle)){
    return res.status(409).json({error:'Handle already active'});
  }

  if(room.participants.size>=10) return res.status(409).json({error:'room full'});

  const usedSlots = new Set(Array.from(room.participants.values()).map(p=>p.slot));
  let slot=0; while(usedSlots.has(slot) && slot<10) slot++;
  if(slot>=10) return res.status(409).json({error:'room full'});

  const usedColors = new Set(Array.from(room.participants.values()).map(p=>p.color));
  const color = PARTICIPANT_COLORS.find(c=>!usedColors.has(c)) || PARTICIPANT_COLORS[slot%PARTICIPANT_COLORS.length];

  const now = new Date();
  const joinRowIdx = greatestRow(room)+1;

  // Seed newcomers with the last 20 committed lines: the boundary is the
  // smallest row among them. room.lines is in commit order, so sort by row;
  // rows are unique per line and ordered as the transcript.
  const recent = room.lines.slice().sort((a,b)=>a.row-b.row).slice(-20);
  const historyFromRow = recent.length ? recent[0].row : joinRowIdx;

  const participant = {
    id: nextParticipantId++,
    roomId: room.id,
    handle: cleanHandle,
    token: newParticipantToken(),
    color,
    slot,
    liveRow: null,
    liveText: '',
    liveCaret: 0,
    joinedAt: now,
    historyFromRow,
    joinedLineCount: room.lines.length,
    lastSeen: now,
    nextSeq: 1,
    socket: null
  };
  room.participants.set(participant.id, participant);
  const joinLine = storeLine(room, participant, `* ${cleanHandle} joined`, joinRowIdx, now);

  const roster = Array.from(room.participants.values()).map(p=>({handle:p.handle, color:p.color, slot:p.slot}));
  broadcast(room, committedMessage(joinLine, null, null));
  broadcast(room, rosterMessage(room));
  res.json({participant:{id:participant.id, roomId:participant.roomId, handle:participant.handle, token:participant.token, color:participant.color, slot:participant.slot, liveRow:participant.liveRow, joinedAt:participant.joinedAt.getTime(), historyFromRow:participant.historyFromRow}, roster, room:{id:room.id, name:room.name}});
});

// leave
app.post('/api/leave', (req,res)=>{
  const {roomId, participantId, token}=req.body||{};
  const room = getRoom(roomId);
  if(!room) return res.json({freed:false});
  const participant = room.participants.get(Number(participantId));
  if(!participant) return res.json({freed:false});
  if(!checkParticipantAuth(participant, token)) return res.status(401).json({error:'invalid token'});

  removeParticipant(room, participant, new Date());
  res.json({freed:true});
});

// get roster
app.get('/api/roster', (req,res)=>{
  const roomId = Number(req.query.roomId);
  const room = getRoom(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  const participants = Array.from(room.participants.values()).map(p=>({handle:p.handle, color:p.color, slot:p.slot})).sort((a,b)=>a.slot-b.slot);
  res.json({participants});
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
const wss = new WebSocketServer({server, path:'/ws'});

wss.on('connection', (ws)=>{
  ws.on('message', (raw)=>{
    let msg;
    try{ msg = JSON.parse(raw.toString()); }catch{ msg = null; }
    if(!ws.participant){
      // Before hello, anything but a hello (unparseable input included) is unauthorized.
      if(!msg || msg.type!=='hello'){ sendWs(ws, {type:'error', code:'unauthorized'}); return ws.close(); }
      const room = getRoom(msg.roomId);
      const participant = room && room.participants.get(Number(msg.participantId));
      if(!participant){ sendWs(ws, {type:'error', code:'unknown-participant'}); return ws.close(); }
      if(!checkParticipantAuth(participant, msg.token)){ sendWs(ws, {type:'error', code:'unauthorized'}); return ws.close(); }
      // One socket per participant: a reconnecting tab replaces its old connection.
      if(participant.socket && participant.socket!==ws){ try{ participant.socket.close(); }catch{} }
      participant.socket = ws;
      participant.lastSeen = new Date();
      ws.participant = participant;
      ws.room = room;
      return sendWs(ws, snapshotMessage(room, participant));
    }
    const participant = ws.participant;
    if(participant.socket!==ws || !ws.room.participants.has(participant.id)) return;
    participant.lastSeen = new Date();
    if(msg && msg.type==='key') return handleKey(participant, ws.room, msg);
    sendWs(ws, {type:'error', code:'invalid-message'});
  });
  ws.on('pong', ()=>{ if(ws.participant) ws.participant.lastSeen = new Date(); });
  ws.on('close', ()=>{ if(ws.participant && ws.participant.socket===ws) ws.participant.socket = null; });
});

// Presence is the socket: pings every 12 s, pongs refresh lastSeen.
function pingSockets(){
  for(const room of rooms.values()){
    for(const p of room.participants.values()){
      const ws = p.socket;
      if(ws && ws.readyState===1){ try{ ws.ping(); }catch{} }
    }
  }
}
let pingInterval = null;
if (process.env.NODE_ENV !== 'test') {
  pingInterval = setInterval(pingSockets, 12000);
}

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
  PARTICIPANT_COLORS,
  HEARTBEAT_TIMEOUT_MS,
  isValidChar,
  getRoom,
  listRooms,
  getOrCreateRoom,
  greatestRow,
  cleanupStaleInRoom,
  globalHandleExists,
  handleKey,
  editLive,
  commitLive,
  liveMessage,
  committedMessage,
  broadcast,
  sendTo,
  snapshotMessage,
  rosterOf,
  rosterMessage,
  removeParticipant,
  publicLine,
  liveLineOf,
  pingSockets,
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
