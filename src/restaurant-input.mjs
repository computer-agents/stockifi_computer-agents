import { readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { restaurantFixtures } from './fixtures/restaurants.mjs';
import { slugify } from './utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildRestaurantSlug(record) {
  if (record.slug) {
    return slugify(record.slug);
  }
  if (record.name) {
    return slugify(record.name);
  }
  return slugify(record.website || `restaurant-${Math.random().toString(36).slice(2, 8)}`);
}

function normalizeRestaurantRecord(record) {
  const website = String(record.website || '').trim();
  if (!website) {
    throw new Error(`Restaurant record is missing website: ${JSON.stringify(record)}`);
  }

  return {
    slug: buildRestaurantSlug(record),
    name: String(record.name || record.slug || website).trim(),
    website,
    city: String(record.city || '').trim(),
    country: String(record.country || '').trim(),
    bookingUrl: String(record.bookingUrl || '').trim() || null,
    knownMenuUrls: normalizeList(record.knownMenuUrls),
    notes: normalizeList(record.notes),
  };
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }
    if (char === ',' && !insideQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const record = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? '';
    });
    return record;
  });
}

async function readRestaurantFile(filePath) {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(REPO_ROOT, filePath);
  const extension = extname(absolutePath).toLowerCase();
  const content = await readFile(absolutePath, 'utf8');

  if (extension === '.json') {
    const payload = JSON.parse(content);
    return Array.isArray(payload) ? payload : payload.restaurants || [];
  }

  if (extension === '.jsonl') {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  if (extension === '.csv') {
    return parseCsv(content);
  }

  throw new Error(`Unsupported restaurant file format: ${extension || 'unknown'}`);
}

export async function loadRestaurantCatalog(config) {
  if (!config.restaurantsFile) {
    return restaurantFixtures;
  }

  const records = await readRestaurantFile(config.restaurantsFile);
  return records.map((record) => normalizeRestaurantRecord(record));
}

export async function resolveRestaurantsForSeed(config) {
  return loadRestaurantCatalog(config);
}
