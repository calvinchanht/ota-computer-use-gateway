import type { Workspace } from '../core/workspaces.js';
import { ok } from '../core/result.js';

const REMINDER = 'Close unused tabs.';

type BrowserProfile = NonNullable<Workspace['browser']>['profiles'][number];

export async function listBrowserProfiles(workspace: Workspace) {
  const profiles = configuredProfiles(workspace).map((profile, index) => browserProfile(workspace, profile, index));
  return ok(`listed ${profiles.length} browser profiles`, { workspace_id: workspace.id, reminder: REMINDER, profiles });
}

export async function browserStatus(workspace: Workspace, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  return ok('browser status', {
    workspace_id: workspace.id,
    reminder: REMINDER,
    profile,
    cdp: {
      endpoint: cdpEndpoint(profile),
      reachable: await cdpReachable(profile),
      note: 'Browser tools use Chrome DevTools Protocol against a headed Chrome profile.'
    }
  });
}

export async function listBrowserTabs(workspace: Workspace, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  return ok(`listed ${tabs.length} browser tabs`, browserTabPayload(workspace, profile, tabs));
}

export async function browserTabInfo(workspace: Workspace, targetId: string, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  const tab = await findBrowserTarget(profile, targetId);
  return ok('browser tab info', tabInfoPayload(workspace, profile, tab));
}

