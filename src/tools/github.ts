import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runCommand, type CommandResult } from '../core/process.js';
import { resolveInside } from '../core/paths.js';
import { ok } from '../core/result.js';
import { truncateText } from '../core/text.js';
import { redactGitOutputForDisplay } from './git.js';
import type { AppConfig } from '../config/schema.js';
import { sanitizeResultsEnabled, workspaceChildEnvironmentMode } from '../core/securityPolicy.js';
import type { Workspace } from '../core/workspaces.js';

export type GithubRatePolicy = {
  preflight?: boolean;
  resource?: string;
  min_remaining?: number;
  retry_mode?: 'never' | 'safe_read_once';
  max_wait_ms?: number;
};

type NormalizedRatePolicy = {
  preflight: boolean;
  resource?: string;
  min_remaining?: number;
  retry_mode: 'never' | 'safe_read_once';
  max_wait_ms: number;
};

type RateBudgetClassification = 'ok' | 'primary_exhausted' | 'secondary_limited' | 'rate_limited_unknown' | 'not_checked';

type RateBudget = {
  classification: RateBudgetClassification;
  resource?: string;
  limit?: number;
  remaining?: number;
  used?: number;
  reset_at?: string;
  retry_after_ms?: number;
  source: 'rate_policy' | 'gh_api_rate_limit' | 'gh_command_output';
  safe_to_replay: boolean;
  automatic_retry_count: number;
  execution: 'executed' | 'skipped_rate_budget';
};

type RateLimitObservation = Pick<RateBudget, 'classification'> & Partial<Pick<RateBudget, 'reset_at' | 'retry_after_ms'>>;
type GithubExecutionContext = {
  token: string;
  cwdAbsolute: string;
  cwdDisplay: string;
  timeout: number;
  executable: string;
  env: NodeJS.ProcessEnv;
  environmentMode: Parameters<typeof runCommand>[5];
};

const MAX_RATE_WAIT_MS = 60000;
const RATE_POLICY_KEYS = new Set(['preflight', 'resource', 'min_remaining', 'retry_mode', 'max_wait_ms']);
const SAFE_GH_API_VALUE_FLAGS = new Set(['-H', '--header', '--hostname', '-p', '--preview', '--cache', '-q', '--jq', '-t', '--template']);
const SAFE_GH_API_BOOLEAN_FLAGS = new Set(['-i', '--include', '--paginate', '--silent', '--slurp', '--verbose']);

export async function githubCliTool(
  config: AppConfig,
  workspace: Workspace,
  cmd: string[],
  cwdPath = '.',
  timeoutMs = 60000,
  maxOutputChars = 20000,
  ratePolicy?: GithubRatePolicy
) {
  if (!workspace.allow_tests) throw new Error('workspace does not allow GitHub command execution');
  if (!Array.isArray(cmd) || cmd.length === 0) throw new Error('cmd_array must be an array');
  const context = await githubExecutionContext(config, workspace, cwdPath, timeoutMs);
  if (ratePolicy === undefined) return runGithubLegacy(config, workspace, cmd, maxOutputChars, context);
  return runGithubWithRatePolicy(config, workspace, cmd, maxOutputChars, ratePolicy, context);
}

async function githubExecutionContext(config: AppConfig, workspace: Workspace, cwdPath: string, timeoutMs: number): Promise<GithubExecutionContext> {
  const token = await githubToken(workspace);
  const cwd = await resolveInside(workspace, cwdPath, config);
  return {
    token,
    cwdAbsolute: cwd.absolute,
    cwdDisplay: cwd.displayPath,
    timeout: Math.min(Math.max(1, timeoutMs), config.security.max_exec_ms),
    executable: githubExecutable(workspace),
    env: { GH_TOKEN: token, GITHUB_TOKEN: token },
    environmentMode: workspaceChildEnvironmentMode(config, workspace)
  };
}

