import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ok } from '../core/result.js';
import { truncateText } from '../core/text.js';
import type { Workspace } from '../core/workspaces.js';

const SKILL_ROOTS = ['.agent/skills', '.agents/skills'];
const MAX_SKILL_CHARS = 50000;

export async function listSkills(workspace: Workspace) {
  const groups = await Promise.all(SKILL_ROOTS.map((root) => listSkillRoot(workspace, root)));
  const skills = groups.flat().filter(isSkillSummary).sort((a, b) => a.name.localeCompare(b.name));
  return ok(`listed ${skills.length} skills`, { skill_roots: SKILL_ROOTS, skills });
}

export async function readSkill(workspace: Workspace, name: string) {
  assertSkillName(name);
  for (const root of SKILL_ROOTS) {
    const skill = await readSkillFromRoot(workspace, root, name);
    if (skill) return ok(`read skill ${name}`, skill);
  }
  throw new Error(`skill not found: ${name}`);
}

async function listSkillRoot(workspace: Workspace, root: string) {
  const dir = path.join(workspace.realRoot, root);
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  return (await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => skillSummary(workspace, root, entry.name)))).filter(Boolean);
}

async function skillSummary(workspace: Workspace, root: string, name: string) {
  if (!validSkillName(name)) return undefined;
  const file = path.join(workspace.realRoot, root, name, 'SKILL.md');
  try {
    const info = await stat(file);
    if (!info.isFile()) return undefined;
    const text = await readFile(file, 'utf8');
    return { name, root, path: path.posix.join(root, name, 'SKILL.md'), description: firstDescription(text), bytes: info.size };
  } catch { return undefined; }
}

async function readSkillFromRoot(workspace: Workspace, root: string, name: string) {
  const file = path.join(workspace.realRoot, root, name, 'SKILL.md');
  try {
    const info = await stat(file);
    if (!info.isFile()) return undefined;
    const text = await readFile(file, 'utf8');
    const limited = truncateText(text, MAX_SKILL_CHARS);
    return { name, root, path: path.posix.join(root, name, 'SKILL.md'), text: limited.text, bytes: info.size, truncated: limited.truncated };
  } catch { return undefined; }
}

function isSkillSummary(value: Awaited<ReturnType<typeof skillSummary>>): value is NonNullable<Awaited<ReturnType<typeof skillSummary>>> {
  return value !== undefined;
}

function firstDescription(text: string) {
  const line = text.split(/\r?\n/).find((item) => item.toLowerCase().startsWith('description:'));
  return line ? line.slice('description:'.length).trim().replace(/^['"]|['"]$/g, '') : '';
}

function assertSkillName(name: string) {
  if (!validSkillName(name)) throw new Error('invalid skill name');
}

function validSkillName(name: string) {
  return /^[a-z0-9][a-z0-9_-]{0,80}$/.test(name);
}
