import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/core/workspaces.js';
import { listSkills, readSkill } from '../src/tools/skills.js';

describe('skill tools', () => {
  it('lists skills from .agent and .agents skill roots', async () => {
    const workspace = await fixtureWorkspace();
    await writeSkill(workspace, '.agent/skills', 'deploy-helper', "# Deploy Helper\n\ndescription: Deploy safely.\n");
    await writeSkill(workspace, '.agents/skills', 'quota-check', "# Quota Check\n\ndescription: Check quotas.\n");

    const result = await listSkills(workspace);
    const skills = (result.data as any).skills;
    expect(skills.map((skill: any) => skill.name)).toEqual(['deploy-helper', 'quota-check']);
    expect(skills[0].description).toBe('Deploy safely.');
  });

  it('reads a named skill on demand', async () => {
    const workspace = await fixtureWorkspace();
    await writeSkill(workspace, '.agent/skills', 'browser-fallback', '# Browser Fallback\n\ndescription: Use CDP.\n');

    const result = await readSkill(workspace, 'browser-fallback');
    const data = result.data as any;
    expect(data.path).toBe('.agent/skills/browser-fallback/SKILL.md');
    expect(data.text).toContain('Use CDP');
    expect(data.truncated).toBe(false);
  });

  it('rejects invalid skill names before path lookup', async () => {
    const workspace = await fixtureWorkspace();
    await expect(readSkill(workspace, '../secret')).rejects.toThrow('invalid skill name');
  });
});

async function writeSkill(workspace: Workspace, root: string, name: string, text: string) {
  const dir = path.join(workspace.realRoot, root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), text);
}

async function fixtureWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'ota-skills-test-'));
  return {
    id: 'skills',
    name: 'Skills Test',
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
