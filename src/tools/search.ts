import { runCommand } from '../core/process.js';
import { ok } from '../core/result.js';
import { resolveInside } from '../core/paths.js';
import type { AppConfig } from '../config/schema.js';
import type { Workspace } from '../core/workspaces.js';

export async function searchFiles(config: AppConfig, workspace: Workspace, query: string, requestedPath = '.') {
  const resolved = await resolveInside(workspace, requestedPath, config);
  const max = String(config.security.max_search_results);
  const result = await runCommand('rg', ['--line-number', '--max-count', '3', '--max-filesize', '200K', '-m', max, query, resolved.absolute], workspace.realRoot);
  const lines = result.stdout.split('\n').filter(Boolean).slice(0, config.security.max_search_results);
  return ok(`found ${lines.length} matching lines`, { query, path: resolved.relative, matches: lines, exit_code: result.code });
}
