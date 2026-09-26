import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeNative, NativeFrameDecoder } from './framing.js';

test('native framing decodes fragmented and coalesced messages', () => {
  const a = encodeNative({ v: 1, id: 'a' }); const b = encodeNative({ v: 1, id: 'b' });
  const decoder = new NativeFrameDecoder();
  assert.deepEqual(decoder.push(a.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(Buffer.concat([a.subarray(2), b])), [{ v: 1, id: 'a' }, { v: 1, id: 'b' }]);
  decoder.end();
});
test('rejects oversized, malformed and truncated frames', () => {
  const decoder = new NativeFrameDecoder(8);
  assert.throws(() => decoder.push(Buffer.from([9, 0, 0, 0])), /length/);
  assert.throws(() => new NativeFrameDecoder().push(Buffer.from([1, 0, 0, 0, 0xff])), /JSON/);
  const truncated = new NativeFrameDecoder(); truncated.push(Buffer.from([2, 0, 0, 0, 0x7b]));
  assert.throws(() => truncated.end(), /Truncated/);
});
