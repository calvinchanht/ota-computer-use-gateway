import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { browserCdpBatch, browserCdpBrowserBatch, browserCdpBrowserCall, browserCdpCall, browserManageTabs, browserStatus, browserVisibleState, listBrowserProfiles, listBrowserTabs } from '../../tools/browser.js';
import { READ_ONLY, RUN_LOCAL, TOOL_RESULT_OUTPUT_SCHEMA } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerBrowserTools(context: RegisterContext): void {
  registerListBrowserProfiles(context);
  registerBrowserStatus(context);
  registerListBrowserTabs(context);
  registerBrowserVisibleState(context);
  registerBrowserManageTabs(context);
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
  server.registerTool('list_browser_tabs', {
    title: 'List browser target ids',
    description: 'Read-only list of existing Chrome target ids for the configured profile. Does not navigate, click, type, or expose full page URLs unless include_urls is true.',
    inputSchema: { ...profileSchema(), include_urls: z.boolean().default(false) },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'list_browser_tabs', (workspace) => listBrowserTabs(workspace, args.profile_label, args.include_urls)));
}


function registerBrowserVisibleState({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_visible_state', {
    title: 'Browser visible state',
    description: 'Return high-level human-visible page state for a page target: visible text, buttons, links, controls, required missing fields, file inputs, visibly uploaded filenames, and visible errors.',
    inputSchema: { ...profileSchema(), target_id: z.string() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: READ_ONLY
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_visible_state', (workspace) => browserVisibleState(workspace, args.target_id, args.profile_label)));
}

function registerBrowserManageTabs({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_manage_tabs', {
    title: 'Browser tab management',
    description: 'Compact high-level tab hygiene helper: list page tabs only, focus by URL/title/target id, or close matching page tabs. Hides workers/iframes/browser UI.',
    inputSchema: { ...profileSchema(), action: z.enum(['list_page_tabs_only', 'focus_by_url', 'focus_by_title', 'close_by_filter']), url_contains: z.string().optional(), title_contains: z.string().optional(), target_id: z.string().optional(), include_urls: z.boolean().optional(), max_close: z.number().optional() },
    outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
    annotations: RUN_LOCAL
  }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_manage_tabs', (workspace) => browserManageTabs(workspace, args as any, args.profile_label)));
}

function registerBrowserCdpBrowserCall({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_browser_call', { title: 'Browser-level CDP call', description: 'Call one Chrome DevTools Protocol method on the scoped browser websocket for a configured profile.', inputSchema: browserCdpCallSchema(), outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_browser_call', (workspace) => browserCdpBrowserCall(workspace, args.method, args.params ?? {}, args.profile_label)));
}

function registerBrowserCdpBrowserBatch({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_browser_batch', { title: 'Browser-level CDP batch', description: 'Send a sequence of raw Chrome DevTools Protocol commands to the scoped browser websocket. This is gateway-side transport batching, not a browser action wrapper. Supports raw CDP command steps and delay_ms steps.', inputSchema: { ...profileSchema(), calls: z.array(cdpBatchStepSchema(false)).min(1).max(20) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_browser_batch', (workspace) => browserCdpBrowserBatch(workspace, args.calls as any, args.profile_label)));
}

function registerBrowserCdpCall({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_call', { title: 'Browser CDP call', description: 'Call one Chrome DevTools Protocol method on a scoped page target websocket.', inputSchema: cdpCallSchema(), outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_call', (workspace) => browserCdpCall(workspace, args.target_id, args.method, args.params ?? {}, args.profile_label)));
}

function registerBrowserCdpBatch({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_batch', { title: 'Browser CDP batch', description: 'Send a sequence of raw Chrome DevTools Protocol commands to a scoped page-target websocket. This is gateway-side transport sequencing, not a browser action wrapper. Supports raw CDP command steps, delay_ms steps, and command wait_for page_load/dom_content_loaded.', inputSchema: { ...targetInfoSchema(), calls: z.array(cdpBatchStepSchema(true)).min(1).max(20) }, outputSchema: TOOL_RESULT_OUTPUT_SCHEMA, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_batch', (workspace) => browserCdpBatch(workspace, args.target_id, args.calls as any, args.profile_label)));
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

function cdpBatchStepSchema(allowPageWait: boolean) {
  const command = z.object({
    method: cdpMethodSchema().describe('Raw CDP method name, e.g. Runtime.evaluate, Page.navigate, Input.dispatchMouseEvent.'),
    params: z.record(z.string(), z.unknown()).optional().describe('Raw CDP params for the method.'),
    ...(allowPageWait ? {
      wait_for: z.enum(['page_load', 'dom_content_loaded']).optional().describe('Gateway sequencing helper: arm the CDP Page event listener before sending this command, then wait for the event after the command response.'),
      timeout_ms: z.number().int().min(1).max(60000).optional().describe('Timeout for wait_for in milliseconds; default 10000.')
    } : {})
  });
  const delayStep = z.object({ delay_ms: z.number().int().min(0).max(60000).describe('Gateway sequencing helper: wait before the next raw CDP command.') });
  return z.union([command, delayStep]);
}

function cdpMethodSchema() {
  return z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/);
}
