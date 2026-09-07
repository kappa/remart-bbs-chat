import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, alice, bob, idle, typing } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
  keepaliveApi: { leaveRoom: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const carol = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2 };

describe('Roster', () => {
  it('lists participants by slot with color dots', async () => {
    await renderJoined(snapshot({ liveLines: [idle(carol), idle(alice), idle(bob)], roster: [carol, alice, bob] }));
    expect(await screen.findByText('PARTICIPANTS')).toBeInTheDocument();
    const entries = document.querySelectorAll('.roster-entry');
    expect(Array.from(entries).map((e) => e.textContent)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(document.querySelectorAll('.roster-color-dot').length).toBe(3);
  });

  it('a roster message adds and removes people', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    await screen.findByText('Bob');
    serverSend(ws, { type: 'roster', roster: [alice, carol] });
    expect(await screen.findByText('Carol')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('no character count appears in the sidebar while typing', async () => {
    await renderJoined(snapshot({ liveLines: [typing(alice, 0, 'hello')] }));
    expect(await screen.findByText('hello')).toBeInTheDocument();
    expect(screen.queryByText(/chars/)).toBeNull();
  });

  it('the sidebar offers Type, Help, and Leave with no single-key command buttons', async () => {
    await renderJoined();
    expect(screen.getByRole('button', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
    expect(screen.queryByText('[l]')).toBeNull();
    expect(screen.queryByText('[?]')).toBeNull();
    expect(screen.queryByText('[q]')).toBeNull();
  });

  it('Help opens the overlay; Escape and Close dismiss it', async () => {
    const user = userEvent.setup();
    await renderJoined();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByText('CHAT COMMANDS')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('CHAT COMMANDS')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByText('CHAT COMMANDS')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('CHAT COMMANDS')).toBeNull();
  });

  it('a typed ? reaches the server and its help command opens the overlay', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined();
    await user.click(await screen.findByLabelText('Shared chat area'));
    await user.keyboard('?{Enter}');
    expect(ws.keys().map((k) => [k.kind, k.char ?? ''])).toEqual([['char', '?'], ['enter', '']]);
    serverSend(ws, { type: 'command', name: 'help' });
    expect(await screen.findByText('CHAT COMMANDS')).toBeInTheDocument();
  });

  it('the sidebar links to the issue form without disturbing the session', async () => {
    const user = userEvent.setup();
    await renderJoined();
    const link = screen.getByRole('link', { name: 'Report a problem' });
    expect(link).toHaveAttribute('href', 'https://github.com/kappa/remart-bbs-chat/issues/new');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await user.click(screen.getByRole('button', { name: 'Type' }));
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
    await user.click(link);
    expect(document.activeElement).not.toBe(document.querySelector('.keyboard-capture'));
  });

  it('a newcomer plays the join chirp; the first snapshot does not', async () => {
    const spy = vi.spyOn(globalThis as any, 'AudioContext');
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    expect(spy).not.toHaveBeenCalled();
    serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
