import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const statePath = resolve(repoRoot, '.stockifi-cloud-state.json');

loadDotEnv(resolve(repoRoot, '.env'));

const setupFirecrawl = readBoolean(process.env.STOCKIFI_SETUP_FIRECRAWL_FUNCTION, true);
const setupOrchestrator = readBoolean(process.env.STOCKIFI_SETUP_ORCHESTRATOR_FUNCTION, true);

const state = {
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  firecrawl: null,
  orchestrator: null,
  nextEnv: {},
};

if (!process.env.COMPUTER_AGENTS_API_KEY) {
  throw new Error('COMPUTER_AGENTS_API_KEY is required. Copy .env.example to .env and add the customer API key first.');
}

if (setupFirecrawl) {
  const result = runScript('create-firecrawl-function.mjs', process.env);
  state.firecrawl = result;
  Object.assign(state.nextEnv, result.nextEnv || {});
  Object.assign(process.env, result.nextEnv || {});
}

if (setupOrchestrator) {
  const result = runScript('create-orchestrator-function.mjs', process.env);
  state.orchestrator = result;
  Object.assign(state.nextEnv, result.nextEnv || {});
  Object.assign(process.env, result.nextEnv || {});
}

state.updatedAt = new Date().toISOString();
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

console.log('\nStockifi cloud setup complete.');
console.log(`State written to ${statePath}`);
console.log('\nAdd these values to .env for later reruns:');
for (const [key, value] of Object.entries(state.nextEnv)) {
  console.log(`${key}=${value ?? ''}`);
}

function runScript(fileName, env) {
  console.log(`\n=== ${fileName} ===`);
  const child = spawnSync(process.execPath, [resolve(scriptDir, fileName)], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });

  if (child.stdout) {
    process.stdout.write(child.stdout);
  }
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }
  if (child.status !== 0) {
    throw new Error(`${fileName} failed with exit code ${child.status ?? 'unknown'}.`);
  }

  return parseLastJsonObject(child.stdout);
}

function parseLastJsonObject(output) {
  const text = String(output || '').trim();
  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    try {
      return JSON.parse(text.slice(index));
    } catch {}
  }
  throw new Error('Could not find a JSON summary in setup script output.');
}

function readBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(String(value))) return true;
  if (/^(0|false|no|off)$/i.test(String(value))) return false;
  return fallback;
}

function loadDotEnv(path) {
  if (!existsSync(path)) {
    return;
  }
  const content = String(readFileSync(path, 'utf8'));
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2');
  }
}
