import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeWebSocket } from './testing/fakeWebSocket';
import { openRoomConnection, socketUrl, MAX_PENDING, type ConnectionStatus } from './connection';
import type { ServerMessage } from './protocol';

const creds = { roomId: 1, participantId: 10, token: 'tok' };
const snapshot = (nextSeq: number): ServerMessage => ({ type: 'snapshot', roomId: 1, you: { participantId: 10, nextSeq }, liveLines: [], committed: [], roster: [] });

function open(options = {}) {
  const messages: ServerMessage[] = [];
  const statuses: ConnectionStatus[] = [];
  const onInputLost = vi.fn();
  const connection = openRoomConnection(creds, { onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s), onInputLost }, { url: 'ws://test/ws', reconnectDelayMs: 100, ...options });
  return { connection, messages, statuses, onInputLost };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('openRoomConnection', () => {
  it('sends hello on open and reports open after the snapshot', () => {
    const { statuses } = open();
    expect(statuses).toEqual(['connecting']);
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    expect(ws.url).toBe('ws://test/ws');
    expect(ws.sent).toEqual([{ type: 'hello', ...creds }]);
    ws.serverSend(snapshot(1));
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('queues keystrokes typed before the snapshot and sends them in order after it', () => {
    const { connection } = open();
    expect(connection.send({ kind: 'char', char: 'A' })).toBe(true);
    expect(connection.send({ kind: 'enter' })).toBe(true);
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    expect(ws.keys()).toEqual([]);
    ws.serverSend(snapshot(1));
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'char', char: 'A' }, { type: 'key', seq: 2, kind: 'enter' }]);
    connection.send({ kind: 'backspace' });
    expect(ws.keys()[2]).toEqual({ type: 'key', seq: 3, kind: 'backspace' });
  });

  it('keystrokes typed before the first snapshot after a reload take the server numbering', () => {
    const { connection } = open();
    connection.send({ kind: 'char', char: 'A' });
    connection.send({ kind: 'char', char: 'B' });
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(57));
    expect(ws.keys()).toEqual([{ type: 'key', seq: 57, kind: 'char', char: 'A' }, { type: 'key', seq: 58, kind: 'char', char: 'B' }]);
    connection.send({ kind: 'enter' });
    expect(ws.keys()[2]).toEqual({ type: 'key', seq: 59, kind: 'enter' });
  });

  it('on reconnect resends only keystrokes the server has not echoed', () => {
    const { connection, statuses } = open();
    vi.runOnlyPendingTimers();
    const first = FakeWebSocket.latest();
    first.serverSend(snapshot(1));
    connection.send({ kind: 'char', char: 'A' });
    connection.send({ kind: 'char', char: 'B' });
    connection.send({ kind: 'char', char: 'C' });
    first.serverSend({ type: 'live', participantId: 10, row: 0, text: 'A', caret: 0, seq: 1 });
    first.serverSend({ type: 'live', participantId: 99, row: 1, text: 'x', caret: 0, seq: 2 });
    first.serverClose();
    expect(statuses.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(100);
    vi.runOnlyPendingTimers();
    const second = FakeWebSocket.latest();
    expect(second).not.toBe(first);
    second.serverSend(snapshot(2));
    expect(second.keys().map((k) => k.seq)).toEqual([2, 3]);
    expect(statuses.at(-1)).toBe('open');
  });

  it('drops pending keystrokes the reconnect snapshot shows as already applied', () => {
    const { connection } = open();
    vi.runOnlyPendingTimers();
    const first = FakeWebSocket.latest();
    first.serverSend(snapshot(1));
    connection.send({ kind: 'char', char: 'A' });
    connection.send({ kind: 'char', char: 'B' });
    first.serverClose();
    vi.advanceTimersByTime(100); vi.runOnlyPendingTimers();
    const second = FakeWebSocket.latest();
    second.serverSend(snapshot(3));
    expect(second.keys()).toEqual([]);
    connection.send({ kind: 'char', char: 'C' });
    expect(second.keys()[0].seq).toBe(3);
  });

  it('seq-gap discards the queue, adopts the expected number, and reports lost input', () => {
    const { connection, onInputLost } = open();
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(1));
    connection.send({ kind: 'char', char: 'A' });
    ws.serverSend({ type: 'error', code: 'seq-gap', expected: 7 });
    expect(onInputLost).toHaveBeenCalledTimes(1);
    connection.send({ kind: 'char', char: 'B' });
    expect(ws.keys().at(-1)).toEqual({ type: 'key', seq: 7, kind: 'char', char: 'B' });
  });

  it('refuses keystrokes when the pending queue is full', () => {
    const { connection } = open({ maxPending: 2 });
    expect(connection.send({ kind: 'char', char: 'A' })).toBe(true);
    expect(connection.send({ kind: 'char', char: 'B' })).toBe(true);
    expect(connection.send({ kind: 'char', char: 'C' })).toBe(false);
    expect(MAX_PENDING).toBe(200);
  });

  it('close stops reconnecting', () => {
    const { connection } = open();
    vi.runOnlyPendingTimers();
    const first = FakeWebSocket.latest();
    connection.close();
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    vi.advanceTimersByTime(1000); vi.runOnlyPendingTimers();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('forwards every message to onMessage', () => {
    const { messages } = open();
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(1));
    ws.serverSend({ type: 'command', name: 'help' });
    expect(messages.map((m) => m.type)).toEqual(['snapshot', 'command']);
  });
  it('pendingCount counts keystrokes not yet acked by an echo', () => {
    const { connection } = open();
    vi.runOnlyPendingTimers();
    const ws = FakeWebSocket.latest();
    ws.serverSend(snapshot(1));
    expect(connection.pendingCount()).toBe(0);
    connection.send({ kind: 'char', char: 'a' });
    connection.send({ kind: 'char', char: 'b' });
    expect(connection.pendingCount()).toBe(2);
    ws.serverSend({ type: 'live', participantId: 10, row: 0, text: 'a', caret: 1, seq: 1 });
    expect(connection.pendingCount()).toBe(1);
    ws.serverSend({ type: 'live', participantId: 10, row: 0, text: 'ab', caret: 2, seq: 2 });
    expect(connection.pendingCount()).toBe(0);
  });
});


describe('socketUrl', () => {
  it('uses ws for http and wss for https, at /ws on the page host', () => {
    expect(socketUrl({ protocol: 'http:', host: 'localhost:3000' } as Location)).toBe('ws://localhost:3000/ws');
    expect(socketUrl({ protocol: 'https:', host: 'chat.example' } as Location)).toBe('wss://chat.example/ws');
  });
});
