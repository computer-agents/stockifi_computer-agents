import { getRecurringRefreshScheduleDefinition } from '../blueprint.mjs';
import { createClient } from '../client.mjs';
import { getConfig, describeTarget } from '../config.mjs';
import { ensureSchedule } from '../reconcile.mjs';
import { loadProjectState } from '../state.mjs';
import { printHeading, printJson } from '../utils.mjs';

const config = getConfig();
const client = createClient(config);
const state = loadProjectState();

let environment = state.environment;
if (!environment?.id) {
  environment = (await client.environments.list()).find((item) => item.name === config.environmentName);
}

let coordinatorAgent = state.agents?.coordinator;
if (!coordinatorAgent?.id) {
  coordinatorAgent = (await client.agents.list()).find((item) => item.name === 'Stockifi Pipeline Coordinator');
}

if (!environment?.id || !coordinatorAgent?.id) {
  throw new Error('Bootstrap state missing or ACP objects not found. Run `npm run bootstrap` first.');
}

printHeading('Create Change Monitor Schedule');
console.log(`ACP API target: ${describeTarget(config)}`);

const schedule = await ensureSchedule(
  client,
  config,
  getRecurringRefreshScheduleDefinition(
    config,
    { id: environment.id, name: environment.name },
    { id: coordinatorAgent.id, name: coordinatorAgent.name },
  ),
);

printJson('schedule', schedule);
