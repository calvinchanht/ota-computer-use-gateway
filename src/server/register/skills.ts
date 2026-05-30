import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { listSkills, readSkill } from '../../tools/skills.js';
import { READ_ONLY } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerSkillTools(context: RegisterContext): void {
  registerListSkills(context);
  registerReadSkill(context);
}

function registerListSkills({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_skills', {
    title: 'List skills',
    description: 'List workspace skills with metadata for progressive disclosure.',
    inputSchema: { workspace_id: z.string() },
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_skills', listSkills));
}

function registerReadSkill({ server, workspaces }: RegisterContext): void {
  server.registerTool('read_skill', {
    title: 'Read skill',
    description: 'Read one workspace SKILL.md by skill name.',
    inputSchema: { workspace_id: z.string(), name: z.string() },
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'read_skill',
    (workspace) => readSkill(workspace, args.name)
  ));
}
