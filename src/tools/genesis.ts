import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ok } from '../core/result.js';

const CONTINUITY_ROOT = '/home/genesis/infunity/infunity-agents/genesis/continuity';
const AGENT_CARD_DIR = path.join(CONTINUITY_ROOT, 'agent-cards');
const HOST_CARD_DIR = path.join(CONTINUITY_ROOT, 'machine-profiles');
const MAX_EXCERPT_CHARS = 12000;

const CORE_DOCS = [
  'CONTROL_PLANE_INDEX.md',
  'ESTATE_RUNTIME_TABLE.md',
  'HOST_RUNTIME_TABLE.md',
  'CURRENT_STATE.md',
  'AGENT_DIRECTORY.md'
];

export async function genesisBootstrap() {
  const docs = await readDocs(CORE_DOCS, 2500);
  return ok('genesis bootstrap', {
    lane: 'Webchat Genesis',
    posture: 'read-heavy coarse control-plane reports; no secrets, destructive ops, external messages, account/security changes, or service restarts',
    workflow_guidance: [
      'Use genesis_estate_overview first for broad orientation.',
      'Use genesis_agent_deep_dive for one named agent.',
      'Use genesis_host_deep_dive for one host/machine profile.',
      'Use genesis_safe_diagnostic for bounded non-mutating diagnostic summaries.',
      'Do not ask for raw secrets or bearer tokens; these tools intentionally do not return them.'
    ],
    continuity_root: CONTINUITY_ROOT,
    docs
  });
}

export async function genesisEstateOverview() {
  const docs = await readDocs(['CONTROL_PLANE_INDEX.md', 'ESTATE_RUNTIME_TABLE.md', 'HOST_RUNTIME_TABLE.md', 'AGENT_DIRECTORY.md'], 6000);
  const agents = await listCardNames(AGENT_CARD_DIR);
  const hosts = await listCardNames(HOST_CARD_DIR);
  return ok('genesis estate overview', {
    continuity_root: CONTINUITY_ROOT,
    agents,
    hosts,
    docs,
    note: 'This is a bounded continuity-backed overview, not a live SSH/service audit.'
  });
}

export async function genesisAgentDeepDive(agent: string) {
  const name = safeSlug(agent, 'agent');
  const card = await readFirstExisting([
    path.join(AGENT_CARD_DIR, `${name}.md`),
    path.join(AGENT_CARD_DIR, `${name.toLowerCase()}.md`)
  ], MAX_EXCERPT_CHARS);
  if (!card) throw new Error(`unknown or undocumented agent card: ${name}`);
  return ok('genesis agent deep dive', {
    agent: name,
    card,
    note: 'Agent deep dives are continuity-backed and intentionally omit secret values.'
  });
}

export async function genesisHostDeepDive(host: string) {
  const name = safeSlug(host, 'host');
  const candidates = await hostCandidates(name);
  const card = await readFirstExisting(candidates, MAX_EXCERPT_CHARS);
  if (!card) throw new Error(`unknown or undocumented host card: ${name}`);
  return ok('genesis host deep dive', {
    host: name,
    card,
    note: 'Host deep dives are continuity-backed and intentionally omit secret values.'
  });
}

export async function genesisSafeDiagnostic(scope = 'estate', target?: string) {
  const normalizedScope = safeScope(scope);
  if (normalizedScope === 'agent') return genesisAgentDeepDive(requiredTarget(target, 'agent'));
  if (normalizedScope === 'host') return genesisHostDeepDive(requiredTarget(target, 'host'));
  const docs = await readDocs(['CURRENT_STATE.md', 'CONTROL_PLANE_INDEX.md', 'ESTATE_RUNTIME_TABLE.md'], 5000);
  return ok('genesis safe diagnostic', {
    scope: normalizedScope,
    target: target ?? null,
    docs,
    boundaries: ['read-only continuity summary', 'no secrets', 'no SSH/live command execution', 'no service mutation'],
    recommended_next_calls: ['genesis_agent_deep_dive', 'genesis_host_deep_dive']
  });
}

async function readDocs(names: string[], chars: number) {
  const out = [];
  for (const name of names) {
    const file = path.join(CONTINUITY_ROOT, name);
    const doc = await readExcerpt(file, chars).catch(() => null);
    if (doc) out.push(doc);
  }
  return out;
}

async function readFirstExisting(files: string[], chars: number) {
  for (const file of files) {
    const doc = await readExcerpt(file, chars).catch(() => null);
    if (doc) return doc;
  }
  return null;
}

async function readExcerpt(file: string, chars: number) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('not a file');
  const raw = await readFile(file, 'utf8');
  const excerpt = sanitize(raw).slice(0, Math.min(chars, MAX_EXCERPT_CHARS));
  return { path: file, chars: raw.length, excerpt, truncated: raw.length > excerpt.length };
}

async function listCardNames(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name.replace(/\.md$/, '')).sort();
}

async function hostCandidates(name: string) {
  const base = [path.join(HOST_CARD_DIR, `${name}.md`), path.join(HOST_CARD_DIR, `${name.toLowerCase()}.md`)];
  const entries = await readdir(HOST_CARD_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name.toLowerCase().includes(name.toLowerCase())) base.push(path.join(HOST_CARD_DIR, entry.name));
  }
  return [...new Set(base)];
}

function sanitize(text: string) {
  return text
    .replace(/(bearer|token|secret|password|pat|api[_-]?key)(\s*[:=]\s*)[^\s`]+/gi, '$1$2[REDACTED]')
    .replace(/Authorization:\s*Bearer\s+[^\s`]+/gi, 'Authorization: Bearer [REDACTED]');
}

function safeSlug(value: string, name: string) {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(value)) throw new Error(`invalid ${name} name`);
  return value;
}

function safeScope(value: string) {
  if (!['estate', 'agent', 'host'].includes(value)) throw new Error('scope must be estate, agent, or host');
  return value;
}

function requiredTarget(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} target is required`);
  return value;
}
