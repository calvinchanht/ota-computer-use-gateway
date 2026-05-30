import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { browserStatus, listBrowserProfiles, listBrowserTabs } from '../../tools/browser.js';
import { READ_ONLY } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerBrowserTools(context: RegisterContext): void {
  registerListBrowserProfiles(context);
  registerBrowserStatus(context);
  registerListBrowserTabs(context);
}

function registerListBrowserProfiles({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_browser_profiles', {
    title: 'List browser profiles',
    description: 'List configured headed Chrome/CDP browser profiles for a workspace.',
    inputSchema: { workspace_id: z.string() },
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_browser_profiles', listBrowserProfiles));
}

function registerBrowserStatus({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_status', {
    title: 'Browser status',
    description: 'Return selected headed Chrome/CDP profile status metadata.',
    inputSchema: { workspace_id: z.string(), profile_label: z.string().optional() },
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'browser_status',
    (workspace) => browserStatus(workspace, args.profile_label)
  ));
}

function registerListBrowserTabs({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_browser_tabs', {
    title: 'List browser tabs',
    description: 'List Chrome page targets through the configured CDP debug port.',
    inputSchema: { workspace_id: z.string(), profile_label: z.string().optional() },
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(
    workspaces, args.workspace_id, 'list_browser_tabs',
    (workspace) => listBrowserTabs(workspace, args.profile_label)
  ));
}
