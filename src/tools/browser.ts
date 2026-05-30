import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from '../core/workspaces.js';
import { ok } from '../core/result.js';
import { agentPath } from '../core/agentDir.js';

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
  return ok(`listed ${tabs.length} browser tabs`, await browserTabPayload(workspace, profile, tabs));
}

export async function browserTabInfo(workspace: Workspace, targetId: string, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  const tab = await findBrowserTarget(profile, targetId, workspace);
  return ok('browser tab info', await tabInfoPayload(workspace, profile, tab));
}

export async function browserTabScreenshot(workspace: Workspace, targetId: string, label?: string, format: ScreenshotFormat = 'png') {
  assertScreenAllowed(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const result = await cdpCommand<{ data: string }>(tab.webSocketDebuggerUrl, 'Page.captureScreenshot', { format });
  return ok('browser tab screenshot captured', { ...await tabInfoPayload(workspace, profile, tab), screenshot: screenshotPayload(result.data, format) });
}

export async function browserTabSnapshot(workspace: Workspace, targetId: string, label?: string) {
  assertScreenAllowed(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const result = await cdpCommand<DomSnapshot>(tab.webSocketDebuggerUrl, 'DOMSnapshot.captureSnapshot', { computedStyles: [] });
  return ok('browser tab snapshot captured', { ...await tabInfoPayload(workspace, profile, tab), snapshot: boundedJson(result) });
}

export async function openBrowserTab(workspace: Workspace, url: string, label?: string, observeAfter?: ObserveAfter, tabKey?: string) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const opened = await fetchCdpJson<ChromeTarget>(profile, `/json/new?${encodeURIComponent(url)}`, 'PUT');
  const key = boundedTabKey(tabKey);
  if (key) await rememberTabKey(workspace, profile, key, opened);
  return ok('browser tab opened', await actionPayload(workspace, profile, { opened: await tabSummary(workspace, profile, opened), tab_key: key ?? undefined }, observeAfter));
}

export async function navigateBrowserTab(workspace: Workspace, targetId: string, url: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const result = await cdpCommand<{ frameId?: string; loaderId?: string; errorText?: string }>(tab.webSocketDebuggerUrl, 'Page.navigate', { url });
  await refreshResolvedTabKey(workspace, profile, targetId);
  return ok('browser tab navigated', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId, navigation: result }, observeAfter));
}

export async function clickBrowserTab(workspace: Workspace, targetId: string, x: number, y: number, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const point = { x: boundedCoordinate(x), y: boundedCoordinate(y) };
  await dispatchMouseClick(tab.webSocketDebuggerUrl, point);
  return ok('browser tab clicked', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId, click: point }, observeAfter));
}

export async function typeBrowserTab(workspace: Workspace, targetId: string, text: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const boundedText = boundedInputText(text);
  await cdpCommand(tab.webSocketDebuggerUrl, 'Input.insertText', { text: boundedText });
  return ok('browser tab typed text', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId, text_chars: boundedText.length }, observeAfter));
}

export async function fillBrowserTabField(workspace: Workspace, targetId: string, selector: string, value: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const boundedSelectorValue = boundedSelector(selector);
  const boundedValue = boundedInputText(value);
  const expression = fillFieldExpression(boundedSelectorValue, boundedValue);
  const result = await cdpCommand<{ result?: { value?: unknown } }>(tab.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const filled = result.result?.value as { ok?: boolean; reason?: string; tag?: string } | undefined;
  if (!filled?.ok) throw new Error(`browser field fill failed: ${filled?.reason ?? 'unknown'}`);
  return ok('browser tab field filled', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId, selector: boundedSelectorValue, value_chars: boundedValue.length, element: filled.tag ?? null }, observeAfter));
}

export async function selectBrowserTabOption(workspace: Workspace, targetId: string, selector: string, value: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const boundedSelectorValue = boundedSelector(selector);
  const boundedValue = boundedInputText(value);
  const expression = selectOptionExpression(boundedSelectorValue, boundedValue);
  const result = await cdpCommand<{ result?: { value?: unknown } }>(tab.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const selected = result.result?.value as { ok?: boolean; reason?: string; selected?: string } | undefined;
  if (!selected?.ok) throw new Error(`browser select failed: ${selected?.reason ?? 'unknown'}`);
  return ok('browser tab option selected', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId, selector: boundedSelectorValue, value: selected.selected ?? boundedValue }, observeAfter));
}

