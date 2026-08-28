import { randomUUID } from 'node:crypto';
import { access, readFile, rm } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import path from 'node:path';
import { runCommand, type CommandResult } from '../core/process.js';
import type { ToolResult } from '../core/result.js';

export const WINDOWS_OTA_DEPLOY_PROFILE = 'rosebot_ota_gateway_game247';
export const WINDOWS_OTA_DEPLOY_REPO = 'calvinchanht/ota-computer-use-gateway';
export const WINDOWS_OTA_DEPLOY_MODE = 'deploy';
export const WINDOWS_OTA_TARGET_USER = 'unrea';
export const WINDOWS_OTA_TARGET_PRINCIPAL = 'USER\\unrea';
export const WINDOWS_OTA_TARGET_SID = 'S-1-5-21-3306437337-2558437765-874637037-1002';
export const WINDOWS_OTA_SOURCE_REVISION = '9c5d012e6de79f322993b84abdce86bb9155a0b0';
export const WINDOWS_OTA_SOURCE_TREE = '06bbf604b8089e2734e6f0e57dcde7dea22d74e6';
export const WINDOWS_OTA_PRE_LIVE_MARKER = 'ec0d7db5c6af';
export const WINDOWS_OTA_POST_LIVE_MARKER = '9c5d012e6de7';

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const NODE_DIR = 'C:\\Program Files\\nodejs';
const WORKSPACE_ROOT = 'D:\\Projects\\Rosebot';
const SOURCE_ROOT = 'D:\\Projects\\Rosebot\\worktrees\\ota247-uiafix-g73r1';
const STACK_CONFIG = 'D:\\Projects\\Rosebot\\config\\rosebot.windows-stack.local.json';
const UPDATER = 'D:\\Projects\\Rosebot\\deployments\\webchat-provider-orchestrator\\scripts\\windows\\Update-WindowsAgentOtaDeployment.ps1';
const LIVE_ROOT = 'D:\\Projects\\Rosebot\\deployments\\ota-computer-use-gateway';
const ROLLBACK_ROOT = 'D:\\Projects\\Rosebot\\deployments\\ota-computer-use-gateway.prev';
const NEW_ROOT = 'D:\\Projects\\Rosebot\\deployments\\ota-computer-use-gateway.new';
const TASK_NAME = 'Rosebot-OtaGateway-Game247-Deploy';
const RECEIPT_PATH = 'D:\\Projects\\Rosebot\\runtime\\ota247-repo-deploy-receipt.json';
const LISTENER_ADDRESS = '100.99.103.54';
const LISTENER_PORT = 18769;
const SERVICE_NAME = 'rosebot-ota-gateway';
const SUPERVISOR_EXECUTABLE = 'pwsh.exe';
const SUPERVISOR_SCRIPT = 'Run-WindowsNodeServiceLoop.ps1';
const SUPERVISOR_ANCESTRY_LIMIT = 4;
const HEALTH_URL = `http://${LISTENER_ADDRESS}:${LISTENER_PORT}/healthz`;
const WAIT_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_COMMAND_OUTPUT = 30000;

export type ScheduledTaskSpec = {
  taskName: string;
  principal: {
    account: string;
    sid: string;
    logonType: 'Interactive';
    runLevel: 'Limited';
  };
  triggers: [];
  action: {
    executable: string;
    arguments: readonly string[];
    workingDirectory: string;
  };
};

export type SourceIdentity = {
  revision: string;
  tree: string;
  clean: boolean;
  deployMarker?: string;
};

export type RuntimeIdentity = {
  platform: string;
  hostname: string;
  localHostId: string;
  username: string;
  principal: string;
  sid: string;
};

export type ResourceSnapshot = {
  dFreeGb: number;
  freeVirtualMb: number;
  freePhysicalMb: number;
};

export type ListenerSnapshot = {
  address: string;
  port: number;
  processId: number;
  processPresent: boolean;
  supervisorPresent: boolean;
  supervisorMatched: boolean;
};

export type HealthSnapshot = {
  status: number;
  body: unknown;
};

export type UpdaterReceipt = {
  schema_version: 'ota-windows-deploy-receipt/v1';
  operation_id: string;
  updater_exit_code: number;
  outcome: 'success' | 'failure';
};

