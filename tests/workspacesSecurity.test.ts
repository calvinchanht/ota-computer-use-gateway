import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { agentPath } from '../src/core/agentDir.js';
import { buildWorkspaces } from '../src/core/workspaces.js';
import type { AppConfig } from '../src/config/schema.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('workspace agent directory isolation', () => {
  it('rejects an agent_dir outside the workspace root', async () => {
    const root = await temp('ota-workspace-');
    const outside = await temp('ota-agent-outside-');
    await expect(buildWorkspaces(config(root, outside))).rejects.toThrow(/agent_dir.*inside the workspace root/);
  });

  it('rejects a symlinked .agent directory that escapes the workspace', async () => {
    const root = await temp('ota-workspace-');
    const outside = await temp('ota-agent-outside-');
    await symlink(outside, join(root, '.agent'));
    await expect(buildWorkspaces(config(root))).rejects.toThrow(/agent_dir.*symlink/);
  });

  it('rejects nested symlinks added after workspace initialization', async () => {
    const root = await temp('ota-workspace-');
    const outside = await temp('ota-agent-outside-');
    const workspace = [...(await buildWorkspaces(config(root))).values()][0];
    await mkdir(join(workspace.realAgentDir, 'artifacts'), { recursive: true });
    await symlink(outside, join(workspace.realAgentDir, 'artifacts', 'escape'));
    expect(() => agentPath(workspace, 'artifacts', 'escape', 'secret.txt')).toThrow(/symlink/);
  });
});

async function temp(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function config(root: string, agentDir?: string): AppConfig {
  return { workspaces: [{ id: 'test', name: 'Test', root, agent_dir: agentDir }] } as AppConfig;
}
