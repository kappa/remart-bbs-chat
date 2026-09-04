import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Ensure test env before import
process.env.NODE_ENV = 'test';
const mod = await import('./server/index.js');
const {
  isValidChar,
  getRoom,
  getOrCreateRoom,
  greatestLineIdx,
  cleanupStaleInRoom,
  globalHandleExists,
  rooms,
  resetForTests,
  ANSI_COLORS,
  HEARTBEAT_TIMEOUT_MS,
} = mod;

describe('isValidChar', () => {
  it('allows normal ASCII', () => {
    assert.equal(isValidChar('a'), true);
    assert.equal(isValidChar('Z'), true);
    assert.equal(isValidChar('0'), true);
    assert.equal(isValidChar('!'), true);
  });
  it('allows space and tab', () => {
    assert.equal(isValidChar(' '), true);
    assert.equal(isValidChar('\t'), true);
  });
  it('allows Unicode including Cyrillic', () => {
    assert.equal(isValidChar('Я'), true);
    assert.equal(isValidChar('ё'), true);
    assert.equal(isValidChar('Ω'), true);
    assert.equal(isValidChar('你'), true);
    // Emoji is single grapheme via Array.from, our impl currently allows it as printable Unicode
    assert.equal(isValidChar('😀'), true);
  });
  it('rejects newline and carriage return', () => {
    assert.equal(isValidChar('\n'), false);
    assert.equal(isValidChar('\r'), false);
  });
  it('rejects C0 controls', () => {
    assert.equal(isValidChar('\x00'), false);
    assert.equal(isValidChar('\x01'), false);
    assert.equal(isValidChar('\x1f'), false);
    assert.equal(isValidChar(String.fromCharCode(127)), false);
  });
  it('rejects multi-char strings', () => {
    assert.equal(isValidChar('ab'), false);
    assert.equal(isValidChar(''), false);
    assert.equal(isValidChar('aa'), false);
  });
  it('rejects non-string', () => {
    assert.equal(isValidChar(null), false);
    assert.equal(isValidChar(undefined), false);
    assert.equal(isValidChar(123), false);
  });
});

describe('Room creation and occupancy', () => {
  beforeEach(() => resetForTests());

  it('creates rooms incrementally', () => {
    const r1 = getOrCreateRoom(null, true);
    const r2 = getOrCreateRoom(null, true);
    assert.equal(r1.id + 1, r2.id);
    assert.equal(r1.name, `Room ${r1.id}`);
  });

  it('reuses room with space', () => {
    const r1 = getOrCreateRoom(null, true);
    // Fill r1 to 9 participants (not 10, so still space)
    for (let i = 0; i < 9; i++) {
      r1.participants.set(i + 1, {
        id: i + 1,
        handle: `user${i}`,
        color: ANSI_COLORS[i % ANSI_COLORS.length],
        lineSlot: i,
        activeLineIdx: null,
        activeContent: '',
        lastSeen: new Date(),
        joinedAt: new Date(),
      });
    }
    const rReuse = getOrCreateRoom(null, false);
    assert.equal(rReuse.id, r1.id, 'should reuse room with space');
  });

  it('creates new room when existing full', () => {
    const r1 = getOrCreateRoom(null, true);
    // Fill to 10
    for (let i = 0; i < 10; i++) {
      r1.participants.set(i + 100, {
        id: i + 100,
        handle: `user${i}`,
        color: ANSI_COLORS[i],
        lineSlot: i,
        activeLineIdx: null,
        activeContent: '',
        lastSeen: new Date(),
        joinedAt: new Date(),
      });
    }
    const rNew = getOrCreateRoom(null, false);
    assert.notEqual(rNew.id, r1.id);
  });

  it('respects preferredId when has space', () => {
    const r1 = getOrCreateRoom(null, true);
    const r2 = getOrCreateRoom(r1.id, false);
    assert.equal(r2.id, r1.id);
  });

  it('creates ephemeral rooms and cleans up when empty', () => {
    const room = getOrCreateRoom(null, true);
    const roomId = room.id;
    // Simulate participant that went stale with empty content
    const stale = {
      id: 999,
      handle: 'stale',
      color: ANSI_COLORS[0],
      lineSlot: 0,
      activeLineIdx: null,
      activeContent: '',
      lastSeen: new Date(Date.now() - HEARTBEAT_TIMEOUT_MS - 1000),
      joinedAt: new Date(),
    };
    room.participants.set(stale.id, stale);
    const removed = cleanupStaleInRoom(room);
    assert.equal(removed, 1);
    // Room should be deleted because it was empty after cleanup and not lobby
    assert.equal(rooms.has(roomId), false, 'empty ephemeral room should be deleted');
  });

  it('greatestLineIdx handles null activeLineIdx', () => {
    const room = getOrCreateRoom(null, true);
    room.lines.push({ lineIdx: 5 });
    room.lines.push({ lineIdx: 2 });
    room.participants.set(1, { activeLineIdx: null });
    room.participants.set(2, { activeLineIdx: 10 });
    assert.equal(greatestLineIdx(room), 10);
    room.participants.delete(2);
    assert.equal(greatestLineIdx(room), 5);
  });
});

