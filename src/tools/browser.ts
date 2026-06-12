import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from '../core/workspaces.js';
import { ok } from '../core/result.js';
import { assertInside } from '../core/paths.js';

const REMINDER = 'Use CDP directly through browser_cdp_* tools.';

type BrowserProfile = NonNullable<Workspace['browser']>['profiles'][number];

type CdpWaitFor = 'page_load' | 'dom_content_loaded';

type CdpBatchCall = {
  method: string;
  params?: Record<string, unknown>;
  wait_for?: CdpWaitFor;
  timeout_ms?: number;
};

type CdpBatchDelay = {
  delay_ms: number;
};

type CdpBatchStep = CdpBatchCall | CdpBatchDelay;

type ChromeTarget = {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  attached?: boolean;
  webSocketDebuggerUrl?: string;
};

type BrowserTargetFilter = {
  type?: string;
  include_iframes?: boolean;
  include_workers?: boolean;
  include_browser_ui?: boolean;
};

type BrowserManageTabsAction = 'list_page_tabs_only' | 'focus_by_url' | 'focus_by_title' | 'close_by_filter';

type BrowserManageTabsOptions = {
  action: BrowserManageTabsAction;
  url_contains?: string;
  title_contains?: string;
  target_id?: string;
  include_urls?: boolean;
  max_close?: number;
};

type BrowserClickAndWaitOptions = {
  target_id: string;
  selector?: string;
  text?: string;
  wait_for_text?: string;
  wait_for_selector?: string;
  wait_for_url_contains?: string;
  wait_until_stable?: boolean;
  timeout_ms?: number;
};

type BrowserUploadFileOptions = {
  target_id: string;
  selector: string;
  path: string;
  verify_visible_text?: string;
  timeout_ms?: number;
};

type BrowserTailSnapshot = {
  cursor: number;
  captured_at: string;
  url?: string;
  title?: string;
  visible_text: string;
  busy: boolean;
};

const browserTailSnapshots = new Map<string, BrowserTailSnapshot>();
let browserTailCursor = 0;

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

export async function listBrowserTabs(workspace: Workspace, label?: string, includeUrls = false, filter: BrowserTargetFilter = {}) {
  const profile = selectedBrowserProfile(workspace, label);
  const targets = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  const normalizedFilter = normalizeTargetFilter(filter);
  const visibleTargets = targets.filter((target) => targetMatchesFilter(target, normalizedFilter));
  return ok(`listed ${visibleTargets.length} browser targets`, {
    workspace_id: workspace.id,
    reminder: REMINDER,
    profile_label: profile.label,
    urls_included: includeUrls,
    target_filter: normalizedFilter,
    total_targets: targets.length,
    filtered_targets: targets.length - visibleTargets.length,
    targets: visibleTargets.map((target) => targetSummary(target, includeUrls))
  });
}


export async function browserVisibleState(workspace: Workspace, targetId: string, label?: string) {
  assertScreenRead(workspace);
  const { profile, target } = await websocketTarget(workspace, targetId, label);
  const result = await cdpCommand<RuntimeEvaluateResult>(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: visibleStateExpression(),
    returnByValue: true,
    awaitPromise: true
  });
  return ok('browser visible state', {
    workspace_id: workspace.id,
    reminder: 'High-level visible browser state. Use this to verify what a human-visible page appears to show; do not rely only on DOM mutation state for upload/form readiness.',
    profile_label: profile.label,
    target: targetSummary(target),
    state: boundedVisibleState(runtimeValue(result))
  });
}

export async function browserTail(workspace: Workspace, targetId: string, cursor?: number, label?: string) {
  assertScreenRead(workspace);
  const { profile, target } = await websocketTarget(workspace, targetId, label);
  const result = await cdpCommand<RuntimeEvaluateResult>(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: browserTailExpression(),
    returnByValue: true,
    awaitPromise: true
  });
  const state = browserTailSnapshot(runtimeValue(result));
  const previous = cursor === undefined ? undefined : browserTailSnapshots.get(browserTailKey(workspace.id, profile.label, targetId, cursor));
  const nextCursor = ++browserTailCursor;
  const captured_at = new Date().toISOString();
  const snapshot: BrowserTailSnapshot = { cursor: nextCursor, captured_at, url: state.url, title: state.title, visible_text: state.visible_text, busy: state.busy };
  browserTailSnapshots.set(browserTailKey(workspace.id, profile.label, targetId, nextCursor), snapshot);
  pruneBrowserTailSnapshots();
  return ok('browser tail', {
    workspace_id: workspace.id,
    profile_label: profile.label,
    target: targetSummary(target),
    tail_supported: true,
    cursor: cursor ?? 0,
    next_cursor: nextCursor,
    captured_at,
    state: { url: state.url, title: state.title, busy: state.busy, visible_text_length: state.visible_text.length },
    delta: browserTailDelta(previous, snapshot),
    note: 'Pass cursor=next_cursor on the next browser_tail call to receive only URL/title/busy/text deltas.'
  });
}

