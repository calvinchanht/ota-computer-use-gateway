import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { deniedPath } from './deny.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from './workspaces.js';

export type ResolvedPath = { absolute: string; relative: string };

export async function resolveInside(workspace: Workspace, requested: string, config: AppConfig): Promise<ResolvedPath> {
  const joined = resolveRequestedPath(workspace, requested);
  const real = await realpath(joined);
  assertInside(workspace.realRoot, real);
  const relative = path.relative(workspace.realRoot, real) || '.';
  const denied = deniedPath(relative, config.security.denied_globs, config.security.protect_secret_paths);
  if (denied) throw new Error(denied);
  return { absolute: real, relative };
}

export async function resolveWritableInside(workspace: Workspace, requested: string, config: AppConfig): Promise<ResolvedPath> {
  const absolute = resolveRequestedPath(workspace, requested);
  assertInside(workspace.realRoot, absolute);
  const relative = path.relative(workspace.realRoot, absolute) || '.';
  const denied = deniedPath(relative, config.security.denied_globs, config.security.protect_secret_paths);
  if (denied) throw new Error(denied);
  await mkdir(path.dirname(absolute), { recursive: true });
  return { absolute, relative };
}

function resolveRequestedPath(workspace: Workspace, requested: string): string {
  return path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(workspace.realRoot, requested);
}

export function assertInside(root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (rel === '') return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path resolves outside workspace');
}
