import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { activateBrowserTab, browserCdpBatch, browserCdpCall, browserStatus, browserTabInfo, browserTabScreenshot, browserTabSnapshot, clickBrowserTab, closeBrowserTab, fillBrowserTabField, listBrowserProfiles, listBrowserTabs, navigateBrowserTab, openBrowserTab, pressBrowserTabKey, scrollBrowserTab, selectBrowserTabOption, typeBrowserTab } from '../../tools/browser.js';
import { READ_ONLY, RUN_LOCAL } from './annotations.js';
import type { RegisterContext } from './types.js';

export function registerBrowserTools(context: RegisterContext): void {
  registerListBrowserProfiles(context);
  registerBrowserStatus(context);
  registerListBrowserTabs(context);
  registerBrowserTabInfo(context);
  registerBrowserTabScreenshot(context);
  registerBrowserTabSnapshot(context);
  registerOpenBrowserTab(context);
  registerNavigateBrowserTab(context);
  registerClickBrowserTab(context);
  registerTypeBrowserTab(context);
  registerFillBrowserTabField(context);
  registerSelectBrowserTabOption(context);
  registerPressBrowserTabKey(context);
  registerScrollBrowserTab(context);
  registerBrowserCdpCall(context);
  registerBrowserCdpBatch(context);
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

function registerBrowserTabInfo({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_tab_info', { title: 'Browser tab info', description: 'Return metadata for one Chrome target/tab by id.', inputSchema: targetInfoSchema(), annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_tab_info', (workspace) => browserTabInfo(workspace, args.target_id, args.profile_label)));
}

function registerBrowserTabScreenshot({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_tab_screenshot', { title: 'Browser tab screenshot', description: 'Capture a screenshot from one Chrome target/tab through CDP.', inputSchema: screenshotSchema(), annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_tab_screenshot', (workspace) => browserTabScreenshot(workspace, args.target_id, args.profile_label, args.format)));
}

function registerBrowserTabSnapshot({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_tab_snapshot', { title: 'Browser tab snapshot', description: 'Capture a bounded DOM snapshot from one Chrome target/tab through CDP.', inputSchema: targetInfoSchema(), annotations: READ_ONLY }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_tab_snapshot', (workspace) => browserTabSnapshot(workspace, args.target_id, args.profile_label)));
}

function registerOpenBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('open_browser_tab', { title: 'Open browser tab', description: 'Open a URL in a new headed Chrome tab through CDP. Optionally assign a stable tab_key that can be used anywhere target_id is accepted.', inputSchema: { ...profileSchema(), url: z.string(), tab_key: tabKeySchema().optional(), observe_after: observeAfterSchema().optional() }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'open_browser_tab', (workspace) => openBrowserTab(workspace, args.url, args.profile_label, args.observe_after, args.tab_key)));
}

function registerNavigateBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('navigate_browser_tab', { title: 'Navigate browser tab', description: 'Navigate an existing Chrome target/tab to a URL through CDP.', inputSchema: { ...targetActionSchema(), url: z.string() }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'navigate_browser_tab', (workspace) => navigateBrowserTab(workspace, args.target_id, args.url, args.profile_label, args.observe_after)));
}

function registerClickBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('click_browser_tab', { title: 'Click browser tab', description: 'Click viewport coordinates in an existing Chrome target/tab through CDP.', inputSchema: { ...targetActionSchema(), x: z.number(), y: z.number() }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'click_browser_tab', (workspace) => clickBrowserTab(workspace, args.target_id, args.x, args.y, args.profile_label, args.observe_after)));
}

function registerTypeBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('type_browser_tab', { title: 'Type into browser tab', description: 'Insert text into the focused element of an existing Chrome target/tab through CDP.', inputSchema: { ...targetActionSchema(), text: z.string().max(10000) }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'type_browser_tab', (workspace) => typeBrowserTab(workspace, args.target_id, args.text, args.profile_label, args.observe_after)));
}

