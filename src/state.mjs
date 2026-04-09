import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dirname, '..', '.stockifi-workflow-state.json');

export function loadProjectState() {
  if (!existsSync(STATE_FILE)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${STATE_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function saveProjectState(state) {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function getStateFilePath() {
  return STATE_FILE;
}

export const loadDemoState = loadProjectState;
export const saveDemoState = saveProjectState;
