import { hostname, userInfo } from 'node:os';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { runCommand } from '../core/process.js';
import { ok } from '../core/result.js';
import { resolveInside } from '../core/paths.js';
import { truncateText } from '../core/text.js';
import type { AppConfig } from '../config/schema.js';
import { workspaceChildEnvironmentMode } from '../core/securityPolicy.js';
import type { Workspace } from '../core/workspaces.js';
import {
  executeWindowsOtaDeployment,
  WINDOWS_OTA_DEPLOY_MODE,
  WINDOWS_OTA_DEPLOY_PROFILE,
  WINDOWS_OTA_DEPLOY_REPO,
  WINDOWS_OTA_PRE_LIVE_MARKER,
  WINDOWS_OTA_SOURCE_REVISION,
  WINDOWS_OTA_SOURCE_TREE,
  WINDOWS_OTA_TARGET_PRINCIPAL,
  WINDOWS_OTA_TARGET_SID,
  WINDOWS_OTA_TARGET_USER
} from './windowsOtaDeploy.js';

const REGISTRY_PATH = '.agent/workspace-helpers.json';
const MAX_OUTPUT_BYTES = 30000;

const helperIdSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const modeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const templateKindSchema = z.enum(['repo_build_test', 'host_health_check', 'ssh_systemd_user_service', 'repo_deploy_to_host', 'threaddex_agent_smoke']);

const postCheckSchema = z.object({
  kind: z.enum(['http_json', 'command_status']),
  url: z.string().optional(),
  expect_status: z.number().int().positive().optional()
}).strict();

export const helperDefinitionSchema = z.object({
  helper_id: helperIdSchema,
  mode: modeSchema,
  kind: templateKindSchema,
  description: z.string().max(500).optional(),
  repo: z.string().regex(/^[A-Za-z0-9._/-]{1,160}$/).optional(),
  checks: z.array(z.enum(['build', 'test', 'style', 'check'])).default([]),
  target_host_id: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/).optional(),
  target_user: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).optional(),
  service_unit: z.string().regex(/^[A-Za-z0-9_.@:-]{1,160}\.service$/).optional(),
  post_checks: z.array(postCheckSchema).default([]),
  deployment_profile: z.literal(WINDOWS_OTA_DEPLOY_PROFILE).optional(),
  source_revision: z.literal(WINDOWS_OTA_SOURCE_REVISION).optional(),
  source_tree: z.literal(WINDOWS_OTA_SOURCE_TREE).optional(),
  target_principal: z.literal(WINDOWS_OTA_TARGET_PRINCIPAL).optional(),
  target_sid: z.literal(WINDOWS_OTA_TARGET_SID).optional(),
  expected_live_marker: z.literal(WINDOWS_OTA_PRE_LIVE_MARKER).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
}).strict();

export type HelperDefinition = z.infer<typeof helperDefinitionSchema>;

type HelperRegistry = { schema_version: 'workspace-helpers/v1'; helpers: HelperDefinition[] };

export async function workspaceHelperList(config: AppConfig, workspace: Workspace) {
  const registry = await readRegistry(config, workspace);
  return ok('workspace helpers', {
    schema_version: registry.schema_version,
    helpers: registry.helpers.map(publicHelper)
  });
}

export async function workspaceHelperStatus(config: AppConfig, workspace: Workspace, helperId: string, mode?: string) {
  const registry = await readRegistry(config, workspace);
  const helper = findHelper(registry, helperId, mode);
  return ok('workspace helper status', { configured: Boolean(helper), helper: helper ? publicHelper(helper) : undefined });
}

export async function workspaceHelperUpsert(config: AppConfig, workspace: Workspace, input: unknown) {
  if (!workspace.allow_write) throw new Error('workspace does not allow helper registry writes');
  const now = new Date().toISOString();
  const parsed = validateDefinition(helperDefinitionSchema.parse(input));
  assertHelperPrivilege(workspace, parsed);
  const registry = await readRegistry(config, workspace);
  const existing = registry.helpers.findIndex((item) => item.helper_id === parsed.helper_id && item.mode === parsed.mode);
  const helper: HelperDefinition = {
    ...parsed,
    created_at: existing >= 0 ? registry.helpers[existing].created_at ?? now : now,
    updated_at: now
  };
  if (existing >= 0) registry.helpers[existing] = helper;
  else registry.helpers.push(helper);
  registry.helpers.sort((a, b) => `${a.helper_id}:${a.mode}`.localeCompare(`${b.helper_id}:${b.mode}`));
  await writeRegistry(config, workspace, registry);
  return ok('workspace helper saved', { helper: publicHelper(helper) });
}

