import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { deniedPath } from './deny.js';
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
  assertNotDenied(relative, displayPath, config);
  return { absolute: real, relative, displayPath, scope: boundary.scope };
}

export async function resolveWritableInside(workspace: Workspace, requested: string, config: AppConfig): Promise<ResolvedPath> {
  const absolute = resolveRequestedPath(workspace, requested);
  const boundary = pathBoundaryFor(workspace, requested);
  assertInside(boundary.root, absolute, requested, boundary.scope);
  const relative = displayRelative(boundary.root, absolute);
  const displayPath = boundary.scope === 'host' ? ensureAbsoluteDisplay(boundary.root, relative) : relative;
  assertNotDenied(relative, displayPath, config);
  await mkdir(path.dirname(absolute), { recursive: true });
  return { absolute, relative, displayPath, scope: boundary.scope };
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

function assertNotDenied(relative: string, displayPath: string, config: AppConfig): void {
  const denied = deniedPath(relative, config.security.denied_globs)
    || deniedPath(displayPath, config.security.denied_globs);
  if (denied) throw new Error(denied);
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
