import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NativeFrameDecoder, encodeNative } from './framing.js';

const hostPath = fileURLToPath(new URL('./host.js', import.meta.url));

function waitForEvent(emitter, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}`)); }, timeout);
    const cleanup = () => { clearTimeout(timer); emitter.removeListener(event, onEvent); emitter.removeListener('error', onError); };
    const onEvent = (...args) => { cleanup(); resolve(args); };
    const onError = error => { cleanup(); reject(error); };
    emitter.once(event, onEvent);
    emitter.once('error', onError);
  });
}

async function connectWhenReady(socketPath, child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Host exited early (${child.exitCode})`);
    const socket = net.createConnection(socketPath);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Connection timed out')), 500);
        const finish = error => {
          clearTimeout(timer);
          socket.removeListener('connect', onConnect);
          socket.removeListener('error', onError);
          error ? reject(error) : resolve();
        };
        const onConnect = () => finish();
        const onError = error => finish(error);
        socket.once('connect', onConnect);
        socket.once('error', onError);
      });
      return socket;
    } catch {
      socket.destroy();
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  throw new Error('Host MCP socket did not become ready');
}

test('native host bridges a newline MCP request and cleans up on stdin EOF', async t => {
  // Unix-domain socket paths have a small platform limit; keep the isolated HOME short.
  const home = await mkdtemp(path.join(os.tmpdir().startsWith('/var/') ? '/tmp' : os.tmpdir(), 'bb-'));
  const socketPath = path.join(home, '.opencode', 'brave-bridge', 'bridge.sock');
  const child = spawn(process.execPath, [hostPath], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const decoder = new NativeFrameDecoder();
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGKILL'); await waitForEvent(child, 'exit').catch(() => {}); }
    await rm(home, { recursive: true, force: true });
  });

  let nativeFrame;
  const nativeRequest = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Host did not emit native request')), 5000);
    child.stdout.on('data', chunk => {
      try {
        const messages = decoder.push(chunk);
        const requests = messages.filter(message => message.event !== 'ready');
        if (requests.length) { clearTimeout(timer); nativeFrame = requests[0]; resolve(requests[0]); }
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  });

  let socket;
  try { socket = await connectWhenReady(socketPath, child); }
  catch (error) { throw new Error(`${error.message}${stderr ? `: ${stderr}` : ''}`); }
  t.after(() => socket.destroy());
  socket.write(`${JSON.stringify({ v: 2, id: 'integration-1', op: 'group.status', ctx: { project: '/fixture', session: 'ses_fixture' }, params: {} })}\n`);

  const request = await nativeRequest;
  assert.equal(request.v, 2);
  assert.match(request.id, new RegExp(`^${child.pid}-\\d+$`));
  assert.equal(request.op, 'group.status');
  assert.deepEqual(request.params, {});
  assert.ok(nativeFrame);

  const responsePromise = waitForEvent(socket, 'data');
  child.stdin.write(encodeNative({ v: 2, id: request.id, ok: true, result: { authorized: true } }));
  const [chunk] = await responsePromise;
  const response = JSON.parse(chunk.toString().split('\n').find(Boolean));
  assert.deepEqual(response, { v: 2, id: 'integration-1', ok: true, result: { authorized: true } });

  const exited = waitForEvent(child, 'exit');
  child.stdin.end();
  const [code, signal] = await exited;
  assert.equal(code, 0, stderr);
  assert.equal(signal, null);
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await stat(socketPath); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Host exited without removing its MCP socket');
});