export async function workspaceHelperRun(config: AppConfig, workspace: Workspace, helperId: string, mode: string, args: Record<string, unknown> = {}) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow helper runs');
  const registry = await readRegistry(config, workspace);
  const helper = findHelper(registry, helperId, mode);
  if (!helper) throw new Error(`unknown workspace helper: ${helperId}/${mode}`);
  validateDefinition(helper);
  assertHelperPrivilege(workspace, helper);
  if (helper.kind === 'repo_build_test') return runRepoBuildTest(config, workspace, helper, args);
  if (helper.kind === 'ssh_systemd_user_service') return runSystemdUserService(config, workspace, helper);
  if (helper.kind === 'repo_deploy_to_host') {
    assertNoRepoDeployExecutionArgs(args);
    assertFixedRepoDeployLocalTarget(helper);
    return executeWindowsOtaDeployment();
  }
  return ok('workspace helper plan ready', {
    helper: publicHelper(helper),
    executed: false,
    reason: 'template validation is implemented; execution for this helper kind must be provided by a server-side executor lane',
    plan: helperPlan(helper)
  });
}

function assertHelperPrivilege(workspace: Workspace, helper: HelperDefinition): void {
  if (helper.kind === 'ssh_systemd_user_service' && workspace.api_sets?.machine_admin !== true) {
    throw new Error('systemd workspace helpers require machine_admin API set');
  }
  if (helper.kind === 'repo_deploy_to_host' && workspace.api_sets?.machine_admin !== true) {
    throw new Error('repo_deploy_to_host workspace helpers require machine_admin API set');
  }
}

function validateDefinition(helper: HelperDefinition): HelperDefinition {
  if (helper.kind === 'repo_build_test') {
    if (!helper.repo) throw new Error('repo_build_test helper requires repo');
    if (helper.checks.length === 0) throw new Error('repo_build_test helper requires at least one check');
  }
  if (helper.kind === 'ssh_systemd_user_service') {
    if (!helper.target_host_id || !helper.target_user || !helper.service_unit) throw new Error('ssh_systemd_user_service helper requires target_host_id, target_user, and service_unit');
    for (const check of helper.post_checks) {
      if (check.kind === 'http_json' && check.url && !isLocalUrl(check.url)) throw new Error('http_json post_checks must use local loopback URLs');
    }
  }
  if (helper.kind === 'repo_deploy_to_host') assertFixedRepoDeployDefinition(helper);
  else assertNoFixedRepoDeployFields(helper);
  return helper;
}

function assertFixedRepoDeployDefinition(helper: HelperDefinition): void {
  if (helper.mode !== WINDOWS_OTA_DEPLOY_MODE) throw new Error(`repo_deploy_to_host mode must be ${WINDOWS_OTA_DEPLOY_MODE}`);
  if (helper.repo !== WINDOWS_OTA_DEPLOY_REPO) throw new Error('repo_deploy_to_host repo does not match the fixed Windows OTA profile');
  if (!helper.target_host_id) throw new Error('repo_deploy_to_host requires target_host_id');
  if (helper.target_user !== WINDOWS_OTA_TARGET_USER) throw new Error('repo_deploy_to_host target_user does not match the fixed Windows OTA profile');
  if (helper.deployment_profile !== WINDOWS_OTA_DEPLOY_PROFILE) throw new Error('repo_deploy_to_host deployment_profile mismatch');
  if (helper.source_revision !== WINDOWS_OTA_SOURCE_REVISION) throw new Error('repo_deploy_to_host source_revision mismatch');
  if (helper.source_tree !== WINDOWS_OTA_SOURCE_TREE) throw new Error('repo_deploy_to_host source_tree mismatch');
  if (helper.target_principal !== WINDOWS_OTA_TARGET_PRINCIPAL) throw new Error('repo_deploy_to_host target_principal mismatch');
  if (helper.target_sid !== WINDOWS_OTA_TARGET_SID) throw new Error('repo_deploy_to_host target_sid mismatch');
  if (helper.expected_live_marker !== WINDOWS_OTA_PRE_LIVE_MARKER) throw new Error('repo_deploy_to_host expected_live_marker mismatch');
  if (helper.checks.length !== 0 || helper.post_checks.length !== 0 || helper.service_unit !== undefined) {
    throw new Error('repo_deploy_to_host fixed Windows OTA profile does not accept checks, post_checks, or service_unit');
  }
  assertFixedRepoDeployLocalTarget(helper);
}

