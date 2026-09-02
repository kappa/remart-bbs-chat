// test-rooms.js - Task 2 room max 10
const { Rooms } = require('./rooms.js');
const rooms = new Rooms();
const roomId = rooms.createRoom();
for (let i=0; i<10; i++) rooms.joinRoom(roomId, `u${i}`, `User${i}`);
try {
  rooms.joinRoom(roomId, 'u10', 'User10');
  throw new Error('should have failed at 10 max');
} catch(e) {
  if (!e.message.includes('full')) throw e;
}
console.log('PASS room max 10');

// Additional checks
const room = rooms.rooms.get(roomId);
if (room.users.size !== 10) throw new Error('should have 10 users');
if (room.lines.length !== 10) throw new Error('should have 10 lines');

// Test empty disconnect frees slot
const roomId2 = rooms.createRoom();
rooms.joinRoom(roomId2, 'uA', 'Alice');
rooms.leaveRoom(roomId2, 'uA');
if (rooms.rooms.get(roomId2).lines.length !== 0) throw new Error('empty line should be freed on disconnect');
if (rooms.rooms.get(roomId2).users.size !== 0) throw new Error('user should be removed');

// Test typed line stays
const roomId3 = rooms.createRoom();
rooms.joinRoom(roomId3, 'uB', 'Bob');
rooms.rooms.get(roomId3).lines[0].content = 'hi';
rooms.leaveRoom(roomId3, 'uB');
if (rooms.rooms.get(roomId3).lines.length !== 1) throw new Error('typed line should stay as history');
console.log('PASS empty disconnect logic');

console.log('PASS all Task 2 tests');
