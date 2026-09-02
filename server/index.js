import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const ANSI_COLORS = ["#00FFFF","#FFFF00","#FF00FF","#00FF00","#FF8000","#80FF00","#FF0080","#00FF80","#8080FF","#FF8080"];
let nextRoomId = 1;
const rooms = new Map();

function getOrCreateRoom(preferredId, forceNew){
  if(!forceNew && preferredId && rooms.has(preferredId)){
    const r=rooms.get(preferredId); if(r.participants.size<10) return r;
  }
  if(!forceNew){ for(const r of rooms.values()) if(r.participants.size<10) return r; }
  const room={id:nextRoomId++, name:`Room ${nextRoomId-1}`, participants:new Map(), lines:[], nextLineIdx:0, createdAt:Date.now()};
  rooms.set(room.id, room); return room;
}
function listRooms(){ return Array.from(rooms.values()).map(r=>({id:r.id,name:r.name,occupancy:r.participants.size,max:10})); }

const app=express(); app.use(cors()); app.use(express.json());
const server=createServer(app);
const wss=new WebSocketServer({server});

wss.on('connection', ws=>{
  ws.on('message', raw=>{
    try{ for(const c of wss.clients) if(c.readyState===1) c.send(raw.toString()); }catch{}
  });
});

app.get('/api/rooms',(req,res)=>res.json({rooms:listRooms()}));
app.post('/api/rooms',(req,res)=>{
  const {preferredId,forceNew}=req.body||{};
  const room=getOrCreateRoom(preferredId,forceNew);
  res.json({room:{id:room.id,name:room.name}});
});
app.get('/api/room/:id',(req,res)=>{
  const room=rooms.get(Number(req.params.id));
  if(!room) return res.status(404).json({error:'not found'});
  res.json({participants:Array.from(room.participants.values()),history:room.lines});
});
app.post('/api/join',(req,res)=>{
  const {roomId,handle}=req.body;
  const room=rooms.get(roomId);
  if(!room) return res.status(404).json({error:'room not found'});
  if(Array.from(room.participants.values()).some(p=>p.handle.toLowerCase()===handle.toLowerCase())) return res.status(409).json({error:'Handle already active'});
  if(room.participants.size>=10) return res.status(409).json({error:'room full'});
  const used=new Set(Array.from(room.participants.values()).map(p=>p.lineSlot));
  let slot=0; while(used.has(slot)) slot++;
  const color=ANSI_COLORS[slot%ANSI_COLORS.length];
  const participant={id:Date.now(),roomId,handle,color,lineSlot:slot,activeLineIdx:room.nextLineIdx++,activeContent:'',joinedAt:Date.now(),lastSeen:Date.now()};
  room.participants.set(participant.id,participant);
  room.lines.push({id:`join-${participant.id}`,handle,content:`* ${handle} joined`,lineIdx:room.nextLineIdx++,committed:true,committedAt:Date.now()});
  res.json({participant,roster:Array.from(room.participants.values())});
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Remart BBS standalone server listening on ${PORT}`));
