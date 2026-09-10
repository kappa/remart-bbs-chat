// End-to-end check with two browser tabs, driven over the Chrome DevTools
// protocol against a headless Chrome. Starts its own server on CHECK_PORT
// (default 3001) from the built client, so run `npm run build` first.
//
//   npm run check:browser
//
// Alice and Bob join one room. Typing, Backspace, Enter, the ? and q
// commands, handle autocomplete (with Carol as a third tab), the afk marker
// driven by real tab switches, a page reload, and a server restart are
// exercised, then a second room checks the 20-line join history window, and
// every observation is printed as PASS or FAIL. Exit code 1 if anything
// failed.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const REPO = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CHECK_PORT || 3001);
const DEBUG_PORT = Number(process.env.CHECK_DEBUG_PORT || 9333);
const CHROME = process.env.CHROME || 'google-chrome';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' -- ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const proc = spawn('node', ['server/index.js'], { cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => proc.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(proc); }));
}
async function stopServer(proc) { proc.kill('SIGTERM'); await new Promise((r) => proc.on('exit', r)); }

// Minimal DevTools protocol client: one browser socket, flat sessions per tab.
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.waiting = new Map();
    this.ready = new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (!m.id || !this.waiting.has(m.id)) return;
      const { res, rej } = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
}

const ENTER = { windowsVirtualKeyCode: 13, code: 'Enter' };
const BACKSPACE = { windowsVirtualKeyCode: 8, code: 'Backspace' };
const ESCAPE = { windowsVirtualKeyCode: 27, code: 'Escape' };
const ARROW_LEFT = { windowsVirtualKeyCode: 37, code: 'ArrowLeft' };