export async function browserManageTabs(workspace: Workspace, options: BrowserManageTabsOptions, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  const targets = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  const pages = targets.filter((target) => targetMatchesFilter(target, normalizeTargetFilter({ type: 'page' })));
  if (options.action === 'list_page_tabs_only') {
    return ok(`listed ${pages.length} page tabs`, { workspace_id: workspace.id, profile_label: profile.label, targets: pages.map((target) => targetSummary(target, options.include_urls ?? false)) });
  }

  assertBrowserControl(workspace);
  const browserUrl = await browserWebSocketUrl(profile);
  const matches = matchingTargets(pages, options);
  if (options.action === 'focus_by_url' || options.action === 'focus_by_title') {
    const target = matches[0];
    if (!target) throw new Error('no matching browser tab found');
    await cdpCommand(browserUrl, 'Target.activateTarget', { targetId: target.id });
    return ok('focused browser tab', { workspace_id: workspace.id, profile_label: profile.label, action: options.action, target: targetSummary(target, true) });
  }

  if (options.action === 'close_by_filter') {
    const limit = Math.min(Math.max(Math.trunc(options.max_close ?? 10), 0), 50);
    const selected = matches.slice(0, limit);
    const closed = [];
    for (const target of selected) {
      await cdpCommand(browserUrl, 'Target.closeTarget', { targetId: target.id });
      closed.push(targetSummary(target, true));
    }
    return ok(`closed ${closed.length} browser tabs`, { workspace_id: workspace.id, profile_label: profile.label, action: options.action, matched: matches.length, closed });
  }

  throw new Error(`unsupported browser tab action: ${options.action}`);
}


export async function browserClickAndWait(workspace: Workspace, options: BrowserClickAndWaitOptions, label?: string) {
  assertBrowserControl(workspace);
  const { profile, target } = await websocketTarget(workspace, options.target_id, label);
  const timeoutMs = boundedTimeoutMs(options.timeout_ms ?? 10000);
  const result = await cdpCommand<RuntimeEvaluateResult>(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: clickAndWaitExpression(options, timeoutMs),
    returnByValue: true,
    awaitPromise: true
  });
  return ok('browser click and wait completed', {
    workspace_id: workspace.id,
    reminder: 'High-level click-and-wait helper. Prefer this over raw click followed by blind sleeps when waiting for visible text, selector, URL change, or DOM stability.',
    profile_label: profile.label,
    target: targetSummary(target),
    result: runtimeValue(result)
  });
}


export async function browserUploadFileAndVerify(workspace: Workspace, options: BrowserUploadFileOptions, label?: string) {
  assertBrowserControl(workspace);
  const uploadFile = await resolveUploadPath(workspace, options.path);
  const { profile, target } = await websocketTarget(workspace, options.target_id, label);
  const documentResult = await cdpCommand<{ root: { nodeId: number } }>(target.webSocketDebuggerUrl, 'DOM.getDocument', { depth: 1, pierce: true });
  const queryResult = await cdpCommand<{ nodeId: number }>(target.webSocketDebuggerUrl, 'DOM.querySelector', { nodeId: documentResult.root.nodeId, selector: options.selector });
  if (!queryResult.nodeId) throw new Error('file input selector not found');
  await cdpCommand(target.webSocketDebuggerUrl, 'DOM.setFileInputFiles', { nodeId: queryResult.nodeId, files: [uploadFile.absolute] });
  const verifyText = options.verify_visible_text ?? path.basename(uploadFile.absolute);
  const timeoutMs = boundedTimeoutMs(options.timeout_ms ?? 10000);
  const verify = await cdpCommand<RuntimeEvaluateResult>(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: waitForVisibleTextExpression(verifyText, timeoutMs),
    returnByValue: true,
    awaitPromise: true
  });
  return ok('browser upload file and verify completed', {
    workspace_id: workspace.id,
    reminder: 'High-level file-upload helper. It sets the file input and verifies the upload is reflected in human-visible page text, avoiding DOM-only false readiness.',
    profile_label: profile.label,
    target: targetSummary(target),
    file: { path: uploadFile.relative, basename: path.basename(uploadFile.absolute), bytes: uploadFile.bytes },
    verify: runtimeValue(verify)
  });
}

