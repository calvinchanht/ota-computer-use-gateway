import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configPathFromArg, loadConfig } from './config/load.js';
import { createServer } from './server/create.js';
import { listenHttp } from './server/http.js';

async function main(): Promise<void> {
  const config = await loadConfig(configPathFromArg(process.argv));
  if (transportMode(process.argv) === 'http') return listenHttp(config);

  const server = await createServer(config);
  await server.connect(new StdioServerTransport());
}

function transportMode(argv: string[]): 'stdio' | 'http' {
  const flag = argv.findIndex((item) => item === '--transport');
  return argv[flag + 1] === 'http' ? 'http' : 'stdio';
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