function assertNoFixedRepoDeployFields(helper: HelperDefinition): void {
  if (helper.deployment_profile !== undefined || helper.source_revision !== undefined || helper.source_tree !== undefined || helper.target_principal !== undefined || helper.target_sid !== undefined || helper.expected_live_marker !== undefined) {
    throw new Error('fixed Windows OTA deployment fields are only valid for repo_deploy_to_host');
  }
}

function assertFixedRepoDeployLocalTarget(helper: HelperDefinition): void {
  const localHostId = (process.env.OTA_LOCAL_HOST_ID ?? '').trim().toLowerCase();
  if (!localHostId) throw new Error('repo_deploy_to_host requires server-owned OTA_LOCAL_HOST_ID binding');
  if ((helper.target_host_id ?? '').trim().toLowerCase() !== localHostId) throw new Error('repo_deploy_to_host target_host_id must match the exact local host binding');
}

function assertNoRepoDeployExecutionArgs(args: Record<string, unknown>): void {
  if (Object.keys(args).length !== 0) throw new Error('repo_deploy_to_host does not accept execution args or transaction overrides');
}

async function runRepoBuildTest(config: AppConfig, workspace: Workspace, helper: HelperDefinition, args: Record<string, unknown>) {
  const requested = Array.isArray(args.checks) ? args.checks.map(String) : helper.checks;
  const configured = new Set(helper.checks);
  const checks = requested.filter((check): check is 'build' | 'test' | 'style' | 'check' => ['build', 'test', 'style', 'check'].includes(check) && configured.has(check as 'build' | 'test' | 'style' | 'check'));
  if (checks.length === 0) throw new Error('no allowed checks requested');
  const repo = await resolveInside(workspace, helper.repo ?? '.', config);
  const results = [];
  for (const check of checks) {
    const script = check === 'test' ? 'test' : check;
    const result = await runCommand('npm', ['run', script], repo.absolute, Math.min(config.security.max_exec_ms, 120000), {}, workspaceChildEnvironmentMode(config, workspace));
    const stdout = truncateText(result.stdout, MAX_OUTPUT_BYTES);
    const stderr = truncateText(result.stderr, MAX_OUTPUT_BYTES);
    results.push({ check, exit_code: result.code, timed_out: result.timed_out, stdout: stdout.text, stderr: stderr.text, stdout_truncated: stdout.truncated, stderr_truncated: stderr.truncated });
    if (result.code !== 0 || result.timed_out) break;
  }
  const failed = results.find((item) => item.exit_code !== 0 || item.timed_out);
  return ok(failed ? 'workspace helper finished with failures' : 'workspace helper finished', {
    helper: publicHelper(helper),
    executed: true,
    repo: repo.relative,
    results
  });
}

async function runSystemdUserService(config: AppConfig, workspace: Workspace, helper: HelperDefinition) {
  if (!isLocalHelperTarget(helper)) throw new Error('systemd helper execution is currently local-user only');
  const action = systemdAction(helper.mode);
  const unit = helper.service_unit ?? '';
  const environmentMode = workspaceChildEnvironmentMode(config, workspace);
  const run = await runCommand('systemctl', ['--user', action, unit], workspace.realRoot, Math.min(config.security.max_exec_ms, 120000), systemdEnv(), environmentMode);
  const active = await runCommand('systemctl', ['--user', 'is-active', unit], workspace.realRoot, 15000, systemdEnv(), environmentMode);
  const postChecks = await runPostChecks(helper.post_checks);
  const failed = run.code !== 0 || run.timed_out || postChecks.some((check) => !check.ok);
  return ok(failed ? 'workspace helper finished with failures' : 'workspace helper finished', {
    helper: publicHelper(helper),
    executed: true,
    action,
    command: commandSummary(run),
    service: { unit, active: active.stdout.trim(), exit_code: active.code },
    post_checks: postChecks
  });
}

function isLocalHelperTarget(helper: HelperDefinition): boolean {
  const targetHost = (helper.target_host_id ?? '').trim().toLowerCase();
  const host = hostname().trim().toLowerCase();
  const shortHost = host.split('.', 1)[0] ?? host;
  const configuredHost = (process.env.OTA_LOCAL_HOST_ID ?? '').trim().toLowerCase();
  const localTargets = new Set(['local', 'localhost', host, shortHost]);
  if (configuredHost) localTargets.add(configuredHost);
  return localTargets.has(targetHost) && helper.target_user === currentLocalUser();
}

