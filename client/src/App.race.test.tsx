import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { FakeWebSocket } from './testing/fakeWebSocket';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle, typing, storeSession, queryClient } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
  keepaliveApi: { leaveRoom: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const liveRows = () => Array.from(document.querySelectorAll('.live-line')).map((el) => el.textContent?.replace(/\s+$/, ''));

describe('Fast input under delayed echo', () => {
  it('A Enter B Backspace C: nothing renders until echo; then A committed, C live, Bob untouched', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), typing(bob, 2, 'X')], roster: [alice, bob] }));
    await screen.findByText('X');
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('A{Enter}B{Backspace}C');
    expect(ws.keys().map((k) => [k.seq, k.kind, k.char ?? ''])).toEqual([[1, 'char', 'A'], [2, 'enter', ''], [3, 'char', 'B'], [4, 'backspace', ''], [5, 'char', 'C']]);
    expect(liveRows()).toEqual(['X']);
    expect(document.querySelectorAll('.committed-line').length).toBe(0);

    serverSend(ws, { type: 'live', participantId: 10, row: 3, text: 'A', caret: 0, seq: 1 });
    serverSend(ws, { type: 'committed', participantId: 10, seq: 2, line: line('c1', 3, 'A') });
    serverSend(ws, { type: 'live', participantId: 10, row: null, text: '', caret: 0, seq: 2 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: 'B', caret: 0, seq: 3 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: '', caret: 0, seq: 4 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: 'C', caret: 0, seq: 5 });

    await waitFor(() => expect(liveRows()).toEqual(['X', 'C']));
    const committed = screen.getByText('A');
    expect(committed).toHaveClass('committed-line');
    expect(committed).toHaveAttribute('data-document-order', '3');
    expect(screen.getByText('X')).toHaveAttribute('data-document-order', '2');
  });

  it('a transient character then backspace from another participant is shown then cleared', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    serverSend(ws, { type: 'live', participantId: 20, row: 0, text: 'x', caret: 0, seq: 1 });
    expect(await screen.findByText('x')).toBeInTheDocument();
    serverSend(ws, { type: 'live', participantId: 20, row: 0, text: '', caret: 0, seq: 2 });
    await waitFor(() => expect(screen.queryByText('x')).not.toBeInTheDocument());
    expect(liveRows()).toEqual(['']);
  });

  it('keystrokes typed while reconnecting are sent after the new snapshot', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    act(() => ws.serverClose());
    expect(await screen.findByText('Reconnecting...')).toBeInTheDocument();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('Z');
    const next = await waitFor(() => {
      const latest = FakeWebSocket.latest();
      if (latest === ws || !latest.sent.some((m) => m.type === 'hello')) throw new Error('not reconnected');
      return latest;
    }, { timeout: 3000 });
    serverSend(next, snapshot());
    expect(next.keys()).toEqual([{ type: 'key', seq: 1, kind: 'char', char: 'Z' }]);
    await waitFor(() => expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument());
  });

  it('keystrokes typed before the first snapshot after a reload take the server numbering', async () => {
    const user = userEvent.setup();
    storeSession();
    render(<QueryClientProvider client={queryClient()}><App /></QueryClientProvider>);
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('AB');
    const ws = await waitFor(() => {
      const socket = FakeWebSocket.latest();
      if (!socket.sent.some((m) => m.type === 'hello')) throw new Error('no hello yet');
      return socket;
    });
    expect(ws.keys()).toEqual([]);
    serverSend(ws, snapshot({ you: { participantId: 10, nextSeq: 57 } }));
    expect(ws.keys()).toEqual([{ type: 'key', seq: 57, kind: 'char', char: 'A' }, { type: 'key', seq: 58, kind: 'char', char: 'B' }]);
  });

  it('a leave command ends the session, closes the socket, and does not reconnect', async () => {
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'command', name: 'leave' });
    expect(await screen.findByText('ROOMS')).toBeInTheDocument();
    expect(sessionStorage.getItem('remart-bbs-chat.session')).toBeNull();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    await act(() => new Promise((resolve) => setTimeout(resolve, 1500)));
    expect(FakeWebSocket.instances).toEqual([ws]);
  });

  it('seq-gap shows the lost-input warning', async () => {
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'error', code: 'seq-gap', expected: 4 });
    expect(await screen.findByText('Connection recovered, some input was lost')).toBeInTheDocument();
  });

  it('a full pending queue pauses input with a warning', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.paste('a'.repeat(100));
    await user.paste('b'.repeat(100));
    expect(ws.keys().length).toBe(200);
    await user.keyboard('c');
    expect(ws.keys().length).toBe(200);
    expect(await screen.findByText('Not connected, input paused')).toBeInTheDocument();
  });
});
