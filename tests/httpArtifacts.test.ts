import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/schema.js';
import { signedArtifactUrl } from '../src/server/artifactSignatures.js';
import { createHttpRequestHandler } from '../src/server/http.js';
import { fileSymlinksSupported } from './support/symlinkCapabilities.js';

const roots: string[] = [];

afterEach(async () => {
  delete process.env.OTA_GATEWAY_ARTIFACT_URL_SECRET;
  delete process.env.TEST_BEARER;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('HTTP signed artifact serving', () => {
  it('serves a signed regular artifact without bearer auth', async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, '.agent', 'artifacts', 'safe.txt'), 'safe artifact');
    const server = createServer(createHttpRequestHandler(config(root)));
    await listen(server);
    try {
      const response = await fetch(signed(server, '.agent/artifacts/safe.txt'));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('safe artifact');
    } finally { await close(server); }
  });

  it.skipIf(!fileSymlinksSupported())('rejects a signed artifact symlink that escapes the artifact root', async () => {
    const root = await fixtureRoot();
    const outside = join(root, 'outside.txt');
    await writeFile(outside, 'outside secret');
    await symlink(outside, join(root, '.agent', 'artifacts', 'escape.txt'));
    const server = createServer(createHttpRequestHandler(config(root)));
    await listen(server);
    try {
      const response = await fetch(signed(server, '.agent/artifacts/escape.txt'));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'artifact_path_not_allowed' });
    } finally { await close(server); }
  });

  it('rejects a symlinked artifacts root even when the signed target exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ota-artifact-root-'));
    roots.push(root);
    await mkdir(join(root, '.agent'), { recursive: true });
    const outside = join(root, 'outside-artifacts');
    await mkdir(outside);
    await writeFile(join(outside, 'escape.txt'), 'outside secret');
    await symlink(outside, join(root, '.agent', 'artifacts'), 'junction');
    const server = createServer(createHttpRequestHandler(config(root)));
    await listen(server);
    try {
      const response = await fetch(signed(server, '.agent/artifacts/escape.txt'));
      expect(response.status).toBe(403);
    } finally { await close(server); }
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ota-artifact-'));
  roots.push(root);
  await mkdir(join(root, '.agent', 'artifacts'), { recursive: true });
  return root;
}

function config(root: string): AppConfig {
  process.env.OTA_GATEWAY_ARTIFACT_URL_SECRET = 'artifact-test-secret';
  process.env.TEST_BEARER = 'bearer-test-secret';
  return {
    server: {
      host: '127.0.0.1', port: 8765,
      auth: { enabled: true, bearer_token_env: 'TEST_BEARER', allow_loopback_without_auth: false },
      rate_limit: { enabled: false, window_ms: 60000, max_requests: 120, trust_proxy_headers: false },
      tool_annotations: { mode: 'honest' }, exposed_tools: []
    },
    workspaces: [{ id: 'test', name: 'Test', root }],
    security: { max_file_bytes: 1024 * 1024, max_response_bytes: 1024 * 1024, max_request_bytes: 10000, max_search_results: 10, max_exec_ms: 120000 }
  };
}

function signed(server: Server, artifactPath: string): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const urlPath = `/api/v1/artifacts/test/${encodeURIComponent(artifactPath)}`;
  return signedArtifactUrl(base, urlPath, 60);
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
