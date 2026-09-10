import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNotifier, titleChannel, soundChannel, TITLE_NOTICE_MS, TITLE_TICK_MS, type NotificationChannel } from './notifications';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('titleChannel', () => {
  it('rotates "<handle> joined " by code point and restores the base title after the notice', () => {
    const doc = { title: 'Base' };
    const channel = titleChannel(doc, 'Base');
    channel.notify({ kind: 'join', handle: '😀Bob' });
    expect(doc.title).toBe('😀Bob joined ');
    vi.advanceTimersByTime(TITLE_TICK_MS);
    expect(doc.title).toBe('Bob joined 😀');
    vi.advanceTimersByTime(TITLE_NOTICE_MS);
    expect(doc.title).toBe('Base');
  });
  it('uses "mentioned you" for mentions and a later notice replaces the running one', () => {
    const doc = { title: 'Base' };
    const channel = titleChannel(doc, 'Base');
    channel.notify({ kind: 'join', handle: 'Bob' });
    vi.advanceTimersByTime(TITLE_TICK_MS * 3);
    channel.notify({ kind: 'mention', handle: 'Carol', text: 'hi @Alice' });
    expect(doc.title).toBe('Carol mentioned you ');
    vi.advanceTimersByTime(TITLE_NOTICE_MS - 1);
    expect(doc.title).not.toBe('Base');
    vi.advanceTimersByTime(1);
    expect(doc.title).toBe('Base');
  });
  it('stop restores the title at once and clears the timers', () => {
    const doc = { title: 'Base' };
    const channel = titleChannel(doc, 'Base');
    channel.notify({ kind: 'join', handle: 'Bob' });
    channel.stop();
    expect(doc.title).toBe('Base');
    vi.advanceTimersByTime(TITLE_TICK_MS * 2);
    expect(doc.title).toBe('Base');
  });
});

describe('soundChannel', () => {
  function audioSpy() {
    const oscillators: any[] = [];
    class Ctx {
      currentTime = 0; destination = {};
      createOscillator() { const o = { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; oscillators.push(o); return o; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      close() {}
    }
    (globalThis as any).AudioContext = Ctx;
    return oscillators;
  }
  it('plays two square tones for a join and one sine tone for a mention', () => {
    const oscillators = audioSpy();
    const channel = soundChannel(() => true);
    channel.notify({ kind: 'join', handle: 'Bob' });
    expect(oscillators.map((o) => [o.type, o.frequency.value])).toEqual([['square', 880], ['square', 1320]]);
    oscillators.length = 0;
    channel.notify({ kind: 'mention', handle: 'Bob', text: 'hi' });
    expect(oscillators.map((o) => o.type)).toEqual(['sine']);
    expect(oscillators[0].frequency.value).toBeGreaterThan(1320);
  });
  it('plays nothing when the switch is off', () => {
    const oscillators = audioSpy();
    soundChannel(() => false).notify({ kind: 'join', handle: 'Bob' });
    expect(oscillators).toEqual([]);
  });
  it('swallows audio failures', () => {
    (globalThis as any).AudioContext = class { constructor() { throw new Error('blocked'); } };
    expect(() => soundChannel(() => true).notify({ kind: 'mention', handle: 'Bob', text: 'x' })).not.toThrow();
  });
});

describe('createNotifier', () => {
  it('fans notify and stop out to every channel in order', () => {
    const calls: string[] = [];
    const channel = (name: string): NotificationChannel => ({ notify: (n) => calls.push(`${name}:${n.kind}`), stop: () => calls.push(`${name}:stop`) });
    const notifier = createNotifier([channel('a'), channel('b')]);
    notifier.notify({ kind: 'join', handle: 'Bob' });
    notifier.stop();
    expect(calls).toEqual(['a:join', 'b:join', 'a:stop', 'b:stop']);
  });
});
