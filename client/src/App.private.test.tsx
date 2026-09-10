import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, alice, bob, idle, typing } from './testing/roomFixtures';
import type { FakeWebSocket } from './testing/fakeWebSocket';
import type { RosterEntry } from './protocol';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const carol: RosterEntry = { participantId: 30, handle: 'Carol', color: '#f0f', slot: 2, afk: false };
const three = () => snapshot({ liveLines: [idle(alice), idle(bob), idle(carol)], roster: [alice, bob, carol] });
const privates = (ws: FakeWebSocket) => ws.sent.filter((m) => m.type === 'private');
const committedTexts = () => Array.from(document.querySelectorAll('.committed-line')).map((e) => e.textContent);

async function openTo(handle: string) {
  const user = userEvent.setup();
  const { ws } = await renderJoined(three());
  await screen.findByText('Carol');
  await user.click(screen.getByRole('button', { name: handle }));
  const input = await screen.findByLabelText(`Private message to ${handle}`);
  return { user, ws, input };
}

describe('Sending a private message', () => {
  it('clicking a name opens a focused input right under that entry', async () => {
    const { input } = await openTo('Bob');
    expect(document.activeElement).toBe(input);
    expect(input.closest('.roster-private')?.previousElementSibling?.textContent).toBe('Bob');
    expect(screen.getByRole('button', { name: 'Bob' })).toHaveAttribute('title', 'Send Bob a private message');
  });

  it('clicking your own name opens nothing', async () => {
    const user = userEvent.setup();
    await renderJoined(three());
    await screen.findByText('Carol');
    expect(screen.queryByRole('button', { name: 'Alice' })).toBeNull();
    await user.click(screen.getByText('Alice'));
    expect(screen.queryByLabelText(/Private message to/)).toBeNull();
  });

  it('clicking another name moves the input and keeps the text', async () => {
    const { user, input } = await openTo('Bob');
    await user.type(input, 'lun');
    await user.click(screen.getByRole('button', { name: 'Carol' }));
    const moved = await screen.findByLabelText('Private message to Carol');
    expect(moved).toHaveValue('lun');
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
  });

  it('Enter sends the trimmed text, closes the input, and refocuses the keyboard', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, '  lunch?  {Enter}');
    expect(privates(ws)).toEqual([{ type: 'private', to: 20, text: 'lunch?' }]);
    expect(ws.keys()).toEqual([]);
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.keyboard-capture'));
    expect(committedTexts()).toEqual([]);
  });

  it('Escape closes without sending and refocuses the keyboard', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'never{Escape}');
    expect(privates(ws)).toEqual([]);
    expect(ws.keys()).toEqual([]);
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

  it('the input stays open with its text when the target leaves, so nothing typed goes to the room', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'sec');
    serverSend(ws, { type: 'roster', roster: [alice, carol] });
    expect(await screen.findByText('Bob is not reachable')).toBeInTheDocument();
    const still = screen.getByLabelText('Private message to Bob');
    expect(still).toHaveValue('sec');
    await user.type(still, 'ret');
    expect(still).toHaveValue('secret');
    expect(ws.keys()).toEqual([]);
    await user.keyboard('{Enter}');
    expect(privates(ws)).toEqual([{ type: 'private', to: 20, text: 'secret' }]);
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
  });

  it('Enter while composing with an IME neither sends nor closes', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'こんにち');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(privates(ws)).toEqual([]);
    expect(screen.getByLabelText('Private message to Bob')).toHaveValue('こんにち');
  });

  it('text with a character the room rejects is not sent and the input stays open', async () => {
    const { user, ws, input } = await openTo('Bob');
    fireEvent.change(input, { target: { value: 'a\u0007b' } });
    await user.keyboard('{Enter}');
    expect(privates(ws)).toEqual([]);
    expect(await screen.findByText('That message has a character that cannot be sent')).toBeInTheDocument();
    expect(screen.getByLabelText('Private message to Bob')).toHaveValue('a\u0007b');
  });

  it('while disconnected the text is kept and a notice shows', async () => {
    const { user, ws, input } = await openTo('Bob');
    await user.type(input, 'lunch?');
    act(() => ws.serverClose());
    await user.keyboard('{Enter}');
    expect(privates(ws)).toEqual([]);
    expect(await screen.findByText('Not connected, try again')).toBeInTheDocument();
    expect(screen.getByLabelText('Private message to Bob')).toHaveValue('lunch?');
  });

  it('Escape in the input closes only the input, never a popup', async () => {
    const { user, ws, input } = await openTo('Bob');
    serverSend(ws, { type: 'private', from: 30, handle: 'Carol', color: '#f0f', text: 'psst' });
    await screen.findByText('psst');
    await user.type(input, '{Escape}');
    expect(screen.queryByLabelText('Private message to Bob')).toBeNull();
    expect(screen.getByText('psst')).toBeInTheDocument();
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

describe('Receiving a private message', () => {
  const incoming = (text: string, handle = 'Bob', color = '#0ff', from = 20) =>
    ({ type: 'private' as const, from, handle, color, text });

  it('renders a popup outside the chat area with the sender in color; the transcript is unchanged', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, incoming('lunch?'));
    const text = await screen.findByText('lunch?');
    const popup = text.closest('.private-popup');
    expect(popup).not.toBeNull();
    expect(popup?.closest('#chat-area')).toBeNull();
    expect(popup?.querySelector('.private-from')).toHaveTextContent('Bob');
    expect(popup?.querySelector('.private-from')).toHaveStyle({ color: '#0ff' });
    expect(committedTexts()).toEqual([]);
    expect(document.querySelectorAll('.chat-line').length).toBe(document.querySelectorAll('#chat-area .chat-line').length);
  });

  it('two messages stack in arrival order; click removes one, Escape removes the oldest', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, incoming('first'));
    serverSend(ws, incoming('second', 'Carol', '#f0f', 30));
    await screen.findByText('second');
    expect(Array.from(document.querySelectorAll('.private-text')).map((e) => e.textContent)).toEqual(['first', 'second']);
    await user.click(screen.getByText('second'));
    await waitFor(() => expect(screen.queryByText('second')).toBeNull());
    serverSend(ws, incoming('third', 'Carol', '#f0f', 30));
    await screen.findByText('third');
    await user.click(screen.getByLabelText('Shared chat area'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('first')).toBeNull());
    expect(screen.getByText('third')).toBeInTheDocument();
    expect(ws.keys()).toEqual([]);
  });

  it('a sender who left still shows with the handle and color from the message', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, { type: 'roster', roster: [alice, carol] });
    serverSend(ws, incoming('bye'));
    const popup = (await screen.findByText('bye')).closest('.private-popup');
    expect(popup?.querySelector('.private-from')).toHaveTextContent('Bob');
  });

  it('keeps only the five newest popups', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    for (let i = 1; i <= 7; i++) serverSend(ws, incoming(`m${i}`));
    await screen.findByText('m7');
    expect(Array.from(document.querySelectorAll('.private-text')).map((e) => e.textContent)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('Escape closes an open handle list before it touches a popup', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined(snapshot({ liveLines: [typing(alice, 0, '@'), idle(bob), idle(carol)], roster: [alice, bob, carol] }));
    await screen.findByRole('listbox', { name: 'Handle suggestions' });
    serverSend(ws, incoming('psst'));
    await screen.findByText('psst');
    await user.click(screen.getByLabelText('Shared chat area'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByText('psst')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('psst')).toBeNull());
  });

  it('Escape with the help dialog open closes the help and leaves the popups alone', async () => {
    const user = userEvent.setup();
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, incoming('psst'));
    await screen.findByText('psst');
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await screen.findByRole('dialog', { name: 'help' });
    await user.click(document.querySelector('.help-overlay') as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('psst')).toBeInTheDocument();
  });

  it('ending the session clears the popups', async () => {
    const { ws } = await renderJoined(three());
    await screen.findByText('Carol');
    serverSend(ws, incoming('lunch?'));
    await screen.findByText('lunch?');
    serverSend(ws, { type: 'error', code: 'unknown-participant' });
    await waitFor(() => expect(screen.queryByText('lunch?')).toBeNull());
  });
});
