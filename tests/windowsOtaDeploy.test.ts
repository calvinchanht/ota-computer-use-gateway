import { describe, expect, it } from 'vitest';
import {
  buildWindowsOtaTaskSpec,
  executeWindowsOtaDeployment,
  WINDOWS_OTA_DEPLOY_PROFILE,
  WINDOWS_OTA_POST_LIVE_MARKER,
  WINDOWS_OTA_PRE_LIVE_MARKER,
  WINDOWS_OTA_SOURCE_REVISION,
  WINDOWS_OTA_SOURCE_TREE,
  WINDOWS_OTA_TARGET_PRINCIPAL,
  WINDOWS_OTA_TARGET_SID,
  WINDOWS_OTA_TARGET_USER,
  WINDOWS_OTA_TEST_CONSTANTS,
  type HealthSnapshot,
  type ListenerSnapshot,
  type ResourceSnapshot,
  type RuntimeIdentity,
  type ScheduledTaskSpec,
  type SourceIdentity,
  type UpdaterReceipt,
  type WindowsOtaController
} from '../src/tools/windowsOtaDeploy.js';

describe('fixed Windows OTA deployment executor', () => {
  it('builds one fixed no-trigger Scheduled Task with exact principal, working directory, and encoded updater wrapper', () => {
    const spec = buildWindowsOtaTaskSpec('op-fixed-1');
    expect(spec.taskName).toBe(WINDOWS_OTA_TEST_CONSTANTS.taskName);
    expect(spec.principal).toEqual({
      account: WINDOWS_OTA_TARGET_PRINCIPAL,
      sid: WINDOWS_OTA_TARGET_SID,
      logonType: 'Interactive',
      runLevel: 'Limited'
    });
    expect(spec.triggers).toEqual([]);
    expect(spec.action.executable).toBe(WINDOWS_OTA_TEST_CONSTANTS.powershell);
    expect(spec.action.workingDirectory).toBe(WINDOWS_OTA_TEST_CONSTANTS.workspaceRoot);
    expect(spec.action.arguments.slice(0, 4)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    expect(spec.action.arguments).toHaveLength(5);

    const wrapper = Buffer.from(spec.action.arguments[4], 'base64').toString('utf16le');
    expect(wrapper).toContain("$env:Path = 'C:\\Program Files\\nodejs;' + $env:Path");
    expect(wrapper).toContain(`& '${WINDOWS_OTA_TEST_CONSTANTS.powershell}' -NoProfile -ExecutionPolicy Bypass -File '${WINDOWS_OTA_TEST_CONSTANTS.updater}'`);
    expect(wrapper).toContain(`-WorkspaceRoot '${WINDOWS_OTA_TEST_CONSTANTS.workspaceRoot}'`);
    expect(wrapper).toContain(`-OtaSource '${WINDOWS_OTA_TEST_CONSTANTS.sourceRoot}'`);
    expect(wrapper).toContain(`-StackConfig '${WINDOWS_OTA_TEST_CONSTANTS.stackConfig}'`);
    expect(wrapper).toContain(`$receipt = '${WINDOWS_OTA_TEST_CONSTANTS.receiptPath}'`);
    expect(wrapper).toContain("$operationId = 'op-fixed-1'");
    expect(wrapper).not.toMatch(/Start-Process|Stop-Process|Stop-Service|Restart-Service|taskkill|cmd\.exe|run_command|workspace_helper_run/i);
  });

  it('proves the fixed listener process under the bounded Rosebot pwsh supervisor topology', async () => {
    const probe = WINDOWS_OTA_TEST_CONSTANTS.listenerProbeScript;
    expect(probe).toContain('Get-CimInstance Win32_Process -ErrorAction Stop');
    expect(probe).toContain('ParentProcessId');
    expect(probe).toContain(`$depth -lt ${WINDOWS_OTA_TEST_CONSTANTS.supervisorAncestryLimit}`);
    expect(probe).toContain(`-ieq '${WINDOWS_OTA_TEST_CONSTANTS.supervisorExecutable}'`);
    expect(probe).toContain('Run-WindowsNodeServiceLoop\\.ps1');
    expect(probe).toContain(`-Name\\s+(?:"${WINDOWS_OTA_TEST_CONSTANTS.serviceName}"|${WINDOWS_OTA_TEST_CONSTANTS.serviceName})(?=$|\\s)`);
    expect(probe).not.toContain('Win32_Service');

    const fixture = controllerFixture({ listeners: [{ processPresent: true, supervisorPresent: true, supervisorMatched: true }] });
    expect((await executeWindowsOtaDeployment(fixture.controller)).ok).toBe(true);
  });

  it('runs exactly one register and one start, accepts exact provenance, and cleans task and receipt on success', async () => {
    const fixture = controllerFixture();
    const result = await executeWindowsOtaDeployment(fixture.controller);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      executed: true,
      profile: WINDOWS_OTA_DEPLOY_PROFILE,
      source_revision: WINDOWS_OTA_SOURCE_REVISION,
      source_tree: WINDOWS_OTA_SOURCE_TREE,
      prior_live_marker: WINDOWS_OTA_PRE_LIVE_MARKER,
      live_marker: WINDOWS_OTA_POST_LIVE_MARKER,
      rollback_marker: WINDOWS_OTA_PRE_LIVE_MARKER,
      task_cleaned: true,
      receipt_cleaned: true,
      protected_surfaces_untouched: true
    });
    expect(fixture.calls.register).toBe(1);
    expect(fixture.calls.start).toBe(1);
    expect(fixture.calls.wait).toBe(1);
    expect(fixture.calls.unregister).toBe(1);
    expect(fixture.calls.deleteReceipt).toBe(1);
    expect(fixture.registeredSpec?.triggers).toEqual([]);
  });

  it.each([
    ['wrong platform', { runtime: { platform: 'linux' } }, 'wrong_platform'],
    ['missing local binding', { runtime: { localHostId: '' } }, 'local_host_binding_missing'],
    ['wrong user', { runtime: { username: 'other' } }, 'target_user_mismatch'],
    ['wrong principal', { runtime: { principal: 'USER\\other' } }, 'target_principal_mismatch'],
    ['wrong SID', { runtime: { sid: 'S-1-0-0' } }, 'target_sid_mismatch'],
    ['task already present', { taskPresent: true }, 'operation_task_present'],
    ['receipt already present', { receiptPresent: true }, 'operation_receipt_present'],
    ['wrong source revision', { source: { revision: 'bad' } }, 'source_revision_mismatch'],
    ['wrong source tree', { source: { tree: 'bad' } }, 'source_tree_mismatch'],
    ['dirty source', { source: { clean: false } }, 'source_worktree_dirty'],
    ['wrong optional source marker', { source: { deployMarker: 'bad' } }, 'source_deploy_marker_mismatch'],
    ['wrong live marker', { preLiveMarker: 'bad' }, 'pre_live_marker_mismatch'],
    ['new deployment exists', { newPathPresent: true }, 'new_deployment_path_present'],
    ['deployment collision', { collision: true }, 'gateway_deployment_collision'],
    ['low disk', { resources: { dFreeGb: 59 } }, 'insufficient_d_drive_space'],
    ['low virtual memory', { resources: { freeVirtualMb: 8191 } }, 'insufficient_virtual_memory'],
    ['low physical memory', { resources: { freePhysicalMb: 383 } }, 'insufficient_physical_memory'],
    ['wrong listener count', { listeners: [] }, 'listener_count_mismatch'],
    ['wrong listener address', { listeners: [{ address: '127.0.0.1' }] }, 'listener_binding_mismatch'],
    ['missing listener process', { listeners: [{ processPresent: false }] }, 'listener_process_missing'],
    ['missing listener supervisor', { listeners: [{ supervisorPresent: false, supervisorMatched: false }] }, 'listener_supervisor_missing'],
    ['wrong listener supervisor', { listeners: [{ supervisorPresent: true, supervisorMatched: false }] }, 'listener_supervisor_mismatch'],
    ['bad health status', { health: { status: 503 } }, 'health_check_failed'],
    ['bad health payload', { health: { body: { ok: true, service: 'other', transport: 'http' } } }, 'health_payload_mismatch']
  ])('fails closed before registration for %s', async (_name, override, failureClass) => {
    const fixture = controllerFixture(override as FixtureOverride);
    const result = await executeWindowsOtaDeployment(fixture.controller);
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ failure_class: failureClass, retry_attempted: false, alternate_route_attempted: false, process_or_service_termination_attempted: false });
    expect(fixture.calls.register).toBe(0);
    expect(fixture.calls.start).toBe(0);
  });

  it('does not clean or alter preregistration task/receipt state that it did not create', async () => {
    const taskFixture = controllerFixture({ taskPresent: true });
    await executeWindowsOtaDeployment(taskFixture.controller);
    expect(taskFixture.calls.unregister).toBe(0);
    expect(taskFixture.calls.deleteReceipt).toBe(0);

    const receiptFixture = controllerFixture({ receiptPresent: true });
    await executeWindowsOtaDeployment(receiptFixture.controller);
    expect(receiptFixture.calls.unregister).toBe(0);
    expect(receiptFixture.calls.deleteReceipt).toBe(0);
  });

  it('does not clean task or receipt owned by a concurrent winner after both invocations pass absence checks', async () => {
    const shared: FixtureSharedState = { taskPresent: false, receiptPresent: false };
    const winner = controllerFixture({}, shared);
    const loser = controllerFixture({}, shared);
    const loserAtHealth = deferred();
    const winnerReceiptCreated = deferred();
    const releaseWinnerReceipt = deferred();

    const winnerHealth = winner.controller.health;
    let winnerHealthReads = 0;
    winner.controller.health = async () => {
      const value = await winnerHealth();
      winnerHealthReads += 1;
      if (winnerHealthReads === 1) await loserAtHealth.promise;
      return value;
    };

    const loserHealth = loser.controller.health;
    let loserHealthReads = 0;
    loser.controller.health = async () => {
      const value = await loserHealth();
      loserHealthReads += 1;
      if (loserHealthReads === 1) {
        loserAtHealth.resolve();
        await winnerReceiptCreated.promise;
      }
      return value;
    };

    const winnerWaitForReceipt = winner.controller.waitForReceipt;
    winner.controller.waitForReceipt = async (...args) => {
      const receipt = await winnerWaitForReceipt(...args);
      winnerReceiptCreated.resolve();
      await releaseWinnerReceipt.promise;
      return receipt;
    };

    const winnerPromise = executeWindowsOtaDeployment(winner.controller);
    const loserPromise = executeWindowsOtaDeployment(loser.controller);
    const loserResult = await loserPromise;
    const stateAfterLoser = { ...shared };
    const loserCleanupCalls = { unregister: loser.calls.unregister, deleteReceipt: loser.calls.deleteReceipt };
    releaseWinnerReceipt.resolve();
    const winnerResult = await winnerPromise;

    expect(loserResult.ok).toBe(false);
    expect(loser.calls.register).toBe(1);
    expect(loserCleanupCalls).toEqual({ unregister: 0, deleteReceipt: 0 });
    expect(stateAfterLoser).toMatchObject({ taskPresent: true, receiptPresent: true });
    expect(winnerResult.ok).toBe(true);
    expect(winner.calls.unregister).toBe(1);
    expect(winner.calls.deleteReceipt).toBe(1);
  });

  it('preserves a foreign receipt and retains the owned task exclusion when receipt ownership is unproven', async () => {
    const fixture = controllerFixture({ updaterReceipt: { operation_id: 'foreign-operation' } });
    const result = await executeWindowsOtaDeployment(fixture.controller);

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      failure_class: 'receipt_operation_mismatch',
      cleanup_ok: false,
      cleanup_failure_class: 'post_start_exclusion_retained'
    });
    expect(fixture.calls.unregister).toBe(0);
    expect(fixture.calls.deleteReceipt).toBe(0);
    expect(fixture.state.taskPresent).toBe(true);
    expect(fixture.state.receiptPresent).toBe(true);
    expect(fixture.state.receiptOperationId).toBe('foreign-operation');
  });

  it('accepts an absent source .deploy-rev because exact Git revision/tree and clean state are independently bound', async () => {
    const fixture = controllerFixture({ source: { deployMarker: undefined } });
    const result = await executeWindowsOtaDeployment(fixture.controller);
    expect(result.ok).toBe(true);
  });

  it('propagates canonical updater failure and cleans the exact operation without retrying', async () => {
    const fixture = controllerFixture({ updaterReceipt: { outcome: 'failure', updater_exit_code: 23 } });
    const result = await executeWindowsOtaDeployment(fixture.controller);
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ failure_class: 'canonical_updater_failed', updater_exit_code: 23, retry_attempted: false, cleanup_ok: true });
    expect(fixture.calls.register).toBe(1);
    expect(fixture.calls.start).toBe(1);
    expect(fixture.calls.wait).toBe(1);
    expect(fixture.calls.unregister).toBe(1);
    expect(fixture.calls.deleteReceipt).toBe(1);
  });

  it('retains task exclusion after bounded wait failure and never performs a second start', async () => {
    const fixture = controllerFixture({ waitFailure: new Error('bounded wait failed') });
    const result = await executeWindowsOtaDeployment(fixture.controller);
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      failure_class: 'unexpected_executor_failure',
      retry_attempted: false,
      cleanup_ok: false,
      cleanup_failure_class: 'post_start_exclusion_retained'
    });
    expect(fixture.calls.start).toBe(1);
    expect(fixture.calls.wait).toBe(1);
    expect(fixture.calls.unregister).toBe(0);
    expect(fixture.calls.deleteReceipt).toBe(0);
    expect(fixture.state.taskPresent).toBe(true);
  });

  it('retains invocation A exclusion across timeout so invocation B cannot start or delete A late receipt', async () => {
    const shared: FixtureSharedState = { taskPresent: false, receiptPresent: false };
    const invocationA = controllerFixture({}, shared);
    let operationAId = '';
    invocationA.controller.waitForReceipt = async (_path, operationId) => {
      invocationA.calls.wait += 1;
      operationAId = operationId;
      throw new Error('bounded wait failed');
    };

    const resultA = await executeWindowsOtaDeployment(invocationA.controller);
    expect(resultA.ok).toBe(false);
    expect(resultA.data).toMatchObject({
      failure_class: 'unexpected_executor_failure',
      cleanup_ok: false,
      cleanup_failure_class: 'post_start_exclusion_retained'
    });
    expect(operationAId).not.toBe('');
    expect(invocationA.calls).toMatchObject({ register: 1, start: 1, wait: 1, unregister: 0, deleteReceipt: 0 });
    expect(shared).toMatchObject({ taskPresent: true, receiptPresent: false });

    const invocationB = controllerFixture({}, shared);
    const resultB = await executeWindowsOtaDeployment(invocationB.controller);
    expect(resultB.ok).toBe(false);
    expect(resultB.data).toMatchObject({ failure_class: 'operation_task_present', cleanup_ok: true });
    expect(invocationB.calls).toMatchObject({ register: 0, start: 0, wait: 0, unregister: 0, deleteReceipt: 0 });
    expect(shared).toMatchObject({ taskPresent: true, receiptPresent: false });

    shared.receiptPresent = true;
    shared.receiptOperationId = operationAId;
    expect(shared).toMatchObject({ taskPresent: true, receiptPresent: true, receiptOperationId: operationAId });
    expect(invocationB.calls.deleteReceipt).toBe(0);
  });

  it.each([
    ['live marker', { postLiveMarker: 'bad' }, 'post_live_marker_mismatch'],
    ['rollback marker', { rollbackMarker: 'bad' }, 'rollback_marker_mismatch'],
    ['new path', { postNewPathPresent: true }, 'new_deployment_path_present_post'],
    ['source provenance', { postSource: { tree: 'bad' } }, 'source_tree_mismatch'],
    ['listener process', { postListeners: [{ processPresent: false }] }, 'listener_process_missing'],
    ['listener supervisor missing', { postListeners: [{ supervisorPresent: false, supervisorMatched: false }] }, 'listener_supervisor_missing'],
    ['listener supervisor mismatch', { postListeners: [{ supervisorPresent: true, supervisorMatched: false }] }, 'listener_supervisor_mismatch'],
    ['health', { postHealth: { body: { ok: false, service: 'ota-computer-use-gateway', transport: 'http' } } }, 'health_payload_mismatch']
  ])('rejects incorrect post-deployment %s and cleans operation state', async (_name, override, failureClass) => {
    const fixture = controllerFixture(override as FixtureOverride);
    const result = await executeWindowsOtaDeployment(fixture.controller);
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ failure_class: failureClass, cleanup_ok: true, retry_attempted: false });
    expect(fixture.calls.start).toBe(1);
    expect(fixture.calls.unregister).toBe(1);
    expect(fixture.calls.deleteReceipt).toBe(1);
  });
});

