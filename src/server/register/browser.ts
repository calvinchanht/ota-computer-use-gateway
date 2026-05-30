import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { browserStatus, listBrowserProfiles, listBrowserTabs, openBrowserTab } from '../../tools/browser.js';
import { READ_ONLY, RUN_LOCAL } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerBrowserTools(context: RegisterContext): void {
  registerListBrowserProfiles(context);
  registerBrowserStatus(context);
  registerListBrowserTabs(context);
  registerOpenBrowserTab(context);
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
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_status', (workspace) => browserStatus(workspace, args.profile_label)));
}

function registerListBrowserTabs({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_browser_tabs', {
    title: 'List browser tabs',
    description: 'List Chrome page targets through the configured CDP debug port.',
    inputSchema: { workspace_id: z.string(), profile_label: z.string().optional() },
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_browser_tabs', (workspace) => listBrowserTabs(workspace, args.profile_label)));
}

function registerOpenBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('open_browser_tab', {
    title: 'Open browser tab',
    description: 'Open a URL in a new headed Chrome tab through CDP, optionally returning tabs after a delay.',
    inputSchema: { workspace_id: z.string(), url: z.string(), profile_label: z.string().optional(), observe_after: observeAfterSchema().optional() },
    annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'open_browser_tab', (workspace) => openBrowserTab(workspace, args.url, args.profile_label, args.observe_after)));
}

function observeAfterSchema() {
  return z.object({ delay_ms: z.number().int().min(0).max(5000).optional(), tabs: z.boolean().optional() });
}