function currentLocalUser(): string {
  try { return userInfo().username; }
  catch { return ''; }
}

function systemdAction(mode: string): 'start' | 'stop' | 'restart' {
  if (mode === 'start' || mode === 'stop' || mode === 'restart') return mode;
  throw new Error('systemd helper mode must be start, stop, or restart');
}

function systemdEnv(): NodeJS.ProcessEnv {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return {
    ...(uid === undefined ? {} : { XDG_RUNTIME_DIR: `/run/user/${uid}` }),
    ...(process.env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } : {})
  };
}

async function runPostChecks(checks: HelperDefinition['post_checks']) {
  const results = [];
  for (const check of checks) {
    if (check.kind !== 'http_json') results.push({ ...check, ok: false, error: 'unsupported post_check kind' });
    else results.push(await runHttpPostCheck(check));
  }
  return results;
}

async function runHttpPostCheck(check: HelperDefinition['post_checks'][number]) {
  if (!check.url || !isLocalUrl(check.url)) return { ...check, ok: false, error: 'http_json requires local loopback url' };
  try {
    const response = await fetch(check.url, { signal: AbortSignal.timeout(10000) });
    const expect = check.expect_status ?? 200;
    return { ...check, ok: response.status === expect, status: response.status };
  } catch (error) {
    return { ...check, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function commandSummary(result: Awaited<ReturnType<typeof runCommand>>) {
  const stdout = truncateText(result.stdout, MAX_OUTPUT_BYTES);
  const stderr = truncateText(result.stderr, MAX_OUTPUT_BYTES);
  return { exit_code: result.code, timed_out: result.timed_out, stdout: stdout.text, stderr: stderr.text, stdout_truncated: stdout.truncated, stderr_truncated: stderr.truncated };
}

async function readRegistry(config: AppConfig, workspace: Workspace): Promise<HelperRegistry> {
  const registryPath = await registryFilePath(workspace);
  try {
    const raw = await readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw) as HelperRegistry;
    return registrySchema().parse(parsed);
  } catch (error) {
    if (isMissingFileError(error)) return { schema_version: 'workspace-helpers/v1', helpers: [] };
    throw error;
  }
}

async function writeRegistry(config: AppConfig, workspace: Workspace, registry: HelperRegistry): Promise<void> {
  void config;
  const registryPath = await registryFilePath(workspace);
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

async function registryFilePath(workspace: Workspace): Promise<string> {
  const root = await realpath(workspace.realRoot);
  const filePath = path.resolve(root, REGISTRY_PATH);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('helper registry path escaped workspace');
  return filePath;
}

function registrySchema() {
  return z.object({ schema_version: z.literal('workspace-helpers/v1'), helpers: z.array(helperDefinitionSchema) });
}

function findHelper(registry: HelperRegistry, helperId: string, mode?: string): HelperDefinition | undefined {
  helperIdSchema.parse(helperId);
  if (mode !== undefined) modeSchema.parse(mode);
  return registry.helpers.find((item) => item.helper_id === helperId && (mode === undefined || item.mode === mode));
}

function publicHelper(helper: HelperDefinition) {
  return {
    helper_id: helper.helper_id,
    mode: helper.mode,
    kind: helper.kind,
    description: helper.description,
    repo: helper.repo,
    checks: helper.checks,
    target_host_id: helper.target_host_id,
    target_user: helper.target_user,
    service_unit: helper.service_unit,
    post_checks: helper.post_checks,
    deployment_profile: helper.deployment_profile,
    source_revision: helper.source_revision,
    source_tree: helper.source_tree,
    target_principal: helper.target_principal,
    target_sid: helper.target_sid,
    expected_live_marker: helper.expected_live_marker,
    created_at: helper.created_at,
    updated_at: helper.updated_at
  };
}

function helperPlan(helper: HelperDefinition) {
  if (helper.kind === 'ssh_systemd_user_service') return { type: helper.kind, target_host_id: helper.target_host_id, target_user: helper.target_user, service_unit: helper.service_unit, post_checks: helper.post_checks };
  if (helper.kind === 'repo_deploy_to_host') return {
    type: helper.kind,
    repo: helper.repo,
    target_host_id: helper.target_host_id,
    target_user: helper.target_user,
    deployment_profile: helper.deployment_profile,
    source_revision: helper.source_revision,
    source_tree: helper.source_tree,
    target_principal: helper.target_principal,
    target_sid: helper.target_sid,
    expected_live_marker: helper.expected_live_marker
  };
  return { type: helper.kind };
}

function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}
