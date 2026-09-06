import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { primeChatSnapshot, resetChatState, getLastSocket, broadcastFromServer } from './test-setup';

function qc(){ return new QueryClient({defaultOptions:{queries:{retry:false, gcTime:0}}}); }

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  resetChatState();
});

describe('Enter buffer separation - typing during pending commit', ()=>{
  it('after Enter, typing B shows B only, not HiB, and Hi remains visible as committed', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    // Initial state: Hi typed, activeContent Hi (nextSeq 3 — two chars sent already).
    primeChatSnapshot({
      roomId: 1,
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: 'Hi' }],
      roster: [{ handle: 'Alice', color: '#fff', slot: 0 }],
    });

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);

    expect(await screen.findByText('Hi')).toBeInTheDocument();

    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);

    await user.keyboard('{Enter}');
    // After Enter, server sends committed{lineIdx:0, content:Hi} then live{row:null, text:''}
    const ws = getLastSocket();
    expect(ws.sentKeys[ws.sentKeys.length-1]).toMatchObject({ kind: 'enter', seq: 1 });

    // Wait for committed echo: Hi should still be visible as committed
    await waitFor(() => {
      broadcastFromServer({
        type: 'committed', participantId: 10, seq: 1,
        line: { id: 'h1', handle: 'Alice', content: 'Hi', lineIdx: 0, committed: true, committedAt: 2, color: '#fff' },
      });
      broadcastFromServer({ type: 'live', participantId: 10, row: null, text: '', seq: 1 });
    });
    expect(await screen.findByText('Hi')).toBeInTheDocument();

    // Now type B before commit response
    await user.keyboard('B');
    await waitFor(() => {
      // After typing B, server should echo live with row and text
      broadcastFromServer({ type: 'live', participantId: 10, row: 1, text: 'B', seq: 2 });
    });
    // Active line should now show B (the rendered active line is from server echo)
    await waitFor(() => {
      const activeLines = document.querySelectorAll('.active-line');
      const ownActive = Array.from(activeLines).find(el => el.textContent?.includes('B'));
      expect(ownActive).toBeTruthy();
      expect(ownActive?.textContent).not.toContain('HiB');
    });
  });

  it('seq increments for each op and sends with char', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: null, text: '' }],
      roster: [{ handle: 'Alice', color: '#fff', slot: 0 }],
    });

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);
    await user.keyboard('a');
    await user.keyboard('b');
    // Server should receive keys with seq 1 and 2
    await waitFor(() => {
      const ws = getLastSocket();
      expect(ws.sentKeys.length).toBeGreaterThanOrEqual(2);
      expect(ws.sentKeys[0]).toMatchObject({ kind: 'char', char: 'a', seq: 1 });
      expect(ws.sentKeys[1]).toMatchObject({ kind: 'char', char: 'b', seq: 2 });
    });
  });
});