export async function browserCdpBrowserCall(workspace: Workspace, method: string, params: Record<string, unknown> = {}, label?: string) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const result = await cdpCommand(await browserWebSocketUrl(profile), boundedCdpMethod(method), boundedCdpParams(params));
  return ok('browser-level CDP call completed', { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, method, result: boundedJson(result) });
}

export async function browserCdpBrowserBatch(workspace: Workspace, calls: CdpBatchStep[], label?: string) {
  assertBrowserControl(workspace);
  const profile = selectedBrowserProfile(workspace, label);
  const url = await browserWebSocketUrl(profile);
  const boundedCalls = calls.slice(0, 20);
  const results = [];
  for (let index = 0; index < boundedCalls.length; index++) results.push(await oneCdpBatchCall(url, boundedCalls[index], index, false));
  return ok('browser-level CDP batch completed', { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, results });
}

export async function browserCdpCall(workspace: Workspace, targetId: string, method: string, params: Record<string, unknown> = {}, label?: string) {
  assertBrowserControl(workspace);
  const { profile, target } = await websocketTarget(workspace, targetId, label);
  const result = await cdpCommand(target.webSocketDebuggerUrl, boundedCdpMethod(method), boundedCdpParams(params));
  return ok('browser CDP call completed', { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, target: targetSummary(target), method, result: boundedJson(result) });
}

export async function browserCdpBatch(workspace: Workspace, targetId: string, calls: CdpBatchStep[], label?: string) {
  assertBrowserControl(workspace);
  const { profile, target } = await websocketTarget(workspace, targetId, label);
  const boundedCalls = calls.slice(0, 20);
  const results = [];
  for (let index = 0; index < boundedCalls.length; index++) results.push(await oneCdpBatchCall(target.webSocketDebuggerUrl, boundedCalls[index], index, true));
  return ok('browser CDP batch completed', { workspace_id: workspace.id, reminder: REMINDER, profile_label: profile.label, target: targetSummary(target), results });
}


type RuntimeEvaluateResult = { result?: { value?: unknown } };

function runtimeValue(result: RuntimeEvaluateResult) {
  return result?.result?.value ?? null;
}

function boundedVisibleState(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const state = value as Record<string, unknown>;
  return {
    ...state,
    visible_text: typeof state.visible_text === 'string' ? state.visible_text.slice(0, 20000) : state.visible_text
  };
}

function browserTailSnapshot(value: unknown): Omit<BrowserTailSnapshot, 'cursor' | 'captured_at'> {
  const state = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    url: typeof state.url === 'string' ? state.url : undefined,
    title: typeof state.title === 'string' ? state.title : undefined,
    visible_text: typeof state.visible_text === 'string' ? state.visible_text.slice(0, 50000) : '',
    busy: Boolean(state.busy)
  };
}

function browserTailDelta(previous: BrowserTailSnapshot | undefined, next: BrowserTailSnapshot) {
  if (!previous) return { initial: true, url_changed: true, title_changed: true, busy_changed: true, text_delta: next.visible_text.slice(0, 20000), text_delta_truncated: next.visible_text.length > 20000 };
  const textDelta = next.visible_text.startsWith(previous.visible_text) ? next.visible_text.slice(previous.visible_text.length) : next.visible_text;
  return {
    initial: false,
    url_changed: previous.url !== next.url,
    title_changed: previous.title !== next.title,
    busy_changed: previous.busy !== next.busy,
    url: previous.url !== next.url ? next.url : undefined,
    title: previous.title !== next.title ? next.title : undefined,
    busy: previous.busy !== next.busy ? next.busy : undefined,
    text_delta: textDelta.slice(0, 20000),
    text_delta_truncated: textDelta.length > 20000,
    text_replaced: !next.visible_text.startsWith(previous.visible_text)
  };
}

function browserTailKey(workspaceId: string, profileLabel: string, targetId: string, cursor: number): string {
  return `${workspaceId}:${profileLabel}:${targetId}:${cursor}`;
}

