import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { FakeWebSocket } from './testing/fakeWebSocket';

// jsdom has no WebSocket; install the shared fake. App tests drive the server
// side through the fixtures in testing/roomFixtures.tsx, which answer the
// app's hello and push server messages with serverSend.
(globalThis as any).WebSocket = FakeWebSocket;

// Fresh instance lists for every test.
beforeEach(() => FakeWebSocket.reset());

// AudioContext stub for join chirp
class MockAudioContext {
  currentTime = 0;
  createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} } as any; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } as any; }
  close() { }
  destination = {} as any;
}
(globalThis as any).AudioContext = MockAudioContext;
(globalThis as any).webkitAudioContext = MockAudioContext;
