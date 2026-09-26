export const MAX_MESSAGE_BYTES = 1024 * 1024;

export function encodeNative(message, maxBytes = MAX_MESSAGE_BYTES) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > maxBytes) throw new Error('Message exceeds size limit');
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

// Incremental decoder: a bad length or malformed JSON fails closed.
export class NativeFrameDecoder {
  constructor(maxBytes = MAX_MESSAGE_BYTES) { this.maxBytes = maxBytes; this.buffer = Buffer.alloc(0); }
  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    const messages = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > this.maxBytes) throw new Error('Invalid native message length');
      if (this.buffer.length < length + 4) break;
      const body = this.buffer.subarray(4, length + 4);
      let value;
      try { value = JSON.parse(body.toString('utf8')); } catch { throw new Error('Invalid JSON message'); }
      messages.push(value);
      this.buffer = this.buffer.subarray(length + 4);
    }
    return messages;
  }
  end() { if (this.buffer.length) throw new Error('Truncated native message'); }
}
