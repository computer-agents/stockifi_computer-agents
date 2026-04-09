import { createClient } from '../client.mjs';
import { getConfig, describeTarget } from '../config.mjs';
import { ensureStockifiSkills } from '../skills.mjs';
import { loadProjectState, saveProjectState } from '../state.mjs';
import { printHeading, printJson } from '../utils.mjs';

const config = getConfig();
const client = createClient(config);
const state = loadProjectState();

printHeading('Install Stockifi Skills');
console.log(`ACP API target: ${describeTarget(config)}`);

const skillRegistry = await ensureStockifiSkills(client, config);

const nextState = {
  ...state,
  updatedAt: new Date().toISOString(),
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
};

saveProjectState(nextState);

printHeading('Installed Skills');
printJson('custom', nextState.skills.custom);
printJson('system', nextState.skills.system);
