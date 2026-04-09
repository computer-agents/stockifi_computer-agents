import { createClient } from '../client.mjs';
import { getConfig, describeTarget } from '../config.mjs';
import { printHeading, printJson } from '../utils.mjs';

const config = getConfig();
const client = createClient(config);

printHeading('Stockifi Workflow Doctor');
console.log(`ACP API target: ${describeTarget(config)}`);

const [environments, agents, resources, orchestrations, schedules, databases] = await Promise.all([
  client.environments.list({ limit: 5 }),
  client.agents.list(),
  client.resources.list({ limit: 5 }),
  client.orchestrations.list({ limit: 5 }),
  client.schedules.list({ limit: 5 }),
  client.databases.list(),
]);

printJson('workspaceSummary', {
  environmentCount: environments.length,
  agentCount: agents.length,
  resourceCount: resources.length,
  orchestrationCount: orchestrations.length,
  scheduleCount: schedules.length,
  databaseCount: databases.length,
});

printJson('integrationFlags', {
  platformUrl: config.platformUrl,
  firecrawlBaseUrlConfigured: Boolean(config.firecrawlBaseUrl),
  firecrawlMcpUrlConfigured: Boolean(config.firecrawlMcpUrl),
  firecrawlApiKeyConfigured: Boolean(config.firecrawlApiKey),
  localModelBaseUrlConfigured: Boolean(config.localModelBaseUrl),
});
