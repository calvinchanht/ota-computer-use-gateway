import type { IncomingMessage } from 'node:http';

export class RequestBodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super('payload_too_large');
    this.name = 'RequestBodyTooLargeError';
  }
}

export async function readBoundedJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
