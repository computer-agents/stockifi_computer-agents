import { createClient } from '../client.mjs';
import { getConfig, describeTarget } from '../config.mjs';
import { listDueRestaurants, persistBatchRunResults } from '../database.mjs';
import { getRestaurantFixture } from '../fixtures/restaurants.mjs';
import { buildBatchEnrichmentPrompt } from '../prompts.mjs';
import { loadProjectState, saveProjectState } from '../state.mjs';
import { extractJsonPayload, printHeading, printJson, summarizeEventItem } from '../utils.mjs';

const config = getConfig();
const client = createClient(config);
const state = loadProjectState();

async function resolveEnvironment() {
  if (state.environment?.id) {
    try {
      return await client.environments.get(state.environment.id);
    } catch {}
  }

  const environments = await client.environments.list();
  return (
    environments.find((item) => item.name === config.environmentName) ||
    environments.find((item) => item.name === 'Default') ||
    null
  );
}

async function resolveCoordinatorAgent() {
  if (state.agents?.coordinator?.id) {
    try {
      return await client.agents.get(state.agents.coordinator.id);
    } catch {}
  }

  return (await client.agents.list()).find((item) => item.name === 'Stockifi Pipeline Coordinator') || null;
}

async function resolveBatchRestaurants() {
  if (config.batchRestaurantSlugs.length > 0) {
    return config.batchRestaurantSlugs.map((slug) => getRestaurantFixture(slug));
  }

  const dueRestaurants = await listDueRestaurants(client, state, config, config.batchSize);
  if (dueRestaurants.length > 0) {
    return dueRestaurants;
  }

  return [getRestaurantFixture(config.restaurantSlug)];
}

const environment = await resolveEnvironment();
const coordinatorAgent = await resolveCoordinatorAgent();

if (!environment?.id || !coordinatorAgent?.id) {
  throw new Error('Bootstrap state missing or ACP objects not found. Run `npm run bootstrap` first.');
}

const restaurants = await resolveBatchRestaurants();
if (restaurants.length === 0) {
  throw new Error('No restaurants available for this batch. Load restaurant inputs into the workflow database first.');
}

const batchId = `stockifi-batch-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;
const title = `Stockifi batch | ${restaurants.length} restaurants | ${batchId}`;
const prompt = buildBatchEnrichmentPrompt(restaurants, {
  batchId,
  cadenceNote: `This run is cost-optimized for batches of up to ${config.batchSize} restaurant websites.`,
});

printHeading('Run Batch');
console.log(`ACP API target: ${describeTarget(config)}`);
printJson('thread', {
  environmentId: environment.id,
  agentId: coordinatorAgent.id,
  title,
});
printJson('restaurants', restaurants);

const thread = await client.threads.create({
  environmentId: environment.id,
  agentId: coordinatorAgent.id,
  title,
});
console.log(`created thread ${thread.id}`);

const result = await client.threads.sendMessage(thread.id, {
  content: prompt,
  internetAccess: true,
  envVars: {
    FIRECRAWL_BASE_URL: config.firecrawlBaseUrl || 'https://api.firecrawl.dev/v2/scrape',
    FIRECRAWL_API_KEY: config.firecrawlApiKey || '',
    FIRECRAWL_BEARER_TOKEN: config.firecrawlBearerToken || config.firecrawlApiKey || '',
    LOCAL_MODEL_BASE_URL: config.localModelBaseUrl || '',
    STOCKIFI_BATCH_ID: batchId,
    STOCKIFI_BATCH_SIZE: String(config.batchSize),
    STOCKIFI_DATABASE_ID: state.database?.id || '',
    STOCKIFI_COLLECTION_RESTAURANTS: state.database?.collections?.restaurants?.id || '',
    STOCKIFI_COLLECTION_MENU_SNAPSHOTS: state.database?.collections?.menuSnapshots?.id || '',
    STOCKIFI_COLLECTION_CHANGE_EVENTS: state.database?.collections?.changeEvents?.id || '',
    STOCKIFI_COLLECTION_BATCH_RUNS: state.database?.collections?.batchRuns?.id || '',
  },
  onEvent: (event) => {
    if (event.type === 'response.item.completed') {
      console.log(`[event] ${summarizeEventItem(event.item)}`);
      return;
    }
    if (event.type === 'response.completed') {
      console.log('[event] response.completed');
      return;
    }
    if (event.type === 'stream.completed') {
      console.log('[event] stream.completed');
    }
  },
});

let rawOutput = result.content?.trim() || '';
if (!rawOutput) {
  const messages = await client.threads.getMessages(thread.id);
  const lastAssistantMessage = [...messages.data].reverse().find((message) => message.role === 'assistant');
  rawOutput = String(lastAssistantMessage?.content ?? '').trim();
}

printHeading('Final Response');
console.log(rawOutput);

const parsed = extractJsonPayload(rawOutput);
const summary = await persistBatchRunResults(
  client,
  state,
  config,
  {
    batchId,
    threadId: thread.id,
    title,
    restaurants,
  },
  parsed,
  rawOutput,
);

const nextState = {
  ...state,
  updatedAt: new Date().toISOString(),
  lastBatchRun: {
    batchId,
    threadId: thread.id,
    title,
    summary,
  },
};

saveProjectState(nextState);

printHeading('Persistence Summary');
printJson('summary', summary);
