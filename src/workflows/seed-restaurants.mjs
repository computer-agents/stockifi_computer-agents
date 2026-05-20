import { createClient } from '../client.mjs';
import { getConfig, describeTarget } from '../config.mjs';
import { seedRestaurantsIntoDatabase } from '../database.mjs';
import { resolveRestaurantsForSeed } from '../restaurant-input.mjs';
import { loadProjectState } from '../state.mjs';
import { printHeading, printJson } from '../utils.mjs';

const config = getConfig();
const client = createClient(config);
const state = loadProjectState();
const restaurants = await resolveRestaurantsForSeed(config);

printHeading('Load Restaurant Inputs');
console.log(`ACP API target: ${describeTarget(config)}`);
console.log(`restaurant source: ${config.restaurantsFile || 'built-in sample catalog'}`);

const seeded = await seedRestaurantsIntoDatabase(client, state, restaurants, config);

printJson('loaded', seeded.map((document) => ({
  id: document.id,
  slug: document.data?.slug,
  website: document.data?.website,
  nextCheckAt: document.data?.nextCheckAt,
})));
