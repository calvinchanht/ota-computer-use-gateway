import { ok } from '../core/result.js';
import { platformInfo } from '../core/platform.js';
import type { Workspace } from '../core/workspaces.js';

export function heartbeat(workspaces: Map<string, Workspace>) {
  return ok('local API project agent online', {
    agent: 'ota-computer-use-gateway',
    version: '0.1.0',
    status: 'online',
    platform: platformInfo(),
    workspaces: [...workspaces.keys()],
    capabilities: ['heartbeat', 'get_workspace_policy', 'list_dir', 'read_file', 'search_files', 'git_status', 'git_diff']
  });
}
