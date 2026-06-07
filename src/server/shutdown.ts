import type { Server } from 'node:http';

type Closeable = { close(): Promise<void> };
type Logger = Pick<typeof console, 'error'>;

export type ShutdownHooks = {
  signals: NodeJS.Signals[];
  onSignal(signal: NodeJS.Signals): Promise<void>;
};

export function installShutdownHooks(server: Server, transport?: Closeable, logger: Logger = console): ShutdownHooks {
  let closing = false;
  const onSignal = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.error(`Received ${signal}; shutting down HTTP API server...`);
    await closeHttpServer(server);
    if (transport) await transport.close();
  };

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) process.once(signal, () => void onSignal(signal));
  return { signals, onSignal };
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