function pruneBrowserTailSnapshots(): void {
  const maxEntries = 200;
  if (browserTailSnapshots.size <= maxEntries) return;
  const remove = browserTailSnapshots.size - maxEntries;
  let count = 0;
  for (const key of browserTailSnapshots.keys()) {
    browserTailSnapshots.delete(key);
    if (++count >= remove) break;
  }
}

function matchingTargets(targets: ChromeTarget[], options: BrowserManageTabsOptions) {
  return targets.filter((target) => {
    if (options.target_id && target.id !== options.target_id) return false;
    if (options.url_contains && !(target.url ?? '').includes(options.url_contains)) return false;
    if (options.title_contains && !(target.title ?? '').toLowerCase().includes(options.title_contains.toLowerCase())) return false;
    if (!options.target_id && !options.url_contains && !options.title_contains && options.action !== 'list_page_tabs_only') return false;
    return true;
  });
}



async function resolveUploadPath(workspace: Workspace, requested: string) {
  if (path.isAbsolute(requested)) throw new Error('absolute upload paths are not allowed');
  const joined = path.resolve(workspace.realRoot, requested);
  const real = await realpath(joined);
  assertInside(workspace.realRoot, real);
  const info = await stat(real);
  if (!info.isFile()) throw new Error('upload path is not a file');
  return { absolute: real, relative: path.relative(workspace.realRoot, real) || '.', bytes: info.size };
}

function waitForVisibleTextExpression(text: string, timeoutMs: number) {
  const payload = JSON.stringify({ text, timeout_ms: timeoutMs }).replace(/</g, '\\u003c');
  return `(() => new Promise((resolve) => {
    const opts = ${payload};
    const started = Date.now();
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const check = () => {
      const visible_text = textOf(document.body);
      if (visible_text.includes(opts.text)) { resolve({ ok: true, visible_text_found: opts.text, elapsed_ms: Date.now() - started }); return; }
      if (Date.now() - started > opts.timeout_ms) { resolve({ ok: false, error: 'visible upload text not found', expected_text: opts.text, elapsed_ms: Date.now() - started }); return; }
      setTimeout(check, 100);
    };
    check();
  }))()`;
}

function clickAndWaitExpression(options: BrowserClickAndWaitOptions, timeoutMs: number) {
  const payload = JSON.stringify({
    selector: options.selector,
    text: options.text,
    wait_for_text: options.wait_for_text,
    wait_for_selector: options.wait_for_selector,
    wait_for_url_contains: options.wait_for_url_contains,
    wait_until_stable: options.wait_until_stable ?? false,
    timeout_ms: timeoutMs
  }).replace(/</g, '\\u003c');
  return `(() => new Promise((resolve) => {
    const opts = ${payload};
    const started = Date.now();
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const findByText = (needle) => Array.from(document.querySelectorAll('button, a, input, textarea, select, [role=button], [onclick]')).find((el) => visible(el) && textOf(el).toLowerCase().includes(String(needle).toLowerCase()));
    const target = opts.selector ? document.querySelector(opts.selector) : findByText(opts.text);
    if (!target) { resolve({ ok: false, error: 'click target not found', elapsed_ms: Date.now() - started }); return; }
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    let lastText = textOf(document.body);
    let stableSince = Date.now();
    const check = () => {
      const bodyText = textOf(document.body);
      if (bodyText !== lastText) { lastText = bodyText; stableSince = Date.now(); }
      const waited = {
        text: opts.wait_for_text ? bodyText.includes(opts.wait_for_text) : undefined,
        selector: opts.wait_for_selector ? Boolean(document.querySelector(opts.wait_for_selector)) : undefined,
        url: opts.wait_for_url_contains ? location.href.includes(opts.wait_for_url_contains) : undefined,
        stable: opts.wait_until_stable ? Date.now() - stableSince >= 750 : undefined
      };
      const active = Object.values(waited).filter((value) => value !== undefined);
      if (!active.length || active.every(Boolean)) {
        resolve({ ok: true, waited, url: location.href, title: document.title, elapsed_ms: Date.now() - started });
        return;
      }
      if (Date.now() - started > opts.timeout_ms) {
        resolve({ ok: false, error: 'wait timed out', waited, url: location.href, title: document.title, elapsed_ms: Date.now() - started });
        return;
      }
      setTimeout(check, 100);
    };
    setTimeout(check, 100);
  }))()`;
}

function browserTailExpression() {
  return `(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const busySelectors = [
      '[aria-busy="true"]',
      '[data-testid*="stop" i]',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Cancel" i]',
      '.result-streaming'
    ];
    return {
      url: location.href,
      title: document.title,
      visible_text: textOf(document.body).slice(0, 50000),
      busy: busySelectors.some((selector) => Boolean(document.querySelector(selector)))
    };
  })()`;
}

