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
    await writeFile(path.join(workspace.realRoot, '.agent', 'AGENT_START_HERE.md'), 'start here');
    await writeFile(path.join(workspace.realRoot, '.agent', 'PROVIDER_THREAD_PROMPT.md'), 'provider prompt');
    await writeFile(path.join(workspace.realRoot, '.agent', 'MICKEY_PROVIDER_ACCEPTANCE.md'), 'acceptance checklist');
    await writeFile(path.join(workspace.realRoot, '.agent', 'SOUL.md'), 'agent soul');
    await writeFile(path.join(workspace.realRoot, '.agent', 'CURRENT_TASK.md'), 'current task');
    await writeFile(path.join(workspace.realRoot, '.agent', 'MEMORY_LOG.jsonl'), '{"title":"recent"}\n');

    const result = await contextSnapshot(workspace);
    const data = result.data as any;
    expect(data.identity.id).toBe('ctx');
    expect(data.project_instructions['AGENTS.md']).toContain('project instructions');
    expect(data.continuity['AGENT_START_HERE.md']).toContain('start here');
    expect(data.continuity['PROVIDER_THREAD_PROMPT.md']).toContain('provider prompt');
    expect(data.continuity['MICKEY_PROVIDER_ACCEPTANCE.md']).toContain('acceptance checklist');
    expect(data.continuity['SOUL.md']).toContain('agent soul');
    expect(data.continuity['CURRENT_TASK.md']).toContain('current task');
    expect(data.recent_memory).toContain('recent');
  });

  it('returns an ordered bootstrap packet for chat-thread pickup', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, '.agent', 'AGENT_START_HERE.md'), 'call bootstrap first');
    await writeFile(path.join(workspace.realRoot, '.agent', 'PROVIDER_THREAD_PROMPT.md'), 'provider thread first message');
    await writeFile(path.join(workspace.realRoot, '.agent', 'MICKEY_PROVIDER_ACCEPTANCE.md'), 'provider acceptance');
    await writeFile(path.join(workspace.realRoot, '.agent', 'SOUL.md'), 'mickey soul');
    await writeFile(path.join(workspace.realRoot, '.agent', 'TOOLS.md'), 'tool notes');
    await writeFile(path.join(workspace.realRoot, '.agent', 'CURRENT_TASK.md'), 'current task');
    await writeFile(path.join(workspace.realRoot, '.agent', 'HANDOFF.md'), 'handoff note');

    const result = await agentBootstrap(workspace);
    const data = result.data as any;
    expect(data.agent_start_here).toContain('call bootstrap first');
    expect(data.provider_thread_prompt).toContain('provider thread first message');
    expect(data.provider_acceptance).toContain('provider acceptance');
    expect(data.agent_profile.soul).toContain('mickey soul');
    expect(data.agent_profile.tools).toContain('tool notes');
    expect(data.current_task).toContain('current task');
    expect(data).not.toHaveProperty('recent_handoff');
    expect(data).not.toHaveProperty('recent_progress');
    expect(data).not.toHaveProperty('recent_checkpoints');
    expect(data.next_actions.join(' ')).toContain('get_context_snapshot');
    expect(data.operating_model.join(' ')).toContain('Checkpoint');

    const history = (await contextSnapshot(workspace)).data as any;
    expect(history.continuity['HANDOFF.md']).toContain('handoff note');
  });

  it('matches the accepted role-oriented default bootstrap contract', async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(path.join(workspace.realRoot, '.agent', 'AGENT_START_HERE.md'), 'Live-refresh mutable identities before action.');
    await writeFile(path.join(workspace.realRoot, '.agent', 'CURRENT_TASK.md'), '# Current Task\n\nExact mutable current task packet.\n');

    const result = await agentBootstrap(workspace);
    const data = result.data as Record<string, any>;
    const forbidden = new Set(['recent_handoff', 'recent_progress', 'recent_checkpoints']);
    const found: string[] = [];
    walkKeys(data, 'data', forbidden, found);
    expect(found).toEqual([]);

    const nextActionStrings: string[] = [];
    collectStrings(data.next_actions, nextActionStrings);
    expect(nextActionStrings.some((value) => /\b(?:recent_handoff|recent_progress|recent_checkpoints)\b/i.test(value))).toBe(false);

    const declaredRole = data.role ?? data.orientation_role ?? data.role_profile ?? data.main_loop?.role;
    expect(declaredRole).toBeUndefined();
    expect(nonEmpty(data.current_task)).toBe(true);
    for (const role of ['implementation', 'review', 'decision', 'operator']) {
      const hasPacket = ['current_task', 'task', 'task_packet', 'assignment', 'provider_thread_prompt', 'agent_start_here']
        .some((key) => nonEmpty(data[key]));
      expect(hasPacket, `${role} requires a non-empty current task/assignment packet`).toBe(true);
    }
  });

  it('rejects the accepted polluted bootstrap fixture on both history checks', () => {
    const polluted = {
      current_task: 'current project snapshot',
      recent_progress: 'historical execution log',
      next_actions: ['Read recent_progress before doing anything.']
    };
    const forbidden = new Set(['recent_handoff', 'recent_progress', 'recent_checkpoints']);
    const found: string[] = [];
    walkKeys(polluted, 'data', forbidden, found);
    expect(found).toEqual(['data.recent_progress']);
    const strings: string[] = [];
    collectStrings(polluted.next_actions, strings);
    expect(strings.some((value) => /\b(?:recent_handoff|recent_progress|recent_checkpoints)\b/i.test(value))).toBe(true);
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

function walkKeys(value: unknown, prefix: string, forbidden: Set<string>, found: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, `${prefix}[${index}]`, forbidden, found));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key)) found.push(`${prefix}.${key}`);
    walkKeys(child, `${prefix}.${key}`, forbidden, found);
  }
}

function collectStrings(value: unknown, found: string[]) {
  if (typeof value === 'string') { found.push(value); return; }
  if (Array.isArray(value)) { value.forEach((item) => collectStrings(item, found)); return; }
  if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, found));
}

function nonEmpty(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}
