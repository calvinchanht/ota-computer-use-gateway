import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordApproval } from '../src/core/approval.js';
import { applyPatch } from '../src/tools/applyPatch.js';
import { proposePatch } from '../src/tools/patch.js';
import type { AppConfig } from '../src/config/schema.js';
import type { Workspace } from '../src/core/workspaces.js';

const config: AppConfig = {
  server: { host: '127.0.0.1', port: 8765 },
  workspaces: [],
  security: { max_file_bytes: 1000, max_response_bytes: 1000, max_request_bytes: 1000, max_search_results: 10, max_exec_ms: 120000 }
};

describe('applyPatch', () => {
  it('requires approval', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'a.txt'), 'old');
    await expect(applyPatch(config, workspace, [{ path: 'a.txt', old_text: 'old', new_text: 'new' }])).rejects.toThrow('missing approval');
  });

  it('applies exact replacements with approval', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'a.txt'), 'old');
    await recordApproval(workspace, { id: 'ok', action: 'apply_patch', created_at: new Date().toISOString() });
    await applyPatch(config, workspace, [{ path: 'a.txt', old_text: 'old', new_text: 'new' }]);
    await expect(readFile(path.join(workspace.realRoot, 'a.txt'), 'utf8')).resolves.toBe('new');
  });

  it('rejects non-unique exact replacements', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'a.txt'), 'same\nsame\n');
    await recordApproval(workspace, { id: 'ok', action: 'apply_patch', created_at: new Date().toISOString() });
    await expect(applyPatch(config, workspace, [{ path: 'a.txt', old_text: 'same', new_text: 'new' }]))
      .rejects.toThrow('not unique');
  });

  it('rejects missing exact text with line-ending guidance', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'a.txt'), 'hello\r\nworld\r\n');
    await recordApproval(workspace, { id: 'ok', action: 'apply_patch', created_at: new Date().toISOString() });
    await expect(applyPatch(config, workspace, [{ path: 'a.txt', old_text: 'hello\nworld\n', new_text: 'hi\nworld\n' }]))
      .rejects.toThrow('line endings');
  });

  it('validates proposed patches with the same exact-text rules', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'a.txt'), 'same\nsame\n');
    await expect(proposePatch(config, workspace, [{ path: 'a.txt', old_text: 'same', new_text: 'new' }], 'test'))
      .rejects.toThrow('not unique');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'gtp-apply-'));
  return { id: 'test', name: 'Test', root, realRoot: root, allow_read: true, allow_write: false, allow_patch: true, allow_tests: false, allow_screen: false, allow_mouse_keyboard: false, browser: { profiles: [] }, commands: {} };
}