function visibleStateExpression() {
  return `(() => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const labelFor = (el) => {
      if (!el) return '';
      const id = el.id;
      const labels = [];
      if (id) document.querySelectorAll('label[for="' + CSS.escape(id) + '"]').forEach((label) => labels.push(textOf(label)));
      const parent = el.closest('label');
      if (parent) labels.push(textOf(parent));
      const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
      if (aria) labels.push(aria);
      return [...new Set(labels.filter(Boolean))].join(' | ').slice(0, 240);
    };
    const field = (el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      label: labelFor(el),
      required: Boolean(el.required || el.getAttribute('aria-required') === 'true'),
      disabled: Boolean(el.disabled),
      visible: visible(el),
      value_present: el.type === 'file' ? Boolean(el.files && el.files.length) : Boolean((el.value || '').trim()),
      files: el.type === 'file' ? Array.from(el.files || []).map((file) => ({ name: file.name, size: file.size, type: file.type })) : undefined
    });
    const controls = Array.from(document.querySelectorAll('input, textarea, select')).filter(visible).slice(0, 200).map(field);
    const buttons = Array.from(document.querySelectorAll('button, input[type=button], input[type=submit], [role=button]')).filter(visible).slice(0, 100).map((el) => ({ text: textOf(el).slice(0, 160) || el.value || el.getAttribute('aria-label') || '', type: el.getAttribute('type') || '', disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true') }));
    const links = Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0, 100).map((el) => ({ text: textOf(el).slice(0, 160), href: el.href }));
    const visibleText = textOf(document.body).slice(0, 30000);
    const fileInputs = controls.filter((item) => item.type === 'file');
    const filenames = new Set(fileInputs.flatMap((item) => (item.files || []).map((file) => file.name)));
    const visibleUploadedFiles = Array.from(filenames).filter((name) => visibleText.includes(name));
    const requiredMissing = controls.filter((item) => item.required && !item.disabled && item.visible && !item.value_present);
    const errorNodes = Array.from(document.querySelectorAll('[role=alert], .error, .errors, .invalid, [aria-invalid="true"]')).filter(visible).slice(0, 50).map((el) => textOf(el).slice(0, 300)).filter(Boolean);
    return {
      url: location.href, title: document.title, ready_state: document.readyState,
      visible_text: visibleText, buttons, links, controls,
      required_missing: requiredMissing,
      checkboxes: controls.filter((item) => item.type === 'checkbox'),
      selects: controls.filter((item) => item.tag === 'select'),
      file_inputs: fileInputs,
      visible_uploaded_files: visibleUploadedFiles,
      visible_errors: [...new Set(errorNodes)]
    };
  })()`;
}

function assertScreenRead(workspace: Workspace) {
  if (!workspace.allow_screen && !workspace.allow_read) throw new Error('browser screen/read access is not enabled for this workspace');
}

async function websocketTarget(workspace: Workspace, targetId: string, label?: string) {
  const profile = selectedBrowserProfile(workspace, label);
  const tabs = await fetchCdpJson<ChromeTarget[]>(profile, '/json/list');
  const target = tabs.find((item) => item.id === targetId);
  if (!target) throw new Error(`browser target not found: ${targetId}`);
  if (!target.webSocketDebuggerUrl) throw new Error(`browser target has no websocket debugger url: ${targetId}`);
  return { profile, target: target as ChromeTarget & { webSocketDebuggerUrl: string } };
}

function normalizeTargetFilter(filter: BrowserTargetFilter) {
  return {
    type: filter.type ?? 'page',
    include_iframes: filter.include_iframes ?? false,
    include_workers: filter.include_workers ?? false,
    include_browser_ui: filter.include_browser_ui ?? false
  };
}

function targetMatchesFilter(target: ChromeTarget, filter: ReturnType<typeof normalizeTargetFilter>) {
  const type = target.type ?? '';
  if (filter.type !== 'all' && type !== filter.type) return false;
  if (!filter.include_workers && isWorkerTarget(type)) return false;
  if (!filter.include_iframes && isIframeLikeTarget(target)) return false;
  if (!filter.include_browser_ui && isBrowserUiTarget(target)) return false;
  return true;
}

function isWorkerTarget(type: string) {
  return type === 'worker' || type === 'service_worker' || type === 'shared_worker';
}

