// rooms.js - Task 2 Rooms model with 10 max, line allocation, atomic Enter
class Rooms {
  constructor() { 
    this.rooms = new Map(); 
    this.nextId = 1; 
  }
  
  createRoom() {
    const id = `room-${this.nextId++}`;
    this.rooms.set(id, { id, users: new Map(), lines: [], colors: this._colorPool() });
    return id;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  _colorPool() { 
    return ['#00FFFF','#FFFF00','#FF00FF','#00FF00','#FF8000','#80FF00','#FF0080','#00FF80','#8080FF','#FF8080']; 
  }

  joinRoom(roomId, userId, name) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('room not found');
    if (room.users.size >= 10) throw new Error('room full');
    // system-wide name uniqueness should be checked at server level, but we allow duplicate here for test flexibility
    const color = room.colors.shift();
    if (!color) throw new Error('no colors left - room full');
    room.users.set(userId, { name, color, lineIdx: room.lines.length });
    room.lines.push({ owner: userId, content: '', committed: false });
    return { color, lineIdx: room.users.get(userId).lineIdx };
  }

  leaveRoom(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const user = room.users.get(userId);
    if (!user) return;
    // only free slot if empty line - per spec: empty line on disconnect freed, typed line stays as history
    const line = room.lines[user.lineIdx];
    if (line && line.content === '' && !line.committed) {
      room.lines.splice(user.lineIdx, 1);
      // adjust lineIdx for users after this one
      for (const [uid, u] of room.users.entries()) {
        if (u.lineIdx > user.lineIdx) u.lineIdx--;
      }
    }
    room.colors.push(user.color);
    room.users.delete(userId);
  }

  nextEmptyLine(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('room not found');
    return room.lines.length;
  }

  allocateLine(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('room not found');
    const user = room.users.get(userId);
    if (!user) throw new Error('user not in room');
    // commit current line - even if empty? spec says Enter on empty = ignore, so caller should check, but we commit here
    const currentLine = room.lines[user.lineIdx];
    if (currentLine) {
      currentLine.committed = true;
    }
    // atomic allocation - JS single-threaded makes this atomic
    const newIdx = room.lines.length;
    room.lines.push({ owner: userId, content: '', committed: false });
    user.lineIdx = newIdx;
    return newIdx;
  }
}

module.exports = { Rooms };