export interface WindowsOtaController {
  runtimeIdentity(): Promise<RuntimeIdentity>;
  taskExists(taskName: string): Promise<boolean>;
  receiptExists(receiptPath: string): Promise<boolean>;
  sourceIdentity(): Promise<SourceIdentity>;
  readMarker(root: string): Promise<string | undefined>;
  pathExists(targetPath: string): Promise<boolean>;
  deploymentCollision(): Promise<boolean>;
  resources(): Promise<ResourceSnapshot>;
  listeners(): Promise<ListenerSnapshot[]>;
  health(): Promise<HealthSnapshot>;
  registerTask(spec: ScheduledTaskSpec): Promise<void>;
  startTask(taskName: string): Promise<void>;
  waitForReceipt(receiptPath: string, operationId: string, timeoutMs: number): Promise<UpdaterReceipt>;
  unregisterTask(taskName: string): Promise<void>;
  deleteReceipt(receiptPath: string, operationId: string): Promise<void>;
}

export function buildWindowsOtaTaskSpec(operationId: string): ScheduledTaskSpec {
  const wrapper = buildUpdaterWrapper(operationId);
  return {
    taskName: TASK_NAME,
    principal: {
      account: WINDOWS_OTA_TARGET_PRINCIPAL,
      sid: WINDOWS_OTA_TARGET_SID,
      logonType: 'Interactive',
      runLevel: 'Limited'
    },
    triggers: [],
    action: {
      executable: POWERSHELL,
      arguments: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(wrapper)],
      workingDirectory: WORKSPACE_ROOT
    }
  };
}

type DeploymentState = {
  ownedOperationId?: string;
  registered: boolean;
  started: boolean;
  receiptOwnershipProven: boolean;
};

export async function executeWindowsOtaDeployment(controller: WindowsOtaController = systemWindowsOtaController()): Promise<ToolResult> {
  const state: DeploymentState = { registered: false, started: false, receiptOwnershipProven: false };
  try {
    await executeDeploymentOperation(controller, randomUUID(), state);
    return deploymentSuccessResult();
  } catch (error) {
    const cleanupError = await cleanupFailedOperation(controller, state);
    return deploymentFailureResult(error, state.started, cleanupError);
  }
}

async function executeDeploymentOperation(controller: WindowsOtaController, operationId: string, state: DeploymentState): Promise<void> {
  await assertPreconditions(controller);
  const spec = buildWindowsOtaTaskSpec(operationId);
  await controller.registerTask(spec);
  state.ownedOperationId = operationId;
  state.registered = true;
  await controller.startTask(spec.taskName);
  state.started = true;
  const receipt = await controller.waitForReceipt(RECEIPT_PATH, operationId, WAIT_TIMEOUT_MS);
  state.receiptOwnershipProven = receipt.operation_id === operationId;
  assertUpdaterReceipt(receipt, operationId);
  await assertPostconditions(controller);
  await cleanupOperation(controller, state.registered, operationId);
  state.registered = false;
  await assertOperationCleaned(controller);
  state.ownedOperationId = undefined;
}

function assertUpdaterReceipt(receipt: UpdaterReceipt, operationId: string): void {
  if (receipt.operation_id !== operationId) throw new DeployFailure('receipt_operation_mismatch');
  if (receipt.outcome !== 'success' || receipt.updater_exit_code !== 0) {
    throw new DeployFailure('canonical_updater_failed', { updater_exit_code: receipt.updater_exit_code });
  }
}

async function cleanupFailedOperation(controller: WindowsOtaController, state: DeploymentState): Promise<string | undefined> {
  if (state.ownedOperationId === undefined) return undefined;
  if (state.started && !state.receiptOwnershipProven) return 'post_start_exclusion_retained';
  try {
    await cleanupOperation(controller, state.registered, state.ownedOperationId);
    state.registered = false;
    await assertOperationCleaned(controller);
    state.ownedOperationId = undefined;
    return undefined;
  } catch (cleanup) {
    return failureCode(cleanup);
  }
}

