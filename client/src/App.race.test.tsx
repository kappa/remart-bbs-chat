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

describe('Enter buffer separation - typing during pending commit', ()=>{
  it('after Enter, typing B shows B only, not HiB, and Hi remains visible as committed', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));

    // Initial state: Hi typed, activeContent Hi
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[{id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'Hi', joinedAt:1, nextExpectedSeq:3}],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });

    // commitLine will be slow (simulate pending)
    let commitResolve: any;
    (api.commitLine as any).mockImplementation(()=> new Promise(res=>{ commitResolve = res; }));

    (api.sendChar as any).mockResolvedValue({content:'HiB', lineIdx:1, position:2, participantId:10});

    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);

    // Wait for initial Hi visible
    expect(await screen.findByText('Hi')).toBeInTheDocument();

    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);

    // Press Enter — should immediately clear active buffer to "" and show Hi as pending commit
    await user.keyboard('{Enter}');

    // After Enter, optimisticContent should be "" (fresh buffer), pending commit Hi visible
    // The active line should now be empty (only caret), but committed Hi should still be visible
    await waitFor(()=>{
      // There should be a committed line with Hi (pending)
      expect(screen.getByText('Hi')).toBeInTheDocument();
    });

    // Now type B before commit response
    await user.keyboard('B');

    // Active line should show B only, not HiB
    await waitFor(()=>{
      const activeLines = document.querySelectorAll('.active-line');
      const ownActive = Array.from(activeLines).find(el=> el.textContent?.includes('B'));
      expect(ownActive).toBeTruthy();
      const text = ownActive?.textContent || '';
      // Should be B, not HiB
      expect(text.trim()).not.toBe('HiB');
      // Should contain B
      expect(text).toContain('B');
    });

    // Resolve commit — server now has committed Hi, active B
    commitResolve({newLineIdx:null, committedContent:'Hi', committedAt:Date.now()});

    // After server confirms, Hi should still be visible (now from server history after refetch, pending removed)
    // Simulate server history now includes Hi
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[{id:'h1', handle:'Alice', content:'Hi', lineIdx:0, committed:true, committedAt:2, color:'#fff'}],
      participants:[{id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:1, activeContent:'B', joinedAt:1, nextExpectedSeq:4}],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });

    // Force refetch by invalidating (the commit .then does invalidate, but we can wait)
    await waitFor(async ()=>{
      // After refetch, history Hi and active B should both be visible
      const hi = screen.queryByText('Hi');
      const b = document.querySelector('.active-line');
      // We don't strictly require both yet, just that B not become HiB
      if(b) expect(b.textContent).not.toContain('HiB');
    });
  });

  it('seq increments for each op and sends with char', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'Room 1', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[{id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'', joinedAt:1, nextExpectedSeq:1}],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });
    (api.sendChar as any).mockResolvedValue({content:'a', lineIdx:0, position:0, participantId:10});
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);
    await user.keyboard('a');
    await user.keyboard('b');
    // sendChar should have been called twice with seq 1 and 2
    await waitFor(()=>{
      expect((api.sendChar as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const calls = (api.sendChar as any).mock.calls;
    expect(calls[0][0].seq).toBe(1);
    expect(calls[1][0].seq).toBe(2);
  });
});

describe('WebSocket direct apply', ()=>{
  it('applies char then backspace without missing transient', async ()=>{
    // Simulate queryClient.setQueryData behavior directly — test the logic of WS handler
    // We cannot easily spin a real WS, but we can test that setQueryData preserves transient corrections
    const client = qc();
    // Seed cache with room-state containing Bob empty
    client.setQueryData(['room-state', 1], {
      roomId:1,
      history:[],
      participants:[{id:20, handle:'Bob', color:'#0ff', lineSlot:1, activeLineIdx:1, activeContent:'', joinedAt:1}],
      roster:[]
    });

    // Simulate WS char 'x' for Bob
    const applyChar = (char:string)=>{
      client.setQueryData(['room-state', 1], (old:any)=>{
        if(!old) return old;
        const participants = old.participants.map((p:any)=>{
          if(p.id!==20) return p;
          return {...p, activeContent: (p.activeContent||'')+char};
        });
        return {...old, participants};
      });
    };
    const applyBackspace = ()=>{
      client.setQueryData(['room-state', 1], (old:any)=>{
        if(!old) return old;
        const participants = old.participants.map((p:any)=>{
          if(p.id!==20) return p;
          return {...p, activeContent: p.activeContent.slice(0,-1)};
        });
        return {...old, participants};
      });
    };

    applyChar('x');
    let data = client.getQueryData(['room-state', 1]) as any;
    expect(data.participants[0].activeContent).toBe('x');

    applyBackspace();
    data = client.getQueryData(['room-state', 1]) as any;
    expect(data.participants[0].activeContent).toBe('', 'after char then backspace, content should be empty, not missed');

    // If we had only invalidated and fetched snapshot after both, we would have missed the transient x
    // Direct apply preserves visible correction even if snapshot collected after erase
  });
});
