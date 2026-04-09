import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const STOCKIFI_CUSTOM_SKILLS = [
  {
    key: 'firecrawl',
    slug: 'stockifi-firecrawl',
    name: 'Stockifi Firecrawl Scraper',
    description: 'Live Firecrawl scraping skill for hospitality source discovery, menu fetching, and evidence capture.',
    icon: 'cloud',
  },
  {
    key: 'visualInspector',
    slug: 'stockifi-visual-menu-inspector',
    name: 'Stockifi Visual Menu Inspector',
    description: 'Browser-first playbook for photo menus, scanned menu cards, and image-heavy hospitality sites.',
    icon: 'camera',
  },
];

const STOCKIFI_SYSTEM_SKILLS = {
  browser: 'Browser',
};

function languageForFile(filename) {
  const extension = extname(filename).toLowerCase();
  if (extension === '.mjs' || extension === '.js') {
    return 'javascript';
  }
  if (extension === '.py') {
    return 'python';
  }
  if (extension === '.sh') {
    return 'bash';
  }
  if (extension === '.json') {
    return 'json';
  }
  return 'text';
}

async function loadSkillFiles(skillDir) {
  const scriptsDir = resolve(skillDir, 'scripts');
  let entries = [];

  try {
    entries = await readdir(scriptsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const content = await readFile(resolve(scriptsDir, entry.name), 'utf8');
    files.push({
      name: entry.name,
      content,
      language: languageForFile(entry.name),
    });
  }

  return files;
}

async function loadCustomSkillDefinition(spec) {
  const skillDir = resolve(REPO_ROOT, 'skills', spec.slug);
  const markdown = await readFile(resolve(skillDir, 'SKILL.md'), 'utf8');
  const files = await loadSkillFiles(skillDir);

  return {
    name: spec.name,
    description: spec.description,
    markdown,
    files,
    icon: spec.icon,
    category: 'custom',
    isActive: true,
  };
}

async function requestSkillsApi(config, pathname = '', init = {}) {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/v1/skills${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Skills API failed with status ${response.status}`);
  }

  return payload;
}

async function listPlaygroundSkills(config) {
  if (!config.platformUrl) {
    return [];
  }

  const response = await fetch(`${config.platformUrl.replace(/\/$/, '')}/api/playground/custom-skills`, {
    method: 'GET',
    headers: {
      'x-api-key': config.apiKey,
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return [];
  }

  return Array.isArray(payload?.skills) ? payload.skills : [];
}

async function listActiveSkills(config) {
  const payload = await requestSkillsApi(config, '?isActive=true');
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function listAllVisibleSkills(config) {
  const [customSkills, playgroundSkills] = await Promise.all([
    listActiveSkills(config),
    listPlaygroundSkills(config),
  ]);

  const merged = new Map();
  for (const skill of [...customSkills, ...playgroundSkills]) {
    if (skill?.id) {
      merged.set(skill.id, skill);
    }
  }
  return Array.from(merged.values());
}

export async function ensureCustomSkill(config, spec) {
  const definition = await loadCustomSkillDefinition(spec);
  const existingSkills = await listActiveSkills(config);
  const existing = existingSkills.find((skill) => skill.name === spec.name);

  if (existing?.id) {
    const payload = await requestSkillsApi(config, `/${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(definition),
    });
    return payload.skill;
  }

  const payload = await requestSkillsApi(config, '', {
    method: 'POST',
    body: JSON.stringify(definition),
  });
  return payload.skill;
}

export async function ensureStockifiSkills(client, config) {
  const custom = {};
  for (const spec of STOCKIFI_CUSTOM_SKILLS) {
    custom[spec.key] = await ensureCustomSkill(config, spec);
  }

  const allSkills = await listAllVisibleSkills(config);
  const system = Object.fromEntries(
    Object.entries(STOCKIFI_SYSTEM_SKILLS).map(([key, name]) => [
      key,
      allSkills.find((skill) => skill.name === name) || null,
    ]),
  );

  const browserAndScrapeSkillIds = [
    system.browser?.id,
    custom.visualInspector?.id,
    custom.firecrawl?.id,
  ].filter(Boolean);

  return {
    custom,
    system,
    skillIds: {
      coordinator: browserAndScrapeSkillIds,
      discovery: browserAndScrapeSkillIds,
      classifier: browserAndScrapeSkillIds,
      extractor: browserAndScrapeSkillIds,
      changeDetector: [],
      outreach: [],
    },
  };
}
