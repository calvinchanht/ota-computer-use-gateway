import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentBootstrap, checkpointThread, contextSnapshot, recordDecision, recordHandoff, recordProgress, updateCurrentTask } from '../src/tools/context.js';
import type { Workspace } from '../src/core/workspaces.js';

describe('context tools', () => {
  it('loads identity, project instructions, continuity, and recent memory', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, 'AGENTS.md'), 'project instructions');
    await writeFile(path.join(workspace.realRoot, '.agent', 'CURRENT_TASK.md'), 'current task');
    await writeFile(path.join(workspace.realRoot, '.agent', 'MEMORY_LOG.jsonl'), '{"title":"recent"}\n');

    const result = await contextSnapshot(workspace);
    const data = result.data as any;
    expect(data.identity.id).toBe('ctx');
    expect(data.project_instructions['AGENTS.md']).toContain('project instructions');
    expect(data.continuity['CURRENT_TASK.md']).toContain('current task');
    expect(data.recent_memory).toContain('recent');
  });

  it('returns an ordered bootstrap packet for chat-thread pickup', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, '.agent', 'CURRENT_TASK.md'), 'current task');
    await writeFile(path.join(workspace.realRoot, '.agent', 'HANDOFF.md'), 'handoff note');

    const result = await agentBootstrap(workspace);
    const data = result.data as any;
    expect(data.current_task).toContain('current task');
    expect(data.recent_handoff).toContain('handoff note');
    expect(data.operating_model.join(' ')).toContain('Checkpoint');
  });

  it('records progress and handoff notes', async () => {
    const workspace = await fixtureWorkspace();
    await recordProgress(workspace, 'Progress', 'made progress');
    await recordHandoff(workspace, 'Handoff', 'handoff details');

    await expect(readFile(path.join(workspace.realRoot, '.agent', 'PROGRESS.md'), 'utf8')).resolves.toContain('made progress');
    await expect(readFile(path.join(workspace.realRoot, '.agent', 'HANDOFF.md'), 'utf8')).resolves.toContain('handoff details');
  });

  it('records decisions, current task, and checkpoints', async () => {
    const workspace = await fixtureWorkspace();
    await recordDecision(workspace, 'Decision', 'use checkpoint export');
    await updateCurrentTask(workspace, 'Current Task', 'continue issue #4');
    await checkpointThread(workspace, 'Checkpoint', 'thread summary', ['next thing']);

    await expect(readFile(path.join(workspace.realRoot, '.agent', 'DECISIONS.md'), 'utf8')).resolves.toContain('use checkpoint export');
    await expect(readFile(path.join(workspace.realRoot, '.agent', 'CURRENT_TASK.md'), 'utf8')).resolves.toContain('continue issue #4');
    await expect(readFile(path.join(workspace.realRoot, '.agent', 'CHECKPOINTS.md'), 'utf8')).resolves.toContain('next thing');
  });
});

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'ota-context-test-'));
  await mkdir(path.join(root, '.agent'), { recursive: true });
  return {
    id: 'ctx',
    name: 'Context Test',
    root,
    realRoot: root,
    allow_read: true,
    allow_write: true,
    allow_patch: true,
    allow_tests: false,
    allow_screen: false,
    allow_mouse_keyboard: false,
    browser: { profiles: [] },
    commands: {}
  };
}
