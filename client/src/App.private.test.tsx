import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, alice, bob, idle } from './testing/roomFixtures';
import type { RosterEntry } from './protocol';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const carol: RosterEntry = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2, afk: false };
const three = () => snapshot({ liveLines: [idle(alice), idle(bob), idle(carol)], roster: [alice, bob, carol] });
const privates = (ws: any) => ws.sent.filter((m: any) => m.type === 'private');
const committedTexts = () => Array.from(document.querySelectorAll('.committed-line')).map((e) => e.textContent);

async function openTo(handle: string) {
  const user = userEvent.setup();
  const { ws } = await renderJoined(three());
  await screen.findByText('Carol');
  await user.click(screen.getByRole('button', { name: `Message ${handle}` }));
  const input = await screen.findByLabelText(`Private message to ${handle}`);
  return { user, ws, input };
}

describe('Sending a private message', () => {
  it('clicking a name opens a focused input under that entry', async () => {
    const { input } = await openTo('Bob');
    expect(document.activeElement).toBe(input);
    expect(input.closest('.roster-entry-block')?.querySelector('.roster-handle')?.textContent).toBe('Bob');
  });

  it('clicking your own name opens nothing', async () => {
    const user = userEvent.setup();
    await renderJoined(three());
    await screen.findByText('Carol');
    expect(screen.queryByRole('button', { name: 'Message Alice' })).toBeNull();
    await user.click(screen.getByText('Alice'));
    expect(screen.queryByLabelText(/Private message to/)).toBeNull();
  });

  it('clicking another name moves the input and keeps the text', async () => {
    const { user, input } = await openTo('Bob');
    await user.type(input, 'lun');
    await user.click(screen.getByRole('button', { name: 'Message Carol' }));
    const moved = await screen.findByLabelText('Private message to Carol');
    expect(moved).toHaveValue('lun');
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
  });

  it('Enter sends the trimmed text, closes the input, and refocuses the keyboard', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, '  lunch?  {Enter}');
    expect(privates(ws)).toEqual([{ type: 'private', to: 20, text: 'lunch?' }]);
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
    expect(committedTexts()).toEqual([]);
  });

  it('Escape closes without sending and refocuses the keyboard', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'never{Escape}');
    expect(privates(ws)).toEqual([]);
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
  });

  it('Enter on empty text closes without sending', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, '   {Enter}');
    expect(privates(ws)).toEqual([]);
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
  });

  it('text over 200 code points is not sent and a warning shows', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'x'.repeat(201));
    await user.keyboard('{Enter}');
    expect(privates(ws)).toEqual([]);
    expect(await screen.findByText('Private messages are limited to 200 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Private message to Bob')).toHaveValue('x'.repeat(201));
  });

  it('keys typed in the private input never become chat keystrokes', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'abc');
    expect(ws.keys()).toEqual([]);
  });

  it('the input closes with a warning when the target leaves', async () => {
    const { ws } = await openTo('Bob');
    serverSend(ws, { type: 'roster', roster: [alice, carol] });
    await waitFor(() => expect(screen.queryByLabelText('Private message to Bob')).toBeNull());
    expect(await screen.findByText('Bob is not reachable')).toBeInTheDocument();
  });
});

describe('Sender feedback', () => {
  it('private-sent shows "sent to Bob"', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, { type: 'private-sent', to: 20, handle: 'Bob' });
    expect(await screen.findByText('sent to Bob')).toBeInTheDocument();
  });

  it('unknown-recipient shows the handle when known, "not delivered" otherwise', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, { type: 'error', code: 'unknown-recipient', to: 30 });
    expect(await screen.findByText('Carol is not reachable')).toBeInTheDocument();
    serverSend(ws, { type: 'error', code: 'unknown-recipient', to: 999 });
    expect(await screen.findByText('not delivered')).toBeInTheDocument();
    expect(screen.getByLabelText('Shared chat area')).toBeInTheDocument();
  });
});
