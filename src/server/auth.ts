import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config/schema.js';

export function isAuthorized(config: AppConfig, req: IncomingMessage): boolean {
  const auth = config.server.auth;
  if (!auth.enabled) return true;
  if (auth.allow_loopback_without_auth && isLoopback(req.socket.remoteAddress)) return true;

  const expected = process.env[auth.bearer_token_env];
  if (!expected) return false;
  return tokenMatches(bearerToken(req), expected);
}

export function assertSafeHttpBind(config: AppConfig): void {
  if (isLoopback(config.server.host) || config.server.auth.enabled) return;
  throw new Error('refusing to bind HTTP MCP on a non-loopback host without server.auth.enabled');
}

export function authStartupWarning(config: AppConfig): string | null {
  const auth = config.server.auth;
  if (!auth.enabled || process.env[auth.bearer_token_env]) return null;
  return `HTTP bearer auth is enabled but ${auth.bearer_token_env} is not set`;
}

export function authError(config: AppConfig): { error: string; detail: string } {
  const env = config.server.auth.bearer_token_env;
  if (!process.env[env]) return { error: 'unauthorized', detail: `missing ${env}` };
  return { error: 'unauthorized', detail: 'invalid bearer token' };
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

function tokenMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
