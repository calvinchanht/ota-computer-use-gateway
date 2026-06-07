import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installShutdownHooks } from '../src/server/shutdown.js';

describe('HTTP graceful shutdown', () => {
  afterEach(() => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('closes the HTTP server and MCP transport once', async () => {
    const server = createServer().listen(0);
    const transport = { close: vi.fn(async () => undefined) };
    const logger = { error: vi.fn() };
    const hooks = installShutdownHooks(server, transport, logger);

    await hooks.onSignal('SIGTERM');
    await hooks.onSignal('SIGTERM');

    expect(hooks.signals).toEqual(['SIGINT', 'SIGTERM']);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Received SIGTERM; shutting down HTTP API server...');
  });
});
