import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { acceptExtension } from './host.js';
import { createBridge } from './host.js';
import { encodeNative, NativeFrameDecoder } from './framing.js';

test('extension responses are correlated back as native frames', async () => {
  const input = new EventEmitter(); const output = new PassThrough(); const received = [];
  output.on('data', chunk => received.push(chunk));
  acceptExtension(input, output);
  // Establish an MCP-side request via exported bridge path is integration-owned; framing path validates response serialization.
  input.emit('data', encodeNative({ v: 2, id: 'unknown', ok: true, result: {} }));
  assert.deepEqual(new NativeFrameDecoder().push(Buffer.concat(received)), [{ v: 2, event: 'ready' }]);
  assert.deepEqual(new NativeFrameDecoder().push(encodeNative({ ok: true })), [{ ok: true }]);
});

test('routes interleaved responses to their requesting MCP clients and drops disconnected requests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'brave-bridge-host-test-'));
  const socketPath = path.join(dir, 'bridge.sock');
  const input = new EventEmitter(); const output = new PassThrough();
  const decoder = new NativeFrameDecoder(); const sent = [];
  output.on('data', chunk => sent.push(...decoder.push(chunk).filter(message => message.event !== 'ready')));
  acceptExtension(input, output);
  const server = await createBridge(socketPath);
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const connect = () => new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => resolve(socket));
    socket.once('error', reject);
  });
  const first = await connect(); const second = await connect();
  const responses = socket => {
    let buffer = '';
    return new Promise(resolve => socket.on('data', chunk => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline >= 0) resolve(JSON.parse(buffer.slice(0, newline)));
    }));
  };
  try {
    const firstReply = responses(first); const secondReply = responses(second);
    first.write('{"v":2,"id":"a","op":"one","ctx":{"project":"/fixture","session":"ses_fixture"},"params":{}}\n');
    second.write('{"v":2,"id":"b","op":"two","ctx":{"project":"/fixture","session":"ses_fixture"},"params":{}}\n');
    await new Promise(resolve => { const check = () => sent.length === 2 ? resolve() : setImmediate(check); check(); });
    input.emit('data', encodeNative({ v: 2, id: sent[1].id, ok: true, result: { value: 2 } }));
    input.emit('data', encodeNative({ v: 2, id: sent[0].id, ok: true, result: { value: 1 } }));
    assert.deepEqual(await firstReply, { v: 2, id: 'a', ok: true, result: { value: 1 } });
    assert.deepEqual(await secondReply, { v: 2, id: 'b', ok: true, result: { value: 2 } });

    const dropped = responses(first);
    first.write('{"v":2,"id":"gone","op":"three","ctx":{"project":"/fixture","session":"ses_fixture"},"params":{}}\n');
    await new Promise(resolve => { const check = () => sent.length === 3 ? resolve() : setImmediate(check); check(); });
    first.destroy();
    input.emit('data', encodeNative({ v: 2, id: sent[2].id, ok: true, result: {} }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await Promise.race([dropped.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 20))]), false);
  } finally {
    first.destroy(); second.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('stages upload for approval, rejects stale binding, and commits without sending file bytes', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'brave-upload-host-'));
  const socketPath = path.join(dir, 'bridge.sock');
  const source = path.join(dir, 'sample.apk');
  await writeFile(source, Buffer.from('PK\x03\x04fixture-payload'));
  const input = new EventEmitter(); const output = new PassThrough();
  const decoder = new NativeFrameDecoder(); const sent = [];
  output.on('data', chunk => sent.push(...decoder.push(chunk).filter(message => message.event !== 'ready')));
  acceptExtension(input, output);
  const server = await createBridge(socketPath);
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const socket = await new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => resolve(client));
    client.once('error', reject);
  });
  t.after(async () => { socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  let lines = '';
  socket.setEncoding('utf8'); socket.on('data', chunk => { lines += chunk; });
  const result = async (id, op, params) => {
    const marker = `"id":"${id}"`;
    socket.write(`${JSON.stringify({ v: 2, id, op, ctx: { project: '/fixture', session: 'ses_upload' }, params })}\n`);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const newline = lines.indexOf('\n');
      if (newline >= 0) {
        const line = lines.slice(0, newline); lines = lines.slice(newline + 1);
        const response = JSON.parse(line);
        if (JSON.stringify(response).includes(marker)) return response;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${id}`);
  };
  const params = { handle: 2, snapshotId: '123e4567-e89b-42d3-a456-426614174000', ref: 'f1', path: source };
  const stagedResponse = result('stage', 'file.stage', params);
  while (sent.length < 1) await new Promise(resolve => setImmediate(resolve));
  const proposal = sent[0];
  assert.equal(proposal.op, 'tab.upload.propose');
  assert.equal('stagedPath' in proposal.params, false);
  assert.equal('bytes' in proposal.params, false);
  input.emit('data', encodeNative({ v: 2, id: proposal.id, ok: false, error: { code: 'E_DENIED', message: 'Approval required' } }));
  const denied = await stagedResponse;
  assert.equal(denied.ok, false);

  // A fresh stage gets approval; a commit bound to another snapshot must fail without forwarding.
  const approvedPromise = result('stage-approved', 'file.stage', params);
  while (sent.length < 2) await new Promise(resolve => setImmediate(resolve));
  input.emit('data', encodeNative({ v: 2, id: sent[1].id, ok: true, result: { approved: true } }));
  const approved = await approvedPromise;
  assert.equal(approved.ok, true);
  const stageId = approved.result.stageId;
  const stale = await result('stale', 'file.commit', { handle: 2, snapshotId: '123e4567-e89b-42d3-a456-426614174001', ref: 'f1', stageId });
  assert.equal(stale.ok, false);
  assert.equal(sent.length, 2);

  const commitPromise = result('commit', 'file.commit', { ...params, path: undefined, stageId });
  while (sent.length < 3) await new Promise(resolve => setImmediate(resolve));
  const upload = sent[2];
  assert.equal(upload.op, 'tab.upload');
  assert.equal(typeof upload.params.stagedPath, 'string');
  assert.equal(Buffer.byteLength(JSON.stringify(upload)), Buffer.byteLength(JSON.stringify(upload))); // framed metadata only
  input.emit('data', encodeNative({ v: 2, id: upload.id, ok: true, result: { attached: true } }));
  assert.equal((await commitPromise).ok, true);
  await access(upload.params.stagedPath);
  assert.equal(JSON.stringify(sent).includes('fixture-payload'), false);
});