function deploymentSuccessResult(): ToolResult {
  return result(true, 'fixed Windows OTA deployment completed', {
    executed: true,
    profile: WINDOWS_OTA_DEPLOY_PROFILE,
    source_revision: WINDOWS_OTA_SOURCE_REVISION,
    source_tree: WINDOWS_OTA_SOURCE_TREE,
    prior_live_marker: WINDOWS_OTA_PRE_LIVE_MARKER,
    live_marker: WINDOWS_OTA_POST_LIVE_MARKER,
    rollback_marker: WINDOWS_OTA_PRE_LIVE_MARKER,
    listener: `${LISTENER_ADDRESS}:${LISTENER_PORT}`,
    service: SERVICE_NAME,
    health: { status: 200, ok: true, service: 'ota-computer-use-gateway', transport: 'http' },
    task_cleaned: true,
    receipt_cleaned: true,
    protected_surfaces_untouched: true
  });
}

function deploymentFailureResult(error: unknown, started: boolean, cleanupError: string | undefined): ToolResult {
  return result(false, 'fixed Windows OTA deployment failed closed', {
    executed: started,
    profile: WINDOWS_OTA_DEPLOY_PROFILE,
    failure_class: failureCode(error),
    ...(failureDetail(error) ?? {}),
    retry_attempted: false,
    alternate_route_attempted: false,
    process_or_service_termination_attempted: false,
    cleanup_ok: cleanupError === undefined,
    ...(cleanupError ? { cleanup_failure_class: cleanupError } : {})
  });
}

async function assertPreconditions(controller: WindowsOtaController): Promise<void> {
  const runtime = await controller.runtimeIdentity();
  if (runtime.platform !== 'win32') throw new DeployFailure('wrong_platform');
  if (!runtime.localHostId) throw new DeployFailure('local_host_binding_missing');
  if (runtime.username.toLowerCase() !== WINDOWS_OTA_TARGET_USER) throw new DeployFailure('target_user_mismatch');
  if (runtime.principal.toLowerCase() !== WINDOWS_OTA_TARGET_PRINCIPAL.toLowerCase()) throw new DeployFailure('target_principal_mismatch');
  if (runtime.sid !== WINDOWS_OTA_TARGET_SID) throw new DeployFailure('target_sid_mismatch');
  if (await controller.taskExists(TASK_NAME)) throw new DeployFailure('operation_task_present');
  if (await controller.receiptExists(RECEIPT_PATH)) throw new DeployFailure('operation_receipt_present');

  assertSourceIdentity(await controller.sourceIdentity());
  if ((await controller.readMarker(LIVE_ROOT)) !== WINDOWS_OTA_PRE_LIVE_MARKER) throw new DeployFailure('pre_live_marker_mismatch');
  if (await controller.pathExists(NEW_ROOT)) throw new DeployFailure('new_deployment_path_present');
  if (await controller.deploymentCollision()) throw new DeployFailure('gateway_deployment_collision');

  const resources = await controller.resources();
  if (resources.dFreeGb < 60) throw new DeployFailure('insufficient_d_drive_space');
  if (resources.freeVirtualMb < 8192) throw new DeployFailure('insufficient_virtual_memory');
  if (resources.freePhysicalMb < 384) throw new DeployFailure('insufficient_physical_memory');

  assertListener(await controller.listeners());
  assertHealth(await controller.health());
}

async function assertPostconditions(controller: WindowsOtaController): Promise<void> {
  if ((await controller.readMarker(LIVE_ROOT)) !== WINDOWS_OTA_POST_LIVE_MARKER) throw new DeployFailure('post_live_marker_mismatch');
  if ((await controller.readMarker(ROLLBACK_ROOT)) !== WINDOWS_OTA_PRE_LIVE_MARKER) throw new DeployFailure('rollback_marker_mismatch');
  if (await controller.pathExists(NEW_ROOT)) throw new DeployFailure('new_deployment_path_present_post');
  assertSourceIdentity(await controller.sourceIdentity());
  assertListener(await controller.listeners());
  assertHealth(await controller.health());
}

