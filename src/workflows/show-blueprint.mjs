import { getAgentBlueprints, getEnvironmentDefinition, getResourceDefinitions } from '../blueprint.mjs';
import { getConfig, describeTarget } from '../config.mjs';
import { getDatabaseCollectionDefinitions, getDatabaseDefinition } from '../database.mjs';
import { loadRestaurantCatalog } from '../restaurant-input.mjs';
import { batchEnrichmentSchema, menuExtractionSchema } from '../schema.mjs';
import { printHeading, printJson } from '../utils.mjs';

const config = getConfig();
const restaurantCatalog = await loadRestaurantCatalog(config);

function redactEnvironmentDefinition(environmentDefinition) {
  return {
    ...environmentDefinition,
    secrets: Array.isArray(environmentDefinition?.secrets)
      ? environmentDefinition.secrets.map((secret) => ({
          ...secret,
          value: secret?.value ? '<redacted>' : '',
        }))
      : [],
  };
}

printHeading('Stockifi Shared Workflow Repository');
console.log(`ACP API target: ${describeTarget(config)}`);
console.log(`Execution environment override: ${config.existingEnvironmentId || 'none'}`);
console.log(`Firecrawl configured: ${config.firecrawlBaseUrl ? 'yes' : 'no'}`);
console.log(`Target batch size: ${config.batchSize}`);
console.log(`Restaurant catalog source: ${config.restaurantsFile || 'built-in sample catalog'}`);

printHeading('Environment');
printJson('environment', redactEnvironmentDefinition(getEnvironmentDefinition(config)));

printHeading('Database');
printJson('database', getDatabaseDefinition(config));
printJson('collections', getDatabaseCollectionDefinitions(config));

printHeading('Optional External Resources');
printJson('resources', getResourceDefinitions(config));

printHeading('Agents');
printJson('agents', getAgentBlueprints(config));

printHeading('Sample Restaurants');
printJson('restaurants', restaurantCatalog);

printHeading('Structured Output Shape');
printJson('menuExtractionSchema', menuExtractionSchema);
printJson('batchEnrichmentSchema', batchEnrichmentSchema);

printHeading('Suggested Order');
console.log('1. npm run bootstrap');
console.log('2. npm run seed:restaurants');
console.log('3. npm run run:batch');
console.log('4. npm run estimate:pricing');
console.log('5. npm run schedule:refresh');
