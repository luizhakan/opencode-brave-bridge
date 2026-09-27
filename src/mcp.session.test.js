import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromExtra } from './mcp.js';

test('uses the OpenCode session ID from tool-call metadata', () => {
  assert.equal(sessionFromExtra({ _meta: { sessionID: 'ses_abc-123_X' } }, 'fallback'), 'ses_abc-123_X');
});

test('uses process fallback when metadata is absent or invalid', () => {
  for (const extra of [undefined, {}, { _meta: {} }, { _meta: { sessionID: '' } },
    { _meta: { sessionID: 'bad/session' } }, { _meta: { sessionID: 'x'.repeat(257) } },
    { _meta: { sessionID: 123 } }]) {
    assert.equal(sessionFromExtra(extra, 'process-fallback'), 'process-fallback');
  }
});
