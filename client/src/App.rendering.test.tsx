import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { FakeWebSocket } from './testing/fakeWebSocket';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle, typing, storeSession, queryClient, SESSION } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

describe('Rendering from server state', () => {
  it('shows Connecting until the snapshot arrives, then Reconnecting after a close', async () => {
    storeSession();
    render(<QueryClientProvider client={queryClient()}><App /></QueryClientProvider>);
    expect(await screen.findByText('Connecting...')).toBeInTheDocument();
    const ws = await waitFor(() => {
      const socket = FakeWebSocket.latest();
      if (!socket.sent.some((m) => m.type === 'hello')) throw new Error('no hello yet');
      return socket;
    });
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
    serverSend(ws, snapshot());
    expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
    act(() => ws.serverClose());
    expect(await screen.findByText('Reconnecting...')).toBeInTheDocument();
  });

  it('committed lines use their stored color, even with the author gone', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, 'old message', bob)] }));
    expect(await screen.findByText('old message')).toHaveStyle({ color: '#0ff' });
  });

  it('a URL in a committed line is a new-tab link; the rest is text', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, 'see https://example.com/x ok')] }));
    const anchor = await screen.findByRole('link', { name: 'https://example.com/x' });
    expect(anchor).toHaveAttribute('href', 'https://example.com/x');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    const row = anchor.closest('.committed-line');
    expect(row?.textContent).toBe('see https://example.com/x ok');
  });

  it('markup-looking chat text stays text; only anchors are created', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, 'see <img src=x onerror=alert(1)> ok')] }));
    expect(await screen.findByText(/see.*ok/)).toBeInTheDocument();
    expect(document.querySelector('.committed-line img')).toBeNull();
    expect(document.querySelectorAll('.committed-line a').length).toBe(0);
  });

  it('a half-typed URL in a live line is not a link yet', async () => {
    await renderJoined(snapshot({ liveLines: [typing(alice, 0, 'see https://example.com/x')] }));
    expect(await screen.findByText(/see https:\/\/example.com\/x/)).toBeInTheDocument();
    expect(document.querySelectorAll('.live-line a').length).toBe(0);
  });

  it('clicking a transcript link does not steal chat focus', async () => {
    const user = userEvent.setup();
    await renderJoined(snapshot({ committed: [line('h1', 0, 'see https://example.com/x')] }));
    const anchor = await screen.findByRole('link', { name: 'https://example.com/x' });
    await user.click(await screen.findByLabelText('Shared chat area'));
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
    await user.click(anchor);
    expect(document.activeElement).not.toBe(document.querySelector('.keyboard-capture'));
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

  it('server-selected old rows render even with timestamps before the join', async () => {
    // A preserved live row can be appended after joining with an older timestamp.
    await renderJoined(snapshot({ committed: [line('old', 0, 'before', alice, 0), line('new', 1, 'after', alice, 2)] }), { ...SESSION, historyFromRow: 1 });
    expect(await screen.findByText('after')).toBeInTheDocument();
    expect(screen.getByText('before')).toBeInTheDocument();
  });

  it('a newcomer sees the last 20 committed lines in row order with their colors', async () => {
    // The server selected rows 5..24 from 25 prior lines.
    const committed = Array.from({ length: 25 }, (_, row) => {
      if (row === 5) return line('ann', 5, '* Bob joined', bob, 0);
      if (row === 6) return line('blank', 6, '', alice, 0);
      return line(`l${row}`, row, `t${row}`, alice, 0);
    });
    const { ws } = await renderJoined(snapshot({ committed: committed.slice(-20) }), { ...SESSION, historyFromRow: 5 });
    await screen.findByText('* Bob joined');

    const rendered = Array.from(document.querySelectorAll('.committed-line'));
    expect(rendered.length).toBe(20);
    expect(rendered.map((el) => el.getAttribute('data-document-order')))
      .toEqual(Array.from({ length: 20 }, (_, i) => String(i + 5)));
    expect(rendered[0]).toHaveStyle({ color: '#0ff' });
    expect(rendered[1].textContent).toBe(' ');
    expect(ws).toBeDefined();
  });

  it('typing sends a keystroke and shows nothing until the server echoes it', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('A');
    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'char', char: 'A' }]);
    expect(document.querySelector('.live-line')).toBeNull();
    serverSend(ws, { type: 'live', participantId: 10, row: 1, text: 'A', caret: 1, seq: 1 });
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
    serverSend(ws, { type: 'live', participantId: 10, row: null, text: '', caret: 0, seq: 1 });
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

  it('typing l and pressing Enter commits ordinary chat; help and leave commands still work', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('l{Enter}');
    // l + Enter should be sent as chat, not as a command
    expect(ws.keys().map((k) => [k.kind, k.char ?? ''])).toEqual([['char', 'l'], ['enter', '']]);
    // Server echoes the committed line
    serverSend(ws, { type: 'committed', participantId: 10, seq: 1, line: { row: 0, text: 'l', color: '#fff', slot: 0 } });
    expect(await screen.findByText('l')).toBeInTheDocument();
    // Help command still works
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('?{Enter}');
    expect(ws.keys().map((k) => [k.kind, k.char ?? ''])).toEqual([['char', 'l'], ['enter', ''], ['char', '?'], ['enter', '']]);
    serverSend(ws, { type: 'command', name: 'help' });
    expect(await screen.findByRole('dialog', { name: /help/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));
    // Leave command still works
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
    serverSend(ws, { type: 'live', participantId: 10, row: 1, text: 'a', caret: 0, seq: 1 });
    await screen.findByText('a');
    expect(document.querySelector('.local-cursor-preview')).toBeNull();
    expect(document.querySelectorAll('[aria-label="Your typing position"]').length).toBe(1);
  });
});

