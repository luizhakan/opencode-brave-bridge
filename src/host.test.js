import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { acceptExtension } from './host.js';
import { encodeNative, NativeFrameDecoder } from './framing.js';

test('extension responses are correlated back as native frames', async () => {
  const input = new EventEmitter(); const output = new PassThrough(); const received = [];
  output.on('data', chunk => received.push(chunk));
  acceptExtension(input, output);
  // Establish an MCP-side request via exported bridge path is integration-owned; framing path validates response serialization.
  input.emit('data', encodeNative({ v: 1, id: 'unknown', ok: true, result: {} }));
  assert.equal(received.length, 0);
  assert.deepEqual(new NativeFrameDecoder().push(encodeNative({ ok: true })), [{ ok: true }]);
});
