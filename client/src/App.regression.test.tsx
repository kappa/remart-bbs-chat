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

describe('Regression: A Enter B Backspace C without pausing, other participant untouched', ()=>{
  it('A stays committed, new active is C only, B and deletion distinct, other line untouched, no wait for Enter ack', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    // Initial: Alice has typed A, Bob has X
    primeChatSnapshot({
      roomId: 1,
      liveLines: [
        { participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: 'A' },
        { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1, row: 1, text: 'X' },
      ],
      roster: [
        { handle: 'Alice', color: '#fff', lineSlot: 0 },
        { handle: 'Bob', color: '#0ff', lineSlot: 1 },
      ],
    });

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);

    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(await screen.findByText('X')).toBeInTheDocument();

    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);

    // Press Enter (A -> commit), without waiting for ack, type B, Backspace, C rapidly
    await user.keyboard('{Enter}');
    await user.keyboard('B');
    await user.keyboard('{Backspace}');
    await user.keyboard('C');

    // Server echo: Enter -> committed+live(empty); B -> live{row:1,text:B}; Backspace -> live{row:1,text:''}; C -> live{row:1,text:C}
    broadcastFromServer({ type: 'committed', participantId: 10, seq: 1, line: { id: 'h1', handle: 'Alice', content: 'A', lineIdx: 0, committed: true, committedAt: 2, color: '#fff' } });
    broadcastFromServer({ type: 'live', participantId: 10, row: null, text: '', seq: 1 });
    broadcastFromServer({ type: 'live', participantId: 10, row: 1, text: 'B', seq: 2 });
    broadcastFromServer({ type: 'live', participantId: 10, row: 1, text: '', seq: 3 });
    broadcastFromServer({ type: 'live', participantId: 10, row: 1, text: 'C', seq: 4 });

    await waitFor(()=>{
      // Active line should contain only C, not B
      const activeLines = document.querySelectorAll('.active-line');
      const aliceActive = Array.from(activeLines).find(el=> el.textContent?.includes('C'));
      expect(aliceActive).toBeTruthy();
      const text = aliceActive?.textContent || '';
      expect(text).toContain('C');
      expect(text.trim()).not.toBe('B');
    });

    // Bob's line must remain untouched (still X)
    await waitFor(()=>{
      const bobLine = screen.getByText('X');
      expect(bobLine).toBeInTheDocument();
      const allActive = document.querySelectorAll('.active-line');
      const bobActive = Array.from(allActive).find(el=> el.textContent?.includes('X'));
      expect(bobActive).toBeTruthy();
      expect(bobActive?.textContent).not.toContain('C');
      expect(bobActive?.textContent).not.toContain('A');
    });

    // The order of keys: Enter, B, Backspace, C
    await waitFor(()=>{
      const ws = getLastSocket();
      expect(ws.sentKeys.length).toBeGreaterThanOrEqual(4);
      expect(ws.sentKeys[0]).toMatchObject({ kind: 'enter', seq: 1 });
      expect(ws.sentKeys[1]).toMatchObject({ kind: 'char', char: 'B', seq: 2 });
      expect(ws.sentKeys[2]).toMatchObject({ kind: 'backspace', seq: 3 });
      expect(ws.sentKeys[3]).toMatchObject({ kind: 'char', char: 'C', seq: 4 });
    });
  });

  it('documentLines orders committed A before new active C even before server ack (provisional ordering)', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    primeChatSnapshot({
      roomId: 1,
      liveLines: [
        { participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: 'A' },
        { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1, row: 5, text: 'BobLine' },
      ],
      roster: [
        { handle: 'Alice', color: '#fff', lineSlot: 0 },
        { handle: 'Bob', color: '#0ff', lineSlot: 1 },
      ],
    });

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    expect(await screen.findByText('A')).toBeInTheDocument();

    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);
    await user.keyboard('{Enter}');
    await user.keyboard('B');
    await user.keyboard('{Backspace}');
    await user.keyboard('C');

    broadcastFromServer({ type: 'committed', participantId: 10, seq: 1, line: { id: 'h1', handle: 'Alice', content: 'A', lineIdx: 0, committed: true, committedAt: 2, color: '#fff' } });
    broadcastFromServer({ type: 'live', participantId: 10, row: null, text: '', seq: 1 });
    broadcastFromServer({ type: 'live', participantId: 10, row: 1, text: 'B', seq: 2 });
    broadcastFromServer({ type: 'live', participantId: 10, row: 1, text: '', seq: 3 });
    broadcastFromServer({ type: 'live', participantId: 10, row: 1, text: 'C', seq: 4 });

    await waitFor(()=>{
      const lines = Array.from(document.querySelectorAll('.chat-line'));
      const aIndex = lines.findIndex(el=> el.textContent === 'A');
      const cIndex = lines.findIndex(el=> el.textContent?.includes('C') && el.classList.contains('active-line'));
      expect(aIndex).toBeGreaterThanOrEqual(0);
      expect(cIndex).toBeGreaterThanOrEqual(0);
      expect(aIndex).toBeLessThan(cIndex);
    });
  });

  it('idle participant renders no shared row; local cursor preview only; B lines appear directly below', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    primeChatSnapshot({
      roomId: 1,
      liveLines: [{ participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: 0, text: 'Hi' }],
      roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }],
    });

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    expect(await screen.findByText('Hi')).toBeInTheDocument();

    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);
    await user.keyboard('{Enter}');

    // After Enter with no further typing: Alice is idle — no shared active row,
    // only the local cursor preview on her own client.
    broadcastFromServer({ type: 'committed', participantId: 10, seq: 1, line: { id: 'h1', handle: 'Alice', content: 'Hi', lineIdx: 0, committed: true, committedAt: 2, color: '#fff' } });
    broadcastFromServer({ type: 'live', participantId: 10, row: null, text: '', seq: 1 });
    // Bob appears at row 1
    broadcastFromServer({ type: 'live', participantId: 20, row: 1, text: 'Yo', seq: 1 });
    broadcastFromServer({ type: 'roster', roomId: 1, roster: [{ handle: 'Alice', color: '#fff', lineSlot: 0 }, { handle: 'Bob', color: '#0ff', lineSlot: 1 }] });

    await waitFor(()=>{
      expect(document.querySelector('.active-line[data-line-slot="0"]')).toBeNull();
      expect(document.querySelector('.local-cursor-preview')).not.toBeNull();
    });
    expect(screen.getByText('Hi')).toBeInTheDocument();
    expect(screen.getByText('Yo')).toBeInTheDocument();

    // Alice resumes typing: her new line appears below Bob.
    await user.keyboard('Z');
    broadcastFromServer({ type: 'live', participantId: 10, row: 2, text: 'Z', seq: 2 });
    await waitFor(()=>{
      const lines = Array.from(document.querySelectorAll('.chat-line'));
      const yoIdx = lines.findIndex(el=> el.textContent==='Yo');
      const zRow = Array.from(document.querySelectorAll('.active-line'))
        .find(el=> el.textContent?.includes('Z'));
      expect(zRow).toBeTruthy();
      const zIdx = lines.indexOf(zRow as Element);
      expect(zIdx).toBeGreaterThan(yoIdx);
      expect(document.querySelector('.local-cursor-preview')).toBeNull();
    });
  });

  it('backspacing an allocated line to empty keeps its position', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    primeChatSnapshot({
      roomId: 1,
      liveLines: [
        { participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: null, text: '' },
        { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1, row: 5, text: 'BobLine' },
      ],
      roster: [
        { handle: 'Alice', color: '#fff', lineSlot: 0 },
        { handle: 'Bob', color: '#0ff', lineSlot: 1 },
      ],
    });

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);

    await waitFor(()=>{
      expect(document.querySelector('.active-line[data-line-slot="0"]')).toBeNull();
      expect(document.querySelector('.local-cursor-preview')).not.toBeNull();
    });

    await user.keyboard('A');
    await user.keyboard('B');
    broadcastFromServer({ type: 'live', participantId: 10, row: 6, text: 'A', seq: 1 });
    broadcastFromServer({ type: 'live', participantId: 10, row: 6, text: 'AB', seq: 2 });
    let orderWithText: string|null = null;
    await waitFor(()=>{
      const row = document.querySelector('.active-line[data-line-slot="0"]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain('AB');
      orderWithText = row?.getAttribute('data-document-order') ?? null;
    });
    await user.keyboard('{Backspace}');
    await user.keyboard('{Backspace}');
    broadcastFromServer({ type: 'live', participantId: 10, row: 6, text: 'A', seq: 3 });
    broadcastFromServer({ type: 'live', participantId: 10, row: 6, text: '', seq: 4 });

    await waitFor(()=>{
      const row = document.querySelector('.active-line[data-line-slot="0"]');
      expect(row).not.toBeNull();
      expect(row?.getAttribute('data-document-order')).toBe(orderWithText);
      const lines = Array.from(document.querySelectorAll('.chat-line'));
      const bobIdx = lines.findIndex(el=> el.textContent==='BobLine');
      const rowIdx = lines.indexOf(row as Element);
      expect(rowIdx).toBeGreaterThan(bobIdx);
    });

    await user.keyboard('C');
    broadcastFromServer({ type: 'live', participantId: 10, row: 6, text: 'C', seq: 5 });
    await waitFor(()=>{
      const row = document.querySelector('.active-line[data-line-slot="0"]');
      expect(row?.textContent).toContain('C');
      expect(row?.getAttribute('data-document-order')).toBe(orderWithText);
    });
  });
});

