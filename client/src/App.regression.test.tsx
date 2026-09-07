import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { api } from './api';
import { renderJoined, serverSend, snapshot, line, alice, bob, idle, typing } from './testing/roomFixtures';

vi.mock('./api', () => ({
  api: { listRooms: vi.fn(), getOrCreateRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(), getRoster: vi.fn() },
  keepaliveApi: { leaveRoom: vi.fn() },
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); (api.listRooms as any).mockResolvedValue({ rooms: [] }); });

const orders = () => Array.from(document.querySelectorAll('[data-document-order]')).map((el) => Number(el.getAttribute('data-document-order')));

describe('Transcript regressions', () => {
  it('an idle participant has no shared row; the local preview sits below', async () => {
    await renderJoined(snapshot({ liveLines: [idle(alice), typing(bob, 1, 'B')], roster: [alice, bob], committed: [line('c0', 0, 'first', bob)] }));
    await screen.findByText('B');
    expect(orders()).toEqual([0, 1]);
    expect(document.querySelector('.local-cursor-preview')).not.toBeNull();
  });

  it('a live line backspaced to empty keeps its row and position', async () => {
    const { ws } = await renderJoined(snapshot({ liveLines: [typing(alice, 1, 'ab'), idle(bob)], roster: [alice, bob], committed: [line('c0', 0, 'top', bob)] }));
    await screen.findByText('ab');
    serverSend(ws, { type: 'live', participantId: 10, row: 1, text: '', seq: 1 });
    serverSend(ws, { type: 'committed', participantId: null, seq: null, line: line('c2', 2, 'later', bob) });
    await screen.findByText('later');
    expect(orders()).toEqual([0, 1, 2]);
    expect(document.querySelector('.live-line')).toHaveAttribute('data-document-order', '1');
  });

  it('scrollback survives a truncated reconnect snapshot', async () => {
    const { ws } = await renderJoined(snapshot({ committed: [line('a', 0, 'one'), line('b', 1, 'two'), line('c', 2, 'three')] }));
    await screen.findByText('three');
    serverSend(ws, snapshot({ committed: [line('c', 2, 'three')] }));
    await waitFor(() => {
      expect(screen.getByText('one')).toBeInTheDocument();
      expect(screen.getByText('two')).toBeInTheDocument();
    });
  });

  it('a reader scrolled up is not yanked down by new lines; a reader at the bottom follows', async () => {
    const { ws } = await renderJoined(snapshot({ committed: [line('a', 0, 'one')] }));
    const chat = await screen.findByLabelText('Shared chat area');
    Object.defineProperty(chat, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(chat, 'clientHeight', { configurable: true, value: 100 });
    chat.scrollTop = 0;
    fireEvent.scroll(chat);
    serverSend(ws, { type: 'committed', participantId: null, seq: null, line: line('b', 1, 'two') });
    await screen.findByText('two');
    expect(chat.scrollTop).toBe(0);
    chat.scrollTop = 900;
    fireEvent.scroll(chat);
    serverSend(ws, { type: 'committed', participantId: null, seq: null, line: line('c', 2, 'three') });
    await screen.findByText('three');
    expect(chat.scrollTop).toBe(1000);
  });

  it('switching sessions resets the transcript', async () => {
    const { ws, unmount } = await renderJoined(snapshot({ committed: [line('a', 0, 'first room')] }));
    await screen.findByText('first room');
    unmount();
    expect(ws.readyState).toBe(3);
    const second = await renderJoined(snapshot({ roomId: 2, committed: [line('z', 0, 'second room')] }));
    await screen.findByText('second room');
    expect(screen.queryByText('first room')).not.toBeInTheDocument();
    second.unmount();
  });
});

describe('Visual viewport (task 19)', () => {
  // Minimal stand-in for window.visualViewport: records listeners so tests
  // can fire resize/scroll and assert they are detached on unmount.
  function stubVisualViewport() {
    const listeners = new Map<string, Set<() => void>>();
    const vv = {
      height: 800,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners.get(type)?.delete(fn);
      },
    };
    (window as any).visualViewport = vv;
    const fire = (type: 'resize' | 'scroll') =>
      act(() => { for (const fn of listeners.get(type) ?? []) fn(); });
    const listenerCount = (type: string) => (listeners.get(type)?.size ?? 0);
    return { fire, listenerCount };
  }

  const container = () => document.querySelector<HTMLElement>('#container')!;

  function fakeChatScroll(chat: HTMLElement, scrollHeight: number) {
    Object.defineProperty(chat, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(chat, 'clientHeight', { configurable: true, value: 100 });
  }

  it('uses the current viewport when joining with the keyboard already open', async () => {
    stubVisualViewport();
    (window as any).visualViewport.height = 400;
    (window as any).visualViewport.offsetTop = 120;
    const { unmount } = await renderJoined();
    try {
      expect(container().style.getPropertyValue('--app-height')).toBe('400px');
      expect(container().style.getPropertyValue('--app-offset')).toBe('120px');
    } finally {
      unmount();
      delete (window as any).visualViewport;
    }
  });

  it('a viewport resize writes --app-height/--app-offset and keeps a bottom reader at the bottom', async () => {
    const { fire, listenerCount } = stubVisualViewport();
    const { unmount } = await renderJoined(snapshot({ committed: [line('a', 0, 'one')] }));
    const chat = await screen.findByLabelText('Shared chat area');
    fakeChatScroll(chat, 1000);
    chat.scrollTop = 900; // within 80px of the bottom
    fireEvent.scroll(chat);

    (window as any).visualViewport.height = 400;
    (window as any).visualViewport.offsetTop = 120;
    fire('resize');

    expect(container().style.getPropertyValue('--app-height')).toBe('400px');
    expect(container().style.getPropertyValue('--app-offset')).toBe('120px');
    expect(chat.scrollTop).toBe(1000);

    unmount();
    expect(listenerCount('resize')).toBe(0);
    expect(listenerCount('scroll')).toBe(0);
    delete (window as any).visualViewport;
  });

  it('a viewport resize does not move a reader who scrolled up', async () => {
    const { fire } = stubVisualViewport();
    await renderJoined(snapshot({ committed: [line('a', 0, 'one')] }));
    const chat = await screen.findByLabelText('Shared chat area');
    fakeChatScroll(chat, 1000);
    chat.scrollTop = 0;
    fireEvent.scroll(chat);

    (window as any).visualViewport.height = 400;
    (window as any).visualViewport.offsetTop = 120;
    fire('resize');

    expect(chat.scrollTop).toBe(0);
    expect(container().style.getPropertyValue('--app-height')).toBe('400px');
    delete (window as any).visualViewport;
  });
});
