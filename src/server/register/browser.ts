import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { browserCdpBatch, browserCdpBrowserBatch, browserCdpBrowserCall, browserCdpCall, browserStatus, listBrowserProfiles, listBrowserTabs } from '../../tools/browser.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerBrowserTools(context: RegisterContext): void {
  registerListBrowserProfiles(context);
  registerBrowserStatus(context);
  registerListBrowserTabs(context);
  registerBrowserCdpBrowserCall(context);
  registerBrowserCdpBrowserBatch(context);
  registerBrowserCdpCall(context);
  registerBrowserCdpBatch(context);
}

function registerListBrowserProfiles({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_browser_profiles', { title: 'List browser profiles', description: 'List configured Chrome/CDP profiles for a workspace.', inputSchema: { workspace_id: z.string() }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_browser_profiles', listBrowserProfiles));
}

function registerBrowserStatus({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_status', { title: 'Browser status', description: 'Return configured Chrome/CDP profile status metadata.', inputSchema: profileSchema(), outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_status', (workspace) => browserStatus(workspace, args.profile_label)));
}

function registerListBrowserTabs({ server, workspaces }: RegisterContext): void {
  server.registerTool('list_browser_tabs', { title: 'List browser tabs', description: 'List Chrome page targets through the configured CDP debug port.', inputSchema: profileSchema(), outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_browser_tabs', (workspace) => listBrowserTabs(workspace, args.profile_label)));
}

function registerBrowserCdpBrowserCall({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_browser_call', { title: 'Browser-level CDP call', description: 'Call one Chrome DevTools Protocol method on the scoped browser websocket for a configured profile.', inputSchema: browserCdpCallSchema(), outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_browser_call', (workspace) => browserCdpBrowserCall(workspace, args.method, args.params ?? {}, args.profile_label)));
}

function registerBrowserCdpBrowserBatch({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_browser_batch', { title: 'Browser-level CDP batch', description: 'Call multiple Chrome DevTools Protocol methods on the scoped browser websocket for a configured profile.', inputSchema: { ...profileSchema(), calls: z.array(cdpCallItemSchema()).min(1).max(20) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_browser_batch', (workspace) => browserCdpBrowserBatch(workspace, args.calls, args.profile_label)));
}

function registerBrowserCdpCall({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_call', { title: 'Browser CDP call', description: 'Call one Chrome DevTools Protocol method on a scoped page target websocket.', inputSchema: cdpCallSchema(), outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_call', (workspace) => browserCdpCall(workspace, args.target_id, args.method, args.params ?? {}, args.profile_label)));
}

function registerBrowserCdpBatch({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_batch', { title: 'Browser CDP batch', description: 'Call multiple Chrome DevTools Protocol methods on a scoped page target websocket.', inputSchema: { ...targetInfoSchema(), calls: z.array(cdpCallItemSchema()).min(1).max(20) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_batch', (workspace) => browserCdpBatch(workspace, args.target_id, args.calls, args.profile_label)));
}

function profileSchema() {
  return { workspace_id: z.string(), profile_label: z.string().optional() };
}

function targetInfoSchema() {
  return { ...profileSchema(), target_id: z.string().describe('Raw Chrome target id from list_browser_tabs.') };
}

function browserCdpCallSchema() {
  return { ...profileSchema(), method: cdpMethodSchema(), params: z.record(z.string(), z.unknown()).optional() };
}

function cdpCallSchema() {
  return { ...targetInfoSchema(), method: cdpMethodSchema(), params: z.record(z.string(), z.unknown()).optional() };
}

function cdpCallItemSchema() {
  return z.object({ method: cdpMethodSchema(), params: z.record(z.string(), z.unknown()).optional() });
}

function cdpMethodSchema() {
  return z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/);
}