export async function pressBrowserTabKey(workspace: Workspace, targetId: string, key: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const normalized = boundedKey(key);
  await dispatchKeyPress(tab.webSocketDebuggerUrl, normalized);
  return ok('browser tab key pressed', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId, key: normalized }, observeAfter));
}

export async function scrollBrowserTab(workspace: Workspace, targetId: string, deltaX = 0, deltaY = 0, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const scroll = { delta_x: boundedScrollDelta(deltaX), delta_y: boundedScrollDelta(deltaY) };
  await cdpCommand(tab.webSocketDebuggerUrl, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: 0, y: 0, deltaX: scroll.delta_x, deltaY: scroll.delta_y });
  return ok('browser tab scrolled', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId, scroll }, observeAfter));
}

export async function activateBrowserTab(workspace: Workspace, targetId: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const tab = await findBrowserTarget(profile, targetId, workspace);
  await fetchCdpText(profile, `/json/activate/${encodeURIComponent(tab.id)}`);
  return ok('browser tab activated', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId }, observeAfter));
}

export async function closeBrowserTab(workspace: Workspace, targetId: string, label?: string, observeAfter?: ObserveAfter) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const tab = await findBrowserTarget(profile, targetId, workspace);
  await fetchCdpText(profile, `/json/close/${encodeURIComponent(tab.id)}`);
  await forgetResolvedTabKey(workspace, profile, targetId, tab.id);
  return ok('browser tab closed', await actionPayload(workspace, profile, { target_id: tab.id, target_ref: targetId }, observeAfter));
}

export async function browserCdpCall(workspace: Workspace, targetId: string, method: string, params: Record<string, unknown> = {}, label?: string) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const result = await cdpCommand(tab.webSocketDebuggerUrl, boundedCdpMethod(method), boundedCdpParams(params));
  return ok('browser CDP call completed', { ...await tabInfoPayload(workspace, profile, tab), method, result: boundedJson(result) });
}

