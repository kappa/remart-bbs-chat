import WebSocket from 'ws';

process.env.NODE_ENV = 'test';
export const serverModule = await import('./server/index.js');

// Close accepted connections even when a test failed before its own cleanup,
// or never sent hello. Wait for close events so the next test starts isolated.
export async function closeAllSockets() {
  await Promise.all(Array.from(serverModule.wss.clients, (ws) => new Promise((resolve) => {
    ws.once('close', resolve);
    ws.terminate();
  })));
}

// Binds the shared Express/WebSocket server to a free port. Returns the base
// HTTP URL, the socket URL, and a close function for `after`.
export function startServer() {
  return new Promise((resolve) => {
    const httpServer = serverModule.server.listen(0, () => {
      const { port } = httpServer.address();
      resolve({
        baseUrl: `http://localhost:${port}`,
        wsUrl: `ws://localhost:${port}/ws`,
        close: async () => {
          await closeAllSockets();
          await new Promise((res) => httpServer.close(res));
        },
      });
    });
  });
}

export async function post(baseUrl, path, body) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

export async function newRoom(baseUrl) {
  return (await post(baseUrl, '/api/rooms', { forceNew: true })).json.room.id;
}

// Joins over HTTP and returns the credentials a socket `hello` needs.
export async function join(baseUrl, roomId, handle) {
  const { json } = await post(baseUrl, '/api/join', { roomId, handle });
  return { roomId, participantId: json.participant.id, token: json.participant.token, handle, color: json.participant.color };
}

// A raw socket that records every parsed message in arrival order.
export function openSocket(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const client = { ws, messages: [], cursor: 0 };
  client.opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  client.closed = new Promise((res) => ws.on('close', res));
  ws.on('message', (raw) => client.messages.push(JSON.parse(raw.toString())));
  client.send = (msg) => ws.send(JSON.stringify(msg));
  // Resolves with the next not-yet-consumed message matching `predicate`.
  client.next = (predicate = () => true, timeoutMs = 2000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      for (let i = client.cursor; i < client.messages.length; i++) {
        if (predicate(client.messages[i])) { client.cursor = i + 1; return resolve(client.messages[i]); }
      }
      if (Date.now() > deadline) return reject(new Error(`timeout; unconsumed: ${JSON.stringify(client.messages.slice(client.cursor))}`));
      setTimeout(poll, 5);
    };
    poll();
  });
  return client;
}

// Opens a socket, sends hello, and waits for the snapshot.
export async function connect(wsUrl, creds) {
  const client = openSocket(wsUrl);
  await client.opened;
  client.send({ type: 'hello', roomId: creds.roomId, participantId: creds.participantId, token: creds.token });
  client.snapshot = await client.next((m) => m.type === 'snapshot');
  return client;
}

export function settle(ms = 50) { return new Promise((res) => setTimeout(res, ms)); }