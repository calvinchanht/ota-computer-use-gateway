import type { AppConfig } from '../config/schema.js';

export type HealthPayload = {
  ok: true;
  service: 'ota-computer-use-gateway';
  transport: 'http';
  mcp_path: '/mcp';
  uptime_seconds: number;
  auth_required: boolean;
  rate_limit_enabled: boolean;
  max_request_bytes: number;
};

export function healthPayload(config: AppConfig, startedAt: number): HealthPayload {
  return {
    ok: true,
    service: 'ota-computer-use-gateway',
    transport: 'http',
    mcp_path: '/mcp',
    uptime_seconds: uptimeSeconds(startedAt),
    auth_required: config.server.auth.enabled,
    rate_limit_enabled: config.server.rate_limit.enabled,
    max_request_bytes: config.security.max_request_bytes
  };
}

function uptimeSeconds(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}