function assertSourceIdentity(source: SourceIdentity): void {
  if (source.revision !== WINDOWS_OTA_SOURCE_REVISION) throw new DeployFailure('source_revision_mismatch');
  if (source.tree !== WINDOWS_OTA_SOURCE_TREE) throw new DeployFailure('source_tree_mismatch');
  if (!source.clean) throw new DeployFailure('source_worktree_dirty');
  if (source.deployMarker !== undefined && source.deployMarker !== WINDOWS_OTA_POST_LIVE_MARKER) {
    throw new DeployFailure('source_deploy_marker_mismatch');
  }
}

function assertListener(listeners: ListenerSnapshot[]): void {
  if (listeners.length !== 1) throw new DeployFailure('listener_count_mismatch', { listener_count: listeners.length });
  const listener = listeners[0];
  if (listener.address !== LISTENER_ADDRESS || listener.port !== LISTENER_PORT) throw new DeployFailure('listener_binding_mismatch');
  if (!listener.processPresent) throw new DeployFailure('listener_process_missing');
  if (!listener.supervisorPresent) throw new DeployFailure('listener_supervisor_missing');
  if (!listener.supervisorMatched) throw new DeployFailure('listener_supervisor_mismatch');
}

function assertHealth(health: HealthSnapshot): void {
  if (health.status !== 200 || !health.body || typeof health.body !== 'object') throw new DeployFailure('health_check_failed');
  const body = health.body as Record<string, unknown>;
  if (body.ok !== true || body.service !== 'ota-computer-use-gateway' || body.transport !== 'http') throw new DeployFailure('health_payload_mismatch');
}

async function cleanupOperation(controller: WindowsOtaController, registered: boolean, operationId: string): Promise<void> {
  const failures: string[] = [];
  try { await controller.deleteReceipt(RECEIPT_PATH, operationId); }
  catch { failures.push('receipt_cleanup_failed'); }
  if (registered) {
    try { await controller.unregisterTask(TASK_NAME); }
    catch { failures.push('task_cleanup_failed'); }
  }
  if (failures.length > 0) throw new DeployFailure(failures.join('+'));
}

async function assertOperationCleaned(controller: WindowsOtaController): Promise<void> {
  if (await controller.taskExists(TASK_NAME)) throw new DeployFailure('task_cleanup_unproven');
  if (await controller.receiptExists(RECEIPT_PATH)) throw new DeployFailure('receipt_cleanup_unproven');
}