async function runGithubLegacy(config: AppConfig, workspace: Workspace, cmd: string[], maxOutputChars: number, context: GithubExecutionContext) {
  const result = await runCommand(context.executable, cmd.map(String), context.cwdAbsolute, context.timeout, context.env, context.environmentMode);
  return githubResult(config, workspace, cmd, context.cwdDisplay, result, context.token, maxOutputChars);
}

async function runGithubWithRatePolicy(config: AppConfig, workspace: Workspace, cmd: string[], maxOutputChars: number, ratePolicy: GithubRatePolicy, context: GithubExecutionContext) {
  const policy = normalizeRatePolicy(ratePolicy, context.timeout);
  const safeToReplay = isProvablySafeRestRead(cmd);
  const startedAt = Date.now();
  let rateBudget = initialRateBudget(policy, safeToReplay);
  if (policy.preflight) {
    rateBudget = await preflightRateBudget(context.executable, context.cwdAbsolute, context.timeout, startedAt, context.env, context.environmentMode, policy, safeToReplay);
    if (rateBudget.classification === 'primary_exhausted') return skippedRateBudgetResult(workspace, cmd, context.cwdDisplay, rateBudget);
  }
  const executed = await executeWithRatePolicy(cmd, context, policy, safeToReplay, rateBudget, startedAt);
  const base = await githubResult(config, workspace, cmd, context.cwdDisplay, executed.result, context.token, maxOutputChars, true);
  return { ...base, data: { ...(base.data as Record<string, unknown>), rate_budget: executed.rateBudget } };
}

function initialRateBudget(policy: NormalizedRatePolicy, safeToReplay: boolean): RateBudget {
  return {
    classification: 'not_checked', resource: policy.resource, source: 'rate_policy', safe_to_replay: safeToReplay,
    automatic_retry_count: 0, execution: 'executed'
  };
}

function skippedRateBudgetResult(workspace: Workspace, cmd: string[], cwd: string, rateBudget: RateBudget) {
  return ok('github command skipped by rate budget', {
    command: ['gh', ...redactAuthorizationHeaderArgs(cmd)], cwd, exit_code: null, timed_out: false, output: '', truncated: false,
    auth_lane: workspace.git?.github_cli_wrapper ? 'configured_wrapper' : 'configured_token_env',
    rate_budget: { ...rateBudget, execution: 'skipped_rate_budget' }
  });
}

async function executeWithRatePolicy(cmd: string[], context: GithubExecutionContext, policy: NormalizedRatePolicy, safeToReplay: boolean, initialBudget: RateBudget, startedAt: number) {
  let result = await runGithubCommand(cmd, context, startedAt);
  let observation = result.code === 0 ? undefined : classifyRateLimit(`${result.stdout}\n${result.stderr}`);
  let rateBudget = observation ? applyRateObservation(initialBudget, observation) : initialBudget;
  if (!shouldRetrySafeRead(policy, safeToReplay, observation, context.timeout, startedAt)) return { result, rateBudget };
  await sleep(observation!.retry_after_ms!);
  result = await runGithubCommand(cmd, context, startedAt);
  rateBudget = { ...rateBudget, automatic_retry_count: 1 };
  observation = result.code === 0 ? undefined : classifyRateLimit(`${result.stdout}\n${result.stderr}`);
  return { result, rateBudget: observation ? applyRateObservation(rateBudget, observation) : rateBudget };
}

function runGithubCommand(cmd: string[], context: GithubExecutionContext, startedAt: number) {
  return runCommand(context.executable, cmd.map(String), context.cwdAbsolute, remainingTimeout(context.timeout, startedAt), context.env, context.environmentMode);
}

