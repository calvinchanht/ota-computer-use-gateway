import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { activateBrowserTab, browserStatus, closeBrowserTab, listBrowserProfiles, listBrowserTabs, openBrowserTab } from '../../tools/browser.js';
import { READ_ONLY, RUN_LOCAL } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerBrowserTools(context: RegisterContext): void {
  registerListBrowserProfiles(context);
  registerBrowserStatus(context);
  registerListBrowserTabs(context);
  registerOpenBrowserTab(context);
  registerActivateBrowserTab(context);
  registerCloseBrowserTab(context);
}

function registerListBrowserProfiles({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_browser_profiles', { title: 'List browser profiles', description: 'List configured headed Chrome/CDP browser profiles for a workspace.', inputSchema: { workspace_id: z.string() }, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_browser_profiles', listBrowserProfiles));
}

function registerBrowserStatus({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_status', { title: 'Browser status', description: 'Return selected headed Chrome/CDP profile status metadata.', inputSchema: profileSchema(), annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_status', (workspace) => browserStatus(workspace, args.profile_label)));
}

function registerListBrowserTabs({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_browser_tabs', { title: 'List browser tabs', description: 'List Chrome page targets through the configured CDP debug port.', inputSchema: profileSchema(), annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_browser_tabs', (workspace) => listBrowserTabs(workspace, args.profile_label)));
}

function registerOpenBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('open_browser_tab', { title: 'Open browser tab', description: 'Open a URL in a new headed Chrome tab through CDP.', inputSchema: { ...profileSchema(), url: z.string(), observe_after: observeAfterSchema().optional() }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'open_browser_tab', (workspace) => openBrowserTab(workspace, args.url, args.profile_label, args.observe_after)));
}

function registerActivateBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('activate_browser_tab', { title: 'Activate browser tab', description: 'Focus a Chrome target/tab through CDP.', inputSchema: targetSchema(), annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'activate_browser_tab', (workspace) => activateBrowserTab(workspace, args.target_id, args.profile_label, args.observe_after)));
}

function registerCloseBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('close_browser_tab', { title: 'Close browser tab', description: 'Close a Chrome target/tab through CDP.', inputSchema: targetSchema(), annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'close_browser_tab', (workspace) => closeBrowserTab(workspace, args.target_id, args.profile_label, args.observe_after)));
}

function profileSchema() {
  return { workspace_id: z.string(), profile_label: z.string().optional() };
}

function targetSchema() {
  return { ...profileSchema(), target_id: z.string(), observe_after: observeAfterSchema().optional() };
}

function observeAfterSchema() {
  return z.object({ delay_ms: z.number().int().min(0).max(5000).optional(), tabs: z.boolean().optional() });
}