export async function browserTabScreenshot(workspace: Workspace, targetId: string, label?: string, format: ScreenshotFormat = 'png') {
  assertScreenAllowed(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const tab = await findBrowserTarget(profile, targetId);
  if (!tab.webSocketDebuggerUrl) throw new Error(`browser tab has no websocket debugger url: ${targetId}`);
  const result = await cdpCommand<{ data: string }>(tab.webSocketDebuggerUrl, 'Page.captureScreenshot', { format });
  return ok('browser tab screenshot captured', { ...tabInfoPayload(workspace, profile, tab), screenshot: screenshotPayload(result.data, format) });
}

export async function openBrowserTab(workspace: Workspace, url: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const opened = await fetchCdpJson<ChromeTarget>(profile, `/json/new?${encodeURIComponent(url)}`, 'PUT');
  return ok('browser tab opened', await actionPayload(workspace, profile, { opened: tabSummary(opened) }, observeAfter));
}

export async function activateBrowserTab(workspace: Workspace, targetId: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  await fetchCdpText(profile, `/json/activate/${encodeURIComponent(targetId)}`);
  return ok('browser tab activated', await actionPayload(workspace, profile, { target_id: targetId }, observeAfter));
}

export async function closeBrowserTab(workspace: Workspace, targetId: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  await fetchCdpText(profile, `/json/close/${encodeURIComponent(targetId)}`);
  return ok('browser tab closed', await actionPayload(workspace, profile, { target_id: targetId }, observeAfter));
}

async function actionPayload(workspace: Workspace, profile: ReturnType<typeof browserProfile>, data: Record<string, unknown>, observeAfter?: ObserveAfter) {
  return {
    workspace_id: workspace.id,
    reminder: REMINDER,
    profile_label: profile.label,
    ...data,
    observation: await observeBrowserAfter(workspace, profile, observeAfter)
  };
}

async function findBrowserTarget(profile: ReturnType<typeof browserProfile>, targetId: string) {
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  const tab = tabs.find((target) => target.id === targetId);
  if (!tab) throw new Error(`browser tab not found: ${targetId}`);
  return tab;
}

async function observeBrowserAfter(workspace: Workspace, profile: ReturnType<typeof browserProfile>, options?: ObserveAfter) {
  if (!options) return undefined;
  const delayMs = clampDelay(options.delay_ms ?? 0);
  if (delayMs > 0) await delay(delayMs);
  if (!options.tabs) return { delay_ms: delayMs };
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  return { delay_ms: delayMs, ...browserTabPayload(workspace, profile, tabs) };
}

async function cdpReachable(profile: ReturnType<typeof browserProfile>) {
  try {
    await fetchCdpJson(profile, '/json/version');
    return true;
  } catch { return false; }
}

async function fetchCdpJson<T>(profile: ReturnType<typeof browserProfile>, path: string, method = 'GET'): Promise<T> {
  const res = await fetchCdp(profile, path, method);
  return await res.json() as T;
}

async function fetchCdpText(profile: ReturnType<typeof browserProfile>, path: string, method = 'GET') {
  const res = await fetchCdp(profile, path, method);
  return await res.text();
}

async function fetchCdp(profile: ReturnType<typeof browserProfile>, path: string, method = 'GET') {
  const res = await fetch(`${cdpEndpoint(profile)}${path}`, { method });
  if (!res.ok) throw new Error(`CDP request failed: ${res.status}`);
  return res;
}

function cdpEndpoint(profile: ReturnType<typeof browserProfile>) {
  return `http://${profile.cdp_host}:${profile.cdp_port}`;
}

function isPageTarget(target: ChromeTarget) {
  return target.type === 'page';
}

function browserTabPayload(workspace: Workspace, profile: ReturnType<typeof browserProfile>, tabs: ChromeTarget[]) {
  return { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, tabs: tabs.filter(isPageTarget).map(tabSummary) };
}

function tabInfoPayload(workspace: Workspace, profile: ReturnType<typeof browserProfile>, tab: ChromeTarget) {
  return { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, tab: tabSummary(tab) };
}

function tabSummary(target: ChromeTarget) {
  return { id: target.id, title: target.title ?? '', url: target.url ?? '', type: target.type, attached: target.attached ?? false };
}

function assertBrowserControl(workspace: Workspace) {
  if (!workspace.allow_mouse_keyboard) throw new Error('browser control is not enabled for this workspace');
}

function assertScreenAllowed(workspace: Workspace) {
  if (!workspace.allow_screen) throw new Error('screen observation is not enabled for this workspace');
}

function selectedBrowserProfile(workspace: Workspace, label?: string) {
  const profiles = configuredProfiles(workspace).map((profile, index) => browserProfile(workspace, profile, index));
  const target = label ?? profiles.find((profile) => profile.default)?.label ?? workspace.id;
  const profile = profiles.find((item) => item.label === target);
  if (!profile) throw new Error(`unknown browser profile: ${target}`);
  return profile;
}

function configuredProfiles(workspace: Workspace): BrowserProfile[] {
  const configured = workspace.browser?.profiles ?? [];
  return configured.length ? configured : [defaultProfile(workspace)];
}

function browserProfile(workspace: Workspace, profile: BrowserProfile, index: number) {
  return {
    label: profile.label ?? workspace.id,
    user_data_dir: profile.user_data_dir ?? null,
    cdp_host: profile.cdp_host ?? '127.0.0.1',
    cdp_port: profile.cdp_port ?? 9222,
    display: profile.display ?? null,
    headed: profile.headed ?? true,
    default: profile.default ?? index === 0,
    launch: profile.launch ?? false
  };
}

type ObserveAfter = {
  delay_ms?: number;
  tabs?: boolean;
};

type ScreenshotFormat = 'png' | 'jpeg' | 'webp';

type ChromeTarget = {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  attached?: boolean;
  webSocketDebuggerUrl?: string;
};

function screenshotPayload(base64: string, format: ScreenshotFormat) {
  const bytes = Buffer.from(base64, 'base64').length;
  if (bytes > 5 * 1024 * 1024) throw new Error('browser screenshot exceeds 5 MiB limit');
  return { media_type: `image/${format}`, base64, bytes };
}

async function cdpCommand<T>(url: string, method: string, params: Record<string, unknown>) {
  return await new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('CDP command timed out')), 10000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener('error', () => reject(new Error('CDP websocket error')));
    ws.addEventListener('message', (event) => handleCdpMessage(event.data, resolve, reject, timer, ws));
  });
}

function handleCdpMessage<T>(data: unknown, resolve: (value: T) => void, reject: (error: Error) => void, timer: NodeJS.Timeout, ws: WebSocket) {
  const message = JSON.parse(String(data));
  if (message.id !== 1) return;
  clearTimeout(timer);
  ws.close();
  if (message.error) reject(new Error(message.error.message ?? 'CDP command failed'));
  else resolve(message.result as T);
}

function clampDelay(value: number) {
  return Math.min(Math.max(Math.trunc(value), 0), 5000);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultProfile(workspace: Workspace): BrowserProfile {
  return {
    label: workspace.id,
    cdp_host: '127.0.0.1',
    cdp_port: 9222,
    headed: true,
    default: true,
    launch: false
  };
}
