import { createHash } from 'node:crypto';
import http from 'node:http';

const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';
const MENU_URL_PATTERN =
  /(menu|meny|mat|food|order|bestill|takeaway|lunsj|dinner|middag|selskapsmeny|catering|wolt|foodora|agiorder|gloriafood)/i;
const PDF_PATTERN = /\.pdf(?:[?#]|$)/i;
const IMAGE_PATTERN = /\.(?:png|jpe?g|webp|avif)(?:[?#]|$)/i;
const NON_MENU_ASSET_PATTERN = /(?:\.svg(?:[?#]|$)|\/icons?\/|\/_next\/image|favicon|logo|sprite|burger-menu)/i;
const THIRD_PARTY_MENU_HOSTS = ['agiorder.no', 'foodora.no', 'wolt.com', 'gloriafood.com', 'ubereats.com'];
const OUTPUT_HEADERS = [
  'Record ID',
  'Company name',
  'Website URL',
  'Country/Region',
  'City',
  'landing_page_ok',
  'menu_candidates_count',
  'menu_candidates_urls',
  'menu pages#',
  'menu pages',
  'menu pdfs#',
  'menu pdfs',
  'menu images#',
  'menu images',
  'menu_found',
  'menu_enrichment_json',
  'proteins_on_menu',
  'dominant_protein',
  'dominant_protein_main_dish',
  'dominant_protein_main_dish_sellingprice',
  'dominant_protein_main_dish_url',
  'price_tier',
];
const PROTEIN_PATTERNS = [
  ['beef', /\b(beef|biff|entrecote|entrecôte|burger|okse|storfe|kalv)\b/i],
  ['pork', /\b(pork|svin|bacon|skinke|pepperoni|chorizo|salami)\b/i],
  ['chicken', /\b(chicken|kylling|pollo)\b/i],
  ['lamb', /\b(lamb|lam|kebab|kofta)\b/i],
  ['fish', /\b(fish|fisk|laks|salmon|tuna|tunfisk|cod|torsk|sashimi|nigiri|maki)\b/i],
  ['shellfish', /\b(shellfish|skalldyr|scampi|shrimp|reke|reker|hummer|krabbe|crab)\b/i],
  ['seafood', /\b(seafood|sjømat|sjomat)\b/i],
];

const cache = new Map();
const collectionIdCache = new Map();

let embeddedSecretPromise = null;
let runtimeSdkPromise = null;

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

async function readJson(request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return {};
  }
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function ensureHttpUrl(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

function safeUrl(value, baseUrl = '') {
  try {
    return new URL(value, baseUrl || undefined);
  } catch {
    return null;
  }
}

function hostname(value) {
  return safeUrl(value)?.hostname.replace(/^www\./, '').toLowerCase() ?? '';
}

function sameRegistrableHost(left, right) {
  const a = hostname(left);
  const b = hostname(right);
  return Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)));
}

function isAllowedThirdParty(url) {
  const host = hostname(url);
  return THIRD_PARTY_MENU_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function normalizeCandidateUrl(value, baseUrl) {
  const url = safeUrl(String(value ?? '').trim(), baseUrl);
  if (!url || !['http:', 'https:'].includes(url.protocol)) return '';
  url.hash = '';
  return url.toString();
}

function extractUrlsFromMarkdown(markdown) {
  const text = String(markdown ?? '');
  const urls = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)"'<>]+/gi)) {
    urls.push(match[0]);
  }
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    urls.push(match[1]);
  }
  return urls;
}

function flattenFirecrawlLinks(data) {
  const links = data?.data?.links ?? data?.links ?? [];
  if (!Array.isArray(links)) return [];
  return links.map((link) => (typeof link === 'string' ? link : link?.url ?? link?.href)).filter(Boolean);
}

function markdownFromScrape(data) {
  return String(data?.data?.markdown ?? data?.markdown ?? '');
}

function titleFromScrape(data) {
  return String(data?.data?.metadata?.title ?? data?.metadata?.title ?? data?.data?.title ?? data?.title ?? '');
}

function compactMarkdown(markdown, maxChars = 16_000) {
  return String(markdown ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function menuUrlScore(url, baseUrl) {
  const normalized = String(url ?? '');
  let score = 0;
  if (NON_MENU_ASSET_PATTERN.test(normalized)) score -= 10;
  if (sameRegistrableHost(normalized, baseUrl)) score += 3;
  if (isAllowedThirdParty(normalized)) score += 2;
  if (MENU_URL_PATTERN.test(normalized)) score += 4;
  if (PDF_PATTERN.test(normalized)) score += 2;
  if (IMAGE_PATTERN.test(normalized)) score += 1;
  if (/facebook|instagram|tripadvisor|linkedin|maps\.google|mailto:|tel:/i.test(normalized)) score -= 8;
  return score;
}

function menuContentScore({ url, markdown, title }) {
  const text = `${title}\n${markdown}`.slice(0, 80_000);
  let score = menuUrlScore(url, url);
  if (!PDF_PATTERN.test(url) && !IMAGE_PATTERN.test(url) && compactMarkdown(markdown, 500).length < 80) score -= 8;
  if (/meny|menu|selskapsmeny|catering|lunsj|middag|a la carte|à la carte/i.test(text)) score += 5;
  if (/(NOK|kr\.?|,-|\b\d{2,4}\s?kr\b|\b\d{2,4},00\b)/i.test(text)) score += 4;
  if (/forretter|hovedrett|dessert|sushi|pizza|burger|tandoori|salat|pasta|tapas|drikke/i.test(text)) score += 4;
  if (/allergener|allergen|gluten|melk|skalldyr|sesam|egg/i.test(text)) score += 1;
  if (/privacy policy|personvern|cookie|terms of service|job|career/i.test(text)) score -= 3;
  return score;
}

function countryCode(country) {
  const normalized = String(country ?? '').toLowerCase();
  if (normalized === 'norway' || normalized === 'no') return 'NO';
  if (normalized === 'sweden' || normalized === 'se') return 'SE';
  if (normalized === 'denmark' || normalized === 'dk') return 'DK';
  return 'US';
}

async function readEmbeddedSecret() {
  if (!embeddedSecretPromise) {
    embeddedSecretPromise = import('./stockifi-firecrawl.secrets.mjs')
      .then((module) => String(module.FIRECRAWL_API_KEY || module.default || '').trim())
      .catch(() => '');
  }
  return embeddedSecretPromise;
}

async function readRuntimeSecret(name) {
  const sdk = await getRuntimeSdk();
  if (!sdk || typeof sdk.getSecretValue !== 'function') {
    return '';
  }
  try {
    return String(await sdk.getSecretValue(name) || '').trim();
  } catch {
    return '';
  }
}

async function getRuntimeSdk() {
  if (!runtimeSdkPromise) {
    runtimeSdkPromise = import('./testbase.runtime.server.mjs').catch(() => null);
  }
  return runtimeSdkPromise;
}

async function resolveFirecrawlApiKey(request, payload) {
  return String(
    process.env.FIRECRAWL_API_KEY
      || process.env.STOCKIFI_FIRECRAWL_API_KEY
      || request.headers.get('x-firecrawl-api-key')
      || request.headers.get('x-stockifi-firecrawl-api-key')
      || payload?.firecrawlApiKey
      || await readRuntimeSecret('FIRECRAWL_API_KEY')
      || await readRuntimeSecret('STOCKIFI_FIRECRAWL_API_KEY')
      || await readEmbeddedSecret()
      || '',
  ).trim();
}

function resolveFirecrawlBaseUrl(payload) {
  const configured = String(
    payload?.firecrawlBaseUrl
      || process.env.STOCKIFI_FIRECRAWL_BASE_URL
      || process.env.FIRECRAWL_BASE_URL
      || DEFAULT_FIRECRAWL_BASE_URL,
  ).trim();
  return configured.replace(/\/scrape$/, '').replace(/\/+$/, '');
}

class FirecrawlClient {
  constructor({ apiKey, baseUrl }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async post(endpoint, payload) {
    if (!this.apiKey) {
      throw new Error('Firecrawl API key is required. Provide FIRECRAWL_API_KEY in runtime env, x-firecrawl-api-key, or firecrawlApiKey.');
    }

    const requestBody = endpoint === '/scrape'
      ? {
          url: payload.url,
          formats: payload.formats ?? ['markdown', 'links'],
          onlyMainContent: payload.onlyMainContent ?? false,
          timeout: payload.timeout ?? 30_000,
        }
      : payload;
    const cacheKey = payload.cacheKey || hash({ endpoint, requestBody });
    if (payload.cache !== false && cache.has(cacheKey)) {
      return { cacheHit: true, cacheKey, body: cache.get(cacheKey), ok: true, status: 200 };
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    if (response.ok && payload.cache !== false) {
      cache.set(cacheKey, body);
    }
    return { cacheHit: false, cacheKey, status: response.status, ok: response.ok, body };
  }

  async scrape(url, options = {}) {
    return this.post('/scrape', { ...options, url });
  }

  async search(query, options = {}) {
    return this.post('/search', {
      query,
      limit: options.limit ?? 6,
      sources: options.sources ?? ['web'],
      country: options.country,
      location: options.location,
      timeout: options.timeout ?? 45_000,
      ignoreInvalidURLs: true,
      ...(options.includeDomains ? { includeDomains: options.includeDomains } : {}),
    });
  }
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('rows must be an array');
  }
  return rows.map((row, index) => ({
    recordId: row.recordId ?? row.record_id ?? row.id ?? `row_${index + 1}`,
    companyName: row.companyName ?? row.company_name ?? row.name ?? '',
    websiteUrl: row.websiteUrl ?? row.website_url ?? row.website ?? row.url ?? '',
    city: row.city ?? '',
    country: row.country ?? '',
    ...row,
  }));
}

function documentId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || `doc_${Date.now()}`;
}

function summarizeRequestPayload(payload) {
  const copy = { ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) };
  delete copy.firecrawlApiKey;
  delete copy.apiKey;
  delete copy.token;
  delete copy.authorization;
  if (Array.isArray(copy.rows)) {
    copy.rows = copy.rows.slice(0, 50).map((row) => ({
      recordId: row?.recordId ?? row?.record_id ?? row?.id ?? null,
      companyName: row?.companyName ?? row?.company_name ?? row?.name ?? null,
      websiteUrl: row?.websiteUrl ?? row?.website_url ?? row?.website ?? row?.url ?? null,
      city: row?.city ?? null,
      country: row?.country ?? null,
    }));
  }
  return copy;
}

function compactEvidenceEntry(entry) {
  return {
    record_id: entry?.record_id ?? null,
    url: entry?.url ?? '',
    title: entry?.title ?? '',
    markdown_excerpt: compactMarkdown(entry?.markdown, 18_000),
    candidate_scores: Array.isArray(entry?.candidate_scores) ? entry.candidate_scores.slice(0, 12) : [],
  };
}

function buildPipelineArtifactMarkdown({ runId, payload, responsePayload }) {
  const rows = responsePayload?.records || responsePayload?.classification?.records || [];
  const discoveryMetrics = responsePayload?.discovery?.metrics || {};
  const classificationMetrics = responsePayload?.classification?.metrics || {};
  const extractionRecords = responsePayload?.extraction?.records || [];
  const outcome = responsePayload?.outcome || null;
  const sourceRows = Array.isArray(payload?.rows) ? payload.rows : [];
  const found = rows.filter((record) => record?.menu_found).length;
  const lines = [
    `# Stockifi Menu Pipeline ${runId}`,
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Input rows: ${sourceRows.length}`,
    `Menus found: ${found}/${rows.length}`,
    '',
    '## Metrics',
    '',
    `- Discovery scrapes: ${Number(discoveryMetrics.direct_scrapes || 0)}`,
    `- Discovery searches: ${Number(discoveryMetrics.direct_searches || 0)}`,
    `- Classification scrapes: ${Number(classificationMetrics.direct_scrapes || 0)}`,
    `- Cache hits: ${Number(discoveryMetrics.cache_hits || 0) + Number(classificationMetrics.cache_hits || 0)}`,
    `- Structured extraction records: ${extractionRecords.length}`,
    `- Outcome rows: ${Array.isArray(outcome?.rows) ? outcome.rows.length : 0}`,
    '',
    '## Records',
    '',
  ];

  for (const record of rows) {
    lines.push(
      `### ${record.record_id}`,
      '',
      `- Website: ${record.website_url || ''}`,
      `- Menu found: ${record.menu_found ? 'yes' : 'no'}`,
      `- Menu type: ${record.menu_type || 'n/a'}`,
      `- Menu URL: ${record.menu_url || 'n/a'}`,
      `- Confidence: ${record.confidence ?? 'n/a'}`,
      '',
    );
  }

  return lines.join('\n');
}

function cleanMenuText(value) {
  return String(value ?? '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\(([^)]+)\)/g, ' ')
    .replace(/[#*_`>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePrice(raw) {
  const match = String(raw ?? '').match(/\d{2,4}(?:[,.]\d{1,2})?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0].replace(',', '.'));
  if (!Number.isFinite(value) || value < 20 || value > 2000) return null;
  return Math.round(value);
}

function inferProteins(text) {
  const proteins = [];
  for (const [protein, pattern] of PROTEIN_PATTERNS) {
    if (pattern.test(String(text ?? ''))) {
      proteins.push(protein);
    }
  }
  if (proteins.includes('shellfish') && !proteins.includes('seafood')) {
    proteins.push('seafood');
  }
  return unique(proteins);
}

function inferItemType(text) {
  if (/\b(dessert|kake|is|sorbet|brownie|tiramisu)\b/i.test(text)) return 'dessert';
  if (/\b(vin|wine|beer|øl|cocktail|drink|brus|kaffe|tea|juice)\b/i.test(text)) return 'drink';
  if (/\b(starter|forrett|snack|siderett|tilbehør|tilbehor)\b/i.test(text)) return 'starter';
  return 'main';
}

function itemNameFromPrefix(prefix) {
  const cleaned = cleanMenuText(prefix)
    .replace(/\b(?:nok|kr)\.?$/i, '')
    .replace(/(?:^| )(fra|from|kun|only)$/i, '')
    .trim();
  const pieces = cleaned
    .split(/(?:\s[-–|•]\s| {2,}|[;:])+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = pieces[pieces.length - 1] || cleaned;
  return candidate
    .replace(/^[\d.()#\-\s]+/, '')
    .replace(/\s+(?:kr|nok)$/i, '')
    .trim()
    .slice(0, 120);
}

function extractMenuItemsFromMarkdown(record) {
  const markdown = String(record?.menu_markdown_excerpt || record?.markdown || '');
  if (!record?.menu_found || !markdown.trim()) {
    return [];
  }

  const items = [];
  const seen = new Set();
  const pricePattern = /(?:kr\.?\s*)?\d{2,4}(?:[,.]\d{1,2})?\s*(?:,-|kr|nok)?/gi;
  const text = markdown.replace(/\r/g, '\n');

  for (const line of text.split(/\n+/)) {
    const compact = cleanMenuText(line);
    if (compact.length < 6) continue;
    if (/(https?:|\/\/|www\.|media\.|images?\/|thumb|\.png|\.jpe?g|\.webp|\.avif)/i.test(compact)) continue;
    if (/^\d+$/.test(compact)) continue;
    pricePattern.lastIndex = 0;
    let match;
    while ((match = pricePattern.exec(compact))) {
      if (/^0\d{2,}/.test(match[0].trim())) continue;
      const price = normalizePrice(match[0]);
      if (price == null) continue;
      const prefix = compact.slice(Math.max(0, match.index - 120), match.index);
      const suffix = compact.slice(match.index + match[0].length, match.index + match[0].length + 180);
      const name = itemNameFromPrefix(prefix);
      if (!name || name.length < 3 || /\b(menu|meny|allergen|booking|kontakt|åpning|opening|address|adresse)\b/i.test(name)) continue;
      if (/(https?:|\/\/|www\.|media\.|thumb|images?\/|\.no\b|\.com\b|\.png|\.jpe?g|\.webp|\.avif|gate \d)/i.test(name)) continue;
      const key = `${name.toLowerCase()}_${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const description = cleanMenuText(suffix).slice(0, 240);
      const proteinText = `${name} ${description}`;
      items.push({
        name,
        price,
        price_raw: match[0].trim(),
        type: inferItemType(proteinText),
        category: null,
        description,
        main_protein: inferProteins(proteinText)[0] || null,
        proteins: inferProteins(proteinText),
        source_type: record.menu_type || null,
        source_url: record.menu_url || null,
      });
      if (items.length >= 120) return items;
    }
  }

  return items;
}

function deriveStructuredFields(menuItems) {
  const mains = menuItems.filter((item) => item.type === 'main');
  const pricedMains = mains.filter((item) => Number.isFinite(Number(item.price)));
  const proteins = unique(mains.flatMap((item) => Array.isArray(item.proteins) ? item.proteins : []).filter(Boolean));
  const proteinCounts = new Map();
  for (const item of pricedMains) {
    for (const protein of Array.isArray(item.proteins) ? item.proteins : []) {
      proteinCounts.set(protein, (proteinCounts.get(protein) || 0) + 1);
    }
  }
  const sortedProteins = [...proteinCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dominantProtein = sortedProteins.length > 0 && sortedProteins[0][1] > (sortedProteins[1]?.[1] || 0)
    ? sortedProteins[0][0]
    : null;
  const representative = dominantProtein
    ? pricedMains.find((item) => Array.isArray(item.proteins) && item.proteins.includes(dominantProtein))
    : null;
  const prices = pricedMains.map((item) => Number(item.price)).sort((a, b) => a - b);
  const medianPrice = prices.length >= 3 ? prices[Math.floor(prices.length / 2)] : null;
  const priceTier = medianPrice == null
    ? null
    : medianPrice < 200
      ? 'budget'
      : medianPrice < 350
        ? 'mid-range'
        : medianPrice < 600
          ? 'premium'
          : 'fine-dining';

  return {
    proteins_on_menu: proteins,
    dominant_protein: dominantProtein,
    dominant_protein_main_dish: representative?.name || null,
    dominant_protein_main_dish_sellingprice: representative?.price ?? null,
    dominant_protein_main_dish_url: representative?.source_url || null,
    price_tier: priceTier,
    goal_b: {
      mains_count: mains.length,
      priced_mains_count: pricedMains.length,
      mains_with_protein_count: pricedMains.filter((item) => Array.isArray(item.proteins) && item.proteins.length > 0).length,
      proteins_on_menu: proteins,
      dominant_protein: dominantProtein,
      dominant_protein_main_dish: representative?.name || null,
      dominant_protein_main_dish_sellingprice: representative?.price ?? null,
      dominant_protein_main_dish_url: representative?.source_url || null,
      price_tier: priceTier,
      derivation_notes: menuItems.length ? 'Derived from function-local menu item extraction.' : null,
    },
  };
}

async function extractStructuredMenus({ previousRecords }) {
  if (!Array.isArray(previousRecords)) {
    throw new Error('previousRecords must be an array');
  }
  const records = previousRecords.map((record) => {
    const menuItems = extractMenuItemsFromMarkdown(record);
    const derived = deriveStructuredFields(menuItems);
    return {
      record_id: record.record_id,
      website_url: record.website_url,
      menu_url: record.menu_url || null,
      menu_type: record.menu_type || null,
      valid_json: true,
      extraction_method: 'function_heuristic_markdown',
      extraction_quality: menuItems.filter((item) => Number.isFinite(Number(item.price))).length >= 3 ? 'usable' : 'needs_agent_fallback',
      extraction_notes: menuItems.length
        ? `Extracted ${menuItems.length} priced-looking menu items from Firecrawl markdown.`
        : 'No reliable priced menu items extracted from Firecrawl markdown.',
      evidence_urls: record.menu_url ? [record.menu_url] : [],
      menu_items: menuItems,
      ...derived,
      needs_agent_fallback: menuItems.filter((item) => Number.isFinite(Number(item.price))).length < 3,
    };
  });
  return {
    records,
    metrics: {
      input_count: previousRecords.length,
      output_count: records.length,
      usable_count: records.filter((record) => record.extraction_quality === 'usable').length,
      fallback_count: records.filter((record) => record.needs_agent_fallback).length,
    },
  };
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toOutcomeRows({ rows, discoveryRecords, classificationRecords, extractionRecords }) {
  const discoveryById = new Map((discoveryRecords || []).map((record) => [String(record.record_id), record]));
  const classificationById = new Map((classificationRecords || []).map((record) => [String(record.record_id), record]));
  const extractionById = new Map((extractionRecords || []).map((record) => [String(record.record_id), record]));

  return normalizeRows(rows || []).map((row) => {
    const id = String(row.recordId ?? row.record_id);
    const discovery = discoveryById.get(id) || {};
    const classification = classificationById.get(id) || {};
    const extraction = extractionById.get(id) || {};
    const menuItems = Array.isArray(extraction.menu_items) ? extraction.menu_items : [];
    const derivedFields = deriveStructuredFields(menuItems);
    const proteinsOnMenu = Array.isArray(extraction.proteins_on_menu) && extraction.proteins_on_menu.length
      ? extraction.proteins_on_menu
      : derivedFields.proteins_on_menu;
    const dominantProtein = extraction.dominant_protein ?? derivedFields.dominant_protein;
    const dominantDish = extraction.dominant_protein_main_dish ?? derivedFields.dominant_protein_main_dish;
    const dominantDishPrice = extraction.dominant_protein_main_dish_sellingprice ?? derivedFields.dominant_protein_main_dish_sellingprice;
    const dominantDishUrl = extraction.dominant_protein_main_dish_url ?? derivedFields.dominant_protein_main_dish_url ?? classification.menu_url ?? '';
    const priceTier = extraction.price_tier ?? derivedFields.price_tier;
    const goalB = extraction.goal_b || {
      ...derivedFields.goal_b,
      proteins_on_menu: proteinsOnMenu,
      dominant_protein: dominantProtein,
      dominant_protein_main_dish: dominantDish,
      dominant_protein_main_dish_sellingprice: dominantDishPrice,
      dominant_protein_main_dish_url: dominantDishUrl || null,
      price_tier: priceTier,
      derivation_notes: extraction.extraction_method === 'computer_agents_thread'
        ? 'Derived from Computer Agents structured extraction.'
        : derivedFields.goal_b.derivation_notes,
    };
    const enrichmentJson = menuItems.length ? {
      status: extraction.valid_json === false ? 'invalid' : 'ok',
      extraction_method: extraction.extraction_method || null,
      extraction_quality: extraction.extraction_quality || null,
      menu_url: classification.menu_url || extraction.menu_url || null,
      style: extraction.cuisine_style || null,
      proteins: proteinsOnMenu,
      price_tier: priceTier,
      goal_b: goalB,
      mains: menuItems,
    } : null;

    return {
      'Record ID': id,
      'Company name': row.companyName ?? row.company_name ?? '',
      'Website URL': row.websiteUrl ?? row.website_url ?? '',
      'Country/Region': row.country ?? '',
      City: row.city ?? '',
      landing_page_ok: discovery.landing_page_ok === false ? 0 : discovery.landing_page_ok === true ? 1 : '',
      menu_candidates_count: discovery.menu_candidates_count ?? '',
      menu_candidates_urls: Array.isArray(discovery.menu_candidates_urls) ? discovery.menu_candidates_urls.join(' ') : '',
      'menu pages#': Array.isArray(classification.menu_pages) ? classification.menu_pages.length : '',
      'menu pages': Array.isArray(classification.menu_pages) ? classification.menu_pages.join(' ') : '',
      'menu pdfs#': Array.isArray(classification.menu_pdfs) ? classification.menu_pdfs.length : '',
      'menu pdfs': Array.isArray(classification.menu_pdfs) ? classification.menu_pdfs.join(' ') : '',
      'menu images#': Array.isArray(classification.menu_images) ? classification.menu_images.length : '',
      'menu images': Array.isArray(classification.menu_images) ? classification.menu_images.join(' ') : '',
      menu_found: classification.menu_found === true ? 1 : classification.menu_found === false ? 0 : '',
      menu_enrichment_json: enrichmentJson ? JSON.stringify(enrichmentJson) : '',
      proteins_on_menu: Array.isArray(proteinsOnMenu) ? proteinsOnMenu.join(',') : '',
      dominant_protein: dominantProtein ?? '',
      dominant_protein_main_dish: dominantDish ?? '',
      dominant_protein_main_dish_sellingprice: dominantDishPrice ?? '',
      dominant_protein_main_dish_url: dominantDishUrl ?? '',
      price_tier: priceTier ?? '',
    };
  });
}

function buildOutcomeCsv({ rows, discoveryRecords, classificationRecords, extractionRecords }) {
  const outcomeRows = toOutcomeRows({ rows, discoveryRecords, classificationRecords, extractionRecords });
  const csv = [
    OUTPUT_HEADERS.join(','),
    ...outcomeRows.map((row) => OUTPUT_HEADERS.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
  return { rows: outcomeRows, csv: `${csv}\n`, headers: OUTPUT_HEADERS };
}

async function ensureRuntimeCollection(name, description) {
  const sdk = await getRuntimeSdk();
  if (!sdk || typeof sdk.getConnectedDatabase !== 'function' || !sdk.getConnectedDatabase()) {
    return null;
  }
  if (collectionIdCache.has(name)) {
    return collectionIdCache.get(name);
  }
  if (typeof sdk.listDatabaseCollections !== 'function' || typeof sdk.createDatabaseCollection !== 'function') {
    return null;
  }

  const listed = await sdk.listDatabaseCollections();
  const collections = Array.isArray(listed?.collections) ? listed.collections : [];
  const existing = collections.find((entry) => entry?.name === name);
  if (existing?.id) {
    collectionIdCache.set(name, existing.id);
    return existing.id;
  }

  const created = await sdk.createDatabaseCollection(name, description);
  const collectionId = created?.collection?.id || created?.id || null;
  if (collectionId) {
    collectionIdCache.set(name, collectionId);
  }
  return collectionId;
}

async function putRuntimeDocument(collectionName, description, id, data) {
  const sdk = await getRuntimeSdk();
  if (!sdk || typeof sdk.putDatabaseDocument !== 'function') {
    return null;
  }
  const collectionId = await ensureRuntimeCollection(collectionName, description);
  if (!collectionId) {
    return null;
  }
  return sdk.putDatabaseDocument(collectionId, documentId(id), data && typeof data === 'object' ? data : {});
}

async function persistStockifiResult(endpoint, payload, responsePayload) {
  if (payload?.persist === false) {
    return { enabled: false, reason: 'disabled_by_request' };
  }

  try {
    const sdk = await getRuntimeSdk();
    if (!sdk || typeof sdk.getConnectedDatabase !== 'function' || !sdk.getConnectedDatabase()) {
      return { enabled: false, reason: 'no_database_binding' };
    }

    const now = new Date().toISOString();
    const runId = documentId(payload?.runId || `${endpoint}_${now}_${hash({ endpoint, payload: summarizeRequestPayload(payload) }).slice(0, 12)}`);
    const discoveryRecords = responsePayload?.discovery?.records || (endpoint === 'discover' ? responsePayload?.records : []);
    const classificationRecords = responsePayload?.classification?.records || (endpoint === 'classify' ? responsePayload?.records : []);
    const extractionRecords = responsePayload?.extraction?.records || (endpoint === 'extract' ? responsePayload?.records : []);
    const outcome = responsePayload?.outcome || (endpoint === 'outcome' ? responsePayload : null);
    const records = responsePayload?.records || classificationRecords || discoveryRecords || [];
    const evidence = responsePayload?.classification?.evidence || responsePayload?.evidence || [];

    await putRuntimeDocument('stockifi_runs', 'One document per Firecrawl router request or pipeline run.', runId, {
      run_id: runId,
      endpoint,
      object: responsePayload?.object || null,
      created_at: now,
      request: summarizeRequestPayload(payload),
      summary: {
        input_rows: Array.isArray(payload?.rows) ? payload.rows.length : 0,
        discovery_records: Array.isArray(discoveryRecords) ? discoveryRecords.length : 0,
        classification_records: Array.isArray(classificationRecords) ? classificationRecords.length : 0,
        extraction_records: Array.isArray(extractionRecords) ? extractionRecords.length : 0,
        outcome_rows: Array.isArray(outcome?.rows) ? outcome.rows.length : 0,
        records: Array.isArray(records) ? records.length : 0,
        menus_found: Array.isArray(records) ? records.filter((record) => record?.menu_found).length : 0,
      },
      metrics: {
        scrape: responsePayload?.cacheKey ? {
          cache_key: responsePayload.cacheKey,
          cache_hit: Boolean(responsePayload.cacheHit),
          status: responsePayload.status ?? null,
        } : null,
        discovery: responsePayload?.discovery?.metrics || (endpoint === 'discover' ? responsePayload?.metrics : null),
        classification: responsePayload?.classification?.metrics || (endpoint === 'classify' ? responsePayload?.metrics : null),
        extraction: responsePayload?.extraction?.metrics || (endpoint === 'extract' ? responsePayload?.metrics : null),
      },
    });

    for (const record of Array.isArray(discoveryRecords) ? discoveryRecords : []) {
      await putRuntimeDocument('stockifi_discovery_records', 'Menu entrypoint discovery records keyed by run and restaurant.', `${runId}_${record?.record_id}`, {
        run_id: runId,
        created_at: now,
        ...record,
      });
    }

    for (const record of Array.isArray(classificationRecords) ? classificationRecords : []) {
      await putRuntimeDocument('stockifi_classification_records', 'Classified menu source records keyed by run and restaurant.', `${runId}_${record?.record_id}`, {
        run_id: runId,
        created_at: now,
        ...record,
      });
    }

    for (const entry of Array.isArray(evidence) ? evidence : []) {
      await putRuntimeDocument('stockifi_evidence', 'Compact selected evidence and candidate scores for review/debugging.', `${runId}_${entry?.record_id}`, {
        run_id: runId,
        created_at: now,
        ...compactEvidenceEntry(entry),
      });
    }

    for (const record of Array.isArray(extractionRecords) ? extractionRecords : []) {
      await putRuntimeDocument('stockifi_menu_extractions', 'Structured menu extraction records keyed by run and restaurant.', `${runId}_${record?.record_id}`, {
        run_id: runId,
        created_at: now,
        ...record,
      });

      for (const [index, item] of (Array.isArray(record?.menu_items) ? record.menu_items : []).entries()) {
        await putRuntimeDocument('stockifi_menu_items', 'Flattened structured menu items keyed by run, restaurant, and item index.', `${runId}_${record?.record_id}_${index + 1}`, {
          run_id: runId,
          created_at: now,
          record_id: record?.record_id ?? null,
          website_url: record?.website_url ?? null,
          menu_url: record?.menu_url ?? null,
          item_index: index + 1,
          ...item,
        });
      }
    }

    if (outcome?.csv) {
      await putRuntimeDocument('stockifi_outcomes', 'Generated Stockifi outcome CSV artifacts and row summaries.', `${runId}_outcome`, {
        run_id: runId,
        created_at: now,
        kind: 'csv',
        mime_type: 'text/csv',
        headers: outcome.headers || OUTPUT_HEADERS,
        row_count: Array.isArray(outcome.rows) ? outcome.rows.length : 0,
        csv: outcome.csv,
      });
    }

    if (endpoint === 'scrape') {
      await putRuntimeDocument('stockifi_scrapes', 'Compact scrape responses and cache metadata.', runId, {
        run_id: runId,
        created_at: now,
        url: payload?.url || null,
        cache_key: responsePayload?.cacheKey || null,
        cache_hit: Boolean(responsePayload?.cacheHit),
        status: responsePayload?.status ?? null,
        ok: Boolean(responsePayload?.ok),
        title: titleFromScrape(responsePayload?.body),
        markdown_excerpt: compactMarkdown(markdownFromScrape(responsePayload?.body), 18_000),
      });
    }

    if (endpoint === 'pipeline' && payload?.storeArtifacts !== false) {
      await putRuntimeDocument('stockifi_artifacts', 'Human-readable markdown/JSON artifacts generated from runs.', `${runId}_summary`, {
        run_id: runId,
        created_at: now,
        kind: 'markdown',
        mime_type: 'text/markdown',
        path: `stockifi/menu-pipelines/${runId}/summary.md`,
        content: buildPipelineArtifactMarkdown({ runId, payload, responsePayload }),
      });
    }

    return {
      enabled: true,
      runId,
      collections: [
        'stockifi_runs',
        'stockifi_discovery_records',
        'stockifi_classification_records',
        'stockifi_menu_extractions',
        'stockifi_menu_items',
        'stockifi_evidence',
        'stockifi_scrapes',
        'stockifi_artifacts',
        'stockifi_outcomes',
      ],
    };
  } catch (error) {
    return {
      enabled: false,
      reason: 'persist_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function discoverMenus({ rows, firecrawl }) {
  const records = [];
  const metrics = { direct_scrapes: 0, direct_searches: 0, cache_hits: 0, errors: [] };

  for (const row of normalizeRows(rows)) {
    const websiteUrl = ensureHttpUrl(row.websiteUrl ?? row.website_url);
    const baseHost = hostname(websiteUrl);
    let landingPageOk = false;
    const rawCandidates = [];
    const evidenceUrls = [];

    if (websiteUrl) {
      try {
        const scraped = await firecrawl.scrape(websiteUrl, { formats: ['markdown', 'links'], onlyMainContent: false });
        metrics.direct_scrapes += scraped.cacheHit ? 0 : 1;
        metrics.cache_hits += scraped.cacheHit ? 1 : 0;
        landingPageOk = Boolean(scraped.body?.success ?? scraped.ok);
        evidenceUrls.push(websiteUrl);
        rawCandidates.push(...flattenFirecrawlLinks(scraped.body));
        rawCandidates.push(...extractUrlsFromMarkdown(markdownFromScrape(scraped.body)));
      } catch (error) {
        metrics.errors.push({ record_id: row.recordId, stage: 'landing_scrape', message: error.message });
      }
    }

    try {
      const queryParts = [row.companyName, row.city, row.country, 'menu OR meny'].filter(Boolean);
      const search = await firecrawl.search(queryParts.join(' '), {
        country: countryCode(row.country),
        limit: 8,
      });
      metrics.direct_searches += search.cacheHit ? 0 : 1;
      metrics.cache_hits += search.cacheHit ? 1 : 0;
      for (const result of search.body?.data?.web ?? []) {
        rawCandidates.push(result.url);
        if (result.url) evidenceUrls.push(result.url);
      }
    } catch (error) {
      metrics.errors.push({ record_id: row.recordId, stage: 'menu_search', message: error.message });
    }

    const candidates = unique(
      rawCandidates
        .map((url) => normalizeCandidateUrl(url, websiteUrl))
        .filter((url) => !NON_MENU_ASSET_PATTERN.test(url))
        .filter((url) => url && (sameRegistrableHost(url, websiteUrl) || isAllowedThirdParty(url)))
        .map((url) => ({ url, score: menuUrlScore(url, websiteUrl) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.url),
    ).slice(0, 8);

    records.push({
      record_id: row.recordId,
      website_url: websiteUrl,
      landing_page_ok: landingPageOk,
      menu_candidates_urls: candidates,
      menu_candidates_count: candidates.length,
      evidence_urls: unique(evidenceUrls).slice(0, 12),
      confidence: candidates.length > 0 ? 0.82 : 0.35,
      needs_agent_fallback: candidates.length === 0,
      direct_firecrawl: true,
      base_host: baseHost,
    });
  }

  return { records, metrics };
}

async function classifySources({ previousRecords, firecrawl, includeEvidence = true }) {
  if (!Array.isArray(previousRecords)) {
    throw new Error('previousRecords must be an array');
  }
  const records = [];
  const evidence = [];
  const metrics = { direct_scrapes: 0, cache_hits: 0, errors: [] };

  for (const record of previousRecords) {
    const candidates = Array.isArray(record.menu_candidates_urls) ? record.menu_candidates_urls.slice(0, 6) : [];
    const scored = [];

    for (const candidate of candidates) {
      let scraped = null;
      let markdown = '';
      let title = '';
      try {
        scraped = await firecrawl.scrape(candidate, { formats: ['markdown', 'links'], onlyMainContent: false });
        metrics.direct_scrapes += scraped.cacheHit ? 0 : 1;
        metrics.cache_hits += scraped.cacheHit ? 1 : 0;
        markdown = markdownFromScrape(scraped.body);
        title = titleFromScrape(scraped.body);
      } catch (error) {
        metrics.errors.push({ record_id: record.record_id, url: candidate, message: error.message });
      }

      scored.push({
        url: candidate,
        score: menuContentScore({ url: candidate, markdown, title }),
        type: PDF_PATTERN.test(candidate) ? 'pdf' : IMAGE_PATTERN.test(candidate) ? 'image' : 'md',
        title,
        markdown,
        cacheKey: scraped?.cacheKey ?? null,
      });
    }

    const markdownCandidate = scored
      .filter((item) => item.type === 'md')
      .filter((item) => compactMarkdown(item.markdown, 500).length >= 80)
      .sort((a, b) => b.score - a.score)
      .find((item) => item.score >= 7);
    const pdfCandidate = scored
      .filter((item) => item.type === 'pdf')
      .sort((a, b) => b.score - a.score)[0];
    const imageCandidate = scored
      .filter((item) => item.type === 'image')
      .sort((a, b) => b.score - a.score)[0];
    const selected = markdownCandidate ?? pdfCandidate ?? imageCandidate ?? scored.sort((a, b) => b.score - a.score)[0];
    const menuFound = Boolean(selected && selected.score >= 4);

    if (selected && includeEvidence) {
      evidence.push({
        record_id: record.record_id,
        url: selected.url,
        title: selected.title,
        markdown: selected.markdown,
        candidate_scores: scored.map((item) => ({
          url: item.url,
          score: item.score,
          type: item.type,
          title: item.title,
        })),
      });
    }

    records.push({
      record_id: record.record_id,
      website_url: record.website_url,
      menu_found: menuFound,
      menu_type: menuFound ? selected.type : null,
      menu_url: menuFound ? selected.url : null,
      menu_pages: menuFound && selected.type === 'md' ? [selected.url] : [],
      menu_pdfs: unique([
        ...(menuFound && selected.type === 'pdf' ? [selected.url] : []),
        ...candidates.filter((url) => PDF_PATTERN.test(url)),
      ]),
      menu_images: unique([
        ...(menuFound && selected.type === 'image' ? [selected.url] : []),
        ...candidates.filter((url) => IMAGE_PATTERN.test(url)),
      ]),
      cascade_stopped_at: menuFound ? selected.type : null,
      confidence: menuFound ? Math.min(0.98, Math.max(0.55, selected.score / 14)) : 0.25,
      evidence: menuFound
        ? `Direct Firecrawl selected ${selected.url} with score ${selected.score}.`
        : 'Direct Firecrawl could not identify a reliable menu candidate.',
      menu_markdown_excerpt: menuFound ? compactMarkdown(selected.markdown, 18_000) : '',
      direct_firecrawl: true,
      needs_agent_fallback: !menuFound || !selected?.markdown,
    });
  }

  return { records, evidence, metrics };
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const payload = await readJson(request);

    if (request.method === 'GET' && url.pathname === '/health') {
      const sdk = await getRuntimeSdk();
      const connectedDatabase = sdk && typeof sdk.getConnectedDatabase === 'function' ? sdk.getConnectedDatabase() : null;
      return json({
        ok: true,
        service: 'stockifi-firecrawl-router',
        endpoints: ['/scrape', '/discover', '/classify', '/extract', '/outcome', '/pipeline'],
        cacheEntries: cache.size,
        persistence: {
          databaseConnected: Boolean(connectedDatabase),
          databaseName: connectedDatabase?.name || null,
        },
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    const firecrawl = new FirecrawlClient({
      apiKey: await resolveFirecrawlApiKey(request, payload),
      baseUrl: resolveFirecrawlBaseUrl(payload),
    });

    if (url.pathname === '/scrape') {
      if (!payload.url) {
        return json({ error: 'url is required' }, 400);
      }
      const result = await firecrawl.scrape(payload.url, payload);
      const persistence = result.ok ? await persistStockifiResult('scrape', payload, result) : { enabled: false, reason: 'scrape_failed' };
      return json({ ...result, persistence }, result.ok ? 200 : 502);
    }

    if (url.pathname === '/discover') {
      const result = await discoverMenus({ rows: payload.rows, firecrawl });
      const responsePayload = { ...result, object: 'stockifi.menu_discovery' };
      const persistence = await persistStockifiResult('discover', payload, responsePayload);
      return json({ ...responsePayload, persistence });
    }

    if (url.pathname === '/classify') {
      const result = await classifySources({
        previousRecords: payload.previousRecords ?? payload.records,
        firecrawl,
        includeEvidence: payload.includeEvidence !== false,
      });
      const responsePayload = { ...result, object: 'stockifi.menu_classification' };
      const persistence = await persistStockifiResult('classify', payload, responsePayload);
      return json({ ...responsePayload, persistence });
    }

    if (url.pathname === '/extract') {
      const result = await extractStructuredMenus({
        previousRecords: payload.previousRecords ?? payload.records,
      });
      const responsePayload = { ...result, object: 'stockifi.menu_extractions' };
      const persistence = await persistStockifiResult('extract', payload, responsePayload);
      return json({ ...responsePayload, persistence });
    }

    if (url.pathname === '/outcome') {
      const outcome = buildOutcomeCsv({
        rows: payload.rows,
        discoveryRecords: payload.discoveryRecords ?? payload.discovery?.records ?? [],
        classificationRecords: payload.classificationRecords ?? payload.classification?.records ?? payload.records ?? [],
        extractionRecords: payload.extractionRecords ?? payload.extraction?.records ?? [],
      });
      const responsePayload = { ...outcome, object: 'stockifi.outcome_csv' };
      const persistence = await persistStockifiResult('outcome', payload, responsePayload);
      return json({ ...responsePayload, persistence });
    }

    if (url.pathname === '/pipeline') {
      const discovery = await discoverMenus({ rows: payload.rows, firecrawl });
      const classification = await classifySources({
        previousRecords: discovery.records,
        firecrawl,
        includeEvidence: payload.includeEvidence !== false,
      });
      const extraction = payload.extractStructured || payload.buildOutcome
        ? await extractStructuredMenus({
          previousRecords: classification.records.filter((record) => record?.menu_found),
        })
        : null;
      const outcome = payload.buildOutcome
        ? buildOutcomeCsv({
          rows: payload.rows,
          discoveryRecords: discovery.records,
          classificationRecords: classification.records,
          extractionRecords: extraction?.records || [],
        })
        : null;
      const responsePayload = {
        object: 'stockifi.menu_pipeline',
        discovery,
        classification,
        ...(extraction ? { extraction } : {}),
        ...(outcome ? { outcome } : {}),
        records: classification.records,
      };
      const persistence = await persistStockifiResult('pipeline', payload, responsePayload);
      return json({ ...responsePayload, persistence });
    }

    return json({ error: 'not_found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

async function requestFromNode(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const host = req.headers.host || 'localhost';
  const init = {
    method: req.method || 'GET',
    headers: req.headers,
  };
  if (!['GET', 'HEAD'].includes(init.method)) {
    init.body = body;
    init.duplex = 'half';
  }
  return new Request(`http://${host}${req.url || '/'}`, init);
}

function sendNodeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  response.arrayBuffer()
    .then((buffer) => res.end(Buffer.from(buffer)))
    .catch((error) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const server = http.createServer(async (req, res) => {
    try {
      const response = await handler(await requestFromNode(req));
      sendNodeResponse(res, response);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  server.listen(port, () => {
    console.log(`stockifi-firecrawl-router listening on :${port}`);
  });
}
