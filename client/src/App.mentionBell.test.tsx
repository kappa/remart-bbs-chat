import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from './api';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
}));

const { notify, stop } = vi.hoisted(() => ({ notify: vi.fn(), stop: vi.fn() }));
vi.mock('./notifications', () => ({
  createNotifier: () => ({ notify, stop }),
  titleChannel: () => ({ notify() {}, stop() {} }),
  soundChannel: () => ({ notify() {}, stop() {} }),
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const two = () => snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob] });
const committed = (ws: any, id: string, text: string, participantId: number | null = 20, author = bob) =>
  serverSend(ws, { type: 'committed', participantId, seq: participantId == null ? null : 1, line: line(id, 5, text, author) });

describe('Mention bell', () => {
  it('a new committed line by someone else that mentions you notifies once', async () => {
    const { ws } = await renderJoined(two());
    await screen.findByText('Bob');
    committed(ws, 'c1', 'hi @alice');
    await screen.findByText('hi @alice');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ kind: 'mention', handle: 'Bob', text: 'hi @alice' });
    committed(ws, 'c1', 'hi @alice');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not notify for lines mentioning someone else, your own lines, or snapshot lines', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [idle(alice), idle(bob)], roster: [alice, bob], committed: [line('old', 0, 'earlier @Alice', bob)] }));
    await screen.findByText('earlier @Alice');
    committed(ws, 'c2', 'hey @Bob');
    committed(ws, 'c3', 'note to self @Alice', 10, alice);
    await screen.findByText('note to self @Alice');
    expect(notify).not.toHaveBeenCalled();
  });

  it('a preserved line from someone who left still notifies', async () => {
    const { ws } = await renderJoined(two());
    await screen.findByText('Bob');
    committed(ws, 'c4', 'bye @Alice', null);
    await screen.findByText('bye @Alice');
    expect(notify).toHaveBeenCalledWith({ kind: 'mention', handle: 'Bob', text: 'bye @Alice' });
  });

  it('a newcomer still notifies a join and leaving stops the notifier', async () => {
    const user = userEvent.setup();
    (api.leaveRoom as any).mockResolvedValue({});
    const { ws } = await renderJoined();
    serverSend(ws, { type: 'roster', roster: [alice, bob] });
    await screen.findByText('Bob');
    expect(notify).toHaveBeenCalledWith({ kind: 'join', handle: 'Bob' });
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });
});
