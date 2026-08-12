import type { IncomingMessage, ServerResponse } from 'node:http';

export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = headerValue(req.headers.origin);
  if (!origin || !allowedOrigin(origin)) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', appendVary(res.getHeader('vary'), 'Origin'));
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,idempotency-key,mcp-session-id,mcp-protocol-version,x-openai-conversation-id,x-openai-project-id,x-openai-gpt-id,x-openai-action-invocation-id');
  res.setHeader('access-control-expose-headers', 'mcp-session-id');
}

function allowedOrigin(origin: string): boolean {
  const configured = (process.env.OTA_CORS_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (configured.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) return false;
    if (url.protocol === 'https:' && (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com')) return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

function appendVary(existing: string | number | string[] | undefined, value: string): string {
  const values = (Array.isArray(existing) ? existing : existing === undefined ? [] : [String(existing)])
    .flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) values.push(value);
  return values.join(', ');
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
