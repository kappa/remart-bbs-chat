import { describe, it, expect, afterEach } from 'vitest';
import { claimSession } from './sessionLock';

type Callback = (lock: object | null) => unknown;
function fakeLocks(taken: boolean) {
  const calls: { name: string; options: unknown; held: unknown }[] = [];
  const request = (name: string, options: unknown, callback: Callback) => {
    const held = callback(taken ? null : { name });
    calls.push({ name, options, held });
    return Promise.resolve(held);
  };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return calls;
}
afterEach(() => { delete (navigator as any).locks; });

describe('claimSession', () => {
  it('returns a release function and holds the lock until it is called', async () => {
    const calls = fakeLocks(false);
    const release = await claimSession(10);
    expect(typeof release).toBe('function');
    expect(calls[0].name).toBe('remart-bbs-chat.session.10');
    expect(calls[0].options).toEqual({ ifAvailable: true });
    let settled = false;
    (calls[0].held as Promise<void>).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release!();
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it('returns null when another tab holds the lock', async () => {
    fakeLocks(true);
    await expect(claimSession(10)).resolves.toBeNull();
  });

  it('returns a no-op release when the browser has no Web Locks', async () => {
    const release = await claimSession(10);
    expect(typeof release).toBe('function');
  });
});
