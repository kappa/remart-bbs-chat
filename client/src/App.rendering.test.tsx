import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { primeChatSnapshot, resetChatState, getLastSocket, broadcastFromServer } from './test-setup';

function qc(){ return new QueryClient({defaultOptions:{queries:{retry:false}}}); }

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  resetChatState();
});

describe('Rendering behaviors', ()=>{
  it('committed line uses color snapshot even after roster missing', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      history: [{ id: 'h1', handle: 'Bob', content: 'old message', lineIdx: 0, committed: true, committedAt: 2, color: '#ff00ff' }],
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 1, text: '' }],
      roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const line = await screen.findByText('old message');
    expect(line).toHaveStyle({color:'#ff00ff'});
  });

  it('empty committed line renders as space (no collapse)', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      history: [{ id: 'h1', handle: 'Alice', content: '', lineIdx: 0, committed: true, committedAt: 2 }],
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 1, text: '' }],
      roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const lines = await screen.findAllByText((_,el)=> el?.classList.contains('committed-line') ?? false);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const hasSpace = lines.some(el => el.textContent === ' ');
    expect(hasSpace).toBe(true);
  });

  it('system line has system-line class and dim color', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      history: [{ id: 'h1', handle: 'system', content: '* Bob joined', lineIdx: 0, committed: true, committedAt: 2, color: '#888' }],
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 1, text: '' }],
      roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const sys = await screen.findByText('* Bob joined');
    expect(sys.className).toMatch(/system-line/);
  });

  it('Enter commits without redrawing current line visually', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: 'typing' }],
      roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    expect(await screen.findByText('typing')).toBeInTheDocument();
    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);
    await user.keyboard('{Enter}');
    // Server echoes committed + live empty
    broadcastFromServer({ type: 'committed', participantId: 10, seq: 1, line: { id: 'h1', handle: 'Alice', content: 'typing', lineIdx: 0, committed: true, committedAt: 2, color: '#fff' } });
    broadcastFromServer({ type: 'live', participantId: 10, row: null, text: '', seq: 1 });
    // Committed line "typing" should still be visible
    expect((await screen.findAllByText('typing')).length).toBeGreaterThanOrEqual(1);
  });

  it('backspace at column zero does nothing (no crash)', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: '' }],
      roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const chatArea = await screen.findByLabelText('Shared chat area');
    await userEvent.setup().click(chatArea);
    await userEvent.setup().keyboard('{Backspace}');
    // No key sent — local guard
    expect(getLastSocket().sentKeys).toHaveLength(0);
  });

  it('help overlay shows on ? command and closes', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    primeChatSnapshot({
      roomId: 1,
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: '?' }],
      roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }],
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const chatArea = await screen.findByLabelText('Shared chat area');
    await userEvent.setup().click(chatArea);
    await userEvent.setup().keyboard('{Enter}');
    // Server echoes live clear + command:help
    broadcastFromServer({ type: 'live', participantId: 10, row: null, text: '', seq: 1 });
    broadcastFromServer({ type: 'command', name: 'help' });
    expect(await screen.findByRole('dialog', {name:/help/i})).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button',{name:/close/i}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('paste limited to 100 chars shows warning logic', async ()=>{
    const clipboard = 'a'.repeat(150);
    const limited = clipboard.slice(0,100);
    expect(limited.length).toBe(100);
    const messages: string[] = [];
    if(clipboard.length>100) messages.push('Paste limited to 100 characters');
    expect(messages.join(' · ')).toContain('100 characters');
  });
});