describe('Mouse selection (task 13)', () => {
  const keyboard = () => screen.getByLabelText('Chat keyboard input');

  // renderJoined's join timer focuses the capture textarea; drop that focus
  // so each test's focus assertions say something about the click or key.
  const blurKeyboard = () => (document.activeElement as HTMLElement)?.blur?.();

  const selectLine = async (text: string, collapsed = false) => {
    const el = await screen.findByText(text);
    const range = document.createRange();
    range.selectNodeContents(el);
    if (collapsed) range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return sel;
  };

  it('a click while text is selected does not focus the keyboard textarea', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, 'hello world')] }));
    blurKeyboard();
    const sel = await selectLine('hello world');

    fireEvent.click(screen.getByLabelText('Shared chat area'));

    expect(document.activeElement).not.toBe(keyboard());
    expect(sel.rangeCount).toBe(1);
    expect(sel.getRangeAt(0).collapsed).toBe(false);
  });

  it('a plain click still focuses the keyboard textarea', async () => {
    await renderJoined(snapshot({ committed: [line('h1', 0, 'hello world')] }));
    blurKeyboard();
    await selectLine('hello world', true);

    fireEvent.click(screen.getByLabelText('Shared chat area'));

    expect(document.activeElement).toBe(keyboard());
  });

  it('a keydown after a selection types into the room without a click', async () => {
    const { ws } = await renderJoined(snapshot({ committed: [line('h1', 0, 'hello world')] }));
    blurKeyboard();
    await selectLine('hello world');

    fireEvent.click(screen.getByLabelText('Shared chat area'));
    fireEvent.keyDown(document.body, { key: 'A' });

    expect(ws.keys()).toEqual([{ type: 'key', seq: 1, kind: 'char', char: 'A' }]);
    expect(document.activeElement).toBe(keyboard());
  });

  it('a keydown while a button has focus is left alone', async () => {
    const { ws } = await renderJoined();
    screen.getByRole('button', { name: 'Leave' }).focus();

    fireEvent.keyDown(document.body, { key: 'A' });

    expect(ws.keys()).toEqual([]);
    expect(document.activeElement).not.toBe(keyboard());
  });

  it('one keydown produces exactly one keystroke', async () => {
    const { ws } = await renderJoined();
    blurKeyboard();

    fireEvent.click(screen.getByLabelText('Shared chat area'));
    fireEvent.keyDown(document.body, { key: 'A' });

    expect(ws.keys().length).toBe(1);
  });
});

describe('Editing keys (task 14)', () => {
  const keydown = (key: string, extra: Record<string, unknown> = {}) =>
    fireEvent.keyDown(document.body, { key, ...extra });

  it('ArrowLeft, ArrowRight, Home, End, Delete, and Ctrl+Arrows send their kinds', async () => {
    const { ws } = await renderJoined();
    fireEvent.click(await screen.findByLabelText('Shared chat area'));

    keydown('ArrowLeft');
    keydown('ArrowRight');
    keydown('Home');
    keydown('End');
    keydown('Delete');
    keydown('ArrowLeft', { ctrlKey: true });
    keydown('ArrowRight', { ctrlKey: true });

    expect(ws.keys().map((k) => k.kind)).toEqual(['left', 'right', 'home', 'end', 'delete', 'word-left', 'word-right']);
  });

  it('Ctrl+C keeps its browser meaning and sends nothing', async () => {
    const { ws } = await renderJoined();
    fireEvent.click(await screen.findByLabelText('Shared chat area'));

    keydown('c', { ctrlKey: true });

    expect(ws.keys()).toEqual([]);
  });

  it('the own live row draws the caret at the echoed position; observers get none', async () => {
    await renderJoined(snapshot({ liveLines: [typing(alice, 0, 'abc', 1), typing(bob, 2, 'xy', 1)] }));
    await screen.findByText('xy');

    const own = document.querySelector('.live-line[data-line-slot="0"]')!;
    expect(own.textContent).toBe('abc');
    expect(own.querySelector('.caret-char')?.textContent).toBe('b');
    expect(own.childNodes[0].textContent).toBe('a');
    expect(own.lastChild?.textContent).toBe('c');

    const other = document.querySelector('.live-line[data-line-slot="1"]')!;
    expect(other.textContent).toBe('xy');
    expect(other.querySelector('.caret-char')).toBeNull();
  });
});
