import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from './workspaces.js';

export type PathScope = 'workspace' | 'host';
export type ResolvedPath = { absolute: string; relative: string; displayPath: string; scope: PathScope };

export async function resolveInside(workspace: Workspace, requested: string, config: AppConfig): Promise<ResolvedPath> {
  const candidate = resolveRequestedPath(workspace, requested);
  const boundary = pathBoundaryFor(workspace, requested);
  assertInside(boundary.root, candidate, requested, boundary.scope);
  const real = await realpath(candidate);
  assertInside(boundary.root, real, requested, boundary.scope);
  const relative = displayRelative(boundary.root, real);
  const displayPath = boundary.scope === 'host' ? ensureAbsoluteDisplay(boundary.root, relative) : relative;
  assertNoShadowDeny(config);
  return { absolute: real, relative, displayPath, scope: boundary.scope };
}

export async function resolveWritableInside(workspace: Workspace, requested: string, config: AppConfig): Promise<ResolvedPath> {
  const candidate = resolveRequestedPath(workspace, requested);
  const boundary = pathBoundaryFor(workspace, requested);
  assertInside(boundary.root, candidate, requested, boundary.scope);
  assertNoShadowDeny(config);

  const parent = path.dirname(candidate);
  const existingAncestor = await nearestExistingAncestor(parent);
  const realAncestor = await realpath(existingAncestor);
  assertInside(boundary.root, realAncestor, requested, boundary.scope);

  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  assertInside(boundary.root, realParent, requested, boundary.scope);

  const concrete = path.join(realParent, path.basename(candidate));
  const target = await lstat(concrete).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  const absolute = target ? await realpath(concrete) : concrete;
  assertInside(boundary.root, absolute, requested, boundary.scope);

  const relative = displayRelative(boundary.root, absolute);
  const displayPath = boundary.scope === 'host' ? ensureAbsoluteDisplay(boundary.root, relative) : relative;
  return { absolute, relative, displayPath, scope: boundary.scope };
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function resolveRequestedPath(workspace: Workspace, requested: string): string {
  if (!path.isAbsolute(requested) && hasParentDirectorySegment(requested)) throw new Error(pathBoundaryError(requested, 'workspace'));
  return path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(workspace.realRoot, requested);
}

function hasParentDirectorySegment(requested: string): boolean {
  return requested.split(/[\\/]+/u).some((segment) => segment === '..');
}

function pathBoundaryFor(workspace: Workspace, requested: string): { root: string; scope: PathScope } {
  if (canUseHostFilesystem(workspace, requested)) {
    return { root: path.resolve(workspace.filesystem?.host_root ?? '/'), scope: 'host' };
  }
  return { root: workspace.realRoot, scope: 'workspace' };
}

function canUseHostFilesystem(workspace: Workspace, requested: string): boolean {
  return Boolean(path.isAbsolute(requested) && workspace.api_sets?.machine_admin && workspace.filesystem?.machine_admin_host_scope);
}

function assertNoShadowDeny(_config: AppConfig): void {
  // Calvin policy: OTA/Threaddex must not add hidden path/secret deny lists.
  // File access is controlled by workspace root, host_root, and explicit capability flags only.
  // Do not add path-name, secret-name, glob, or content deny logic here without Calvin's explicit approval.
}

export function assertInside(root: string, candidate: string, requested = candidate, scope: PathScope = 'workspace'): void {
  const rel = path.relative(root, candidate);
  if (rel === '') return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(pathBoundaryError(requested, scope));
}

function displayRelative(root: string, candidate: string): string {
  return (path.relative(root, candidate) || '.').replaceAll('\\', '/');
}

function pathBoundaryError(requested: string, scope: PathScope): string {
  const kind = path.isAbsolute(requested) ? 'absolute' : 'relative';
  if (scope === 'host') return `path resolves outside configured host filesystem scope (${kind} input)`;
  return `path resolves outside workspace (${kind} input); use a workspace-relative path inside the configured workspace root`;
}

function ensureAbsoluteDisplay(root: string, relative: string): string {
  const absolute = path.resolve(root, relative === '.' ? '' : relative);
  return absolute === path.parse(absolute).root ? absolute : absolute.replaceAll('\\', '/');
}