export async function browserCdpBatch(workspace: Workspace, targetId: string, calls: CdpBatchCall[], label?: string) {
  assertBrowserControl(workspace);
  const { profile, tab } = await websocketTarget(workspace, targetId, label);
  const boundedCalls = calls.slice(0, 20);
  const results = [];
  for (const call of boundedCalls) results.push(await oneCdpBatchCall(tab.webSocketDebuggerUrl, call));
  return ok('browser CDP batch completed', { ...await tabInfoPayload(workspace, profile, tab), results });
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

async function websocketTarget(workspace: Workspace, targetId: string, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  const tab = await findBrowserTarget(profile, targetId, workspace);
  if (!tab.webSocketDebuggerUrl) throw new Error(`browser tab has no websocket debugger url: ${targetId}`);
  return { profile, tab: tab as ChromeTarget & { webSocketDebuggerUrl: string } };
}

async function findBrowserTarget(profile: ReturnType<typeof browserProfile>, targetId: string, workspace?: Workspace) {
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  const resolvedId = workspace ? await resolveTabRef(workspace, profile, targetId) : targetId;
  const tab = tabs.find((target) => target.id === resolvedId);
  if (!tab) throw new Error(`browser tab not found: ${targetId}`);
  return tab;
}

async function observeBrowserAfter(workspace: Workspace, profile: ReturnType<typeof browserProfile>, options?: ObserveAfter) {
  if (!options) return undefined;
  const delayMs = clampDelay(options.delay_ms ?? 0);
  if (delayMs > 0) await delay(delayMs);
  if (!options.tabs) return { delay_ms: delayMs };
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  return { delay_ms: delayMs, ...await browserTabPayload(workspace, profile, tabs) };
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

async function browserTabPayload(workspace: Workspace, profile: ReturnType<typeof browserProfile>, tabs: ChromeTarget[]) {
  await pruneMissingTabKeys(workspace, profile, tabs);
  const keys = await readTabKeys(workspace);
  return { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, tabs: tabs.filter(isPageTarget).map((tab) => tabSummaryWithKey(tab, profile, keys)) };
}

async function tabInfoPayload(workspace: Workspace, profile: ReturnType<typeof browserProfile>, tab: ChromeTarget) {
  return { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, tab: await tabSummary(workspace, profile, tab) };
}

async function tabSummary(workspace: Workspace, profile: ReturnType<typeof browserProfile>, target: ChromeTarget) {
  const keys = await readTabKeys(workspace);
  return tabSummaryWithKey(target, profile, keys);
}

function tabSummaryWithKey(target: ChromeTarget, profile: ReturnType<typeof browserProfile>, keys: BrowserTabKeys) {
  const entry = Object.entries(keys.tabs).find(([, item]) => item.profile_label === profile.label && item.target_id === target.id);
  return {
    id: target.id,
    key: entry?.[0] ?? null,
    title: target.title ?? '',
    url: target.url ?? '',
    type: target.type,
    attached: target.attached ?? false,
    attention: browserAttention(target)
  };
}

function browserAttention(target: ChromeTarget): BrowserAttention {
  const haystack = `${target.title ?? ''}\n${target.url ?? ''}`.toLowerCase();
  if (hasAny(haystack, ['captcha', 'turnstile', 'human verification', 'verify you are human', 'just a moment', 'checking your browser'])) {
    return attention('needs_captcha', 'Human verification detected. Stop and ask Calvin to complete it; do not bypass or automate it.');
  }
  if (hasAny(haystack, ['login', 'log in', 'signin', 'sign in', 'auth', 'sso', 'oauth'])) {
    return attention('needs_login', 'Login or authentication page detected. Stop if credentials, SSO, 2FA, or account selection is required.');
  }
  return attention('ready', 'No obvious login, CAPTCHA, or verification blocker detected from tab metadata.');
}

function attention(state: AttentionState, guidance: string): BrowserAttention {
  return { state, guidance };
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

async function resolveTabRef(workspace: Workspace, profile: ReturnType<typeof browserProfile>, targetId: string) {
  const keys = await readTabKeys(workspace);
  const entry = keys.tabs[targetId];
  if (!entry) return targetId;
  if (entry.profile_label !== profile.label) throw new Error(`browser tab key is for profile ${entry.profile_label}: ${targetId}`);
  return entry.target_id;
}

async function rememberTabKey(workspace: Workspace, profile: ReturnType<typeof browserProfile>, key: string, tab: ChromeTarget) {
  const keys = await readTabKeys(workspace);
  keys.tabs[key] = tabKeyEntry(profile, tab);
  await writeTabKeys(workspace, keys);
}

async function refreshResolvedTabKey(workspace: Workspace, profile: ReturnType<typeof browserProfile>, targetId: string) {
  const keys = await readTabKeys(workspace);
  const entry = keys.tabs[targetId];
  if (!entry || entry.profile_label !== profile.label) return;
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  const tab = tabs.find((item) => item.id === entry.target_id);
  if (tab) keys.tabs[targetId] = tabKeyEntry(profile, tab);
  await writeTabKeys(workspace, keys);
}

async function forgetResolvedTabKey(workspace: Workspace, profile: ReturnType<typeof browserProfile>, targetRef: string, targetId: string) {
  const keys = await readTabKeys(workspace);
  for (const [key, entry] of Object.entries(keys.tabs)) {
    if (entry.profile_label !== profile.label) continue;
    if (key === targetRef || entry.target_id === targetId) delete keys.tabs[key];
  }
  await writeTabKeys(workspace, keys);
}

async function pruneMissingTabKeys(workspace: Workspace, profile: ReturnType<typeof browserProfile>, tabs: ChromeTarget[]) {
  const ids = new Set(tabs.map((tab) => tab.id));
  const keys = await readTabKeys(workspace);
  let changed = false;
  for (const [key, entry] of Object.entries(keys.tabs)) {
    if (entry.profile_label !== profile.label || ids.has(entry.target_id)) continue;
    delete keys.tabs[key];
    changed = true;
  }
  if (changed) await writeTabKeys(workspace, keys);
}

function tabKeyEntry(profile: ReturnType<typeof browserProfile>, tab: ChromeTarget): BrowserTabKeyEntry {
  return { profile_label: profile.label, target_id: tab.id, title: tab.title ?? '', url: tab.url ?? '', updated_at: new Date().toISOString() };
}

async function readTabKeys(workspace: Workspace): Promise<BrowserTabKeys> {
  try {
    const parsed = JSON.parse(await readFile(tabKeysPath(workspace), 'utf8')) as BrowserTabKeys;
    return { tabs: parsed.tabs && typeof parsed.tabs === 'object' ? parsed.tabs : {} };
  } catch { return { tabs: {} }; }
}

async function writeTabKeys(workspace: Workspace, keys: BrowserTabKeys) {
  await mkdir(path.dirname(tabKeysPath(workspace)), { recursive: true });
  await writeFile(tabKeysPath(workspace), `${JSON.stringify(keys, null, 2)}\n`);
}

function tabKeysPath(workspace: Workspace) {
  return agentPath(workspace, 'browser-tabs.json');
}

function boundedTabKey(value?: string) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(value)) throw new Error('browser tab key must be 1-64 chars of letters, numbers, dot, underscore, colon, or dash');
  return value;
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

type DomSnapshot = {
  documents?: unknown[];
  strings?: string[];
};

type CdpBatchCall = {
  method: string;
  params?: Record<string, unknown>;
};

type BrowserTabKeyEntry = {
  profile_label: string;
  target_id: string;
  title: string;
  url: string;
  updated_at: string;
};

type BrowserTabKeys = {
  tabs: Record<string, BrowserTabKeyEntry>;
};

type AttentionState = 'ready' | 'needs_login' | 'needs_captcha';

type BrowserAttention = {
  state: AttentionState;
  guidance: string;
};

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

function boundedJson(value: unknown) {
  const json = JSON.stringify(value);
  const limit = 200_000;
  return { truncated: json.length > limit, chars: Math.min(json.length, limit), json: json.slice(0, limit) };
}

async function dispatchMouseClick(url: string, point: { x: number; y: number }) {
  await cdpCommand(url, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await cdpCommand(url, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}

async function dispatchKeyPress(url: string, key: string) {
  await cdpCommand(url, 'Input.dispatchKeyEvent', { type: 'keyDown', key });
  await cdpCommand(url, 'Input.dispatchKeyEvent', { type: 'keyUp', key });
}

function boundedCoordinate(value: number) {
  if (!Number.isFinite(value)) throw new Error('browser click coordinates must be finite numbers');
  return Math.min(Math.max(Math.trunc(value), 0), 100_000);
}

function boundedInputText(value: string) {
  if (value.length > 10_000) throw new Error('browser typed text exceeds 10000 character limit');
  return value;
}

function boundedSelector(value: string) {
  if (!value || value.length > 1000) throw new Error('browser selector must be 1-1000 characters');
  return value;
}

function fillFieldExpression(selector: string, value: string) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: 'not_found' };
    const tag = String(el.tagName || '').toLowerCase();
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!('value' in el) || !descriptor?.set) return { ok: false, reason: 'not_value_field', tag };
    el.focus();
    descriptor.set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, tag };
  })()`;
}

function selectOptionExpression(selector: string, value: string) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: 'not_found' };
    if (String(el.tagName || '').toLowerCase() !== 'select') return { ok: false, reason: 'not_select' };
    const wanted = ${JSON.stringify(value)};
    const options = Array.from(el.options || []);
    const option = options.find((item) => item.value === wanted) || options.find((item) => item.textContent?.trim() === wanted);
    if (!option) return { ok: false, reason: 'option_not_found' };
    el.focus();
    el.value = option.value;
    option.selected = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, selected: option.value };
  })()`;
}

function boundedKey(value: string) {
  if (!/^[A-Za-z0-9+_.:-]{1,64}$/.test(value)) throw new Error('browser key must be 1-64 chars of letters, numbers, +, _, ., :, or -');
  return value;
}

function boundedScrollDelta(value: number) {
  if (!Number.isFinite(value)) throw new Error('browser scroll delta must be finite');
  return Math.min(Math.max(Math.trunc(value), -10_000), 10_000);
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
