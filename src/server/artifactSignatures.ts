import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const DEFAULT_ARTIFACT_URL_TTL_SECONDS = 1800;
const MAX_ARTIFACT_URL_TTL_SECONDS = 86400;

export function signedArtifactUrl(base: string, urlPath: string, ttlSeconds = DEFAULT_ARTIFACT_URL_TTL_SECONDS): string {
  const cleanBase = base.replace(/\/$/, '');
  const secret = artifactSigningSecret();
  if (!secret) return `${cleanBase}${urlPath}`;
  const expires = String(Math.floor(Date.now() / 1000) + boundedTtl(ttlSeconds));
  const sig = artifactSignature(urlPath, expires, secret);
  const joiner = urlPath.includes('?') ? '&' : '?';
  return `${cleanBase}${urlPath}${joiner}expires=${encodeURIComponent(expires)}&sig=${encodeURIComponent(sig)}`;
}

export function hasValidArtifactSignature(req: IncomingMessage): boolean {
  const secret = artifactSigningSecret();
  if (!secret) return false;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const expires = url.searchParams.get('expires') ?? '';
  const sig = url.searchParams.get('sig') ?? '';
  if (!expires || !sig) return false;
  const expiry = Number(expires);
  if (!Number.isInteger(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = artifactSignature(url.pathname, expires, secret);
  return safeEqual(sig, expected);
}

function artifactSigningSecret(): string {
  return process.env.OTA_GATEWAY_ARTIFACT_URL_SECRET || process.env.OTA_GATEWAY_BEARER_TOKEN || '';
}

function artifactSignature(pathname: string, expires: string, secret: string): string {
  return createHmac('sha256', secret).update(`${pathname}\n${expires}`).digest('base64url');
}

function boundedTtl(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_ARTIFACT_URL_TTL_SECONDS;
  return Math.min(Math.floor(value), MAX_ARTIFACT_URL_TTL_SECONDS);
}

function safeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
