import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config/schema.js';

type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(config: AppConfig, req: IncomingMessage, now = Date.now()): boolean {
    const policy = config.server.rate_limit;
    if (!policy.enabled) return true;

    const key = clientKey(req, policy.trust_proxy_headers);
    const bucket = this.currentBucket(key, policy.window_ms, now);
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return bucket.count <= policy.max_requests;
  }

  private currentBucket(key: string, windowMs: number, now: number): Bucket {
    const existing = this.buckets.get(key);
    if (existing && existing.resetAt > now) return existing;
    return { count: 0, resetAt: now + windowMs };
  }
}

export function clientKey(req: IncomingMessage, trustProxyHeaders = false): string {
  if (trustProxyHeaders) return proxyClientKey(req) ?? socketClientKey(req);
  return socketClientKey(req);
}

function proxyClientKey(req: IncomingMessage): string | null {
  return firstHeader(req.headers['cf-connecting-ip']) ?? firstForwardedFor(req.headers['x-forwarded-for']);
}

function socketClientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

function firstForwardedFor(value: string | string[] | undefined): string | null {
  const first = firstHeader(value)?.split(',')[0]?.trim();
  return first || null;
}

function firstHeader(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}
