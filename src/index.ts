import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configPathFromArg, loadConfig } from './config/load.js';
import { createServer } from './server/create.js';

async function main(): Promise<void> {
  const config = await loadConfig(configPathFromArg(process.argv));
  const server = await createServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
