// End-to-end check with two browser tabs, driven over the Chrome DevTools
// protocol against a headless Chrome. Starts its own server on CHECK_PORT
// (default 3001) from the built client, so run `npm run build` first.
//
//   npm run check:browser
//
// Alice and Bob join one room. Typing, Backspace, Enter, the ?, l, and q
// commands, a page reload, and a server restart are exercised and every
// observation is printed as PASS or FAIL. Exit code 1 if anything failed.
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

  const tab = async (name) => {
    const { targetId } = await cdp.send('Target.createTarget', { url: `http://localhost:${PORT}/?name=${name}&room=1` });
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
    };
    return t;
  };
  // Expressions evaluated in the page.
  const text = (sel) => `Array.from(document.querySelectorAll('${sel}')).map(e => e.textContent.replace(/\\s+$/, ''))`;
  const has = (needle) => `document.body.innerText.includes(${JSON.stringify(needle)})`;
  const inRoom = `document.querySelector('[aria-label="Shared chat area"]') && !${has('Connecting...')}`;
  const participantId = `JSON.parse(sessionStorage.getItem('remart-bbs-chat.session')).participantId`;

  const alice = await tab('Alice');
  const bob = await tab('Bob');
  for (const t of [alice, bob]) check(`${t.name} joins room 1 and connects`, await t.waitFor(inRoom));
  check('Alice sees "* Bob joined"; Bob sees only his own join (Alice\'s predates his joinedAt)',
    await alice.waitFor(`${text('.committed-line')}.includes('* Bob joined')`) && await bob.waitFor(`${text('.committed-line')}.join('|') === '* Bob joined'`),
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

  await alice.type('?'); await alice.key('Enter', ENTER);
  check('"?" Enter opens help in Alice\'s tab only', await alice.waitFor(`!!document.querySelector('.help-overlay')`) && !(await bob.eval(`!!document.querySelector('.help-overlay')`)));
  check('"?" was not committed as chat', !(await alice.eval(`${text('.committed-line')}.includes('?')`)));
  await alice.key('Escape', ESCAPE);
  check('Escape closes help', await alice.waitFor(`!document.querySelector('.help-overlay')`));

  await alice.focus(); await alice.type('l'); await alice.key('Enter', ENTER);
  check('"l" Enter shows "Roster refreshed"', await alice.waitFor(has('Roster refreshed')));

  // A reload fires pagehide, whose leave beacon removes Bob; the reloaded
  // page's ?room=1 then joins him again as a new participant.
  const bobIdBefore = await bob.eval(participantId);
  await bob.reload();
  check('Bob reload: Alice sees "* Bob left" then "* Bob joined" (pagehide beacon, then auto-rejoin)',
    await alice.waitFor(`${text('.committed-line')}.slice(-2).join('|') === '* Bob left|* Bob joined'`, 8000), JSON.stringify(await alice.eval(text('.committed-line'))));
  check('Bob reload: back in the room as a new participant with a fresh transcript',
    await bob.waitFor(`${inRoom} && ${text('.committed-line')}.join('|') === '* Bob joined'`, 8000) && (await bob.eval(participantId)) !== bobIdBefore);
  await bob.focus(); await bob.type('yo'); await bob.key('Enter', ENTER);
  check('Bob types after reload: "yo" committed in both tabs', await bob.waitFor(`${text('.committed-line')}.includes('yo')`) && await alice.waitFor(`${text('.committed-line')}.includes('yo')`));

  await alice.focus(); await alice.type('q'); await alice.key('Enter', ENTER);
  check('"q" Enter returns Alice to the lobby', await alice.waitFor(has('ROOMS')));
  check('Bob sees "* Alice left"', await bob.waitFor(`${text('.committed-line')}.includes('* Alice left')`), JSON.stringify(await bob.eval(text('.committed-line'))));

  await stopServer(server);
  check('server stopped: Bob shows "Reconnecting..."', await bob.waitFor(has('Reconnecting...'), 8000));
  server = await startServer();
  check('server restarted: Bob shows "Room session ended. Join again."', await bob.waitFor(has('Room session ended. Join again.'), 8000));

  chrome.kill('SIGTERM');
  await new Promise((r) => chrome.on('exit', r));
  await stopServer(server);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still be flushing; the profile is in tmp */ }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
