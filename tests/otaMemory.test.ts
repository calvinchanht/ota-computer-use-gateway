import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { configSchema, type AppConfig } from '../src/config/schema.js';
import { buildWorkspaces } from '../src/core/workspaces.js';
import { createServer } from '../src/server/create.js';
import { otaMemoryCall } from '../src/tools/otaMemory.js';

describe('OTA-Memory lifecycle adapter', () => {
  it('requires bearer auth on loopback by default when auth is enabled', () => {
    const parsed = configSchema.parse({
      server: { auth: { enabled: true, bearer_token_env: 'TEST_BEARER' } },
      workspaces: [{ id: 'genesis', name: 'Genesis', root: process.cwd() }]
    });
    expect(parsed.server.auth.allow_loopback_without_auth).toBe(false);
  });

  it('requires server-owned paths and project identity when enabled', () => {
    const parsed = configSchema.safeParse({ workspaces: [{ id: 'anna', name: 'Anna', root: process.cwd(), ota_memory: { enabled: true } }] });
    expect(parsed.success).toBe(false);
  });

  it('uses configured identity and ignores model-supplied scope and database paths', async () => {
    const fixture = await memoryFixture();
    const workspace = [...(await buildWorkspaces(fixture.config)).values()][0];
    const result = await otaMemoryCall(workspace, 'memory.begin_turn', {
      request_id: 'begin-1', intent: 'resume work', scope: { project_id: 'attacker' }, database_path: 'C:\\other.sqlite3'
    });
    const receipt = result.data as { operation: string; boundary: Record<string, unknown> };
    expect(receipt.operation).toBe('memory.begin_turn');
    expect(receipt.boundary).toMatchObject({ project_id: 'anna-project', workspace_id: 'anna', agent_id: 'anna' });
    expect(JSON.stringify(result)).not.toContain('other.sqlite3');
  });

  it('resolves opaque fixture handles without exposing target paths in the MCP schema', async () => {
    const fixture = await memoryFixture(true);
    const workspace = [...(await buildWorkspaces(fixture.config)).values()][0];
    const result = await otaMemoryCall(workspace, 'memory.flush_session', {
      request_id: 'flush-1', idempotency_key: 'flush-key-1', execution_handle: 'm14-fixture-1'
    });
    const receipt = result.data as { boundary: { project_id: string }; adapter_marker: string };
    expect(receipt.boundary.project_id).toBe('m14-isolated');
    expect(receipt.adapter_marker).toBe('handle-package');
    await expect(otaMemoryCall(workspace, 'memory.begin_turn', {
      request_id: 'begin-2', intent: 'test', execution_handle: 'unknown'
    })).rejects.toThrow(/unknown or expired/);

    const server = await createServer(fixture.config);
    const tools = (server as unknown as { _registeredTools: Record<string, { inputSchema: unknown }> })._registeredTools;
    const shape = zodShape(tools.memory_begin_turn.inputSchema);
    expect(Object.keys(shape)).toContain('execution_handle');
    expect(Object.keys(shape)).not.toContain('database_path');
    expect(Object.keys(shape)).not.toContain('project_id');

    const commitShape = zodShape(tools.memory_commit_turn.inputSchema);
    const candidates = commitShape.candidates as z.ZodType;
    expect(candidates.safeParse([{ candidate_key: 'provider-smoke', kind: 'observation',
      content: 'Provider write smoke passed.', reason: 'explicit provider smoke' }]).success).toBe(true);
    expect(candidates.safeParse([{ candidate_key: 'provider-smoke',
      content: 'Provider write smoke passed.', reason: 'explicit provider smoke' }]).success).toBe(false);
  });
});

async function memoryFixture(withHandle = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'ota-memory-adapter-'));
  const packageRoot = path.join(root, 'package');
  await mkdir(path.join(packageRoot, 'memory_api'), { recursive: true });
  await writeFile(path.join(packageRoot, 'memory_api', '__init__.py'), '');
  await writeFile(path.join(packageRoot, 'memory_api', 'gateway_adapter.py'), fakeAdapter('default-package'));
  const handlesFile = path.join(root, 'handles.json');
  if (withHandle) {
    const handlePackage = path.join(root, 'handle-package');
    await mkdir(path.join(handlePackage, 'memory_api'), { recursive: true });
    await writeFile(path.join(handlePackage, 'memory_api', '__init__.py'), '');
    await writeFile(path.join(handlePackage, 'memory_api', 'gateway_adapter.py'), fakeAdapter('handle-package'));
    await writeFile(handlesFile, JSON.stringify({ handles: {
      'm14-fixture-1': {
        database_path: path.join(root, 'm14.sqlite3'), package_root: handlePackage,
        project_id: 'm14-isolated'
      }
    } }));
  }
  return { root, config: fixtureConfig(root, packageRoot, withHandle ? handlesFile : undefined) };
}

function fixtureConfig(root: string, packageRoot: string, handlesFile?: string): AppConfig {
  return configSchema.parse({
    server: {},
    workspaces: [{
      id: 'anna', name: 'Anna', root, api_sets: { workspace: true },
      ota_memory: {
        enabled: true, python_executable: pythonExecutable(), package_root: packageRoot,
        database_path: path.join(root, 'anna.sqlite3'), fixture_handles_file: handlesFile,
        project_id: 'anna-project', workspace_id: 'anna', agent_id: 'anna', user_id: 'calvin'
      }
    }]
  });
}

function pythonExecutable(): string {
  return process.env.PYTHON ?? (os.platform() === 'win32' ? 'python' : 'python3');
}

function fakeAdapter(marker: string): string {
  return [
    'import json, sys',
    'request = json.load(sys.stdin)',
    'args = request["arguments"]',
    `result = {"contract_version":"lifecycle-v1","operation":request["operation"],"request_id":args["request_id"],"status":"ok","memory_used":False,"boundary":args["scope"],"adapter_marker":${JSON.stringify(marker)},"receipt":{},"warnings":[],"errors":[]}`,
    'print(json.dumps(result))',
    ''
  ].join('\n');
}

function zodShape(schema: unknown): Record<string, unknown> {
  const source = schema as { def?: { shape?: unknown }; _def?: { shape?: unknown } };
  const shape = source.def?.shape ?? source._def?.shape;
  if (typeof shape === 'function') return shape() as Record<string, unknown>;
  return shape && typeof shape === 'object' ? shape as Record<string, unknown> : {};
}
