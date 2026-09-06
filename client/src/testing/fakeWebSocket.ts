// Stand-in for the browser WebSocket. Tests read what the app sent through
// `sent` and push server messages with `serverSend`. Instances open on the
// next macrotask unless `autoOpen` is false.
export class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static autoOpen = true;
  static reset() { FakeWebSocket.instances = []; FakeWebSocket.autoOpen = true; }
  static latest(): FakeWebSocket {
    const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!last) throw new Error('no FakeWebSocket has been opened');
    return last;
  }

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) setTimeout(() => this.open(), 0);
  }
  open() { if (this.readyState !== FakeWebSocket.CONNECTING) return; this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  send(data: string) { if (this.readyState !== FakeWebSocket.OPEN) throw new Error('socket not open'); this.sent.push(JSON.parse(data)); }
  close() { this.serverClose(); }
  serverSend(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  serverClose() { if (this.readyState === FakeWebSocket.CLOSED) return; this.readyState = FakeWebSocket.CLOSED; this.onclose?.(); }
  keys() { return this.sent.filter((m) => m.type === 'key'); }
}