type FixtureOverride = {
  runtime?: Partial<RuntimeIdentity>;
  taskPresent?: boolean;
  receiptPresent?: boolean;
  source?: Partial<SourceIdentity>;
  preLiveMarker?: string;
  newPathPresent?: boolean;
  collision?: boolean;
  resources?: Partial<ResourceSnapshot>;
  listeners?: Array<Partial<ListenerSnapshot>>;
  health?: Partial<HealthSnapshot>;
  updaterReceipt?: Partial<UpdaterReceipt>;
  waitFailure?: Error;
  postLiveMarker?: string;
  rollbackMarker?: string;
  postNewPathPresent?: boolean;
  postSource?: Partial<SourceIdentity>;
  postListeners?: Array<Partial<ListenerSnapshot>>;
  postHealth?: Partial<HealthSnapshot>;
};

type FixtureSharedState = {
  taskPresent: boolean;
  receiptPresent: boolean;
  receiptOperationId?: string;
};

function controllerFixture(override: FixtureOverride = {}, sharedState?: FixtureSharedState) {
  const calls = { register: 0, start: 0, wait: 0, unregister: 0, deleteReceipt: 0 };
  const state = sharedState ?? {
    taskPresent: override.taskPresent ?? false,
    receiptPresent: override.receiptPresent ?? false,
    receiptOperationId: undefined
  };
  let registeredSpec: ScheduledTaskSpec | undefined;
  let sourceReads = 0;
  let liveMarkerReads = 0;
  let newPathReads = 0;
  let listenerReads = 0;
  let healthReads = 0;

  const runtime: RuntimeIdentity = {
    platform: 'win32', hostname: 'rosebot-win', localHostId: 'rosebot-win', username: WINDOWS_OTA_TARGET_USER,
    principal: WINDOWS_OTA_TARGET_PRINCIPAL, sid: WINDOWS_OTA_TARGET_SID,
    ...override.runtime
  };
  const source: SourceIdentity = { revision: WINDOWS_OTA_SOURCE_REVISION, tree: WINDOWS_OTA_SOURCE_TREE, clean: true, ...override.source };
  const postSource: SourceIdentity = { ...source, ...override.postSource };
  const resources: ResourceSnapshot = { dFreeGb: 100, freeVirtualMb: 16384, freePhysicalMb: 4096, ...override.resources };
  const listeners = normalizeListeners(override.listeners);
  const postListeners = normalizeListeners(override.postListeners ?? override.listeners);
  const health: HealthSnapshot = { status: 200, body: { ok: true, service: 'ota-computer-use-gateway', transport: 'http' }, ...override.health };
  const postHealth: HealthSnapshot = { ...health, ...override.postHealth };

  const controller: WindowsOtaController = {
    runtimeIdentity: async () => runtime,
    taskExists: async () => state.taskPresent,
    receiptExists: async () => state.receiptPresent,
    sourceIdentity: async () => (++sourceReads === 1 ? source : postSource),
    readMarker: async (root) => {
      if (root === WINDOWS_OTA_TEST_CONSTANTS.liveRoot) return ++liveMarkerReads === 1 ? (override.preLiveMarker ?? WINDOWS_OTA_PRE_LIVE_MARKER) : (override.postLiveMarker ?? WINDOWS_OTA_POST_LIVE_MARKER);
      if (root === WINDOWS_OTA_TEST_CONSTANTS.rollbackRoot) return override.rollbackMarker ?? WINDOWS_OTA_PRE_LIVE_MARKER;
      return undefined;
    },
    pathExists: async (targetPath) => targetPath === WINDOWS_OTA_TEST_CONSTANTS.newRoot ? (++newPathReads === 1 ? (override.newPathPresent ?? false) : (override.postNewPathPresent ?? false)) : false,
    deploymentCollision: async () => override.collision ?? false,
    resources: async () => resources,
    listeners: async () => (++listenerReads === 1 ? listeners : postListeners),
    health: async () => (++healthReads === 1 ? health : postHealth),
    registerTask: async (spec) => {
      calls.register += 1;
      if (state.taskPresent) throw new Error('task already registered');
      registeredSpec = spec;
      state.taskPresent = true;
    },
    startTask: async () => { calls.start += 1; },
    waitForReceipt: async (_path, operationId) => {
      calls.wait += 1;
      if (override.waitFailure) throw override.waitFailure;
      const receipt = {
        schema_version: 'ota-windows-deploy-receipt/v1' as const, operation_id: operationId, updater_exit_code: 0, outcome: 'success' as const,
        ...override.updaterReceipt
      };
      state.receiptPresent = true;
      state.receiptOperationId = receipt.operation_id;
      return receipt;
    },
    unregisterTask: async () => { calls.unregister += 1; state.taskPresent = false; },
    deleteReceipt: async (_path, operationId) => {
      calls.deleteReceipt += 1;
      if (!state.receiptPresent) return;
      if (state.receiptOperationId !== operationId) throw new Error('receipt owned by another operation');
      state.receiptPresent = false;
      state.receiptOperationId = undefined;
    }
  };

  return { controller, calls, state, get registeredSpec() { return registeredSpec; } };
}

function normalizeListeners(input?: Array<Partial<ListenerSnapshot>>): ListenerSnapshot[] {
  const source = input ?? [{}];
  return source.map((item) => ({
    address: WINDOWS_OTA_TEST_CONSTANTS.listenerAddress,
    port: WINDOWS_OTA_TEST_CONSTANTS.listenerPort,
    processId: 4242,
    processPresent: true,
    supervisorPresent: true,
    supervisorMatched: true,
    ...item
  }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
