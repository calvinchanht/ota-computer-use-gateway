import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { deniedPath } from './deny.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from './workspaces.js';

export type ResolvedPath = { absolute: string; relative: string };

export async function resolveInside(workspace: Workspace, requested: string, config: AppConfig): Promise<ResolvedPath> {
  if (path.isAbsolute(requested)) throw new Error('absolute paths are not allowed');
  const joined = path.resolve(workspace.realRoot, requested);
  const real = await realpath(joined);
  assertInside(workspace.realRoot, real);
  const relative = path.relative(workspace.realRoot, real) || '.';
  const denied = deniedPath(relative, config.security.denied_globs);
  if (denied) throw new Error(denied);
  return { absolute: real, relative };
}

export function assertInside(root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (rel === '') return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path resolves outside workspace');
}