function buildUpdaterWrapper(operationId: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$operationId = ${psQuote(operationId)}`,
    `$receipt = ${psQuote(RECEIPT_PATH)}`,
    `$env:Path = ${psQuote(`${NODE_DIR};`)} + $env:Path`,
    '$exitCode = 1',
    '$outcome = \'failure\'',
    'try {',
    `  & ${psQuote(POWERSHELL)} -NoProfile -ExecutionPolicy Bypass -File ${psQuote(UPDATER)} -WorkspaceRoot ${psQuote(WORKSPACE_ROOT)} -OtaSource ${psQuote(SOURCE_ROOT)} -StackConfig ${psQuote(STACK_CONFIG)}`,
    '  $exitCode = $LASTEXITCODE',
    "  if ($exitCode -eq 0) { $outcome = 'success' }",
    '} catch {',
    '  $exitCode = 1',
    "  $outcome = 'failure'",
    '}',
    "$payload = [ordered]@{ schema_version = 'ota-windows-deploy-receipt/v1'; operation_id = $operationId; updater_exit_code = [int]$exitCode; outcome = $outcome }",
    '$payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $receipt -Encoding UTF8',
    'exit $exitCode'
  ].join('\r\n');
}

function systemWindowsOtaController(): WindowsOtaController {
  return {
    runtimeIdentity: readRuntimeIdentity,
    taskExists: scheduledTaskExists,
    receiptExists: fileExists,
    sourceIdentity: readSourceIdentity,
    readMarker: async (root) => readTrimmed(path.win32.join(root, '.deploy-rev')),
    pathExists: fileExists,
    deploymentCollision: hasDeploymentCollision,
    resources: readResources,
    listeners: readListeners,
    health: readHealth,
    registerTask: registerScheduledTask,
    startTask: async (taskName) => { await powershell(`Start-ScheduledTask -TaskName ${psQuote(taskName)}`); },
    waitForReceipt,
    unregisterTask: async (taskName) => { await powershell(`Unregister-ScheduledTask -TaskName ${psQuote(taskName)} -Confirm:$false -ErrorAction Stop`); },
    deleteReceipt: deleteReceiptForOperation
  };
}

async function readRuntimeIdentity(): Promise<RuntimeIdentity> {
  const identity = await powershellJson<{ principal: string; sid: string }>(
    "$i=[Security.Principal.WindowsIdentity]::GetCurrent(); [ordered]@{principal=$i.Name;sid=$i.User.Value}|ConvertTo-Json -Compress"
  );
  const host = hostname().trim();
  return {
    platform: process.platform,
    hostname: host,
    localHostId: (process.env.OTA_LOCAL_HOST_ID ?? '').trim(),
    username: safeUsername(),
    principal: identity.principal,
    sid: identity.sid
  };
}

async function scheduledTaskExists(taskName: string): Promise<boolean> {
  const script = [
    `$matches=@(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -eq ${psQuote(taskName)} })`,
    "if ($matches.Count -gt 0) { 'true' } else { 'false' }"
  ].join('; ');
  return (await powershell(script)).trim().toLowerCase() === 'true';
}

async function hasDeploymentCollision(): Promise<boolean> {
  const script = [
    `$updater=${psQuote(UPDATER)}`,
    `$source=${psQuote(SOURCE_ROOT)}`,
    '$p=Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($updater) -and $_.CommandLine.Contains($source) }',
    'if ($p) { \'true\' } else { \'false\' }'
  ].join('; ');
  return (await powershell(script)).trim().toLowerCase() === 'true';
}

async function readResources(): Promise<ResourceSnapshot> {
  return powershellJson<ResourceSnapshot>([
    "$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='D:'\"",
    '$o=Get-CimInstance Win32_OperatingSystem',
    "[ordered]@{dFreeGb=[math]::Floor($d.FreeSpace/1GB);freeVirtualMb=[math]::Floor($o.FreeVirtualMemory/1KB);freePhysicalMb=[math]::Floor($o.FreePhysicalMemory/1KB)}|ConvertTo-Json -Compress"
  ].join('; '));
}

async function readListeners(): Promise<ListenerSnapshot[]> {
  return (await powershellJson<{ items: ListenerSnapshot[] }>(listenerScript())).items ?? [];
}

async function readHealth(): Promise<HealthSnapshot> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    let body: unknown = undefined;
    try { body = JSON.parse(text); } catch { body = undefined; }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: undefined };
  }
}

async function readSourceIdentity(): Promise<SourceIdentity> {
  const revision = (await runFixed(GIT, ['-C', SOURCE_ROOT, 'rev-parse', 'HEAD'], 15000)).stdout.trim();
  const tree = (await runFixed(GIT, ['-C', SOURCE_ROOT, 'rev-parse', 'HEAD^{tree}'], 15000)).stdout.trim();
  const status = (await runFixed(GIT, ['-C', SOURCE_ROOT, 'status', '--porcelain', '--untracked-files=normal'], 15000)).stdout;
  const deployMarker = await readTrimmed(path.win32.join(SOURCE_ROOT, '.deploy-rev'));
  return { revision, tree, clean: status.trim().length === 0, ...(deployMarker === undefined ? {} : { deployMarker }) };
}

function listenerScript(): string {
  const supervisorScriptToken = SUPERVISOR_SCRIPT.replaceAll('.', '\\.');
  const supervisorScriptPattern = `(?i)(?:^|\\s)-File\\s+(?:"[^"]*${supervisorScriptToken}"|[^\\s"]*${supervisorScriptToken})(?=$|\\s)`;
  const supervisorNamePattern = `(?i)(?:^|\\s)-Name\\s+(?:"${SERVICE_NAME}"|${SERVICE_NAME})(?=$|\\s)`;
  return [
    '$processes=@(Get-CimInstance Win32_Process -ErrorAction Stop)',
    `$items=@(Get-NetTCPConnection -State Listen -LocalAddress ${psQuote(LISTENER_ADDRESS)} -LocalPort ${LISTENER_PORT} -ErrorAction SilentlyContinue | ForEach-Object {`,
    '  $pidValue=[int]$_.OwningProcess',
    '  $listenerProcesses=@($processes | Where-Object { [int]$_.ProcessId -eq $pidValue })',
    '  $processPresent=($listenerProcesses.Count -eq 1)',
    '  $supervisorPresent=$false',
    '  $supervisorMatched=$false',
    '  if ($processPresent) {',
    '    $current=$listenerProcesses[0]',
    `    for ($depth=0; $depth -lt ${SUPERVISOR_ANCESTRY_LIMIT}; $depth++) {`,
    '      $parentPid=[int]$current.ParentProcessId',
    '      if ($parentPid -le 0) { break }',
    '      $parents=@($processes | Where-Object { [int]$_.ProcessId -eq $parentPid })',
    '      if ($parents.Count -ne 1) { break }',
    '      $current=$parents[0]',
    '      $commandLine=[string]$current.CommandLine',
    `      $scriptMatched=$commandLine -match ${psQuote(supervisorScriptPattern)}`,
    '      if ($scriptMatched) {',
    '        $supervisorPresent=$true',
    `        if (([string]$current.Name -ieq ${psQuote(SUPERVISOR_EXECUTABLE)}) -and ($commandLine -match ${psQuote(supervisorNamePattern)})) { $supervisorMatched=$true; break }`,
    '      }',
    '    }',
    '  }',
    `  [ordered]@{address=${psQuote(LISTENER_ADDRESS)};port=${LISTENER_PORT};processId=$pidValue;processPresent=[bool]$processPresent;supervisorPresent=[bool]$supervisorPresent;supervisorMatched=[bool]$supervisorMatched}`,
    '})',
    '[ordered]@{items=@($items)} | ConvertTo-Json -Compress -Depth 4'
  ].join('\r\n');
}

async function registerScheduledTask(spec: ScheduledTaskSpec): Promise<void> {
  if (spec.triggers.length !== 0) throw new DeployFailure('task_trigger_not_empty');
  if (spec.action.executable !== POWERSHELL || spec.action.workingDirectory !== WORKSPACE_ROOT) throw new DeployFailure('task_action_mismatch');
  if (spec.principal.account !== WINDOWS_OTA_TARGET_PRINCIPAL || spec.principal.sid !== WINDOWS_OTA_TARGET_SID) throw new DeployFailure('task_principal_mismatch');
  if (spec.principal.logonType !== 'Interactive' || spec.principal.runLevel !== 'Limited') throw new DeployFailure('task_principal_mode_mismatch');
  const actionArgs = spec.action.arguments.map(psQuote).join(',');
  const script = [
    `$action=New-ScheduledTaskAction -Execute ${psQuote(spec.action.executable)} -Argument (($actionArgs=@(${actionArgs})) -join ' ') -WorkingDirectory ${psQuote(spec.action.workingDirectory)}`,
    `$principal=New-ScheduledTaskPrincipal -UserId ${psQuote(spec.principal.sid)} -LogonType Interactive -RunLevel Limited`,
    '$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    `Register-ScheduledTask -TaskName ${psQuote(spec.taskName)} -Action $action -Principal $principal -Settings $settings -ErrorAction Stop | Out-Null`
  ].join('\r\n');
  await powershell(script);
}

async function waitForReceipt(receiptPath: string, operationId: string, timeoutMs: number): Promise<UpdaterReceipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(receiptPath)) {
      let parsed: unknown;
      try { parsed = JSON.parse(await readFile(receiptPath, 'utf8')); }
      catch { throw new DeployFailure('receipt_invalid_json'); }
      const receipt = parseReceipt(parsed);
      if (receipt.operation_id !== operationId) throw new DeployFailure('receipt_operation_mismatch');
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new DeployFailure('deployment_receipt_timeout');
}

async function deleteReceiptForOperation(receiptPath: string, operationId: string): Promise<void> {
  let raw: string;
  try { raw = await readFile(receiptPath, 'utf8'); }
  catch (error) {
    if (isMissing(error)) return;
    throw error;
  }

  let parsed: UpdaterReceipt;
  try { parsed = parseReceipt(JSON.parse(raw)); }
  catch { throw new DeployFailure('receipt_cleanup_ownership_unproven'); }
  if (parsed.operation_id !== operationId) throw new DeployFailure('receipt_cleanup_operation_mismatch');
  await rm(receiptPath, { force: true });
}

function parseReceipt(value: unknown): UpdaterReceipt {
  if (!value || typeof value !== 'object') throw new DeployFailure('receipt_invalid_shape');
  const record = value as Record<string, unknown>;
  if (record.schema_version !== 'ota-windows-deploy-receipt/v1') throw new DeployFailure('receipt_schema_mismatch');
  if (typeof record.operation_id !== 'string') throw new DeployFailure('receipt_invalid_operation');
  if (!Number.isInteger(record.updater_exit_code)) throw new DeployFailure('receipt_invalid_exit_code');
  if (record.outcome !== 'success' && record.outcome !== 'failure') throw new DeployFailure('receipt_invalid_outcome');
  return {
    schema_version: 'ota-windows-deploy-receipt/v1',
    operation_id: record.operation_id,
    updater_exit_code: record.updater_exit_code as number,
    outcome: record.outcome
  };
}

async function powershell(script: string): Promise<string> {
  const failClosedScript = `$ErrorActionPreference = 'Stop'\r\n${script}`;
  return (await runFixed(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(failClosedScript)], 30000)).stdout;
}

async function powershellJson<T>(script: string): Promise<T> {
  const raw = await powershell(script);
  try { return JSON.parse(raw) as T; }
  catch { throw new DeployFailure('controller_invalid_json'); }
}

async function runFixed(executable: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  const result = await runCommand(executable, args, WORKSPACE_ROOT, timeoutMs);
  if (result.timed_out) throw new DeployFailure('controller_command_timeout');
  if (result.code !== 0) throw new DeployFailure('controller_command_failed', { exit_code: result.code ?? -1 });
  if (Buffer.byteLength(result.stdout, 'utf8') > MAX_COMMAND_OUTPUT || Buffer.byteLength(result.stderr, 'utf8') > MAX_COMMAND_OUTPUT) {
    throw new DeployFailure('controller_output_too_large');
  }
  return result;
}

async function readTrimmed(filename: string): Promise<string | undefined> {
  try { return (await readFile(filename, 'utf8')).trim(); }
  catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function fileExists(filename: string): Promise<boolean> {
  try { await access(filename); return true; }
  catch (error) { if (isMissing(error)) return false; throw error; }
}

function safeUsername(): string {
  try { return userInfo().username.trim().toLowerCase(); }
  catch { return ''; }
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}

class DeployFailure extends Error {
  constructor(public readonly code: string, public readonly detail?: Record<string, unknown>) {
    super(code);
  }
}

function failureCode(error: unknown): string {
  return error instanceof DeployFailure ? error.code : 'unexpected_executor_failure';
}

function failureDetail(error: unknown): Record<string, unknown> | undefined {
  return error instanceof DeployFailure ? error.detail : undefined;
}

function result(ok: boolean, summary: string, data: Record<string, unknown>): ToolResult {
  return { ok, summary, data, truncated: false, warnings: [] };
}

export const WINDOWS_OTA_TEST_CONSTANTS = {
  powershell: POWERSHELL,
  workspaceRoot: WORKSPACE_ROOT,
  sourceRoot: SOURCE_ROOT,
  stackConfig: STACK_CONFIG,
  updater: UPDATER,
  liveRoot: LIVE_ROOT,
  rollbackRoot: ROLLBACK_ROOT,
  newRoot: NEW_ROOT,
  taskName: TASK_NAME,
  receiptPath: RECEIPT_PATH,
  listenerAddress: LISTENER_ADDRESS,
  listenerPort: LISTENER_PORT,
  serviceName: SERVICE_NAME,
  supervisorExecutable: SUPERVISOR_EXECUTABLE,
  supervisorScript: SUPERVISOR_SCRIPT,
  supervisorAncestryLimit: SUPERVISOR_ANCESTRY_LIMIT,
  listenerProbeScript: listenerScript(),
  healthUrl: HEALTH_URL,
  nodeDir: NODE_DIR,
  waitTimeoutMs: WAIT_TIMEOUT_MS
} as const;