async function preflightRateBudget(
  executable: string,
  cwd: string,
  timeout: number,
  startedAt: number,
  env: NodeJS.ProcessEnv,
  environmentMode: Parameters<typeof runCommand>[5],
  policy: NormalizedRatePolicy,
  safeToReplay: boolean
): Promise<RateBudget> {
  const base: RateBudget = {
    classification: 'not_checked',
    resource: policy.resource,
    source: 'gh_api_rate_limit',
    safe_to_replay: safeToReplay,
    automatic_retry_count: 0,
    execution: 'executed'
  };
  const remaining = remainingTimeout(timeout, startedAt);
  if (remaining <= 1) return base;
  const result = await runCommand(executable, ['api', 'rate_limit'], cwd, remaining, env, environmentMode);
  if (result.timed_out) return base;

  const failureObservation = classifyRateLimit(`${result.stdout}\n${result.stderr}`);
  if (result.code !== 0) return failureObservation ? applyRateObservation(base, failureObservation) : base;
  if (!policy.resource) return base;

  const selected = selectedRateResource(result.stdout, policy.resource);
  return selected ? selectedRateBudget(base, selected, policy.min_remaining ?? 1) : base;
}

function selectedRateBudget(base: RateBudget, selected: Record<string, unknown>, minimum: number): RateBudget {
  const remaining = finiteInteger(selected.remaining);
  return {
    ...base,
    classification: remaining === undefined ? 'not_checked' : remaining < minimum ? 'primary_exhausted' : 'ok',
    limit: finiteInteger(selected.limit),
    remaining,
    used: finiteInteger(selected.used),
    reset_at: epochSecondsToIso(selected.reset)
  };
}

function selectedRateResource(text: string, resource: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const resources = parsed.resources;
    if (resources && typeof resources === 'object' && !Array.isArray(resources)) {
      const selected = (resources as Record<string, unknown>)[resource];
      if (selected && typeof selected === 'object' && !Array.isArray(selected)) return selected as Record<string, unknown>;
    }
    if (resource === 'rate' && parsed.rate && typeof parsed.rate === 'object' && !Array.isArray(parsed.rate)) return parsed.rate as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeRatePolicy(input: GithubRatePolicy, commandTimeoutMs: number): NormalizedRatePolicy {
  const source = input as Record<string, unknown>;
  const unsupported = Object.keys(source).filter((key) => !RATE_POLICY_KEYS.has(key));
  if (unsupported.length > 0) throw new Error(`rate_policy has unsupported field(s): ${unsupported.sort().join(', ')}`);
  if (source.preflight !== undefined && typeof source.preflight !== 'boolean') throw new Error('rate_policy.preflight must be a boolean');
  if (source.resource !== undefined && (typeof source.resource !== 'string' || source.resource.length === 0)) throw new Error('rate_policy.resource must be a non-empty string');
  if (source.min_remaining !== undefined && !isNonNegativeInteger(source.min_remaining)) throw new Error('rate_policy.min_remaining must be an integer >= 0');
  if (source.retry_mode !== undefined && source.retry_mode !== 'never' && source.retry_mode !== 'safe_read_once') throw new Error('rate_policy.retry_mode must be never or safe_read_once');
  if (source.max_wait_ms !== undefined && !isNonNegativeInteger(source.max_wait_ms)) throw new Error('rate_policy.max_wait_ms must be an integer >= 0');

  return {
    preflight: source.preflight === true,
    resource: source.resource as string | undefined,
    min_remaining: source.min_remaining as number | undefined,
    retry_mode: source.retry_mode === 'safe_read_once' ? 'safe_read_once' : 'never',
    max_wait_ms: Math.min(source.max_wait_ms as number | undefined ?? 0, MAX_RATE_WAIT_MS, commandTimeoutMs)
  };
}

function isProvablySafeRestRead(cmd: string[]): boolean {
  if (cmd[0] !== 'api') return false;
  const args = cmd.slice(1);
  if (args.some((arg) => arg.replace(/^\/+/, '') === 'graphql')) return false;
  const parsed = parseSafeRestArgs(args);
  if (!parsed?.endpointSeen) return false;
  return parsed.explicitMethod === undefined || parsed.explicitMethod === 'GET' || parsed.explicitMethod === 'HEAD';
}

function parseSafeRestArgs(args: string[]): { endpointSeen: boolean; explicitMethod?: string } | undefined {
  let explicitMethod: string | undefined;
  let endpointSeen = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-X' || arg === '--method') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) return undefined;
      explicitMethod = value.toUpperCase();
      index++;
      continue;
    }
    if (arg.startsWith('--method=')) {
      const value = arg.slice('--method='.length);
      if (!value) return undefined;
      explicitMethod = value.toUpperCase();
      continue;
    }
    if (arg.startsWith('-X') && arg.length > 2) { explicitMethod = arg.slice(2).toUpperCase(); continue; }
    if (isImplicitPostArg(arg)) return undefined;
    if (SAFE_GH_API_VALUE_FLAGS.has(arg)) {
      if (args[index + 1] === undefined) return undefined;
      index++;
      continue;
    }
    if ([...SAFE_GH_API_VALUE_FLAGS].some((flag) => flag.startsWith('--') && arg.startsWith(`${flag}=`))) continue;
    if (SAFE_GH_API_BOOLEAN_FLAGS.has(arg) || arg === '--') continue;
    if (arg.startsWith('-')) return undefined;
    endpointSeen = true;
  }
  return { endpointSeen, explicitMethod };
}

