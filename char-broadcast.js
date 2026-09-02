// char-broadcast.ts / js - Task 3 Char-by-char broadcast and line ownership
// Server as source of truth for character order (single-threaded JS serializes)

class CharBroadcast {
  constructor(rooms) {
    this.rooms = rooms; // Rooms instance
  }

  /**
   * @param {string} roomId
   * @param {string} userId
   * @param {string} char - single character to insert
   * @returns {string} new content
   */
  insertChar(roomId, userId, char) {
    const room = this.rooms.getRoom(roomId);
    if (!room) throw new Error('room not found');
    const user = room.users.get(userId);
    if (!user) throw new Error('user not in room');
    // validate user owns lineIdx
    if (user.lineIdx < 0 || user.lineIdx >= room.lines.length) {
      throw new Error('invalid lineIdx');
    }
    const line = room.lines[user.lineIdx];
    if (!line) throw new Error('line not found');
    if (line.owner !== userId) throw new Error('user does not own line');
    if (line.committed) throw new Error('line already committed');

    // hard limit 80 chars, no horizontal scroll, no wrapping (per spec)
    if (line.content.length >= 80) {
      return line.content; // ignore beyond limit
    }
    // single char only - if multi-char pasted, take first char? spec says char-by-char
    // For paste handling, caller should iterate, but we enforce single char here
    if (typeof char !== 'string' || char.length === 0) return line.content;
    const c = char[0]; // take first char if longer string passed
    // Reject control chars except printable? Spec says Unicode single-width exploratory,
    // but we allow any single-width printable, filter out \n\r
    if (c === '\n' || c === '\r') return line.content;

    line.content += c;
    // CharEvent: {roomId, userId, char: c, lineIdx: user.lineIdx, position: line.content.length-1}
    // Broadcast would happen here in server - in this local model we just mutate state
    return line.content;
  }

  /**
   * Backspace handling
   * @param {string} roomId
   * @param {string} userId
   * @returns {string} new content
   */
  backspace(roomId, userId) {
    const room = this.rooms.getRoom(roomId);
    if (!room) throw new Error('room not found');
    const user = room.users.get(userId);
    if (!user) throw new Error('user not in room');
    const line = room.lines[user.lineIdx];
    if (!line) throw new Error('line not found');
    if (line.owner !== userId) throw new Error('user does not own line');
    if (line.committed) throw new Error('line already committed');

    // Edge case confirmed: Backspace at column zero is ignored
    if (line.content.length === 0) {
      return ''; // ignored
    }
    line.content = line.content.slice(0, -1);
    return line.content;
  }

  /**
   * Enter commits current line into history and assigns another available line
   * Atomic - single-threaded JS makes this atomic, TS space action queue also serializes
   * @param {string} roomId
   * @param {string} userId
   * @returns {number} new lineIdx
   */
  commitLine(roomId, userId) {
    const room = this.rooms.getRoom(roomId);
    if (!room) throw new Error('room not found');
    const user = room.users.get(userId);
    if (!user) throw new Error('user not in room');
    const line = room.lines[user.lineIdx];
    if (!line) throw new Error('line not found');
    if (line.owner !== userId) throw new Error('user does not own line');

    // Per spec: Enter commits current line into history and assigns another available line
    // Even empty line? Plan says Enter-on-empty historically unknown, but we allow commit of any length
    // Mark committed
    line.committed = true;

    // Allocate new empty line atomically
    const newIdx = room.lines.length;
    room.lines.push({ owner: userId, content: '', committed: false });
    user.lineIdx = newIdx;
    return newIdx;
  }

  // Note: No deleteLine, clearLine - spec says no action deletes entire line
  // Only char-by-char Backspace allowed
}

module.exports = { CharBroadcast };
