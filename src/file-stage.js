import { constants, createReadStream } from 'node:fs';
import { open, realpath, mkdir, chmod, stat, lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_UPLOAD_SIZE = 256 * 1024 * 1024;
const TTL = 30 * 60 * 1000;
const dataHome = process.env.XDG_DATA_HOME || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), '.local', 'share'));
const directory = path.join(dataHome, 'opencode-brave-bridge', 'staging');
const stages = new Map();
const MAX_STAGES = 3;
const MAX_TOTAL = 512 * 1024 * 1024;
let stagingCount = 0, stagingBytes = 0;

function fail(message) { const error = new Error(message); error.code = 'E_UPLOAD'; throw error; }
function bound(ctx, p) { return { project: ctx.project, session: ctx.session, handle: p.handle, snapshotId: p.snapshotId, ref: p.ref }; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function digest(file) { return new Promise((resolve, reject) => { const hash = createHash('sha256'); createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex'))); }); }

export async function stageFile(ctx, params) {
  const { handle, snapshotId, ref } = params;
  const filePath = params.path;
  if (!Number.isInteger(handle) || !/^[0-9a-f-]{36}$/i.test(snapshotId || '') || !/^f[1-9]\d{0,2}$/.test(ref || '') || typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0')) fail('Invalid upload parameters');
  const sourceReal = await realpath(filePath).catch(() => fail('File does not exist or cannot be accessed'));
  let source;
  try { source = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0)); } catch { fail('File must not be a symlink and must be readable'); }
  const sourceStat = await source.stat();
  const realStat = await stat(sourceReal);
  if (sourceStat.dev !== realStat.dev || sourceStat.ino !== realStat.ino) { await source.close(); fail('Source changed while opening'); }
  if (!sourceStat.isFile() || sourceStat.nlink !== 1 || !/\.(aab|apk)$/i.test(sourceReal)) { await source.close(); fail('Upload must be a regular .aab or .apk file without hard links'); }
  if (sourceStat.size > MAX_UPLOAD_SIZE) { await source.close(); fail('File exceeds the 256 MiB upload limit'); }
  const signature=Buffer.alloc(4);
  if((await source.read(signature,0,4,0)).bytesRead!==4||!signature.equals(Buffer.from([0x50,0x4b,0x03,0x04]))){await source.close();fail('Upload must be a ZIP-based Android package');}
  await ensureInitialized();
  prune();
  if (params.stageId !== undefined || stages.size + stagingCount >= MAX_STAGES || [...stages.values()].reduce((sum, item) => sum + item.size, stagingBytes) + sourceStat.size > MAX_TOTAL) { await source.close(); fail('Staging capacity exceeded or stageId is not allowed'); }
  stagingCount++; stagingBytes += sourceStat.size;
  const stageId = randomUUID();
  const stageDir = path.join(directory, stageId);
  const stagedPath = path.join(stageDir, path.basename(sourceReal).replace(/[^A-Za-z0-9._-]/g, '_'));
  let target;
  try {
    await mkdir(stageDir, { mode: 0o700 });
    target = await open(stagedPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    const hash = createHash('sha256'); let size = 0; const buffer = Buffer.alloc(1024 * 1024);
    for (;;) { const { bytesRead } = await source.read(buffer, 0, buffer.length, size); if (!bytesRead) break; size += bytesRead; if (size > MAX_UPLOAD_SIZE) fail('File exceeds the 256 MiB upload limit'); hash.update(buffer.subarray(0, bytesRead)); let written=0; while(written<bytesRead){const part=await target.write(buffer, written, bytesRead-written);if(!part.bytesWritten)fail('Unable to finish staged file');written+=part.bytesWritten;} }
    await target.sync(); await target.close(); target = undefined; await chmod(stagedPath, 0o400);
    const after = await source.stat();
    if (after.dev !== sourceStat.dev || after.ino !== sourceStat.ino || after.size !== sourceStat.size || after.mtimeMs !== sourceStat.mtimeMs) fail('Source changed during copy');
    const record = { stageId, stagedPath, name: path.basename(stagedPath), displayPath: sourceReal, size, sha256: hash.digest('hex'), binding: bound(ctx, params), expires: Date.now() + TTL };
    stages.set(stageId, record); return { ...record, pending: true };
  } catch (error) { if (target) await target.close().catch(() => {}); await rm(stageDir, { recursive: true, force: true }).catch(() => {}); if (error.code === 'E_UPLOAD') throw error; fail('Unable to stage upload file'); }
  finally { stagingCount--; stagingBytes -= sourceStat.size; await source.close(); }
}

export async function getStage(ctx, params) {
  const record = stages.get(params.stageId);
  if (!record || record.expires < Date.now()) { if (record) await removeStage(record); fail('Staged upload expired or does not exist'); }
  if (!same(record.binding, bound(ctx, params))) fail('Stage binding does not match this session and snapshot');
  const info = await stat(record.stagedPath).catch(() => fail('Staged upload is unavailable'));
  if (!info.isFile() || info.size !== record.size || await digest(record.stagedPath) !== record.sha256) fail('Staged upload integrity check failed');
  return record;
}

async function initialize() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail('Unsafe staging directory');
  for (const name of await readdir(directory)) {
    if(!/^[0-9a-f-]{36}$/.test(name))continue;
    const item=path.join(directory,name),details=await lstat(item).catch(()=>null);
    if(details?.isDirectory()&&Date.now()-details.mtimeMs>TTL)await rm(item,{recursive:true,force:true});
  }
}
let initialized = false;
let initialization;
async function ensureInitialized() { if (initialized) return; if (!initialization) initialization = initialize().then(() => { initialized = true; }); await initialization; }
function prune() { for (const record of stages.values()) if (record.expires <= Date.now()) void removeStage(record); }
const cleanup = setInterval(prune, 60 * 1000);
cleanup.unref?.();
async function removeStage(record) { stages.delete(record.stageId); await rm(path.dirname(record.stagedPath), { recursive: true, force: true }); }
export async function discardStage(ctx, params) { const record = await getStage(ctx, params); await removeStage(record); return { stageId: record.stageId, discarded: true }; }
