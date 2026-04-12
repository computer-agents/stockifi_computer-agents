import './load-env.mjs';

import process from 'node:process';

function readInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getConfig() {
  return {
    apiKey: process.env.COMPUTER_AGENTS_API_KEY ?? '',
    baseUrl: process.env.COMPUTER_AGENTS_BASE_URL ?? 'https://api.computer-agents.com',
    platformUrl: process.env.STOCKIFI_PLATFORM_URL ?? 'https://platform.computer-agents.com',
    environmentName: process.env.STOCKIFI_ENVIRONMENT_NAME ?? 'stockifi-hospitality-pipeline',
    existingEnvironmentId: process.env.STOCKIFI_EXISTING_ENVIRONMENT_ID ?? '',
    computeProfile: process.env.STOCKIFI_COMPUTE_PROFILE ?? 'standard',
    databaseName: process.env.STOCKIFI_DATABASE_NAME ?? 'stockifi-hospitality-intelligence',
    batchSize: readInteger(process.env.STOCKIFI_BATCH_SIZE, 5),
    passesPerMonth: readInteger(process.env.STOCKIFI_PASSES_PER_MONTH, 2),
    scheduleCron: process.env.STOCKIFI_SCHEDULE_CRON ?? '0 4 1,15 * *',
    timezone: process.env.STOCKIFI_TIMEZONE ?? 'Europe/Berlin',
    restaurantSlug: process.env.STOCKIFI_RESTAURANT_SLUG ?? 'casa-lucia-berlin',
    batchRestaurantSlugs: readList(process.env.STOCKIFI_BATCH_RESTAURANT_SLUGS),
    restaurantsFile: process.env.STOCKIFI_RESTAURANTS_FILE ?? '',
    firecrawlMcpUrl: process.env.STOCKIFI_FIRECRAWL_MCP_URL ?? '',
    firecrawlBearerToken: process.env.STOCKIFI_FIRECRAWL_BEARER_TOKEN ?? '',
    firecrawlBaseUrl: process.env.STOCKIFI_FIRECRAWL_BASE_URL ?? '',
    firecrawlApiKey: process.env.STOCKIFI_FIRECRAWL_API_KEY ?? '',
    localModelBaseUrl: process.env.STOCKIFI_LOCAL_MODEL_BASE_URL ?? '',
    collectionNames: {
      restaurants: process.env.STOCKIFI_COLLECTION_RESTAURANTS ?? 'restaurants',
      menuSnapshots: process.env.STOCKIFI_COLLECTION_MENU_SNAPSHOTS ?? 'menuSnapshots',
      changeEvents: process.env.STOCKIFI_COLLECTION_CHANGE_EVENTS ?? 'changeEvents',
      batchRuns: process.env.STOCKIFI_COLLECTION_BATCH_RUNS ?? 'batchRuns',
    },
    models: {
      discovery: process.env.STOCKIFI_DISCOVERY_MODEL ?? 'claude-haiku-4-5',
      classifier: process.env.STOCKIFI_CLASSIFIER_MODEL ?? 'claude-haiku-4-5',
      extraction: process.env.STOCKIFI_EXTRACTION_MODEL ?? 'claude-haiku-4-5',
      changeDetection: process.env.STOCKIFI_CHANGE_DETECTION_MODEL ?? 'claude-haiku-4-5',
      outreach: process.env.STOCKIFI_OUTREACH_MODEL ?? 'claude-haiku-4-5',
      coordinator: process.env.STOCKIFI_COORDINATOR_MODEL ?? 'claude-haiku-4-5',
    },
  };
}

export function assertRuntimeConfig(config) {
  if (!config.apiKey) {
    throw new Error('COMPUTER_AGENTS_API_KEY is required. Add it to .env before running the workflow.');
  }
}

export function describeTarget(config) {
  return config.baseUrl;
}