function registerFillBrowserTabField({ server, workspaces }: RegisterContext): void {
  server.registerTool('fill_browser_tab_field', { title: 'Fill browser tab field', description: 'Set the value of an input or textarea selected by CSS selector through scoped CDP Runtime.evaluate.', inputSchema: { ...targetActionSchema(), selector: z.string().min(1).max(1000), value: z.string().max(10000) }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'fill_browser_tab_field', (workspace) => fillBrowserTabField(workspace, args.target_id, args.selector, args.value, args.profile_label, args.observe_after)));
}

function registerSelectBrowserTabOption({ server, workspaces }: RegisterContext): void {
  server.registerTool('select_browser_tab_option', { title: 'Select browser tab option', description: 'Select a native <select> option by value or exact visible text through scoped CDP Runtime.evaluate.', inputSchema: { ...targetActionSchema(), selector: z.string().min(1).max(1000), value: z.string().max(10000) }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'select_browser_tab_option', (workspace) => selectBrowserTabOption(workspace, args.target_id, args.selector, args.value, args.profile_label, args.observe_after)));
}

function registerPressBrowserTabKey({ server, workspaces }: RegisterContext): void {
  server.registerTool('press_browser_tab_key', { title: 'Press browser tab key', description: 'Press a keyboard key in an existing Chrome target/tab through CDP.', inputSchema: { ...targetActionSchema(), key: z.string().regex(/^[A-Za-z0-9+_.:-]{1,64}$/) }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'press_browser_tab_key', (workspace) => pressBrowserTabKey(workspace, args.target_id, args.key, args.profile_label, args.observe_after)));
}

function registerScrollBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('scroll_browser_tab', { title: 'Scroll browser tab', description: 'Dispatch a bounded mouse-wheel scroll in an existing Chrome target/tab through CDP.', inputSchema: { ...targetActionSchema(), delta_x: z.number().optional(), delta_y: z.number().optional() }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'scroll_browser_tab', (workspace) => scrollBrowserTab(workspace, args.target_id, args.delta_x ?? 0, args.delta_y ?? 0, args.profile_label, args.observe_after)));
}

function registerBrowserCdpCall({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_call', { title: 'Browser CDP call', description: 'Call one Chrome DevTools Protocol method on a scoped target/tab.', inputSchema: cdpCallSchema(), annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_call', (workspace) => browserCdpCall(workspace, args.target_id, args.method, args.params ?? {}, args.profile_label)));
}

function registerBrowserCdpBatch({ server, workspaces }: RegisterContext): void {
  server.registerTool('browser_cdp_batch', { title: 'Browser CDP batch', description: 'Call multiple Chrome DevTools Protocol methods on a scoped target/tab.', inputSchema: { ...targetInfoSchema(), calls: z.array(cdpCallItemSchema()).min(1).max(20) }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'browser_cdp_batch', (workspace) => browserCdpBatch(workspace, args.target_id, args.calls, args.profile_label)));
}

function registerActivateBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('activate_browser_tab', { title: 'Activate browser tab', description: 'Focus a Chrome target/tab through CDP.', inputSchema: targetActionSchema(), annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'activate_browser_tab', (workspace) => activateBrowserTab(workspace, args.target_id, args.profile_label, args.observe_after)));
}

function registerCloseBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('close_browser_tab', { title: 'Close browser tab', description: 'Close a Chrome target/tab through CDP.', inputSchema: targetActionSchema(), annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'close_browser_tab', (workspace) => closeBrowserTab(workspace, args.target_id, args.profile_label, args.observe_after)));
}

function profileSchema() {
  return { workspace_id: z.string(), profile_label: z.string().optional() };
}

function targetInfoSchema() {
  return { ...profileSchema(), target_id: z.string().describe('Raw Chrome target id or stable tab_key assigned by open_browser_tab.') };
}

function screenshotSchema() {
  return { ...targetInfoSchema(), format: z.enum(['png', 'jpeg', 'webp']).optional() };
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

function targetActionSchema() {
  return { ...targetInfoSchema(), observe_after: observeAfterSchema().optional() };
}

function observeAfterSchema() {
  return z.object({ delay_ms: z.number().int().min(0).max(5000).optional(), tabs: z.boolean().optional() });
}

function tabKeySchema() {
  return z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/);
}