function isIframeLikeTarget(target: ChromeTarget) {
  const type = target.type ?? '';
  return type === 'iframe' || type === 'other' && /iframe|frame/i.test(`${target.title ?? ''} ${target.url ?? ''}`);
}

function isBrowserUiTarget(target: ChromeTarget) {
  const url = target.url ?? '';
  return url.startsWith('chrome://') || url.startsWith('devtools://') || url.startsWith('chrome-extension://');
}

function targetSummary(target: ChromeTarget, includeUrl = true) {
  const url = target.url ?? '';
  return {
    id: target.id,
    title: safeTargetTitle(target.title ?? '', includeUrl),
    ...(includeUrl ? { url } : { url_origin: safeUrlOrigin(url) }),
    type: target.type,
    attached: target.attached ?? false,
    has_websocket: Boolean(target.webSocketDebuggerUrl)
  };
}

function safeTargetTitle(title: string, includeUrl: boolean) {
  if (includeUrl) return title;
  try { return new URL(title).origin; }
  catch { return title.slice(0, 160); }
}

function safeUrlOrigin(url: string) {
  try { return new URL(url).origin; }
  catch { return url && !url.startsWith('about:') ? '[non-url]' : url; }
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

async function oneCdpBatchCall(url: string, step: CdpBatchStep, index: number, allowPageWait: boolean) {
  if ('delay_ms' in step) {
    const delayMs = boundedDelayMs(step.delay_ms);
    const started = Date.now();
    await delay(delayMs);
    return { index, kind: 'delay', delay_ms: delayMs, elapsed_ms: Date.now() - started };
  }
  const method = boundedCdpMethod(step.method);
  const params = boundedCdpParams(step.params ?? {});
  const waitFor = step.wait_for ? boundedWaitFor(step.wait_for, allowPageWait) : undefined;
  const timeoutMs = boundedTimeoutMs(step.timeout_ms ?? 10000);
  const started = Date.now();
  const { result, wait } = waitFor
    ? await cdpCommandWithWait(url, method, params, waitFor, timeoutMs)
    : { result: await cdpCommand(url, method, params), wait: undefined };
  return { index, kind: 'cdp', method, result: boundedJson(result), wait, elapsed_ms: Date.now() - started };
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

async function cdpCommandWithWait<T>(url: string, method: string, params: Record<string, unknown>, waitFor: CdpWaitFor, timeoutMs: number) {
  return await new Promise<{ result: T; wait: { wait_for: CdpWaitFor; ok: boolean; setup_method: 'Page.enable'; elapsed_ms: number } }>((resolve, reject) => {
    const ws = new WebSocket(url);
    const started = Date.now();
    let commandResult: T | undefined;
    let eventSeen = false;
    const timer = setTimeout(() => { ws.close(); reject(new Error(`CDP wait timed out: ${waitFor}`)); }, timeoutMs);
    const finish = () => {
      if (commandResult === undefined || !eventSeen) return;
      clearTimeout(timer);
      ws.close();
      resolve({ result: commandResult, wait: { wait_for: waitFor, ok: true, setup_method: 'Page.enable', elapsed_ms: Date.now() - started } });
    };
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 0, method: 'Page.enable', params: {} }));
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP websocket error')); });
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) {
        if (message.error) { clearTimeout(timer); ws.close(); reject(new Error(message.error.message ?? 'CDP command failed')); return; }
        commandResult = message.result as T;
        finish();
        return;
      }
      if (message.method === waitEventMethod(waitFor)) {
        eventSeen = true;
        finish();
      }
    });
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

function boundedDelayMs(value: number) {
  if (!Number.isFinite(value)) throw new Error('delay_ms must be finite');
  return Math.min(Math.max(Math.trunc(value), 0), 60000);
}

function boundedTimeoutMs(value: number) {
  if (!Number.isFinite(value)) throw new Error('timeout_ms must be finite');
  return Math.min(Math.max(Math.trunc(value), 1), 60000);
}

function boundedWaitFor(value: CdpWaitFor, allowPageWait: boolean) {
  if (!allowPageWait) throw new Error('wait_for is only supported for page-target CDP batches');
  if (value !== 'page_load' && value !== 'dom_content_loaded') throw new Error(`unsupported CDP wait_for: ${value}`);
  return value;
}

function waitEventMethod(waitFor: CdpWaitFor) {
  return waitFor === 'page_load' ? 'Page.loadEventFired' : 'Page.domContentEventFired';
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
