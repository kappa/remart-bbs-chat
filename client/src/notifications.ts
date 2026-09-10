// Notifications are typed events; channels decide how to show them.
export type Notification =
  | { kind: 'join'; handle: string }
  | { kind: 'mention'; handle: string; text: string };

export type NotificationChannel = { notify: (n: Notification) => void; stop: () => void };
// A notifier is itself a channel that fans out to the others.
export type Notifier = NotificationChannel;

export const TITLE_NOTICE_MS = 5000;
export const TITLE_TICK_MS = 400;

// Channels are independent: one that throws never silences the next.
export function createNotifier(channels: NotificationChannel[]): Notifier {
  const each = (call: (channel: NotificationChannel) => void) => {
    for (const channel of channels) {
      try { call(channel); } catch { /* a broken channel is not the others' problem */ }
    }
  };
  return {
    notify: (n) => each((channel) => channel.notify(n)),
    stop: () => each((channel) => channel.stop()),
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
function audioContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

// close() returns a promise that rejects when the browser already closed the
// context; a plain try/catch would not see that.
function releaseLater(ctx: AudioContext, afterMs: number) {
  setTimeout(() => { try { ctx.close().catch(() => {}); } catch { /* already closed */ } }, afterMs);
}

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
  releaseLater(ctx, 600);
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
  releaseLater(ctx, 800);
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
