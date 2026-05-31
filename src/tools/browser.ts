import type { Workspace } from '../core/workspaces.js';
import { ok } from '../core/result.js';

const REMINDER = 'Use CDP directly through browser_cdp_* tools.';

type BrowserProfile = NonNullable<Workspace['browser']>['profiles'][number];

type CdpBatchCall = {
  method: string;
  params?: Record<string, unknown>;
};

type ChromeTarget = {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  attached?: boolean;
  webSocketDebuggerUrl?: string;
};

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
      browser_websocket_url: await browserWebSocketUrl(profile).catch(() => null),
      reachable: await cdpReachable(profile),
      note: 'Gateway exposes scoped Chrome DevTools Protocol access; use CDP methods directly.'
    }
  });
}

export async function listBrowserTabs(workspace: Workspace, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  return ok(`listed ${tabs.length} browser targets`, { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, targets: tabs.map(targetSummary) });
}

export async function browserCdpBrowserCall(workspace: Workspace, method: string, params: Record<string, unknown> = {}, label?: string) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const result = await cdpCommand(await browserWebSocketUrl(profile), boundedCdpMethod(method), boundedCdpParams(params));
  return ok('browser-level CDP call completed', { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, method, result: boundedJson(result) });
}

export async function browserCdpBrowserBatch(workspace: Workspace, calls: CdpBatchCall[], label?: string) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const url = await browserWebSocketUrl(profile);
  const boundedCalls = calls.slice(0, 20);
  const results = [];
  for (const call of boundedCalls) results.push(await oneCdpBatchCall(url, call));
  return ok('browser-level CDP batch completed', { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, results });
}

export async function browserCdpCall(workspace: Workspace, targetId: string, method: string, params: Record<string, unknown> = {}, label?: string) {
  assertBrowserControl(workspace);
  const { profile, target } = await websocketTarget(workspace, targetId, label);
  const result = await cdpCommand(target.webSocketDebuggerUrl, boundedCdpMethod(method), boundedCdpParams(params));
  return ok('browser CDP call completed', { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, target: targetSummary(target), method, result: boundedJson(result) });
}

export async function browserCdpBatch(workspace: Workspace, targetId: string, calls: CdpBatchCall[], label?: string) {
  assertBrowserControl(workspace);
  const { profile, target } = await websocketTarget(workspace, targetId, label);
  const boundedCalls = calls.slice(0, 20);
  const results = [];
  for (const call of boundedCalls) results.push(await oneCdpBatchCall(target.webSocketDebuggerUrl, call));
  return ok('browser CDP batch completed', { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, target: targetSummary(target), results });
}

async function websocketTarget(workspace: Workspace, targetId: string, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  const target = tabs.find((item) => item.id === targetId);
  if (!target) throw new Error(`browser target not found: ${targetId}`);
  if (!target.webSocketDebuggerUrl) throw new Error(`browser target has no websocket debugger url: ${targetId}`);
  return { profile, target: target as ChromeTarget & { webSocketDebuggerUrl: string } };
}

function targetSummary(target: ChromeTarget) {
  return {
    id: target.id,
    title: target.title ?? '',
    url: target.url ?? '',
    type: target.type,
    attached: target.attached ?? false,
    has_websocket: Boolean(target.webSocketDebuggerUrl)
  };
}

async function cdpReachable(profile: ReturnType<typeof browserProfile>) {
  try {
    await fetchCdpJson(profile, '/json/version');
    return true;
  } catch { return false; }
}

async function browserWebSocketUrl(profile: ReturnType<typeof browserProfile>) {
  const version = await fetchCdpJson<{ webSocketDebuggerUrl?: string }>(profile, '/json/version');
  if (!version.webSocketDebuggerUrl) throw new Error('Chrome browser websocket debugger url is unavailable');
  return version.webSocketDebuggerUrl;
}

async function fetchCdpJson<T>(profile: ReturnType<typeof browserProfile>, path: string): Promise<T> {
  const res = await fetch(`${cdpEndpoint(profile)}${path}`);
  if (!res.ok) throw new Error(`CDP request failed: ${res.status}`);
  return await res.json() as T;
}

function cdpEndpoint(profile: ReturnType<typeof browserProfile>) {
  return `http://${profile.cdp_host}:${profile.cdp_port}`;
}

function assertBrowserControl(workspace: Workspace) {
  if (!workspace.allow_mouse_keyboard) throw new Error('browser CDP control is not enabled for this workspace');
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

function boundedJson(value: unknown) {
  const json = JSON.stringify(value);
  const limit = 200_000;
  return { truncated: json.length > limit, chars: Math.min(json.length, limit), json: json.slice(0, limit) };
}

function boundedCdpMethod(method: string) {
  if (!/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(method)) throw new Error('invalid CDP method name');
  return method;
}

function boundedCdpParams(params: Record<string, unknown>) {
  if (JSON.stringify(params).length > 200_000) throw new Error('browser CDP params exceed 200000 character limit');
  return params;
}

async function oneCdpBatchCall(url: string, call: CdpBatchCall) {
  const method = boundedCdpMethod(call.method);
  const result = await cdpCommand(url, method, boundedCdpParams(call.params ?? {}));
  return { method, result: boundedJson(result) };
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
