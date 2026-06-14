import { describe, expect, it, afterEach } from 'vitest';
import { hasValidArtifactSignature, signedArtifactUrl } from '../src/server/artifactSignatures.js';

describe('signed artifact URLs', () => {
  afterEach(() => {
    delete process.env.OTA_GATEWAY_ARTIFACT_URL_SECRET;
    delete process.env.OTA_GATEWAY_BEARER_TOKEN;
  });

  it('signs artifact URLs and validates the request without bearer auth', () => {
    process.env.OTA_GATEWAY_ARTIFACT_URL_SECRET = 'artifact-secret';
    const url = signedArtifactUrl('https://boba-api.unrealize.com', '/api/v1/artifacts/boba/.agent%2Fartifacts%2Fscreenshots%2Fscreen.webp', 60);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('expires')).toBeTruthy();
    expect(parsed.searchParams.get('sig')).toBeTruthy();
    expect(hasValidArtifactSignature({ url: `${parsed.pathname}${parsed.search}` } as never)).toBe(true);
  });

  it('rejects tampered or expired signatures', () => {
    process.env.OTA_GATEWAY_ARTIFACT_URL_SECRET = 'artifact-secret';
    const url = signedArtifactUrl('https://boba-api.unrealize.com', '/api/v1/artifacts/boba/.agent%2Fartifacts%2Fscreenshots%2Fscreen.webp', 60);
    const parsed = new URL(url);
    parsed.pathname = '/api/v1/artifacts/boba/.agent%2Fartifacts%2Fscreenshots%2Fother.webp';
    expect(hasValidArtifactSignature({ url: `${parsed.pathname}${parsed.search}` } as never)).toBe(false);

    const expired = new URL(url);
    expired.searchParams.set('expires', '1');
    expect(hasValidArtifactSignature({ url: `${expired.pathname}${expired.search}` } as never)).toBe(false);
  });

  it('falls back to bearer token as signing secret when a dedicated artifact secret is not configured', () => {
    process.env.OTA_GATEWAY_BEARER_TOKEN = 'bearer-as-secret';
    const url = signedArtifactUrl('https://boba-api.unrealize.com', '/api/v1/artifacts/boba/.agent%2Fartifacts%2Fscreenshots%2Fscreen.webp', 60);
    const parsed = new URL(url);
    expect(hasValidArtifactSignature({ url: `${parsed.pathname}${parsed.search}` } as never)).toBe(true);
  });
});
