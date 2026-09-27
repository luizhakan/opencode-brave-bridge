import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { mkdir, chmod, lstat, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function windowsSid() {
  try {
    const output = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const sid = output.match(/S-\d-\d+(?:-\d+)+/)?.[0];
    if (sid) return sid;
  } catch {}
  // Fallback to a stable per-account hash; named pipes use the OS's same-user ACL.
  return createHash('sha256').update(`${os.userInfo().uid}:${os.homedir()}`).digest('hex').slice(0, 32);
}

export const socketPath = process.platform === 'win32'
  ? `\\\\.\\pipe\\opencode-brave-bridge-${windowsSid()}`
  : path.join(os.homedir(), '.opencode', 'brave-bridge', 'bridge.sock');

export async function prepareEndpoint() {
  if (process.platform === 'win32') return;
  const dir = path.dirname(socketPath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

export function removeStaleSocket() {
  return new Promise((resolve, reject) => {
    const probe = net.createConnection(socketPath);
    probe.once('connect', () => { probe.destroy(); reject(Object.assign(new Error('Bridge socket already active'), { code: 'EADDRINUSE' })); });
    probe.once('error', async error => {
      if (error.code !== 'ECONNREFUSED' && error.code !== 'ENOENT') return reject(error);
      if (error.code === 'ECONNREFUSED') {
        try {
          const entry = await lstat(socketPath);
          if (!entry.isSocket() || entry.uid !== process.getuid()) return reject(new Error('Refusing to remove a foreign or non-socket path'));
          await unlink(socketPath);
        } catch (e) { if (e.code !== 'ENOENT') return reject(e); }
      }
      resolve();
    });
  });
}
