import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function qc(){
  return new QueryClient({defaultOptions:{queries:{retry:false}}});
}

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  (api.listRooms as any).mockResolvedValue({rooms:[]});
});

describe('Roster rendering', ()=>{
  it('shows roster sorted by lineSlot with color dots', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[
        {id:11, handle:'Bob', color:'#00ff00', lineSlot:2, activeLineIdx:2, activeContent:'hi', joinedAt:1},
        {id:10, handle:'Alice', color:'#ff0000', lineSlot:0, activeLineIdx:0, activeContent:'', joinedAt:1},
        {id:12, handle:'Carol', color:'#0000ff', lineSlot:1, activeLineIdx:1, activeContent:'yo', joinedAt:1},
      ],
      roster:[
        {handle:'Alice', color:'#ff0000', lineSlot:0},
        {handle:'Carol', color:'#0000ff', lineSlot:1},
        {handle:'Bob', color:'#00ff00', lineSlot:2},
      ]
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    // PARTICIPANTS heading
    expect(await screen.findByText('PARTICIPANTS')).toBeInTheDocument();
    const handles = await screen.findAllByText(/Alice|Bob|Carol/);
    // first in roster should be Alice (slot 0)
    const rosterEntries = document.querySelectorAll('.roster-entry');
    expect(rosterEntries.length).toBe(3);
    expect(rosterEntries[0].textContent).toContain('Alice');
    // color dot background
    const dots = document.querySelectorAll('.roster-color-dot');
    expect(dots.length).toBe(3);
  });

  it('char counter shows current content length', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'hello', joinedAt:1},
      ],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0}]
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    expect(await screen.findByText('5 chars')).toBeInTheDocument();
  });

  it('caret only for own participant', async ()=>{
    const session = {roomId:1, roomName:'lobby', participantId:10, handle:'Alice'};
    sessionStorage.setItem('remart-bbs-chat.session', JSON.stringify(session));
    (api.getRoomState as any).mockResolvedValue({
      roomId:1,
      history:[],
      participants:[
        {id:10, handle:'Alice', color:'#fff', lineSlot:0, activeLineIdx:0, activeContent:'a', joinedAt:1},
        {id:11, handle:'Bob', color:'#0f0', lineSlot:1, activeLineIdx:1, activeContent:'b', joinedAt:1},
      ],
      roster:[{handle:'Alice', color:'#fff', lineSlot:0},{handle:'Bob', color:'#0f0', lineSlot:1}]
    });
    render(<QueryClientProvider client={qc()}><App /></QueryClientProvider>);
    const carets = await screen.findAllByLabelText(/your typing position/i);
    expect(carets.length).toBe(1);
  });
});
