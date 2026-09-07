import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

  it('a newcomer plays the join chirp; the first snapshot does not', async () => {
    const spy = vi.spyOn(globalThis as any, 'AudioContext');
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    expect(spy).not.toHaveBeenCalled();
    serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
