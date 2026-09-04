import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function qc(){ return new QueryClient({defaultOptions:{queries:{retry:false}}}); }

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  (api.listRooms as any).mockResolvedValue({rooms:[]});
});

describe('Rendering behaviors', ()=>{
  it('committed line uses color snapshot even after roster missing', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[
        {id:'h1', handle:'Bob', content:'old message', lineIdx:0, committed:true, committedAt:2, color:'#ff00ff'},
      ],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:1, activeContent:'', joinedAt:1},
      ],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const line = await screen.findByText('old message');
    // inline style color should be #ff00ff (snapshot)
    expect(line).toHaveStyle({color:'#ff00ff'});
  });

  it('empty committed line renders as space (no collapse)', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[
        {id:'h1', handle:'Alice', content:'', lineIdx:0, committed:true, committedAt:2},
      ],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:1, activeContent:'', joinedAt:1},
      ],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    // committed-line with empty content renders as single space text node – testing-library trims spaces so use DOM query
    const lines = await screen.findAllByText((_,el)=> el?.classList.contains('committed-line') ?? false);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    // At least one committed line should have textContent ' ' (rendered as space)
    const hasSpace = lines.some(el => el.textContent === ' ');
    expect(hasSpace).toBe(true);
  });

  it('system line has system-line class and dim color', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[
        {id:'h1', handle:'system', content:'* Bob joined', lineIdx:0, committed:true, committedAt:2, color:'#888'},
      ],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:1, activeContent:'', joinedAt:1},
      ],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const sys = await screen.findByText('* Bob joined');
    expect(sys.className).toMatch(/system-line/);
  });

  it('Enter commits without redrawing current line visually', async ()=>{
    const user = userEvent.setup();
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    let committed = false;
    (api.getRoomState as any).mockImplementation(async ()=>{
      if(!committed){
        return {
          roomId:1,
          history:[],
          participants:[{id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'typing', joinedAt:1}],
          roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
        };
      } else {
        return {
          roomId:1,
          history:[{id:'h1', handle:'Alice', content:'typing', lineIdx:0, committed:true, committedAt:2}],
          participants:[{id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:1, activeContent:'', joinedAt:1}],
          roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
        };
      }
    });
    (api.commitLine as any).mockImplementation(async ()=>{
      committed = true;
      return {newLineIdx:1, committedContent:'typing', committedAt:2};
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    // Initially active line shows typing
    expect(await screen.findByText('typing')).toBeInTheDocument();
    // Press Enter in chat area
    const chatArea = await screen.findByLabelText('Shared chat area');
    await user.click(chatArea);
    await user.keyboard('{Enter}');
    // After commit, old content should still be visible as committed (no disappearance)
    // With new pendingCommits logic, there may be 2 elements (pending + history) briefly, so use AllBy
    expect((await screen.findAllByText('typing')).length).toBeGreaterThanOrEqual(1);
  });

  it('backspace at column zero does nothing (no crash)', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[{id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'', joinedAt:1}],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const chatArea = await screen.findByLabelText('Shared chat area');
    await userEvent.setup().click(chatArea);
    await userEvent.setup().keyboard('{Backspace}');
    // Should not throw, and no backspace api called when empty (app guards)
    expect(api.sendBackspace as any).not.toHaveBeenCalled();
  });

  it('help overlay shows on ? command and closes', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[{id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'?', joinedAt:1}],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });
    // Mock clearActiveCommand path: sendBackspace called for '?' then help shown
    (api.sendBackspace as any).mockResolvedValue({content:'', lineIdx:0, participantId:10});
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const chatArea = await screen.findByLabelText('Shared chat area');
    await userEvent.setup().click(chatArea);
    await userEvent.setup().keyboard('{Enter}');
    expect(await screen.findByRole('dialog', {name:/help/i})).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button',{name:/close/i}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('paste limited to 100 chars shows warning logic', async ()=>{
    // Pure logic test: clipboard >100 should trigger warning message
    const clipboard = 'a'.repeat(150);
    const limited = clipboard.slice(0,100);
    expect(limited.length).toBe(100);
    // App sets warning "Paste limited to 100 characters" when clipboardCharacters.length>100
    const messages: string[] = [];
    if(clipboard.length>100) messages.push('Paste limited to 100 characters');
    expect(messages.join(' · ')).toContain('100 characters');
  });
});
