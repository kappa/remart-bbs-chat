import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
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
  keepaliveApi: { leaveRoom: vi.fn() }
}));

function createTestQueryClient(){
  return new QueryClient({ defaultOptions:{ queries:{ retry:false, gcTime:0 }}});
}

function renderApp(){
  const qc = createTestQueryClient();
  return render(<QueryClientProvider client={qc}><App /></QueryClientProvider>);
}

beforeEach(()=>{
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  // default: no rooms
  (api.listRooms as any).mockResolvedValue({rooms:[]});
});

describe('Lobby rendering', ()=>{
  it('shows handle input and ROOMS heading when no session', async ()=>{
    renderApp();
    expect(await screen.findByLabelText(/handle/i)).toBeInTheDocument();
    expect(screen.getByText('ROOMS')).toBeInTheDocument();
  });

  it('disables Use name when handle empty', async ()=>{
    renderApp();
    const useBtn = await screen.findByRole('button', {name:/use name/i});
    expect(useBtn).toBeDisabled();
  });

  it('enables Use name after typing handle', async ()=>{
    const user = userEvent.setup();
    renderApp();
    const input = await screen.findByLabelText(/handle/i);
    await user.type(input, 'Alice');
    const useBtn = screen.getByRole('button', {name:/use name/i});
    expect(useBtn).toBeEnabled();
  });

  it('shows room list with occupancy and Join buttons', async ()=>{
    (api.listRooms as any).mockResolvedValue({rooms:[
      {id:1, name:'lobby', occupancy:1, max:10, isLobby:true},
      {id:2, name:'room-2', occupancy:10, max:10}
    ]});
    renderApp();
    expect(await screen.findByText(/lobby \(1\/10/)).toBeInTheDocument();
    const joinBtns = await screen.findAllByRole('button', {name:/join/i});
    // first room join enabled (if handle present) else disabled - with no handle both disabled
    expect(joinBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('Join disabled when room full or no handle', async ()=>{
    (api.listRooms as any).mockResolvedValue({rooms:[{id:1, name:'fullroom', occupancy:10, max:10}]});
    renderApp();
    const fullBtn = await screen.findByRole('button', {name:/full/i});
    expect(fullBtn).toBeDisabled();
  });

  it('shows New Room / Create first room button', async ()=>{
    renderApp();
    expect(await screen.findByRole('button', {name:/create first room|new room/i})).toBeInTheDocument();
  });

  it('remembers handle from localStorage', async ()=>{
    localStorage.setItem('remart-bbs-chat.handle','Bob');
    renderApp();
    const input = await screen.findByLabelText(/handle/i) as HTMLInputElement;
    expect(input.value).toBe('Bob');
  });
});
