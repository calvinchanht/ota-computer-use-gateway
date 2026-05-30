import { z } from 'zod';
import { runWorkspaceTool } from '../../core/toolRunner.js';
import { activateBrowserTab, browserStatus, browserTabInfo, browserTabScreenshot, browserTabSnapshot, clickBrowserTab, closeBrowserTab, listBrowserProfiles, listBrowserTabs, navigateBrowserTab, openBrowserTab } from '../../tools/browser.js';
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
  server.registerTool('open_browser_tab', { title: 'Open browser tab', description: 'Open a URL in a new headed Chrome tab through CDP.', inputSchema: { ...profileSchema(), url: z.string(), observe_after: observeAfterSchema().optional() }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'open_browser_tab', (workspace) => openBrowserTab(workspace, args.url, args.profile_label, args.observe_after)));
}

function registerNavigateBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('navigate_browser_tab', { title: 'Navigate browser tab', description: 'Navigate an existing Chrome target/tab to a URL through CDP.', inputSchema: { ...targetActionSchema(), url: z.string() }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'navigate_browser_tab', (workspace) => navigateBrowserTab(workspace, args.target_id, args.url, args.profile_label, args.observe_after)));
}

function registerClickBrowserTab({ server, workspaces }: RegisterContext): void {
  server.registerTool('click_browser_tab', { title: 'Click browser tab', description: 'Click viewport coordinates in an existing Chrome target/tab through CDP.', inputSchema: { ...targetActionSchema(), x: z.number(), y: z.number() }, annotations: RUN_LOCAL }, async (args) => runWorkspaceTool(workspaces, args.workspace_id, 'click_browser_tab', (workspace) => clickBrowserTab(workspace, args.target_id, args.x, args.y, args.profile_label, args.observe_after)));
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
  return { ...profileSchema(), target_id: z.string() };
}

function screenshotSchema() {
  return { ...targetInfoSchema(), format: z.enum(['png', 'jpeg', 'webp']).optional() };
}

function targetActionSchema() {
  return { ...targetInfoSchema(), observe_after: observeAfterSchema().optional() };
}

function observeAfterSchema() {
  return z.object({ delay_ms: z.number().int().min(0).max(5000).optional(), tabs: z.boolean().optional() });
}
