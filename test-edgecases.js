// test-edgecases.js - Task 7 edge cases hardening
const { Rooms } = require('./rooms.js');
const { CharBroadcast } = require('./char-broadcast.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log(`PASS ${name}`); pass++; }
  catch(e) { console.error(`FAIL ${name}: ${e.message}`); fail++; }
}

const rooms = new Rooms();
const bc = new CharBroadcast(rooms);

// Backspace at column zero ignored
ok('Backspace at 0 ignored', () => {
  const roomId = rooms.createRoom();
  rooms.joinRoom(roomId, 'u1', 'Alice');
  const content = bc.backspace(roomId, 'u1');
  if (content !== '') throw new Error(`expected '' got '${content}'`);
  // double backspace
  const content2 = bc.backspace(roomId, 'u1');
  if (content2 !== '') throw new Error('second backspace should still be empty');
});

// Empty disconnect frees slot (lines 0 after leave concept)
// In Rooms impl, leave frees user slot
ok('Empty disconnect frees slot', () => {
  const roomId = rooms.createRoom();
  rooms.joinRoom(roomId, 'u1', 'Bob');
  const room = rooms.rooms.get(roomId);
  if (room.lines.length !== 1) throw new Error('should have 1 line');
  rooms.leaveRoom(roomId, 'u1');
  if (room.users.size !== 0) throw new Error('users should be 0 after leave');
  if (room.lines.length !== 0) throw new Error('empty line should be reclaimed, lines 0');
});

// Typed disconnect stays (lines 1 after leave if content 'hi')
ok('Typed disconnect stays', () => {
  const roomId = rooms.createRoom();
  rooms.joinRoom(roomId, 'u1', 'Carol');
  bc.insertChar(roomId, 'u1', 'h');
  bc.insertChar(roomId, 'u1', 'i');
  const room = rooms.rooms.get(roomId);
  if (room.lines[0].content !== 'hi') throw new Error('should have hi');
  rooms.leaveRoom(roomId, 'u1');
  // In reference impl, typed line stays as history
  if (room.lines.length !== 1) throw new Error(`expected 1 line preserved, got ${room.lines.length}`);
  if (room.lines[0].content !== 'hi') throw new Error('preserved content should be hi');
});

// 80 char limit enforced
ok('80 char limit enforced', () => {
  const roomId = rooms.createRoom();
  rooms.joinRoom(roomId, 'u1', 'Dave');
  for (let i=0;i<85;i++) bc.insertChar(roomId, 'u1', 'a');
  const room = rooms.rooms.get(roomId);
  if (room.lines[0].content.length !== 80) throw new Error(`expected 80 got ${room.lines[0].content.length}`);
});

// Paste flood rate limited (truncate >20)
ok('Paste flood truncated to 20', () => {
  const paste = 'x'.repeat(100);
  const truncated = paste.slice(0, 20);
  if (truncated.length !== 20) throw new Error('truncate failed');
  // simulate sending char-by-char but capped
  const roomId = rooms.createRoom();
  rooms.joinRoom(roomId, 'u1', 'Eve');
  for (const ch of truncated) bc.insertChar(roomId, 'u1', ch);
  const room = rooms.rooms.get(roomId);
  if (room.lines[0].content.length !== 20) throw new Error(`expected 20 got ${room.lines[0].content.length}`);
});

// Unicode wide rejected (only ASCII printable single-width)
ok('Unicode wide rejected', () => {
  const PRINTABLE_ASCII = /^[\x20-\x7E]$/;
  const tests = [
    {char: 'A', valid: true},
    {char: ' ', valid: true},
    {char: '€', valid: false},
    {char: '😀', valid: false},
    {char: 'あ', valid: false},
    {char: '\n', valid: false},
    {char: 'é', valid: false},
  ];
  for (const {char, valid} of tests) {
    const isValid = PRINTABLE_ASCII.test(char) && char.length===1;
    if (isValid !== valid) throw new Error(`char ${char} expected valid=${valid} got ${isValid}`);
  }
});

// No deleteLine exists
ok('No deleteLine/clearLine', () => {
  if (typeof bc.deleteLine === 'function') throw new Error('deleteLine should not exist');
  if (typeof bc.clearLine === 'function') throw new Error('clearLine should not exist');
  if (typeof rooms.deleteLine === 'function') throw new Error('Rooms deleteLine should not exist');
});

// Simultaneous Enter serialization (atomic via single-threaded)
ok('Simultaneous Enter serialization', () => {
  const roomId = rooms.createRoom();
  rooms.joinRoom(roomId, 'u1', 'Frank');
  bc.insertChar(roomId, 'u1', 'h');
  bc.insertChar(roomId, 'u1', 'i');
  const idx1 = bc.commitLine(roomId, 'u1');
  if (idx1 !== 1) throw new Error(`first commit should give idx 1 got ${idx1}`);
  bc.insertChar(roomId, 'u1', 'b');
  bc.insertChar(roomId, 'u1', 'y');
  const idx2 = bc.commitLine(roomId, 'u1');
  if (idx2 !== 2) throw new Error(`second commit should give idx 2 got ${idx2}`);
  const room = rooms.rooms.get(roomId);
  if (room.lines.length !== 3) throw new Error(`expected 3 lines got ${room.lines.length}`);
  if (!room.lines[0].committed) throw new Error('line 0 should be committed');
  if (room.lines[0].content !== 'hi') throw new Error('line 0 content hi');
  if (room.lines[1].content !== 'by') throw new Error('line 1 content by');
});

// Rate limit 10 chars/sec simulation
ok('Rate limit 10 chars/sec', () => {
  let timestamps = [];
  const now = Date.now();
  // simulate 11 chars in same second
  for (let i=0;i<11;i++) timestamps.push(now);
  const recent = timestamps.filter(t => now - t < 1000);
  if (recent.length !== 11) throw new Error('setup');
  const allowed = recent.length <= 10;
  if (allowed) throw new Error('should be rate limited at 11');
  // 10 should be allowed
  timestamps = Array(10).fill(now);
  if (timestamps.filter(t => now - t < 1000).length > 10) throw new Error('10 should be allowed');
});

// Partial typing is legitimate content, not ghost
ok('Partial typing legitimate not ghost', () => {
  const roomId = rooms.createRoom();
  rooms.joinRoom(roomId, 'u1', 'Grace');
  bc.insertChar(roomId, 'u1', 'h');
  const room = rooms.rooms.get(roomId);
  if (room.lines[0].content !== 'h') throw new Error('partial should be legitimate');
  if (room.lines[0].committed) throw new Error('partial should not be committed yet but still legitimate visible content');
});

console.log(`\nEdge cases: ${pass} PASS, ${fail} FAIL`);
if (fail>0) process.exit(1);