async function main() {
  if (!existsSync(join(REPO, 'client', 'dist', 'index.html'))) {
    console.error('client/dist is missing: run `npm run build` first');
    process.exit(2);
  }
  let server = await startServer();
  await fetch(`http://localhost:${PORT}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"forceNew":true}' });

  const profile = mkdtempSync(join(tmpdir(), 'remart-check-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try { version = await (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).json(); } catch { await sleep(200); }
  }
  if (!version) { console.error(`could not reach ${CHROME} on port ${DEBUG_PORT}`); process.exit(2); }
  const cdp = new Cdp(version.webSocketDebuggerUrl);
  await cdp.ready;

  // Expressions evaluated in the page.
  const text = (sel) => `Array.from(document.querySelectorAll('${sel}')).map(e => e.textContent.replace(/\\s+$/, ''))`;
  const has = (needle) => `document.body.innerText.includes(${JSON.stringify(needle)})`;
  const inRoom = `document.querySelector('[aria-label="Shared chat area"]') && !${has('Connecting...')}`;
  // A tab resolves only once its page has joined, so tabs join in the order
  // the script creates them. Creating the next target hides and throttles
  // this one, and an unjoined page could otherwise lose the race for slot 0.
  const tab = async (name, room = 1, { url = `http://localhost:${PORT}/?name=${name}&room=${room}`, join = true } = {}) => {
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    const t = {
      name,
      eval: async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result.value,
      waitFor: async (expr, timeout = 5000) => {
        const end = Date.now() + timeout;
        while (Date.now() < end) { if (await t.eval(expr)) return true; await sleep(50); }
        return false;
      },
      key: async (key, extra = {}) => {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key.length === 1 ? key : undefined, ...extra }, sessionId);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...extra }, sessionId);
      },
      type: async (s) => { for (const ch of s) await t.key(ch); },
      focus: () => t.eval(`document.querySelector('.keyboard-capture')?.focus(), !!document.activeElement?.classList.contains('keyboard-capture')`),
      reload: () => cdp.send('Page.reload', {}, sessionId),
      goto: (url) => cdp.send('Page.navigate', { url }, sessionId),
      close: () => cdp.send('Target.closeTarget', { targetId }),
      front: () => cdp.send('Page.bringToFront', {}, sessionId),
    };
    t.joined = join ? await t.waitFor(inRoom) : false;
    return t;
  };
  const participantId = `JSON.parse(sessionStorage.getItem('remart-bbs-chat.session')).participantId`;

  const alice = await tab('Alice');
  const bob = await tab('Bob');
  for (const t of [alice, bob]) check(`${t.name} joins room 1 and connects`, t.joined);
  check('Alice sees "* Bob joined"; Bob sees the pre-join history (20-line window) plus his own join',
    await alice.waitFor(`${text('.committed-line')}.includes('* Bob joined')`) && await bob.waitFor(`${text('.committed-line')}.join('|') === '* Alice joined|* Bob joined'`),
    `alice=${JSON.stringify(await alice.eval(text('.committed-line')))} bob=${JSON.stringify(await bob.eval(text('.committed-line')))}`);

  check('Alice keyboard focused', await alice.focus());
  await alice.type('hi');
  check('Alice live line "hi" appears in both tabs after the echo',
    await alice.waitFor(`${text('.live-line')}.includes('hi')`) && await bob.waitFor(`${text('.live-line')}.includes('hi')`),
    `alice=${JSON.stringify(await alice.eval(text('.live-line')))} bob=${JSON.stringify(await bob.eval(text('.live-line')))}`);
  check('the caret sits on Alice\'s own live row', await alice.eval(`!!document.querySelector('.live-line .caret')`));
  await alice.key('Backspace', BACKSPACE);
  check('Backspace: both tabs show "h"', await alice.waitFor(`${text('.live-line')}.includes('h')`) && await bob.waitFor(`${text('.live-line')}.includes('h')`));
  await alice.key('Enter', ENTER);
  check('Enter: both tabs show committed "h" and the live row is gone',
    await alice.waitFor(`${text('.committed-line')}.includes('h') && !${text('.live-line')}.includes('h')`) && await bob.waitFor(`${text('.committed-line')}.includes('h')`));

  await alice.focus(); await alice.type('abd'); await alice.key('ArrowLeft', ARROW_LEFT);
  check('mid-line caret blinks only its underline; the character stays visible',
    await alice.waitFor(`document.querySelector('.caret-char')?.textContent === 'd'`) &&
    await alice.eval(`(() => {
      const caret = document.querySelector('.caret-char');
      const animation = caret.getAnimations()[0];
      if (!animation) return false;
      animation.pause();
      animation.currentTime = 0;
      const on = { opacity: getComputedStyle(caret).opacity, border: getComputedStyle(caret).borderBottomColor };
      animation.currentTime = 750;
      const off = { opacity: getComputedStyle(caret).opacity, border: getComputedStyle(caret).borderBottomColor };
      animation.play();
      return on.opacity === '1' && off.opacity === '1' && on.border !== off.border;
    })()`));
  await alice.type('c'); await alice.key('Enter', ENTER);
  check('abd, Left, c, Enter: both tabs show committed "abcd"',
    await alice.waitFor(`${text('.committed-line')}.includes('abcd')`) && await bob.waitFor(`${text('.committed-line')}.includes('abcd')`),
    `alice=${JSON.stringify(await alice.eval(text('.committed-line')))} bob=${JSON.stringify(await bob.eval(text('.committed-line')))}`);

  await alice.type('?'); await alice.key('Enter', ENTER);
  check('"?" Enter opens help in Alice\'s tab only', await alice.waitFor(`!!document.querySelector('.help-overlay')`) && !(await bob.eval(`!!document.querySelector('.help-overlay')`)));
  check('"?" was not committed as chat', !(await alice.eval(`${text('.committed-line')}.includes('?')`)));
  await alice.key('Escape', ESCAPE);
  check('Escape closes help', await alice.waitFor(`!document.querySelector('.help-overlay')`));

  await alice.focus(); await alice.type('l'); await alice.key('Enter', ENTER);
  check('"l" Enter commits ordinary chat in both tabs',
    await alice.waitFor(`${text('.committed-line')}.includes('l')`) && await bob.waitFor(`${text('.committed-line')}.includes('l')`),
    `alice=${JSON.stringify(await alice.eval(text('.committed-line')))} bob=${JSON.stringify(await bob.eval(text('.committed-line')))}`);

  // Task 25: handle autocomplete. Carol joins so Bob has two candidates;
  // "@c" filters to Carol, Enter completes without committing, Enter commits.
  const carol1 = await tab('Carol');
  check('Carol joins room 1', carol1.joined);
  check('Bob sees Carol in the roster', await bob.waitFor(`${text('.roster-handle')}.includes('Carol')`));
  await bob.focus(); await bob.type('@');
  check('Bob "@": the handle list opens with Alice and Carol',
    await bob.waitFor(`${text('[role="option"]')}.join('|') === '> Alice|  Carol'`), JSON.stringify(await bob.eval(text('[role="option"]'))));
  await bob.type('c');
  check('Bob "@c": the list narrows to Carol', await bob.waitFor(`${text('[role="option"]')}.join('|') === '> Carol'`));
  await bob.key('Enter', ENTER);
  check('Enter completes "@carol" in Bob\'s live line without committing',
    await bob.waitFor(`${text('.live-line')}.includes('@carol')`) && !(await bob.eval(`${text('.committed-line')}.some((l) => l.includes('@carol'))`)),
    JSON.stringify(await bob.eval(text('.live-line'))));
  check('the list is closed after the pick', await bob.waitFor(`!document.querySelector('[role="listbox"]')`));
  await bob.key('Enter', ENTER);
  check('a second Enter commits "@carol" in both tabs',
    await bob.waitFor(`${text('.committed-line')}.includes('@carol')`) && await alice.waitFor(`${text('.committed-line')}.includes('@carol')`));

  // Task 31: AFK follows tab visibility. Headless Chrome keeps the tabs of
  // one window, and Page.bringToFront on another tab hides this one and
  // fires a real visibilitychange, so the probe uses Chrome's own signal.
  // (Page.setWebLifecycleState leaves visibility untouched.) If a switch
  // does not change visibilityState within the timeout, the probe says so
  // and falls back to overriding document.hidden inside the page.
  const visibility = (t) => t.eval(`document.visibilityState`);
  const overrideHidden = (t, hidden) => t.eval(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} });
    document.dispatchEvent(new Event('visibilitychange'));
    return document.hidden === ${hidden};
  })()`);
  const show = async (t, others) => {
    await t.front();
    const real = await t.waitFor(`document.visibilityState === 'visible'`, 2000)
      && (await Promise.all(others.map((o) => o.waitFor(`document.visibilityState === 'hidden'`, 2000)))).every(Boolean);
    if (real) return true;
    console.log(`NOTE: Page.bringToFront left ${t.name} ${await visibility(t)}; emulating document.hidden instead`);
    await overrideHidden(t, false);
    for (const o of others) await overrideHidden(o, true);
    return false;
  };
  const rosterAfk = `Array.from(document.querySelectorAll('.roster-entry')).filter((e) => e.querySelector('.roster-afk')).map((e) => e.querySelector('.roster-handle').textContent)`;
  // Carol's lingering session tab is closed first so only Alice and Bob
  // trade the front. Carol keeps whatever visibility she last reported.
  await carol1.close();
  check("Carol's tab is closed", await alice.waitFor(`${text('.roster-handle')}.join('|') === 'Alice|Bob|Carol'`));
  const carolAfk = (await alice.eval(rosterAfk)).includes('Carol') ? ['Carol'] : [];
  const expectAfk = (names) => `${rosterAfk}.join('|') === ${JSON.stringify([...names, ...carolAfk].join('|'))}`;
  await show(alice, [bob]);
  check('Alice in front: Alice sees afk beside Bob and not beside herself', await alice.waitFor(expectAfk(['Bob'])), JSON.stringify(await alice.eval(rosterAfk)));
  check('Bob in the background sees his own afk marker', await bob.waitFor(expectAfk(['Bob'])));
  check('roster order is unchanged while Bob is afk',
    await alice.eval(`${text('.roster-handle')}.join('|') === 'Alice|Bob|Carol'`));
  await show(bob, [alice]);
  check('Bob in front: the marker moves from Bob to Alice', await alice.waitFor(expectAfk(['Alice'])), JSON.stringify(await alice.eval(rosterAfk)));

  // Task 18: a private line reaches one popup and never the transcript.
  const committedBeforePrivate = JSON.stringify(await bob.eval(text('.committed-line')));
  check('roster names share one font size whether or not they are buttons',
    await alice.eval(`(() => { const sizes = Array.from(document.querySelectorAll('.roster-entry'), (e) => getComputedStyle(e).fontSize); return sizes.length > 1 && sizes.every((s) => s === sizes[0] && s !== '16px'); })()`),
    JSON.stringify(await alice.eval(`Array.from(document.querySelectorAll('.roster-entry'), (e) => getComputedStyle(e).fontSize)`)));
  await alice.eval(`Array.from(document.querySelectorAll('button.roster-entry')).find((b) => b.textContent.trim() === 'Bob').click()`);
  check('Alice opens the private input under Bob',
    await alice.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Private message to Bob'`));
  await alice.type('lunch?'); await alice.key('Enter', ENTER);
  check("Bob sees the popup with Alice's text", await bob.waitFor(`${text('.private-text')}.includes('lunch?')`), JSON.stringify(await bob.eval(text('.private-text'))));
  check('the popup names Alice', await bob.eval(`${text('.private-from')}.includes('Alice')`));
  check('Alice sees "sent to Bob"', await alice.waitFor(has('sent to Bob')));
  check('neither transcript gained a line',
    JSON.stringify(await bob.eval(text('.committed-line'))) === committedBeforePrivate && !(await alice.eval(`${text('.committed-line')}.some((l) => l.includes('lunch?'))`)));
  check("Alice's keyboard is focused again", await alice.eval(`document.activeElement?.classList.contains('keyboard-capture')`));
  await bob.focus(); await bob.key('Escape', ESCAPE);
  check("Escape dismisses Bob's popup", await bob.waitFor(`!document.querySelector('.private-popup')`));

  // Task 17: a committed mention is colored and notifies the mentioned tab.
  await bob.focus(); await bob.type('hi @Alice ok'); await bob.key('Enter', ENTER);
  check('Alice sees "@Alice" as a colored mention span in Bob\'s committed line',
    await alice.waitFor(`(() => { const m = document.querySelector('.committed-line .mention[data-handle=\"Alice\"]'); return !!m && m.textContent === '@Alice' && m.dataset.handle === 'Alice'; })()`),
    JSON.stringify(await alice.eval(text('.committed-line'))));
  check('the mention span has Alice\'s roster color',
    await alice.eval(`(() => { const m = document.querySelector('.committed-line .mention[data-handle=\"Alice\"]'); const me = Array.from(document.querySelectorAll('.roster-entry')).find((e) => e.textContent.startsWith('Alice')); return !!m && !!me && getComputedStyle(m).color === getComputedStyle(me).color; })()`));
  check('Alice\'s title rotates "mentioned you"', await alice.waitFor(`document.title.includes('mentioned you')`, 2000), await alice.eval('document.title'));
  check('Bob\'s title does not', !(await bob.eval(`document.title.includes('mentioned you')`)));

  // A reload sends no leave: the reloaded page reconnects with the stored
  // session and keeps its participant, live text, and sequence position,
  // and the observer sees no leave/join lines. Same for a plain-URL load.
  await bob.focus(); await bob.type('xx');
  check('Bob live "xx" visible in both tabs before reload',
    await bob.waitFor(`${text('.live-line')}.includes('xx')`) && await alice.waitFor(`${text('.live-line')}.includes('xx')`));
  const bobIdBefore = await bob.eval(participantId);
  const aliceCommittedBefore = JSON.stringify(await alice.eval(text('.committed-line')));
  await bob.reload();
  check('Bob ?room reload: same participant ID',
    await bob.waitFor(inRoom, 8000) && (await bob.eval(participantId)) === bobIdBefore, `before=${bobIdBefore} after=${await bob.eval(participantId)}`);
  check('Bob ?room reload: live "xx" restored in both tabs',
    await bob.waitFor(`${text('.live-line')}.includes('xx')`, 8000) && await alice.waitFor(`${text('.live-line')}.includes('xx')`, 8000));
  check('Bob ?room reload: Alice transcript gains no leave/join lines',
    JSON.stringify(await alice.eval(text('.committed-line'))) === aliceCommittedBefore, JSON.stringify(await alice.eval(text('.committed-line'))));

  // Task 34: a duplicated tab copies sessionStorage. The page must not resume
  // the session another tab holds: it behaves like a pasted URL and shows the
  // lobby, while the original tab keeps its socket and participant.
  const aliceSession = await alice.eval(`sessionStorage.getItem('remart-bbs-chat.session')`);
  const aliceIdBefore = await alice.eval(participantId);
  const dup = await tab('Alice', 1, { url: `http://localhost:${PORT}/`, join: false });
  await dup.eval(`sessionStorage.setItem('remart-bbs-chat.session', ${JSON.stringify(aliceSession)}), true`);
  await dup.goto(`http://localhost:${PORT}/?name=Alice&room=1`);
  check('a duplicated tab shows the lobby instead of resuming the session', await dup.waitFor(has('ROOMS')));
  check('the duplicated tab dropped its copy of the session', await dup.waitFor(`sessionStorage.getItem('remart-bbs-chat.session') === null`));
  await sleep(1500);
  check("Alice's own tab keeps its participant and never reconnects",
    await alice.eval(inRoom) && await alice.eval(`${participantId} === ${aliceIdBefore}`) && !(await alice.eval(has('Reconnecting'))));
  check('the room still lists one Alice', await alice.eval(`${text('.roster-handle')}.filter((h) => h === 'Alice').length === 1`));
  await dup.close();
  await bob.goto(`http://localhost:${PORT}/`);
  check('Bob plain-URL load: same participant ID',
    await bob.waitFor(inRoom, 8000) && (await bob.eval(participantId)) === bobIdBefore, `after=${await bob.eval(participantId)}`);
  check('Bob plain-URL load: live "xx" restored; Alice transcript still unchanged',
    await bob.waitFor(`${text('.live-line')}.includes('xx')`, 8000) && JSON.stringify(await alice.eval(text('.committed-line'))) === aliceCommittedBefore);
  await bob.focus(); await bob.type('yy'); await bob.key('Enter', ENTER);
  check('Bob types after reload: "xxyy" committed in both tabs (sequence continues)',
    await bob.waitFor(`${text('.committed-line')}.includes('xxyy')`) && await alice.waitFor(`${text('.committed-line')}.includes('xxyy')`));

  await alice.focus(); await alice.type('q'); await alice.key('Enter', ENTER);
  check('"q" Enter returns Alice to the lobby', await alice.waitFor(has('ROOMS')));
  check('Bob sees "* Alice left"', await bob.waitFor(`${text('.committed-line')}.includes('* Alice left')`), JSON.stringify(await bob.eval(text('.committed-line'))));

  await stopServer(server);
  check('server stopped: Bob shows "Reconnecting..."', await bob.waitFor(has('Reconnecting...'), 8000));
  server = await startServer();
  check('server restarted: Bob shows "Room session ended. Join again."', await bob.waitFor(has('Room session ended. Join again.'), 8000));

  // Task 12: a newcomer sees the last 20 committed lines; the existing
  // viewer keeps all of them. A fresh room is needed because the restart
  // wiped room 1.
  const room2 = await (await fetch(`http://localhost:${PORT}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"forceNew":true}' })).json();
  const dave = await tab('Dave', room2.room.id);
  check('Dave joins room 2 and connects', dave.joined);
  await dave.focus();
  for (let i = 1; i <= 25; i++) { await dave.type(String(i)); await dave.key('Enter', ENTER); }
  check('Dave committed 25 numbered lines', await dave.waitFor(`${text('.committed-line')}.includes('25')`));
  const carol = await tab('Carol', room2.room.id);
  check('Carol joins room 2', carol.joined);
  const expected = [...Array.from({ length: 20 }, (_, i) => String(i + 6)), '* Carol joined'].join('|');
  check('Carol sees exactly the last 20 lines (6..25) plus her announcement',
    await carol.waitFor(`${text('.committed-line')}.join('|') === ${JSON.stringify(expected)}`, 8000), JSON.stringify(await carol.eval(text('.committed-line'))));
  check('Dave still sees all 25 lines plus the announcements',
    await dave.waitFor(`${text('.committed-line')}.length === 27`), JSON.stringify(await dave.eval(text('.committed-line'))));

  chrome.kill('SIGTERM');
  await new Promise((r) => chrome.on('exit', r));
  await stopServer(server);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still be flushing; the profile is in tmp */ }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
