import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supportUrl = new URL('./test-support.js', import.meta.url).href;

// Run node:test directly in one child process. A timeout kills that process,
// without leaving a test runner's grandchild holding the leaked sockets.
async function probe({ suite, authenticated, fails }) {
  const directory = await mkdtemp(join(tmpdir(), 'remart-harness-'));
  const file = join(directory, 'probe.mjs');
  const suiteUrl = suite && new URL(suite, import.meta.url).href;
  const source = `
    import { it, before, after } from 'node:test';
    import assert from 'node:assert/strict';
    import { serverModule, startServer, newRoom, join, connect, openSocket } from ${JSON.stringify(supportUrl)};
    ${suite ? `import ${JSON.stringify(suiteUrl)};` : `
      let closeServer;
      before(async () => { ({ close: closeServer } = await startServer()); });
      after(async () => { await closeServer(); });
    `}
    it('probe opens a socket without inline cleanup', async () => {
      const port = serverModule.server.address().port;
      const baseUrl = 'http://localhost:' + port;
      const wsUrl = 'ws://localhost:' + port + '/ws';
      ${authenticated ? `
        const roomId = await newRoom(baseUrl);
        const participant = await join(baseUrl, roomId, 'HarnessProbe');
        await connect(wsUrl, participant);
      ` : `
        const client = openSocket(wsUrl);
        await client.opened;
      `}
      ${fails ? "assert.fail('deliberate socket failure');" : ''}
    });
    ${suite ? `
      it('the next test inherits no accepted sockets', () => {
        assert.equal(serverModule.wss.clients.size, 0, 'socket leaked across tests');
      });
    ` : ''}
  `;
  try {
    await writeFile(file, source);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return await new Promise((resolve) => {
      execFile(process.execPath, [file], { env, timeout: 10000, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
        resolve({ error, output: stdout + stderr });
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Server test cleanup', { concurrency: true }, () => {
  for (const scenario of [
    { name: 'final teardown releases an authenticated socket after a failure', authenticated: true, fails: true },
    { name: 'final teardown releases an unauthenticated socket after a passing test', authenticated: false, fails: false },
    { name: 'WebSocket suite cleans a failed test before the next test', suite: './test-server-ws.js', authenticated: false, fails: true },
    { name: 'HTTP suite cleans a failed test before the next test', suite: './test-server-api.js', authenticated: true, fails: true },
  ]) {
    it(scenario.name, async () => {
      const { error, output } = await probe(scenario);
      assert.ok(!error?.killed, `Probe hung during teardown:\n${output}`);
      assert.equal(error?.code ?? 0, scenario.fails ? 1 : 0, output);
      if (scenario.fails) assert.match(output, /deliberate socket failure/);
      // One intentional failure only; setup, cleanup, and the next test must pass.
      assert.match(output, new RegExp(`# fail ${scenario.fails ? 1 : 0}\\b`));
      if (scenario.suite) assert.match(output, /ok \d+ - the next test inherits no accepted sockets/);
    });
  }
});
