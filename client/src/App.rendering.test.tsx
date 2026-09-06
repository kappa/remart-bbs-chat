import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle, typing } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
  keepaliveApi: { leaveRoom: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

describe('Rendering from server state', () => {
  it('shows Connecting until the snapshot arrives', async () => {
    const { ws } = await renderJoined(snapshot());
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
    ws.serverClose();
    expect(await screen.findByText('Reconnecting...')).toBeInTheDocument();
  });

  it('committed lines use their stored color, even with the author gone', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, 'old message', bob)] }));
    expect(await screen.findByText('old message')).toHaveStyle({ color: '#0ff' });
  });

  it('an empty committed line renders as a space', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, '')] }));
    await waitFor(() => {
      const lines = Array.from(document.querySelectorAll('.committed-line'));
      expect(lines.some((el) => el.textContent === ' ')).toBe(true);
    });
  });

  it('announcements get the system-line class', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, '* Bob joined', bob)] }));
    expect((await screen.findByText('* Bob joined')).className).toMatch(/system-line/);
  });

  it('lines committed before the join are not shown', async () => {
    await renderJoined(snapshot({ committed: [line('old', 0, 'before', alice, 0), line('new', 1, 'after', alice, 2)] }));
    expect(await screen.findByText('after')).toBeInTheDocument();
    expect(screen.queryByText('before')).not.toBeInTheDocument();
  });

  it('typing sends a keystroke and shows nothing until the server echoes it', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('A');
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'char', char: 'A' }]);
    expect(document.querySelector('.live-line')).toBeNull();
    serverSend(ws, { type: 'live', participantId: 10, row: 1, text: 'A', seq: 1 });
    expect(await screen.findByText('A')).toHaveClass('live-line');
  });

  it('Enter sends enter; the committed echo replaces the live row without moving it', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined(snapshot({ liveLines: [typing(alice, 0, 'typing')] }));
    expect(await screen.findByText('typing')).toHaveAttribute('data-document-order', '0');
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('{Enter}');
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'enter' }]);
    serverSend(ws, { type: 'committed', participantId: 10, seq: 1, line: line('c1', 0, 'typing') });
    serverSend(ws, { type: 'live', participantId: 10, row: null, text: '', seq: 1 });
    const committed = await screen.findByText('typing');
    expect(committed).toHaveClass('committed-line');
    expect(committed).toHaveAttribute('data-document-order', '0');
    expect(document.querySelector('.live-line')).toBeNull();
  });

  it('Backspace is sent even when the visible line is empty', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('{Backspace}');
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'backspace' }]);
  });

  it('a help command from the server opens the overlay; Close dismisses it', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'command', name: 'help' });
    expect(await screen.findByRole('dialog', { name: /help/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a roster command shows feedback; a leave command returns to the lobby', async () => {
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'command', name: 'roster' });
    expect(await screen.findByText('Roster refreshed')).toBeInTheDocument();
    serverSend(ws, { type: 'command', name: 'leave' });
    expect(await screen.findByText('ROOMS')).toBeInTheDocument();
    expect(sessionStorage.getItem('remart-bbs-chat.session')).toBeNull();
  });

  it('paste sends at most 100 characters and warns', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.paste('a'.repeat(150));
    expect(ws.keys().length).toBe(100);
    expect(await screen.findByText(/Paste limited to 100 characters/)).toBeInTheDocument();
  });

  it('unknown-participant ends the session with a message', async () => {
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'error', code: 'unknown-participant' });
    expect(await screen.findByText('Room session ended. Join again.')).toBeInTheDocument();
  });

  it('the caret follows the live row and the local preview appears when idle', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), typing(bob, 0, 'b')] }));
    expect(await screen.findByText('b')).toBeInTheDocument();
    expect(document.querySelector('.local-cursor-preview')).not.toBeNull();
    serverSend(ws, { type: 'live', participantId: 10, row: 1, text: 'a', seq: 1 });
    await screen.findByText('a');
    expect(document.querySelector('.local-cursor-preview')).toBeNull();
    expect(document.querySelectorAll('[aria-label="Your typing position"]').length).toBe(1);
  });
});