describe('Regression: server-driven Enter preserves draft lineIdx', ()=>{
  it('delayed post-commit snapshot cannot resurrect the finished draft', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice', token:'test-token'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    const client = qc();

    // Start: Alice idle, Bob idle.
    primeChatSnapshot({
      roomId: 1,
      liveLines: [
        { participantId: 10, handle: 'Alice', color: '#fff', slot: 0, row: null, text: '' },
        { participantId: 20, handle: 'Bob', color: '#0ff', slot: 1, row: null, text: '' },
      ],
      roster: [
        { handle: 'Alice', color: '#fff', lineSlot: 0 },
        { handle: 'Bob', color: '#0ff', lineSlot: 1 },
      ],
    });

    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);

    // 1. Alice types A: server echoes live{row:0, text:A}
    await user.keyboard('A');
    broadcastFromServer({ type: 'live', participantId: 10, row: 0, text: 'A', seq: 1 });
    await waitFor(()=>{
      const row = document.querySelector('.active-line[data-line-slot="0"]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain('A');
      expect(row?.getAttribute('data-document-order')).toBe('0');
    });

    // 2. Bob starts a line at 1.
    broadcastFromServer({ type: 'live', participantId: 20, row: 1, text: 'X', seq: 1 });
    await waitFor(()=>{ expect(screen.getByText('X')).toBeInTheDocument(); });

    // 3. Alice presses Enter. Server commits her A at row 0 and clears her live.
    await user.keyboard('{Enter}');
    broadcastFromServer({ type: 'committed', participantId: 10, seq: 2, line: { id: 'h1', handle: 'Alice', content: 'A', lineIdx: 0, committed: true, committedAt: 2, color: '#fff' } });
    broadcastFromServer({ type: 'live', participantId: 10, row: null, text: '', seq: 2 });

    // Committed A stays visible. No second A.
    await waitFor(()=>{
      const pending = document.querySelector('.committed-line[data-document-order="0"]');
      expect(pending).not.toBeNull();
      expect(pending?.textContent).toContain('A');
    });
    expect(screen.getAllByText('A')).toHaveLength(1);

    // 4. Late snapshot: server reports Alice's active at 0 again. It must not render as an active row.
    broadcastFromServer({ type: 'live', participantId: 10, row: 0, text: 'A', seq: 3 });
    await waitFor(()=>{
      // Still exactly one A — the pending commit. No resurrected active row.
      expect(screen.getAllByText('A')).toHaveLength(1);
      expect(document.querySelector('.active-line[data-line-slot="0"]')).toBeNull();
      expect(document.querySelector('.local-cursor-preview')).not.toBeNull();
    });
  });
});