function isImplicitPostArg(arg: string): boolean {
  if (arg === '-f' || arg === '-F' || arg === '--field' || arg === '--raw-field' || arg === '--input') return true;
  if ((arg.startsWith('-f') || arg.startsWith('-F')) && arg.length > 2) return true;
  return arg.startsWith('--field=') || arg.startsWith('--raw-field=') || arg.startsWith('--input=');
}

function classifyRateLimit(text: string): RateLimitObservation | undefined {
  const retryAfterMs = retryAfterFromText(text);
  const resetAt = resetAtFromText(text);
  if (/api rate limit exceeded|x-ratelimit-remaining\s*[:=]\s*0|rate limit remaining\s*[:=]\s*0/i.test(text)) {
    return { classification: 'primary_exhausted', reset_at: resetAt, retry_after_ms: retryAfterMs };
  }
  if (/secondary rate limit|abuse detection mechanism|abuse rate limit/i.test(text)) {
    return { classification: 'secondary_limited', retry_after_ms: retryAfterMs, reset_at: resetAt };
  }
  if (/\bHTTP\s+(403|429)\b|\bstatus\s*[:=]?\s*(403|429)\b|rate limit/i.test(text)) {
    return { classification: 'rate_limited_unknown', reset_at: resetAt, retry_after_ms: retryAfterMs };
  }
  return undefined;
}

function retryAfterFromText(text: string): number | undefined {
  const jsonValue = jsonNumericField(text, 'retry_after');
  if (jsonValue !== undefined) return Math.max(0, Math.round(jsonValue * 1000));
  const seconds = text.match(/retry[-_ ]after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)?/i)
    ?? text.match(/try again in\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
  if (seconds) return Math.max(0, Math.round(Number(seconds[1]) * 1000));
  const header = text.match(/retry-after\s*:\s*([^\r\n]+)/i)?.[1]?.trim();
  if (header) {
    const when = Date.parse(header);
    if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  }
  return undefined;
}

function resetAtFromText(text: string): string | undefined {
  const match = text.match(/x-ratelimit-reset\s*[:=]\s*(\d{9,})/i);
  return match ? epochSecondsToIso(Number(match[1])) : undefined;
}

function jsonNumericField(text: string, field: string): number | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    const match = text.match(new RegExp(`"${field}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`, 'i'));
    return match ? Number(match[1]) : undefined;
  }
}

function applyRateObservation(budget: RateBudget, observation: RateLimitObservation): RateBudget {
  return {
    ...budget,
    classification: observation.classification,
    reset_at: observation.reset_at ?? budget.reset_at,
    retry_after_ms: observation.retry_after_ms,
    source: 'gh_command_output'
  };
}

