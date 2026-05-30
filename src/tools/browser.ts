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
  return ok(`listed ${tabs.length} browser tabs`, {
    workspace_id: workspace.id,
    reminder: REMINDER,
    profile_label: profile.label,
    tabs: tabs.filter(isPageTarget).map(tabSummary)
  });
}

async function cdpReachable(profile: ReturnType<typeof browserProfile>) {
  try {
    await fetchCdpJson(profile, '/json/version');
    return true;
  } catch { return false; }
}

async function fetchCdpJson<T>(profile: ReturnType<typeof browserProfile>, path: string): Promise<T> {
  const res = await fetch(`${cdpEndpoint(profile)}${path}`);
  if (!res.ok) throw new Error(`CDP request failed: ${res.status}`);
  return await res.json() as T;
}

function cdpEndpoint(profile: ReturnType<typeof browserProfile>) {
  return `http://${profile.cdp_host}:${profile.cdp_port}`;
}

function isPageTarget(target: ChromeTarget) {
  return target.type === 'page';
}

function tabSummary(target: ChromeTarget) {
  return { id: target.id, title: target.title ?? '', url: target.url ?? '', type: target.type, attached: target.attached ?? false };
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

type ChromeTarget = {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  attached?: boolean;
};

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
