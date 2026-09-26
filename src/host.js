import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chmod, unlink } from 'node:fs/promises';
import { NativeFrameDecoder, encodeNative } from './framing.js';

export const socketPath = process.platform === 'win32'
  ? `\\\\.\\pipe\\opencode-brave-bridge-${process.env.USERNAME || 'user'}`
  : path.join(os.tmpdir(), `opencode-brave-bridge-${process.getuid?.() ?? 'user'}.sock`);

const pending = new Map();
let extension;
let nextId = 0;
let mcpSocket;
let lineBuffer = '';

function disconnect(reason = 'Browser extension disconnected') {
  if (extension) { extension.destroy(); extension = undefined; }
  for (const [id, resolve] of pending) resolve({ v: 1, id, ok: false, error: { code: 'E_DISCONNECTED', message: reason } });
  pending.clear();
}

export function createBridge() {
  const server = net.createServer((socket) => {
    if (mcpSocket) { socket.destroy(); return; }
    mcpSocket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      lineBuffer += chunk;
      if (Buffer.byteLength(lineBuffer) > 1024 * 1024) { socket.destroy(); return; }
      let newline;
      while ((newline = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newline); lineBuffer = lineBuffer.slice(newline + 1);
        let request;
        try { request = JSON.parse(line); } catch { sendMcp({ id: null, ok: false, error: { code: 'E_PROTOCOL', message: 'Invalid JSON request' } }); continue; }
        if (!request || request.v !== 1 || typeof request.id !== 'string' || typeof request.op !== 'string' || !request.params || typeof request.params !== 'object') {
          sendMcp({ id: request?.id ?? null, ok: false, error: { code: 'E_PROTOCOL', message: 'Invalid request' } }); continue;
        }
        if (!extension || extension.destroyed) { sendMcp({ id: request.id, ok: false, error: { code: 'E_DISCONNECTED', message: 'Browser extension disconnected' } }); continue; }
        const id = `${process.pid}-${++nextId}`;
        pending.set(id, (response) => sendMcp({ ...response, id: request.id }));
        try { extension.write(encodeNative({ ...request, id })); }
        catch { pending.delete(id); sendMcp({ id: request.id, ok: false, error: { code: 'E_BRIDGE', message: 'Unable to send request' } }); }
      }
    });
    socket.on('close', () => { if (mcpSocket === socket) { mcpSocket = undefined; lineBuffer = ''; } });
    socket.on('error', () => {});
  });
  server.on('error', (error) => { if (error.code !== 'EADDRINUSE') process.exitCode = 1; });
  server.listen(socketPath, async () => {
    if (process.platform !== 'win32') { try { await chmod(socketPath, 0o600); } catch {} }
  });
  return server;
}

function sendMcp(value) { if (mcpSocket && !mcpSocket.destroyed) mcpSocket.write(`${JSON.stringify(value)}\n`); }

export function acceptExtension(input = process.stdin, output = process.stdout) {
  const decoder = new NativeFrameDecoder();
  input.on('data', (chunk) => {
    try {
      for (const message of decoder.push(chunk)) {
        if (!message || typeof message.id !== 'string') continue;
        const resolve = pending.get(message.id);
        if (resolve) { pending.delete(message.id); resolve(message); }
      }
    } catch { disconnect('Invalid browser message'); process.exitCode = 1; }
  });
  input.on('end', () => { try { decoder.end(); } catch {} disconnect(); });
  input.on('error', () => disconnect());
  // Native protocol stdout is reserved exclusively for framed messages.
  output.on('error', () => disconnect());
  extension = { destroyed: false, write(frame) { output.write(frame); }, destroy() { this.destroyed = true; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createBridge();
  acceptExtension();
  process.on('SIGTERM', () => { disconnect(); process.exit(0); });
  process.on('SIGINT', () => { disconnect(); process.exit(0); });
}
