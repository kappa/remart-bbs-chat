import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { primeChatSnapshot, resetChatState, getLastSocket, broadcastFromServer } from './test-setup';

function qc(){
  return new QueryClient({defaultOptions:{queries:{retry:false}}});
}

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  resetChatState();
});

describe('Roster rendering', ()=>{
  it('shows roster sorted by lineSlot with color dots', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      liveLines: [
        { participantId: 11, handle: 'Bob', color: '#00ff00', slot: 2, row: 2, text: 'hi' },
        { participantId: 10, handle: 'Alice', color: '#ff0000', slot: 0, row: 0, text: '' },
        { participantId: 12, handle: 'Carol', color: '#0000ff', slot: 1, row: 1, text: 'yo' },
      ],
      roster: [
        { handle: 'Alice', color: '#ff0000', lineSlot: 0 },
        { handle: 'Carol', color: '#0000ff', lineSlot: 1 },
        { handle: 'Bob', color: '#00ff00', lineSlot: 2 },
      ],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    expect(await screen.findByText('PARTICIPANTS')).toBeInTheDocument();
    await waitFor(() => {
      const rosterEntries = document.querySelectorAll('.roster-entry');
      expect(rosterEntries.length).toBe(3);
      expect(rosterEntries[0].textContent).toContain('Alice');
      const dots = document.querySelectorAll('.roster-color-dot');
      expect(dots.length).toBe(3);
    });
  });

  it('char counter shows current content length', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: 'hello' }],
      roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    expect(await screen.findByText('5 chars')).toBeInTheDocument();
  });

  it('caret only for own participant', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      liveLines: [
        { participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: 'a' },
        { participantId: 11, handle: 'Bob', color: '#0f0', slot: 1, row: 1, text: 'b' },
      ],
      roster: [
        { handle: 'Alice', color: '#fff', lineSlot: 0 },
        { handle: 'Bob', color: '#0f0', lineSlot: 1 },
      ],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const carets = await screen.findAllByLabelText(/your typing position/i);
    expect(carets.length).toBe(1);
  });
});
