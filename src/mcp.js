import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const socketPath = process.platform === 'win32'
  ? `\\\\.\\pipe\\opencode-brave-bridge-${process.env.USERNAME || 'user'}`
  : path.join(os.tmpdir(), `opencode-brave-bridge-${process.getuid?.() ?? 'user'}.sock`);
function projectRoot(cwd = process.cwd()) {
  const absolute = path.resolve(cwd);
  try { return path.resolve(execFileSync('git', ['-C', absolute, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
  catch { return absolute; }
}

export function createMcpServer({ socket = socketPath, project = projectRoot() } = {}) {
  const server = new McpServer({ name: 'opencode-brave-bridge', version: '1.0.0' });
  let connection;
  let input = '';
  const pending = new Map();
  function connect() {
    if (connection && !connection.destroyed) return connection;
    const s = net.createConnection(socket);
    connection = s; s.setEncoding('utf8');
    s.on('data', (chunk) => {
      input += chunk;
      if (Buffer.byteLength(input) > 1024 * 1024) { s.destroy(); return; }
      let i;
      while ((i = input.indexOf('\n')) >= 0) {
        const line = input.slice(0, i); input = input.slice(i + 1);
        let response; try { response = JSON.parse(line); } catch { continue; }
        const resolve = pending.get(response.id); if (resolve) { pending.delete(response.id); resolve(response); }
      }
    });
    const failAll = () => { for (const resolve of pending.values()) resolve({ ok: false, error: { code: 'E_DISCONNECTED', message: 'Bridge host disconnected' } }); pending.clear(); };
    s.on('error', failAll); s.on('close', failAll);
    return s;
  }
  function call(op, params) {
    return new Promise((resolve) => {
      const id = randomUUID(); const s = connect(); pending.set(id, resolve);
      s.once('connect', () => s.write(`${JSON.stringify({ v: 1, id, op, params: { project, ...params } })}\n`));
      if (!s.connecting && !s.destroyed) s.write(`${JSON.stringify({ v: 1, id, op, params: { project, ...params } })}\n`);
    });
  }
  function tool(name, description, schema, op, params) {
    server.tool(name, description, schema, async (args) => {
      const response = await call(op, params(args));
      if (!response.ok) return { isError: true, content: [{ type: 'text', text: `${response.error?.code || 'E_BRIDGE'}: ${response.error?.message || 'Request failed'}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(response.result) }] };
    });
  }
  tool('group_status', 'Get authorization status for this project', {}, 'group.status', () => ({}));
  tool('list_tabs', 'List tabs available in the authorized group', {}, 'tabs.list', () => ({}));
  tool('snapshot', 'Read a sanitized snapshot of a tab', { handle: z.number().int() }, 'tab.snapshot', ({ handle }) => ({ handle }));
  tool('open_tab', 'Open an approved URL in an inactive tab', { url: z.string().url() }, 'tab.open', ({ url }) => ({ url }));
  tool('navigate_tab', 'Navigate an inactive tab to an approved URL', { handle: z.number().int(), url: z.string().url() }, 'tab.navigate', ({ handle, url }) => ({ handle, url }));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
