import {
  getAgentBlueprints,
  getEnvironmentDefinition,
  getOrchestrationDefinition,
  getRecurringRefreshScheduleDefinition,
  getResourceDefinitions,
} from '../blueprint.mjs';
import { createClient } from '../client.mjs';
import { getConfig, describeTarget } from '../config.mjs';
import { getDatabaseCollectionDefinitions, getDatabaseDefinition } from '../database.mjs';
import {
  ensureAgent,
  ensureDatabase,
  ensureDatabaseCollection,
  ensureEnvironment,
  ensureOrchestration,
  ensureResource,
  ensureSchedule,
} from '../reconcile.mjs';
import { ensureStockifiSkills } from '../skills.mjs';
import { loadProjectState, saveProjectState } from '../state.mjs';
import { printHeading, printJson } from '../utils.mjs';

async function ensureEnvironmentReady(client, environmentId) {
  const initialStatus = await client.environments.getBuildStatus(environmentId);
  let buildStatus = initialStatus.buildStatus ?? 'pending';

  if (buildStatus !== 'ready') {
    printHeading('Build Environment');
    console.log(`triggering build for ${environmentId} (current status: ${buildStatus})`);
    await client.environments.build(environmentId, false);
  }

  const startedAt = Date.now();
  const timeoutMs = 20 * 60 * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    const status = await client.environments.getBuildStatus(environmentId);
    buildStatus = status.buildStatus ?? 'pending';
    console.log(`build status: ${buildStatus}`);

    if (buildStatus === 'ready') {
      return status;
    }

    if (buildStatus === 'failed') {
      const logs = await client.environments.getBuildLogs(environmentId);
      throw new Error(`Environment build failed for ${environmentId}.\n${logs.logs ?? ''}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`Timed out waiting for environment ${environmentId} to become ready.`);
}

async function resolveExecutionEnvironment(client, config) {
  if (config.existingEnvironmentId) {
    const environment = await client.environments.get(config.existingEnvironmentId);
    printHeading(`Environment :: ${environment.name}`);
    console.log(`reusing existing environment ${environment.id}`);
    return environment;
  }

  const availableEnvironments = await client.environments.list();
  const defaultEnvironment = availableEnvironments.find((item) => item.name === 'Default');
  if (defaultEnvironment) {
    printHeading(`Environment :: ${defaultEnvironment.name}`);
    console.log(`reusing default environment ${defaultEnvironment.id} for stable workflow execution`);
    return defaultEnvironment;
  }

  const environment = await ensureEnvironment(client, config, getEnvironmentDefinition(config));
  await ensureEnvironmentReady(client, environment.id);
  return environment;
}

const config = getConfig();
const client = createClient(config);
const previousState = loadProjectState();

printHeading('Bootstrap Stockifi Workflow');
console.log(`ACP API target: ${describeTarget(config)}`);

const environment = await resolveExecutionEnvironment(client, config);

const database = await ensureDatabase(client, config, getDatabaseDefinition(config));
const databaseCollections = {};
for (const collectionDefinition of getDatabaseCollectionDefinitions(config)) {
  const collection = await ensureDatabaseCollection(client, database.id, collectionDefinition);
  databaseCollections[collectionDefinition.key] = {
    id: collection.id,
    name: collection.name,
  };
}

const resources = {};
for (const resourceDefinition of getResourceDefinitions(config)) {
  const resource = await ensureResource(client, config, resourceDefinition);
  resources[resourceDefinition.name] = {
    id: resource.id,
    name: resource.name,
    kind: resource.kind,
    serviceUrl: resource.serviceUrl ?? null,
  };
}

const skillRegistry = await ensureStockifiSkills(client, config);

const agents = {};
for (const agentDefinition of getAgentBlueprints(config, skillRegistry.skillIds)) {
  const agent = await ensureAgent(client, config, agentDefinition);
  agents[agentDefinition.key] = {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    description: agent.description ?? null,
    enabledSkills: agent.enabledSkills || [],
  };
}

const orchestration = await ensureOrchestration(
  client,
  config,
  getOrchestrationDefinition(
    environment.id,
    Object.fromEntries(
      Object.entries(agents).map(([key, value]) => [key, { id: value.id }]),
    ),
  ),
);

const schedule = await ensureSchedule(
  client,
  config,
  getRecurringRefreshScheduleDefinition(
    config,
    { id: environment.id, name: environment.name },
    { id: agents.coordinator.id, name: agents.coordinator.name },
  ),
);

const state = {
  ...previousState,
  updatedAt: new Date().toISOString(),
  environment: {
    id: environment.id,
    name: environment.name,
  },
  database: {
    id: database.id,
    name: database.name,
    collections: databaseCollections,
  },
  resources,
  skills: {
    custom: Object.fromEntries(
      Object.entries(skillRegistry.custom).map(([key, skill]) => [
        key,
        {
          id: skill.id,
          name: skill.name,
        },
      ]),
    ),
    system: Object.fromEntries(
      Object.entries(skillRegistry.system)
        .filter(([, skill]) => skill?.id)
        .map(([key, skill]) => [
          key,
          {
            id: skill.id,
            name: skill.name,
          },
        ]),
    ),
  },
  agents,
  orchestration: {
    id: orchestration.id,
    name: orchestration.name,
    strategy: orchestration.strategy,
  },
  schedule: {
    id: schedule.id,
    name: schedule.name,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
  },
};

saveProjectState(state);

printHeading('Bootstrap Summary');
printJson('state', state);
