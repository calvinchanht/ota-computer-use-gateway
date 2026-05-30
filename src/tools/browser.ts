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
      endpoint: `http://${profile.cdp_host}:${profile.cdp_port}`,
      note: 'Browser tools use Chrome DevTools Protocol against a headed Chrome profile.'
    }
  });
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
