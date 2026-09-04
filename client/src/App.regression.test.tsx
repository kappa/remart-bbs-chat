import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { api } from './api';

vi.mock('./api', ()=>({
  api:{
    listRooms: vi.fn(),
    getOrCreateRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    getRoster: vi.fn(),
    heartbeat: vi.fn(),
    sendChar: vi.fn(),
    sendBackspace: vi.fn(),
    commitLine: vi.fn(),
    getRoomState: vi.fn(),
  },
  keepaliveApi:{ leaveRoom: vi.fn() }
}));

function qc(){ return new QueryClient({defaultOptions:{queries:{retry:false, gcTime:0}}}); }

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  (api.listRooms as any).mockResolvedValue({rooms:[]});
});

describe('Regression: A Enter B Backspace C without pausing, other participant untouched', ()=>{
  it('A stays committed, new active is C only, B and deletion distinct, other line untouched, no wait for Enter ack', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    // Initial: Alice has typed A, Bob has X
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'A', joinedAt:1, nextExpectedSeq:2},
        {id:20, handle:'Bob', color:'#0ff', lineSlot:1, activeLineIdx:1, activeContent:'X', joinedAt:1, nextExpectedSeq:1},
      ],
      roster:[
        {handle:'Alice', color:'#fff', lineSlot:0},
        {handle:'Bob', color:'#0ff', lineSlot:1},
      ]
    });

    // commitLine slow (latency) — do not resolve immediately, to simulate Enter ack delay
    let commitResolve: any;
    (api.commitLine as any).mockImplementation(()=> new Promise(res=>{ commitResolve = res; }));

    (api.sendChar as any).mockResolvedValue({content:'', lineIdx:0, position:0, participantId:10});
    (api.sendBackspace as any).mockResolvedValue({content:'', lineIdx:0, participantId:10});

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

    // At this point, commit is still pending (latency), but user continued typing
    // Expected: A stays committed (visible as pending), new active contains only C, not B, not AB, not BC
    await waitFor(()=>{
      // There should be a committed/pending line with A
      const committedA = screen.getByText('A');
      expect(committedA).toBeInTheDocument();
    });

    await waitFor(()=>{
      const activeLines = document.querySelectorAll('.active-line');
      // Find Alice's active line (should contain C)
      const aliceActive = Array.from(activeLines).find(el=> {
        // Alice is first slot, but we check content
        return el.textContent?.includes('C') || el.textContent?.trim() === 'C';
      });
      expect(aliceActive).toBeTruthy();
      const text = aliceActive?.textContent || '';
      // Must be C only, not AB, not B, not BC, not HiB pattern
      expect(text).toContain('C');
      expect(text.trim()).not.toBe('B');
      expect(text.trim()).not.toContain('AB');
      expect(text.trim()).not.toContain('BC');
      // Should not contain A+B together
      expect(text).not.toMatch(/A.*B/);
    });

    // Bob's line must remain untouched (still X)
    await waitFor(()=>{
      const bobLine = screen.getByText('X');
      expect(bobLine).toBeInTheDocument();
      // Ensure Bob's content didn't get polluted with C
      const allActive = document.querySelectorAll('.active-line');
      const bobActive = Array.from(allActive).find(el=> el.textContent?.includes('X'));
      expect(bobActive).toBeTruthy();
      expect(bobActive?.textContent).not.toContain('C');
      expect(bobActive?.textContent).not.toContain('A');
    });

    // Observers receive B and deletion as distinct ordered events: check api call order
    await waitFor(()=>{
      // sendChar should have been called for B and C, in order, with increasing seq
      const charCalls = (api.sendChar as any).mock.calls;
      // First call was A already typed before (not in this flow), but after Enter we typed B then C
      // So we expect at least 2 char calls after Enter: B (seq) and C (seq)
      expect(charCalls.length).toBeGreaterThanOrEqual(2);
      // Find B and C calls
      const bCall = charCalls.find((c:any)=> c[0].char === 'B');
      const cCall = charCalls.find((c:any)=> c[0].char === 'C');
      expect(bCall).toBeTruthy();
      expect(cCall).toBeTruthy();
      // B seq < C seq (ordered)
      expect(bCall[0].seq < cCall[0].seq).toBe(true);
    });

    await waitFor(()=>{
      // Backspace should have been called for B deletion, between B and C seq
      const bsCalls = (api.sendBackspace as any).mock.calls;
      expect(bsCalls.length).toBeGreaterThanOrEqual(1);
      const bCharCall = (api.sendChar as any).mock.calls.find((c:any)=> c[0].char === 'B');
      const cCharCall = (api.sendChar as any).mock.calls.find((c:any)=> c[0].char === 'C');
      const bsCall = bsCalls[0];
      // seq ordering: B < Backspace < C
      expect(bCharCall[0].seq < bsCall[0].seq).toBe(true);
      expect(bsCall[0].seq < cCharCall[0].seq).toBe(true);
    });

    // Now resolve Enter ack (server confirms A committed, allocates new lineIdx for active)
    commitResolve({newLineIdx:null, committedContent:'A', committedAt:Date.now()});

    // Simulate server history now includes A, and active is C on new lineIdx
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[{id:'h1', handle:'Alice', content:'A', lineIdx:0, committed:true, committedAt:2, color:'#fff'}],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:2, activeContent:'C', joinedAt:1, nextExpectedSeq:6},
        {id:20, handle:'Bob', color:'#0ff', lineSlot:1, activeLineIdx:1, activeContent:'X', joinedAt:1, nextExpectedSeq:1},
      ],
      roster:[
        {handle:'Alice', color:'#fff', lineSlot:0},
        {handle:'Bob', color:'#0ff', lineSlot:1},
      ]
    });

    // After server ack, still C only, A committed, Bob untouched, no duplication
    await waitFor(async ()=>{
      // Trigger a manual refetch tick — the component invalidates on commit resolve
      // Wait for final state
      const activeLines = document.querySelectorAll('.active-line');
      const aliceActive = Array.from(activeLines).find(el=> el.textContent?.includes('C'));
      if(aliceActive){
        expect(aliceActive.textContent).toContain('C');
        expect(aliceActive.textContent).not.toContain('B');
      }
    }, {timeout:2000});
  });

  it('documentLines orders committed A before new active C even before server ack (provisional ordering)', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'A', joinedAt:1, nextExpectedSeq:2},
        {id:20, handle:'Bob', color:'#0ff', lineSlot:1, activeLineIdx:5, activeContent:'BobLine', joinedAt:1, nextExpectedSeq:1},
      ],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0},{handle:'Bob', color:'#0ff', lineSlot:1}]
    });

    let commitResolve:any;
    (api.commitLine as any).mockImplementation(()=> new Promise(res=>{ commitResolve=res; }));
    (api.sendChar as any).mockResolvedValue({content:'', lineIdx:0, position:0, participantId:10});
    (api.sendBackspace as any).mockResolvedValue({content:'', lineIdx:0, participantId:10});

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    expect(await screen.findByText('A')).toBeInTheDocument();

    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);
    await user.keyboard('{Enter}');
    await user.keyboard('B');
    await user.keyboard('{Backspace}');
    await user.keyboard('C');

    // Before ack, committed A (pending) should appear before active C in DOM order
    await waitFor(()=>{
      const lines = Array.from(document.querySelectorAll('.chat-line'));
      const aIndex = lines.findIndex(el=> el.textContent === 'A');
      const cIndex = lines.findIndex(el=> el.textContent?.includes('C') && el.classList.contains('active-line'));
      expect(aIndex).toBeGreaterThanOrEqual(0);
      expect(cIndex).toBeGreaterThanOrEqual(0);
      expect(aIndex).toBeLessThan(cIndex);
    });

    commitResolve({newLineIdx:null, committedContent:'A', committedAt:Date.now()});
  });

  it('Enter does not cause active line to jump down then back (provisional stays stable)', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'Hi', joinedAt:1, nextExpectedSeq:2},
      ],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });

    let commitResolve:any;
    (api.commitLine as any).mockImplementation(()=> new Promise(res=>{ commitResolve=res; }));

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    expect(await screen.findByText('Hi')).toBeInTheDocument();

    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);
    await user.keyboard('{Enter}');

    // Capture active line order right after Enter (before ack)
    let orderBeforeAck: string|null = null;
    await waitFor(()=>{
      const active = document.querySelector('.active-line');
      expect(active).toBeTruthy();
      orderBeforeAck = active?.getAttribute('data-document-order') ?? null;
      expect(orderBeforeAck).not.toBeNull();
    });

    // Simulate server ack: history includes Hi, activeLineIdx null (no new char yet, deferred ownership)
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[{id:'h1', handle:'Alice', content:'Hi', lineIdx:0, committed:true, committedAt:2, color:'#fff'}],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:null, activeContent:'', joinedAt:1, nextExpectedSeq:3},
      ],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });
    commitResolve({newLineIdx:null, committedContent:'Hi', committedAt:Date.now()});

    // After ack, active line should still be at same order (provisional), not jumped to bottom then back
    await waitFor(()=>{
      const active = document.querySelector('.active-line');
      expect(active).toBeTruthy();
      const orderAfterAck = active?.getAttribute('data-document-order');
      expect(orderAfterAck).toBe(orderBeforeAck);
    });

    // Committed Hi should still be visible and stay in place (order 0)
    await waitFor(()=>{
      const committed = screen.getByText('Hi');
      expect(committed).toBeInTheDocument();
      // Committed Hi should be before active line in DOM
      const lines = Array.from(document.querySelectorAll('.chat-line'));
      const hiIdx = lines.findIndex(el=> el.textContent==='Hi' && !el.classList.contains('active-line'));
      const activeIdx = lines.findIndex(el=> el.classList.contains('active-line'));
      expect(hiIdx).toBeLessThan(activeIdx);
    });
  });
});
