import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement WebSocket by default; provide minimal stub for App's WS effect
class MockWebSocket {
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; setTimeout(() => this.onopen?.(), 0); }
  send() {}
  close() { this.onclose?.(); }
}
(globalThis as any).WebSocket = MockWebSocket;

// AudioContext stub for join chirp
class MockAudioContext {
  currentTime = 0;
  createOscillator() { return { type:'', frequency:{value:0}, connect(){}, start(){}, stop(){} } as any; }
  createGain() { return { gain:{setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}}, connect(){}} as any; }
  close(){}
  destination = {} as any;
}
(globalThis as any).AudioContext = MockAudioContext;
(globalThis as any).webkitAudioContext = MockAudioContext;
