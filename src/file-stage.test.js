import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, link, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageFile, getStage, discardStage, MAX_UPLOAD_SIZE } from './file-stage.js';

test('stages immutable APK and binds it to the originating session and snapshot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bridge-upload-'));
  try {
    const file = path.join(dir, 'sample.apk'); await writeFile(file, Buffer.from('PK\x03\x04small fixture'));
    const ctx = { project: '/project', session: 'session-a' };
    const params = { handle: 2, snapshotId: '123e4567-e89b-42d3-a456-426614174000', ref: 'f1', path: file };
    const staged = await stageFile(ctx, params);
    assert.equal(staged.size, 17);
    assert.equal(staged.name, 'sample.apk');
    assert.equal(path.basename(path.dirname(staged.stagedPath)), staged.stageId);
    assert.equal(path.extname(staged.stagedPath), '.apk');
    assert.equal((await getStage(ctx, { ...params, stageId: staged.stageId })).sha256, staged.sha256);
    await assert.rejects(getStage({ ...ctx, session: 'session-b' }, { ...params, stageId: staged.stageId }), { code: 'E_UPLOAD' });
    assert.deepEqual(await discardStage(ctx, { ...params, stageId: staged.stageId }), { stageId: staged.stageId, discarded: true });
    await assert.rejects(getStage(ctx, { ...params, stageId: staged.stageId }), { code: 'E_UPLOAD' });
    await assert.rejects(stageFile(ctx, { ...params, stageId: staged.stageId }), { code: 'E_UPLOAD' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects symlinks, hard links and files over the size bound', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bridge-upload-'));
  try {
    const file = path.join(dir, 'source.apk'); await writeFile(file, 'x');
    const ctx = { project: '/project', session: 'session-a' };
    const params = { handle: 2, snapshotId: '123e4567-e89b-42d3-a456-426614174000', ref: 'f1' };
    const alias = path.join(dir, 'alias.apk'); await symlink(file, alias);
    await assert.rejects(stageFile(ctx, { ...params, path: alias }), { code: 'E_UPLOAD' });
    const hard = path.join(dir, 'hard.apk'); await link(file, hard);
    await assert.rejects(stageFile(ctx, { ...params, path: file }), { code: 'E_UPLOAD' });
    assert.equal(MAX_UPLOAD_SIZE, 256 * 1024 * 1024);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
