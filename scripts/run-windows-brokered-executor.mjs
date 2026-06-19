#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { claimExecutorJob, completeExecutorJob, postExecutorHeartbeat } from '../dist/brokeredExecutor/workerClient.js';
import { runWindowsBrokeredOperation, windowsExecutorHeartbeat, WINDOWS_EXECUTOR_KIND } from '../dist/brokeredExecutor/windowsAdapter.js';

const args = parseArgs(process.argv.slice(2));
const options = await loadOptions(args);
const adapter = { localOtaBaseUrl: options.localOtaBaseUrl, workspaceId: options.workspaceId, localOtaBearerToken: options.localOtaBearerToken };

await postExecutorHeartbeat(options, windowsExecutorHeartbeat(options.executorId));
const job = await claimExecutorJob(options, options.leaseMs);
if (!job) {
  console.log(JSON.stringify({ ok: true, summary: 'no brokered executor job available', no_job: true }, null, 2));
  process.exit(0);
}

const result = await runWindowsBrokeredOperation(adapter, job);
const completed = await completeExecutorJob(options, job, result);
console.log(JSON.stringify({ ok: true, summary: 'windows brokered executor job completed', job: completed.job }, null, 2));
process.exit(result.status === 'succeeded' ? 0 : 1);

async function loadOptions(argv) {
  return {
    brokerBaseUrl: required(argv.brokerUrl ?? process.env.WINDOWS_EXECUTOR_BROKER_URL, 'WINDOWS_EXECUTOR_BROKER_URL'),
    localOtaBaseUrl: required(argv.localOtaUrl ?? process.env.WINDOWS_EXECUTOR_LOCAL_OTA_URL, 'WINDOWS_EXECUTOR_LOCAL_OTA_URL'),
    executorId: argv.executorId ?? process.env.WINDOWS_EXECUTOR_ID ?? 'anna-windows-local',
    executorKind: argv.executorKind ?? process.env.WINDOWS_EXECUTOR_KIND ?? WINDOWS_EXECUTOR_KIND,
    workspaceId: argv.workspaceId ?? process.env.WINDOWS_EXECUTOR_WORKSPACE_ID ?? 'anna',
    workerBearerToken: await tokenFrom(argv.workerTokenFile ?? process.env.WINDOWS_EXECUTOR_WORKER_TOKEN_FILE, argv.workerToken ?? process.env.WINDOWS_EXECUTOR_WORKER_TOKEN),
    localOtaBearerToken: await tokenFrom(argv.localOtaTokenFile ?? process.env.WINDOWS_EXECUTOR_LOCAL_OTA_TOKEN_FILE, argv.localOtaToken ?? process.env.WINDOWS_EXECUTOR_LOCAL_OTA_TOKEN),
    leaseMs: argv.leaseMs ? Number(argv.leaseMs) : undefined
  };
}

async function tokenFrom(file, direct) {
  if (direct) return direct;
  return file ? (await readFile(file, 'utf8')).trim() : undefined;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--broker-url') out.brokerUrl = required(argv[++i], arg);
    else if (arg === '--local-ota-url') out.localOtaUrl = required(argv[++i], arg);
    else if (arg === '--executor-id') out.executorId = required(argv[++i], arg);
    else if (arg === '--executor-kind') out.executorKind = required(argv[++i], arg);
    else if (arg === '--workspace-id') out.workspaceId = required(argv[++i], arg);
    else if (arg === '--worker-token') out.workerToken = required(argv[++i], arg);
    else if (arg === '--worker-token-file') out.workerTokenFile = required(argv[++i], arg);
    else if (arg === '--local-ota-token') out.localOtaToken = required(argv[++i], arg);
    else if (arg === '--local-ota-token-file') out.localOtaTokenFile = required(argv[++i], arg);
    else if (arg === '--lease-ms') out.leaseMs = required(argv[++i], arg);
    else if (arg === '--help') usage();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function usage() {
  console.log(`Usage:
  npm run build
  node scripts/run-windows-brokered-executor.mjs --broker-url http://127.0.0.1:8769 --local-ota-url http://127.0.0.1:8769

Environment:
  WINDOWS_EXECUTOR_BROKER_URL
  WINDOWS_EXECUTOR_LOCAL_OTA_URL
  WINDOWS_EXECUTOR_ID                 default: anna-windows-local
  WINDOWS_EXECUTOR_KIND               default: windows_computer_use
  WINDOWS_EXECUTOR_WORKSPACE_ID       default: anna
  WINDOWS_EXECUTOR_WORKER_TOKEN_FILE
  WINDOWS_EXECUTOR_LOCAL_OTA_TOKEN_FILE
`);
  process.exit(0);
}
