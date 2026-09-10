// Notifications are typed events; channels decide how to show them.
export type Notification =
  | { kind: 'join'; handle: string }
  | { kind: 'mention'; handle: string; text: string };

export type NotificationChannel = { notify: (n: Notification) => void; stop: () => void };
export type Notifier = { notify: (n: Notification) => void; stop: () => void };

export const TITLE_NOTICE_MS = 5000;
export const TITLE_TICK_MS = 400;

export function createNotifier(channels: NotificationChannel[]): Notifier {
  return {
    notify: (n) => { for (const channel of channels) channel.notify(n); },
    stop: () => { for (const channel of channels) channel.stop(); },
  };
}

export function titleChannel(doc: { title: string }, baseTitle: string): NotificationChannel {
  let interval: number | undefined;
  let timeout: number | undefined;
  const clear = () => {
    window.clearInterval(interval);
    window.clearTimeout(timeout);
    interval = undefined;
    timeout = undefined;
  };
  const stop = () => { clear(); doc.title = baseTitle; };
  return {
    notify(n) {
      clear();
      let rotated = n.kind === 'join' ? `${n.handle} joined ` : `${n.handle} mentioned you `;
      doc.title = rotated;
      interval = window.setInterval(() => {
        const points = Array.from(rotated);
        rotated = points.slice(1).join('') + points[0];
        doc.title = rotated;
      }, TITLE_TICK_MS);
      timeout = window.setTimeout(stop, TITLE_NOTICE_MS);
    },
    stop,
  };
}

type AudioCtor = new () => AudioContext;
const audioContext = (): AudioContext | null => {
  const Ctor: AudioCtor | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

function playChirp() {
  const ctx = audioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 880;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'square';
  osc2.frequency.value = 1320;
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  gain2.gain.setValueAtTime(0, ctx.currentTime + 0.12);
  gain2.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.13);
  gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
  osc2.start(ctx.currentTime + 0.12);
  osc2.stop(ctx.currentTime + 0.4);
  setTimeout(() => { try { ctx.close(); } catch { /* already closed */ } }, 600);
}

function playBell() {
  const ctx = audioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1568;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
  osc.start();
  osc.stop(ctx.currentTime + 0.55);
  setTimeout(() => { try { ctx.close(); } catch { /* already closed */ } }, 800);
}

export function soundChannel(isOn: () => boolean): NotificationChannel {
  return {
    notify(n) {
      if (!isOn()) return;
      try {
        if (n.kind === 'join') playChirp();
        else playBell();
      } catch {
        // Audio blocked or unavailable.
      }
    },
    stop() {},
  };
}
