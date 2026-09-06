import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { FakeWebSocket } from './testing/fakeWebSocket';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle, typing } from './testing/roomFixtures';

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

    serverSend(ws, { type: 'live', participantId: 10, row: 3, text: 'A', seq: 1 });
    serverSend(ws, { type: 'committed', participantId: 10, seq: 2, line: line('c1', 3, 'A') });
    serverSend(ws, { type: 'live', participantId: 10, row: null, text: '', seq: 2 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: 'B', seq: 3 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: '', seq: 4 });
    serverSend(ws, { type: 'live', participantId: 10, row: 4, text: 'C', seq: 5 });

    await waitFor(() => expect(liveRows()).toEqual(['X', 'C']));
    const committed = screen.getByText('A');
    expect(committed).toHaveClass('committed-line');
    expect(committed).toHaveAttribute('data-document-order', '3');
    expect(screen.getByText('X')).toHaveAttribute('data-document-order', '2');
  });

  it('a transient character then backspace from another participant is shown then cleared', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    serverSend(ws, { type: 'live', participantId: 20, row: 0, text: 'x', seq: 1 });
    expect(await screen.findByText('x')).toBeInTheDocument();
    serverSend(ws, { type: 'live', participantId: 20, row: 0, text: '', seq: 2 });
    await waitFor(() => expect(screen.queryByText('x')).not.toBeInTheDocument());
    expect(liveRows()).toEqual(['']);
  });

  it('keystrokes typed while reconnecting are sent after the new snapshot', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    ws.serverClose();
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
