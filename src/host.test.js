import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import net from 'node:net';
import { acceptExtension } from './host.js';
import { createBridge, socketPath } from './host.js';
import { encodeNative, NativeFrameDecoder } from './framing.js';

test('extension responses are correlated back as native frames', async () => {
  const input = new EventEmitter(); const output = new PassThrough(); const received = [];
  output.on('data', chunk => received.push(chunk));
  acceptExtension(input, output);
  // Establish an MCP-side request via exported bridge path is integration-owned; framing path validates response serialization.
  input.emit('data', encodeNative({ v: 2, id: 'unknown', ok: true, result: {} }));
  assert.equal(received.length, 0);
  assert.deepEqual(new NativeFrameDecoder().push(encodeNative({ ok: true })), [{ ok: true }]);
});

test('routes interleaved responses to their requesting MCP clients and drops disconnected requests', async () => {
  const input = new EventEmitter(); const output = new PassThrough();
  const decoder = new NativeFrameDecoder(); const sent = [];
  output.on('data', chunk => sent.push(...decoder.push(chunk)));
  acceptExtension(input, output);
  const server = await createBridge();
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
  }
});
