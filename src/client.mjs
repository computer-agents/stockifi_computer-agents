import { ComputerAgentsClient } from 'computer-agents';

import { assertRuntimeConfig } from './config.mjs';

export function createClient(config) {
  assertRuntimeConfig(config);

  return new ComputerAgentsClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout: 120_000,
  });
}
