import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, alice, bob, idle, typing } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
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

  it('Help opens the overlay with corrected command descriptions', async () => {
    const user = userEvent.setup();
    await renderJoined();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByText('CHAT COMMANDS')).toBeInTheDocument();
    // Enter sends the current line, does not assign a new empty line
    expect(screen.getByText('send the current line')).toBeInTheDocument();
    expect(screen.queryByText('assign a new empty line')).toBeNull();
    // Backspace removes one code point; caret movement keys are summarized
    expect(screen.getByText('remove one code point')).toBeInTheDocument();
    expect(screen.getByText('remove one code point after caret')).toBeInTheDocument();
    // Unicode and no-line-limit facts retained
    expect(screen.getByText('Unicode supported, including Cyrillic. No character limit.')).toBeInTheDocument();
    // Per-tab testing paragraph removed
    expect(screen.queryByText('For per-tab testing')).toBeNull();
    // l and q descriptions corrected
    expect(screen.getByText('refresh roster')).toBeInTheDocument();
    expect(screen.getByText('leave room')).toBeInTheDocument();
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

  it('a newcomer rotates "<handle> joined" through the title for five seconds', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    vi.useFakeTimers();
    try {
      serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(document.title).toBe('Carol joined');
      vi.advanceTimersByTime(400);
      const first = document.title;
      expect(first).not.toBe('Carol joined');
      vi.advanceTimersByTime(400);
      expect(document.title).not.toBe(first);
      expect(document.title).not.toBe('Remart BBS Chat');
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(400);
        expect(document.title).not.toMatch(/joined\S/);
      }
      vi.advanceTimersByTime(5000);
      expect(document.title).toBe('Remart BBS Chat');
    } finally {
      vi.useRealTimers();
    }
  });

  it('no title notice for the own join, the first snapshot, or a reconnect replay', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    vi.useFakeTimers();
    try {
      expect(document.title).not.toContain('joined');
      serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(document.title).toBe('Carol joined');
      vi.advanceTimersByTime(5000);
      expect(document.title).toBe('Remart BBS Chat');
      serverSend(ws, snapshot({ liveLines: [idle(alice), idle(bob), idle(carol)], roster: [alice, bob, carol] }));
      vi.advanceTimersByTime(1000);
      expect(document.title).toBe('Remart BBS Chat');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a later join replaces the current title notice', async () => {
    const dave = { participantId: 40, handle: 'Dave', color: '#0f0', slot: 3 };
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    vi.useFakeTimers();
    try {
      serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(document.title).toBe('Carol joined');
      vi.advanceTimersByTime(400);
      serverSend(ws, { type: 'roster', roster: [alice, bob, carol, dave] });
      expect(document.title).toBe('Dave joined');
      vi.advanceTimersByTime(5000);
      expect(document.title).toBe('Remart BBS Chat');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaving mid-notice restores the base title', async () => {
    (api.leaveRoom as any).mockResolvedValue({ freed: true });
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    vi.useFakeTimers();
    try {
      serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(document.title).toBe('Carol joined');
      fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
      await act(async () => {});
      expect(document.title).toBe('Remart BBS Chat');
      vi.advanceTimersByTime(6000);
      expect(document.title).toBe('Remart BBS Chat');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rotates an emoji handle by code point without splitting surrogates', async () => {
    const emoji = { participantId: 50, handle: 'Bo😀b', color: '#ff0', slot: 4 };
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    vi.useFakeTimers();
    try {
      serverSend(ws, { type: 'roster', roster: [alice, bob, emoji] });
      expect(document.title).toBe('Bo😀b joined');
      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(400);
        expect(document.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmounting restores the base title', async () => {
    const { ws, unmount } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
    vi.useFakeTimers();
    try {
      serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(document.title).toBe('Carol joined');
      unmount();
      expect(document.title).toBe('Remart BBS Chat');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the title notice works when sound is unavailable', async () => {
    const audio = (globalThis as any).AudioContext;
    const webkit = (globalThis as any).webkitAudioContext;
    delete (globalThis as any).AudioContext;
    delete (globalThis as any).webkitAudioContext;
    try {
      const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
      vi.useFakeTimers();
      try {
        serverSend(ws, { type: 'roster', roster: [alice, bob, carol] });
        expect(document.title).toBe('Carol joined');
      } finally {
        vi.useRealTimers();
      }
    } finally {
      (globalThis as any).AudioContext = audio;
      (globalThis as any).webkitAudioContext = webkit;
    }
  });

  it('the join-sound switch gates the chirp and persists across reloads', async () => {
    const spy = vi.spyOn(globalThis as any, 'AudioContext');
    try {
      localStorage.setItem('remart-bbs-chat.sound', 'off');
      const first = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
      expect(screen.getByRole('checkbox', { name: 'Join sound' })).not.toBeChecked();
      serverSend(first.ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(spy).not.toHaveBeenCalled();
      first.unmount();
      localStorage.setItem('remart-bbs-chat.sound', 'on');
      const second = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
      expect(screen.getByRole('checkbox', { name: 'Join sound' })).toBeChecked();
      serverSend(second.ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(spy).toHaveBeenCalledTimes(1);
      second.unmount();
    } finally {
      spy.mockRestore();
    }
  });

  it('a mid-session toggle takes effect at once; the title still fires; a remount keeps it', async () => {
    const spy = vi.spyOn(globalThis as any, 'AudioContext');
    const user = userEvent.setup();
    try {
      const first = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
      await user.click(screen.getByRole('checkbox', { name: 'Join sound' }));
      serverSend(first.ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(spy).not.toHaveBeenCalled();
      expect(document.title).toBe('Carol joined');
      first.unmount();
      const second = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] }));
      expect(screen.getByRole('checkbox', { name: 'Join sound' })).not.toBeChecked();
      serverSend(second.ws, { type: 'roster', roster: [alice, bob, carol] });
      expect(spy).not.toHaveBeenCalled();
      await user.click(screen.getByRole('checkbox', { name: 'Join sound' }));
      const dave = { participantId: 40, handle: 'Dave', color: '#0f0', slot: 3 };
      serverSend(second.ws, { type: 'roster', roster: [alice, bob, carol, dave] });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('toggling the join-sound switch stores the choice', async () => {
    const user = userEvent.setup();
    await renderJoined();
    const box = screen.getByRole('checkbox', { name: 'Join sound' });
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(localStorage.getItem('remart-bbs-chat.sound')).toBe('off');
    await user.click(box);
    expect(box).toBeChecked();
    expect(localStorage.getItem('remart-bbs-chat.sound')).toBe('on');
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
