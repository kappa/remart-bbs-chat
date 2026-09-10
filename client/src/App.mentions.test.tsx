import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, alice, bob, idle } from './testing/roomFixtures';
import type { RosterEntry } from './protocol';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const carol: RosterEntry = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2 };
const three = () => snapshot({ liveLines: [idle(alice), idle(bob), idle(carol)], roster: [alice, bob, carol] });

// The server echoes Alice's live line; the list follows the echo only.
const echo = (ws: any, text: string, seq = 1) =>
  serverSend(ws, { type: 'live', participantId: 10, row: 0, text, caret: Array.from(text).length, seq });

const sentKeys = (ws: any) => ws.keys().map((k: any) => [k.seq, k.kind, k.char ?? '']);

async function typingAt(text: string) {
  const user = userEvent.setup();
  const { ws } = await renderJoined(three());
  await screen.findByText('Carol');
  await user.click(await screen.findByLabelText('Shared chat area'));
  echo(ws, text);
  return { user, ws };
}

describe('Handle autocomplete keys', () => {
  it('Tab after an echoed @c sends only the completion keystrokes and keeps focus', async () => {
    const { user, ws } = await typingAt('@c');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'a'], [2, 'char', 'r'], [3, 'char', 'o'], [4, 'char', 'l']]);
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
  });

  it('Enter with the list open sends the completion and no enter keystroke', async () => {
    const { user, ws } = await typingAt('hi @b');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'o'], [2, 'char', 'b']]);
  });

  it('Enter with the list closed commits the line', async () => {
    const { user, ws } = await typingAt('hi @x');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
  });

  it('Enter on a token that already spells the handle sends nothing; the next Enter commits', async () => {
    const { user, ws } = await typingAt('@carol');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([]);
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
  });

  it('Escape dismisses the current token; Enter then commits; a new @ token is live again', async () => {
    const { user, ws } = await typingAt('@c');
    await user.keyboard('{Escape}');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
    echo(ws, '@c x @', 2);
    await user.keyboard('{Tab}');
    expect(sentKeys(ws).slice(1)).toEqual([[2, 'char', 'B'], [3, 'char', 'o'], [4, 'char', 'b']]);
  });

  it('Down wraps through the candidates and Up comes back', async () => {
    const { user, ws } = await typingAt('@');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'C'], [2, 'char', 'a'], [3, 'char', 'r'], [4, 'char', 'o'], [5, 'char', 'l']]);
  });

  it('Down twice wraps back to the first candidate', async () => {
    const { user, ws } = await typingAt('@');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'B'], [2, 'char', 'o'], [3, 'char', 'b']]);
  });

  it('Up from the first candidate wraps to the last', async () => {
    const { user, ws } = await typingAt('@');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)[0]).toEqual([1, 'char', 'C']);
  });

  it('a keystroke with no echo yet leaves the list unchanged until the echo arrives', async () => {
    const { user, ws } = await typingAt('@');
    await user.keyboard('c');
    await user.keyboard('{Tab}');
    expect(sentKeys(ws)).toEqual([[1, 'char', 'c'], [2, 'char', 'B'], [3, 'char', 'o'], [4, 'char', 'b']]);
  });

  it('Backspace echo that restores a match reopens the list', async () => {
    const { user, ws } = await typingAt('@x');
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
    echo(ws, '@', 2);
    await user.keyboard('{Tab}');
    expect(sentKeys(ws).slice(1)).toEqual([[2, 'char', 'B'], [3, 'char', 'o'], [4, 'char', 'b']]);
  });

  it('a roster change updates the candidates', async () => {
    const { user, ws } = await typingAt('@c');
    serverSend(ws, { type: 'roster', roster: [alice, bob] });
    await user.keyboard('{Enter}');
    expect(sentKeys(ws)).toEqual([[1, 'enter', '']]);
  });

  it('a phone Enter (insertLineBreak) picks when the list is open', async () => {
    const { ws } = await typingAt('@c');
    const textarea = document.querySelector('.keyboard-capture') as HTMLTextAreaElement;
    textarea.focus();
    const event = new InputEvent('input', { inputType: 'insertLineBreak', bubbles: true });
    act(() => textarea.dispatchEvent(event));
    expect(sentKeys(ws)).toEqual([[1, 'char', 'a'], [2, 'char', 'r'], [3, 'char', 'o'], [4, 'char', 'l']]);
  });
});

describe('Handle autocomplete list', () => {
  it('opens on an echoed @ with the other participants in roster order and highlights the first', async () => {
    const { ws } = await typingAt('@');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['> Bob', '  Carol']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveStyle({ color: '#f0f' });
    echo(ws, '@c', 2);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['> Carol']);
    echo(ws, '@x', 3);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the list sits inside the own live line after the caret', async () => {
    await typingAt('@');
    const listbox = await screen.findByRole('listbox');
    expect(listbox.closest('.live-line')).not.toBeNull();
    expect(listbox.parentElement).toHaveClass('mention-anchor');
  });

  it('Down moves the highlight', async () => {
    const { user } = await typingAt('@');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}');
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['  Bob', '> Carol']);
  });

  it('clicking an entry picks it and keeps keyboard focus', async () => {
    const { user, ws } = await typingAt('@');
    await user.click(await screen.findByRole('option', { name: /Carol/ }));
    expect(sentKeys(ws)).toEqual([[1, 'char', 'C'], [2, 'char', 'a'], [3, 'char', 'r'], [4, 'char', 'o'], [5, 'char', 'l']]);
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
  });

  it('is absent for another participant\'s live line', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, { type: 'live', participantId: 20, row: 0, text: '@', caret: 1, seq: 1 });
    await screen.findByText('@');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Help dialog', () => {
  it('lists the @ autocomplete keys', async () => {
    const user = userEvent.setup();
    await renderJoined();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByText('@')).toBeInTheDocument();
    expect(screen.getByText(/Up\/Down choose, Tab or Enter insert, Escape closes/)).toBeInTheDocument();
  });
});