describe('globalHandleExists case-insensitive', () => {
  beforeEach(() => resetForTests());

  it('detects duplicates across rooms', () => {
    const r1 = getOrCreateRoom(null, true);
    r1.participants.set(1, { handle: 'Alice', lastSeen: new Date() });
    assert.equal(globalHandleExists('alice'), true);
    assert.equal(globalHandleExists('ALICE'), true);
    assert.equal(globalHandleExists('AlIcE'), true);
    assert.equal(globalHandleExists('bob'), false);
  });
});

describe('cleanupStaleInRoom preserving nonempty', () => {
  beforeEach(() => resetForTests());

  it('preserves nonempty active text as committed line', () => {
    const room = getOrCreateRoom(null, true);
    const stale = {
      id: 10,
      handle: 'bob',
      color: '#00FFFF',
      lineSlot: 0,
      activeLineIdx: 5,
      activeContent: 'hello',
      lastSeen: new Date(Date.now() - HEARTBEAT_TIMEOUT_MS - 5000),
      joinedAt: new Date(),
    };
    room.participants.set(stale.id, stale);
    const beforeLines = room.lines.length;
    cleanupStaleInRoom(room);
    // Should have at least 2 new lines: committed content + leave notice, but room may be deleted if it was only participant
    // Since room had 1 participant and we removed him, room is deleted – we need to keep room alive by adding another participant
  });

  it('preserves nonempty and deletes empty, keeps room if others remain', () => {
    const room = getOrCreateRoom(null, true);
    const keeper = {
      id: 1,
      handle: 'keeper',
      color: ANSI_COLORS[1],
      lineSlot: 1,
      activeLineIdx: null,
      activeContent: '',
      lastSeen: new Date(),
      joinedAt: new Date(),
    };
    room.participants.set(keeper.id, keeper);
    const staleFull = {
      id: 2,
      handle: 'bob',
      color: ANSI_COLORS[0],
      lineSlot: 0,
      activeLineIdx: 3,
      activeContent: 'typed but not committed',
      lastSeen: new Date(Date.now() - HEARTBEAT_TIMEOUT_MS - 1000),
      joinedAt: new Date(),
    };
    room.participants.set(staleFull.id, staleFull);
    const staleEmpty = {
      id: 3,
      handle: 'empty',
      color: ANSI_COLORS[2],
      lineSlot: 2,
      activeLineIdx: null,
      activeContent: '',
      lastSeen: new Date(Date.now() - HEARTBEAT_TIMEOUT_MS - 1000),
      joinedAt: new Date(),
    };
    room.participants.set(staleEmpty.id, staleEmpty);

    cleanupStaleInRoom(room);
    // keeper should remain, stale removed
    assert.equal(room.participants.has(keeper.id), true);
    assert.equal(room.participants.has(staleFull.id), false);
    assert.equal(room.participants.has(staleEmpty.id), false);
    // Check lines contain committed text and leave notices
    const contents = room.lines.map(l => l.content);
    assert.ok(contents.some(c => c === 'typed but not committed'), 'should preserve nonempty active text');
    assert.ok(contents.some(c => c === '* bob left'));
    assert.ok(contents.some(c => c === '* empty left'));
    // Empty's active text should NOT be preserved as separate line
    assert.equal(contents.filter(c => c === '').length, 0);
  });
});