function shouldRetrySafeRead(
  policy: NormalizedRatePolicy,
  safeToReplay: boolean,
  observation: RateLimitObservation | undefined,
  timeout: number,
  startedAt: number
): boolean {
  if (policy.retry_mode !== 'safe_read_once' || !safeToReplay || observation?.classification !== 'secondary_limited') return false;
  const wait = observation.retry_after_ms;
  if (wait === undefined || wait > policy.max_wait_ms) return false;
  return wait < remainingTimeout(timeout, startedAt);
}

async function githubResult(config: AppConfig, workspace: Workspace, cmd: string[], cwd: string, result: CommandResult, token: string, maxOutputChars: number, protectAuthorizationHeaders = false) {
  const rawOutput = `${result.stdout}${result.stderr}`;
  const displayOutput = protectAuthorizationHeaders ? redactAuthorizationHeaderLines(rawOutput) : rawOutput;
  const output = redactGithubOutput(displayOutput, token, sanitizeResultsEnabled(config));
  const limited = truncateText(output, Math.min(Math.max(1, maxOutputChars), 50000));
  return ok('github command finished', {
    command: ['gh', ...(protectAuthorizationHeaders ? redactAuthorizationHeaderArgs(cmd) : cmd)],
    cwd,
    exit_code: result.code,
    timed_out: result.timed_out,
    output: limited.text,
    truncated: limited.truncated,
    auth_lane: workspace.git?.github_cli_wrapper ? 'configured_wrapper' : 'configured_token_env'
  });
}

function redactAuthorizationHeaderArgs(args: string[]): string[] {
  const redacted = [...args];
  for (let index = 0; index < redacted.length; index++) {
    const arg = redacted[index];
    if (arg === '-H' || arg === '--header') {
      if (redacted[index + 1] !== undefined) redacted[index + 1] = redactAuthorizationHeaderValue(redacted[index + 1]);
      index++;
      continue;
    }
    if (arg.startsWith('--header=')) {
      redacted[index] = `--header=${redactAuthorizationHeaderValue(arg.slice('--header='.length))}`;
      continue;
    }
    if (arg.startsWith('-H=')) {
      redacted[index] = `-H=${redactAuthorizationHeaderValue(arg.slice('-H='.length))}`;
      continue;
    }
    if (arg.startsWith('-H') && arg.length > 2) {
      redacted[index] = `-H${redactAuthorizationHeaderValue(arg.slice(2))}`;
    }
  }
  return redacted;
}

function redactAuthorizationHeaderValue(value: string): string {
  const prefix = value.match(/^(\s*(?:proxy-)?authorization\s*:\s*)/i)?.[1];
  return prefix ? `${prefix}[AUTHORIZATION_REDACTED]` : value;
}

function redactAuthorizationHeaderLines(text: string): string {
  return text.replace(/((?:^|\r?\n)\s*(?:authorization|proxy-authorization)\s*:\s*)[^\r\n]*/gi, '$1[AUTHORIZATION_REDACTED]');
}

function remainingTimeout(timeout: number, startedAt: number): number {
  return Math.max(1, timeout - (Date.now() - startedAt));
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function epochSecondsToIso(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  try {
    return new Date(value * 1000).toISOString();
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubToken(workspace: Workspace): Promise<string> {
  const tokenFile = workspace.git?.github_token_file || defaultTokenPath(workspace);
  try {
    const token = (await readFile(tokenFile, 'utf8')).trim();
    if (token) return token;
  } catch {
    throw new Error('github auth diagnostic: configured github token file is not readable');
  }
  throw new Error('github auth diagnostic: configured github token file is empty');
}

function githubExecutable(workspace: Workspace): string {
  return workspace.git?.github_cli_wrapper || workspace.git?.github_cli || 'gh';
}

function defaultTokenPath(workspace: Workspace): string {
  return path.join(workspace.realRoot, 'secrets', `${workspace.id}_github_pat.txt`);
}

function redactGithubOutput(text: string, token: string, sanitizeResults: boolean): string {
  return redactGitOutputForDisplay(text, sanitizeResults, [token]);
}
