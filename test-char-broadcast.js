// test-char-broadcast.js - Task 3 char broadcast ordering
// Should FAIL initially when char-broadcast.js not found
const { CharBroadcast } = require('./char-broadcast.js');
const { Rooms } = require('./rooms.js');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

const rooms = new Rooms();
const cb = new CharBroadcast(rooms);

const roomId = rooms.createRoom();
rooms.joinRoom(roomId, 'u1', 'Alice');
rooms.joinRoom(roomId, 'u2', 'Bob');

// Test 1: insert char
let content = cb.insertChar(roomId, 'u1', 'H');
assert(content === 'H', 'insert H should return H');
content = cb.insertChar(roomId, 'u1', 'i');
assert(content === 'Hi', 'insert i should return Hi');

// Test 2: 80 char limit
const roomId2 = rooms.createRoom();
rooms.joinRoom(roomId2, 'u3', 'Charlie');
for (let i=0; i<80; i++) cb.insertChar(roomId2, 'u3', 'x');
let longContent = rooms.getRoom(roomId2).lines[0].content;
assert(longContent.length === 80, 'should be 80 chars');
let afterLimit = cb.insertChar(roomId2, 'u3', 'y');
assert(afterLimit.length === 80, 'should stay 80 chars after limit, got '+afterLimit.length);
assert(!afterLimit.endsWith('y'), 'should not append beyond 80');

// Test 3: backspace removes last char
cb.insertChar(roomId, 'u1', '!'); // Hi!
let after = cb.backspace(roomId, 'u1'); // should be Hi
assert(after === 'Hi', `backspace should remove !, got ${after}`);

// Test 4: backspace at column zero ignored
const roomId3 = rooms.createRoom();
rooms.joinRoom(roomId3, 'u4', 'Dave');
let emptyBs = cb.backspace(roomId3, 'u4');
assert(emptyBs === '', 'backspace at 0 should return empty string');
assert(rooms.getRoom(roomId3).lines[0].content === '', 'backspace at 0 should keep empty');

// Test 5: commitLine atomic
let beforeCommit = rooms.getRoom(roomId).lines.length;
let newIdx = cb.commitLine(roomId, 'u1');
let room = rooms.getRoom(roomId);
assert(room.lines[beforeCommit-1].committed === true || room.lines[0].committed === true, 'previous line should be committed');
assert(room.lines[newIdx].content === '', 'new line should be empty');
assert(room.lines[newIdx].owner === 'u1', 'new line owner should be u1');
assert(room.users.get('u1').lineIdx === newIdx, 'user lineIdx should update');

// Test 6: server ordering - sequential inserts preserved
const roomId4 = rooms.createRoom();
rooms.joinRoom(roomId4, 'u5', 'Eve');
cb.insertChar(roomId4, 'u5', 'a');
cb.insertChar(roomId4, 'u5', 'b');
cb.insertChar(roomId4, 'u5', 'c');
assert(rooms.getRoom(roomId4).lines[0].content === 'abc', 'ordering should be abc');

// Test 7: no delete entire line - only backspace char-by-char
assert(typeof cb.deleteLine !== 'function', 'should not have deleteLine method');
assert(typeof cb.clearLine !== 'function', 'should not have clearLine method');

// Test 8: partial typing is legitimate content
const roomId5 = rooms.createRoom();
rooms.joinRoom(roomId5, 'u6', 'Frank');
cb.insertChar(roomId5, 'u6', 'p');
cb.insertChar(roomId5, 'u6', 'a');
let partial = rooms.getRoom(roomId5).lines[0].content;
assert(partial === 'pa', 'partial typing should be legitimate content pa, got '+partial);

console.log('PASS all char broadcast tests');
console.log('PASS char insert');
console.log('PASS 80 char limit');
console.log('PASS backspace');
console.log('PASS backspace at column zero ignored');
console.log('PASS commitLine atomic');
console.log('PASS server ordering');
console.log('PASS no deleteLine');
console.log('PASS partial typing legitimate');
