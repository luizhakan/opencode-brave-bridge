import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { unlink } from 'node:fs/promises';
import { socketPath, prepareEndpoint, removeStaleSocket } from './endpoint.js';
import { NativeFrameDecoder, encodeNative } from './framing.js';

export { socketPath };

const pending = new Map();
const clients = new Set();
let extension;
let nextId = 0;
let serverInstance;

function disconnect(reason = 'Browser extension disconnected') {
  if (extension) { extension.destroy(); extension = undefined; }
  for (const [id, item] of pending) { clearTimeout(item.timer); item.resolve({ v: 2, id, ok: false, error: { code: 'E_DISCONNECTED', message: reason } }); }
  pending.clear();
}

export async function createBridge() {
  await prepareEndpoint();
  await removeStaleSocket();
   const server = net.createServer((socket) => {
     if (clients.size >= 16) { socket.destroy(); return; }
     const client = { socket, lineBuffer: '', pending: new Set() };
     clients.add(client);
     socket.setEncoding('utf8');
     socket.on('data', (chunk) => {
       client.lineBuffer += chunk;
       if (Buffer.byteLength(client.lineBuffer) > 1024 * 1024) { socket.destroy(); return; }
       let newline;
       while ((newline = client.lineBuffer.indexOf('\n')) !== -1) {
         const line = client.lineBuffer.slice(0, newline); client.lineBuffer = client.lineBuffer.slice(newline + 1);
         let request;
         try { request = JSON.parse(line); } catch { sendMcp(client, { id: null, ok: false, error: { code: 'E_PROTOCOL', message: 'Invalid JSON request' } }); continue; }
         if (!request || request.v !== 2 || typeof request.id !== 'string' || typeof request.op !== 'string' || !request.ctx || typeof request.ctx.project !== 'string' || typeof request.ctx.session !== 'string' || !request.params || typeof request.params !== 'object') {
           sendMcp(client, { id: request?.id ?? null, ok: false, error: { code: 'E_PROTOCOL', message: 'Invalid request' } }); continue;
         }
         if (client.pending.size >= 32 || pending.size >= 128) { sendMcp(client, { id: request.id, ok: false, error: { code: 'E_BUSY', message: 'Too many pending requests' } }); continue; }
         if (!extension || extension.destroyed) { sendMcp(client, { id: request.id, ok: false, error: { code: 'E_DISCONNECTED', message: 'Browser extension disconnected' } }); continue; }
         const id = `${process.pid}-${++nextId}`;
         const timer = setTimeout(() => { pending.delete(id); client.pending.delete(id); sendMcp(client, { id: request.id, ok: false, error: { code: 'E_TIMEOUT', message: 'Bridge request timed out' } }); }, 15000);
         client.pending.add(id);
         pending.set(id, { timer, client, resolve: response => { clearTimeout(timer); client.pending.delete(id); sendMcp(client, { ...response, id: request.id }); } });
         try { extension.write(encodeNative({ ...request, id })); }
         catch { const item = pending.get(id); if (item) clearTimeout(item.timer); pending.delete(id); client.pending.delete(id); sendMcp(client, { id: request.id, ok: false, error: { code: 'E_BRIDGE', message: 'Unable to send request' } }); }
       }
     });
     socket.on('close', () => {
       clients.delete(client);
       for (const id of client.pending) { const item = pending.get(id); if (item) clearTimeout(item.timer); pending.delete(id); }
       client.pending.clear();
     });
    socket.on('error', () => {});
  });
  server.on('error', (error) => { process.exitCode = 1; server.emit('bridgeError', error); });
  server.listen(socketPath, async () => {
    if (process.platform !== 'win32') { const { chmod } = await import('node:fs/promises'); await chmod(socketPath, 0o600); }
  });
  server.on('close', () => { if (process.platform !== 'win32') unlink(socketPath).catch(() => {}); });
  serverInstance = server;
  return server;
}

function sendMcp(client, value) { if (client?.socket && !client.socket.destroyed) client.socket.write(`${JSON.stringify(value)}\n`); }

export function acceptExtension(input = process.stdin, output = process.stdout) {
  const decoder = new NativeFrameDecoder();
  input.on('data', (chunk) => {
    try {
      for (const message of decoder.push(chunk)) {
        if (!message || typeof message.id !== 'string') continue;
        const item = pending.get(message.id);
        if (item) { pending.delete(message.id); item.resolve(message); }
      }
    } catch { disconnect('Invalid browser message'); process.exitCode = 1; }
  });
  input.on('end', () => {
    try { decoder.end(); } catch {}
    disconnect();
    for (const client of clients) client.socket.destroy();
    serverInstance?.close();
  });
  input.on('error', () => disconnect());
  // Native protocol stdout is reserved exclusively for framed messages.
  output.on('error', () => disconnect());
  extension = { destroyed: false, write(frame) { output.write(frame); }, destroy() { this.destroyed = true; } };
  output.write(encodeNative({ v: 2, event: 'ready' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await createBridge();
  acceptExtension();
  process.on('SIGTERM', () => { disconnect(); process.exit(0); });
  process.on('SIGINT', () => { disconnect(); process.exit(0); });
}
