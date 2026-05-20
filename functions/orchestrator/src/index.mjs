import http from 'node:http';

const DEFAULT_COMPUTER_AGENTS_BASE_URL = 'https://api.computer-agents.com';
const DEFAULT_FIRECRAWL_FUNCTION_URL = '';
const DEFAULT_ENVIRONMENT_ID = '';
const DEFAULT_EXTRACTOR_AGENT_NAME = 'Stockifi Menu Extractor';
const DEFAULT_EXTRACTOR_MODEL = 'claude-haiku-4-5';

let runtimeSdkPromise = null;
let deployedConfigPromise = null;
const collectionIdCache = new Map();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function readJson(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function getRuntimeSdk() {
  if (!runtimeSdkPromise) {
    runtimeSdkPromise = import('./testbase.runtime.server.mjs').catch(() => null);
  }
  return runtimeSdkPromise;
}

async function getDeployedConfig() {
  if (!deployedConfigPromise) {
    deployedConfigPromise = import('./stockifi-orchestrator.config.mjs')
      .then((module) => module.default || module)
      .catch(() => ({}));
  }
  return deployedConfigPromise;
}

async function readRuntimeSecret(name) {
  const sdk = await getRuntimeSdk();
  if (!sdk || typeof sdk.getSecretValue !== 'function') return '';
  try {
    return String(await sdk.getSecretValue(name) || '').trim();
  } catch {
    return '';
  }
}

async function resolveComputerAgentsApiKey(request, payload) {
  return String(
    process.env.COMPUTER_AGENTS_API_KEY
      || request.headers.get('x-computer-agents-api-key')
      || request.headers.get('x-stockifi-api-key')
      || payload?.computerAgentsApiKey
      || await readRuntimeSecret('COMPUTER_AGENTS_API_KEY')
      || await readRuntimeSecret('STOCKIFI_COMPUTER_AGENTS_API_KEY')
      || '',
  ).trim();
}

async function authorizeRunRequest(request) {
  const expected = await readRuntimeSecret('STOCKIFI_ORCHESTRATOR_TOKEN');
  if (!expected) return true;
  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const provided = request.headers.get('x-stockifi-orchestrator-token') || bearer;
  return provided === expected;
}

function stamp() {
  return new Date().toISOString().replace(/[-:.]/g, '').replace(/T/, '_').slice(0, 16).toLowerCase();
}

function documentId(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 240) || `doc_${stamp()}`;
}

function chunk(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function toFunctionRow(row) {
  return {
    recordId: row.recordId ?? row.record_id ?? row['Record ID'],
    companyName: row.companyName ?? row.company_name ?? row['Company name'],
    websiteUrl: row.websiteUrl ?? row.website_url ?? row['Website URL'],
    country: row.country ?? row.country_region ?? row['Country/Region'],
    city: row.city ?? row.City,
  };
}

async function postJson(url, payload, options = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }
  if (!response.ok) {
    throw new Error(`POST ${url} failed (${response.status}): ${body?.message || body?.error || text.slice(0, 200)}`);
  }
  return body;
}

async function ensureRuntimeCollection(name, description) {
  const sdk = await getRuntimeSdk();
  if (!sdk || typeof sdk.getConnectedDatabase !== 'function' || !sdk.getConnectedDatabase()) return null;
  if (collectionIdCache.has(name)) return collectionIdCache.get(name);
  if (typeof sdk.listDatabaseCollections !== 'function' || typeof sdk.createDatabaseCollection !== 'function') return null;

  const listed = await sdk.listDatabaseCollections();
  const collections = Array.isArray(listed?.collections) ? listed.collections : [];
  const existing = collections.find((entry) => entry?.name === name);
  if (existing?.id) {
    collectionIdCache.set(name, existing.id);
    return existing.id;
  }

  const created = await sdk.createDatabaseCollection(name, description);
  const collectionId = created?.collection?.id || created?.id || null;
  if (collectionId) collectionIdCache.set(name, collectionId);
  return collectionId;
}

async function putRuntimeDocument(collectionName, description, id, data) {
  const sdk = await getRuntimeSdk();
  if (!sdk || typeof sdk.putDatabaseDocument !== 'function') return null;
  const collectionId = await ensureRuntimeCollection(collectionName, description);
  if (!collectionId) return null;
  return sdk.putDatabaseDocument(collectionId, documentId(id), data && typeof data === 'object' ? data : {});
}

function normalizeContent(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => normalizeContent(item?.text ?? item?.content ?? item)).filter(Boolean).join('\n').trim();
  }
  if (value && typeof value === 'object') return normalizeContent(value.text ?? value.content ?? value.value ?? '');
  return '';
}

function extractJsonPayload(text) {
  const input = String(text || '').trim();
  if (!input) return null;
  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : input;
  try {
    return JSON.parse(candidate);
  } catch {}
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {}
  }
  return null;
}

async function resolveThreadResultContent(client, threadId, result) {
  const directContent = normalizeContent(result?.content) || normalizeContent(result?.response?.content);
  if (directContent) return directContent;

  const eventContent = [...(result?.events || [])]
    .reverse()
    .map((event) => normalizeContent(event?.response?.content ?? event?.item?.content))
    .find(Boolean);
  if (eventContent) return eventContent;

  const messages = await client.threads.getMessages(threadId);
  const messageList = Array.isArray(messages) ? messages : (messages.data || messages.messages || []);
  return [...messageList]
    .reverse()
    .filter((message) => message.role === 'assistant')
    .map((message) => normalizeContent(message.content))
    .find(Boolean) || '';
}

function getAgentExtractionError(content, parsed) {
  if (parsed && typeof parsed === 'object') return null;
  const text = String(content || '').trim();
  if (!text) return 'Agent returned an empty response.';
  if (/^(Execution failed:\s*)?API Error:/i.test(text)) return text.slice(0, 500);
  if (/^Execution failed:/i.test(text)) return text.slice(0, 500);
  return 'Agent did not return parseable JSON.';
}

function normalizeAgentExtraction(parsed, classificationRecord, threadId, options = {}) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const menuItems = Array.isArray(source.menu_items) ? source.menu_items : [];
  const validJson = !options.error && source.valid_json !== false;
  return {
    record_id: source.record_id || classificationRecord.record_id,
    website_url: source.website_url || classificationRecord.website_url,
    menu_url: source.menu_url || classificationRecord.menu_url || null,
    menu_type: classificationRecord.menu_type || null,
    valid_json: validJson,
    extraction_method: 'computer_agents_thread',
    extraction_quality: options.error ? 'failed' : (menuItems.length >= 3 ? 'usable' : 'needs_review'),
    extraction_notes: source.extraction_notes || options.error || '',
    thread_id: threadId,
    agent_id: options.agentId || null,
    agent_name: options.agentName || null,
    extraction_error: options.error || null,
    evidence_urls: classificationRecord.menu_url ? [classificationRecord.menu_url] : [],
    menu_items: menuItems.map((item, index) => ({
      name: String(item?.name || '').trim(),
      price: item?.price == null || item.price === '' ? null : Number(item.price),
      price_raw: item?.price_raw ?? null,
      type: item?.type || 'other',
      category: item?.category ?? null,
      description: item?.description ?? '',
      main_protein: item?.main_protein ?? null,
      proteins: Array.isArray(item?.proteins) ? item.proteins : [],
      source_type: item?.source_type || classificationRecord.menu_type || null,
      source_url: item?.source_url || classificationRecord.menu_url || null,
      item_index: index + 1,
    })).filter((item) => item.name),
    proteins_on_menu: Array.isArray(source.proteins_on_menu) ? source.proteins_on_menu : [],
    dominant_protein: source.dominant_protein ?? null,
    dominant_protein_main_dish: source.dominant_protein_main_dish ?? null,
    dominant_protein_main_dish_sellingprice: source.dominant_protein_main_dish_sellingprice ?? null,
    dominant_protein_main_dish_url: source.dominant_protein_main_dish_url || (source.dominant_protein_main_dish ? classificationRecord.menu_url : null),
    price_tier: source.price_tier ?? null,
    needs_agent_fallback: Boolean(options.error),
  };
}

function buildExtractionPrompt(record) {
  return [
    'You are extracting structured restaurant menu data for the Stockifi validation package.',
    'Use ONLY the supplied Firecrawl menu markdown excerpt. Do not browse and do not infer dishes that are not in the text.',
    'Return JSON only, with this exact top-level shape:',
    JSON.stringify({
      record_id: record.record_id,
      website_url: record.website_url,
      menu_url: record.menu_url,
      valid_json: true,
      menu_items: [
        {
          name: 'literal dish name',
          price: 123,
          price_raw: '123,-',
          type: 'main',
          category: null,
          description: '',
          main_protein: null,
          proteins: [],
          source_type: record.menu_type || null,
          source_url: record.menu_url || null,
        },
      ],
      proteins_on_menu: [],
      dominant_protein: null,
      dominant_protein_main_dish: null,
      dominant_protein_main_dish_sellingprice: null,
      dominant_protein_main_dish_url: null,
      price_tier: null,
      extraction_notes: '',
    }, null, 2),
    '',
    'Rules:',
    '- `type` must be one of main, starter, dessert, drink, side, other.',
    '- Proteins must use only beef, pork, chicken, lamb, fish, seafood, shellfish.',
    '- Prices must be literal menu prices as numbers in NOK; use null for variable prices.',
    '- `price_tier` is budget (<200), mid-range (200-349), premium (350-599), fine-dining (>=600), or null if fewer than 3 priced mains.',
    '- If the excerpt is not a readable food menu, return `menu_items: []` and null menu-dependent fields.',
    '',
    'Classification record:',
    JSON.stringify({
      record_id: record.record_id,
      website_url: record.website_url,
      menu_url: record.menu_url,
      menu_type: record.menu_type,
      confidence: record.confidence,
    }, null, 2),
    '',
    'Menu markdown excerpt:',
    record.menu_markdown_excerpt || '',
  ].join('\n');
}

function buildExtractorAgentConfig(config) {
  return {
    description: 'Stockifi menu extraction agent. Converts supplied menu evidence into strict structured JSON for the validation pipeline.',
    model: config.extractorModel,
    reasoningEffort: 'high',
    instructions: [
      'You are the Stockifi Menu Extractor for the Computer Agents validation pipeline.',
      'Your only job is to convert supplied restaurant menu evidence into strict JSON that matches the requested schema.',
      'Use only evidence supplied in the prompt unless the prompt explicitly asks you to browse.',
      'Do not invent dishes, prices, proteins, categories, or URLs.',
      'Prices must be literal menu prices. If a price is not present, use null.',
      'Protein labels must use only beef, pork, chicken, lamb, fish, seafood, shellfish.',
      'Return JSON only. Include concise extraction_notes describing evidence quality and any uncertainty.',
    ].join('\n'),
    metadata: {
      owner: 'stockifi',
      purpose: 'menu-structured-extraction',
      managedBy: 'stockifi-orchestrator-function',
    },
  };
}

async function resolveExtractorAgentId(client, config) {
  if (config.agentId) return config.agentId;

  const agents = await client.agents.list();
  const existing = agents.find((entry) => entry.name === config.extractorAgentName);
  const agentConfig = buildExtractorAgentConfig(config);
  if (existing?.id) {
    if (
      existing.model !== agentConfig.model
      || existing.reasoningEffort !== agentConfig.reasoningEffort
      || existing.instructions !== agentConfig.instructions
    ) {
      const updated = await client.agents.update(existing.id, agentConfig);
      return updated?.id || existing.id;
    }
    return existing.id;
  }

  const created = await client.agents.create({
    ...agentConfig,
    name: config.extractorAgentName,
  });
  if (!created?.id) throw new Error('Failed to create Stockifi extractor agent.');
  return created.id;
}

async function resolveEnvironmentId(client, config) {
  if (config.environmentId) return config.environmentId;
  const environments = await client.environments.list();
  const environment = environments.find((entry) => entry.name === 'Default' || entry.isDefault) || environments[0];
  if (!environment?.id) throw new Error('No Computer Agents environment found for agent fallback.');
  return environment.id;
}

async function persistExtractionRecord(record, runId) {
  await putRuntimeDocument('stockifi_menu_extractions', 'Structured menu extraction records keyed by run and restaurant.', `${runId}_${record.record_id}`, {
    run_id: runId,
    created_at: new Date().toISOString(),
    ...record,
  });

  for (const [index, item] of record.menu_items.entries()) {
    await putRuntimeDocument('stockifi_menu_items', 'Flattened structured menu items keyed by run, restaurant, and item index.', `${runId}_${record.record_id}_${index + 1}`, {
      run_id: runId,
      created_at: new Date().toISOString(),
      record_id: record.record_id,
      website_url: record.website_url,
      menu_url: record.menu_url,
      item_index: index + 1,
      ...item,
    });
  }
}

async function runAgentFallbackStage({ client, config, runId, pipelineRecords, currentExtractionRecords }) {
  const environmentId = await resolveEnvironmentId(client, config);
  const agentId = await resolveExtractorAgentId(client, config);
  const extractionById = new Map(currentExtractionRecords.map((record) => [String(record.record_id), record]));
  const candidates = pipelineRecords.classificationRecords
    .filter((record) => record.menu_found)
    .filter((record) => config.forceAgentFallback || extractionById.get(String(record.record_id))?.needs_agent_fallback)
    .slice(0, config.agentFallbackLimit);
  const fallbackRecords = [];

  for (const record of candidates) {
    const thread = await client.threads.create({
      environmentId,
      agentId,
      title: `Stockifi extraction ${runId} ${record.record_id}`,
    });
    const result = await client.threads.sendMessage(thread.id, {
      content: buildExtractionPrompt(record),
      internetAccess: false,
      timeout: 900_000,
    });
    const content = await resolveThreadResultContent(client, thread.id, result);
    const parsed = extractJsonPayload(content);
    const extracted = normalizeAgentExtraction(parsed, record, thread.id, {
      agentId,
      agentName: config.extractorAgentName,
      error: getAgentExtractionError(content, parsed),
    });
    fallbackRecords.push(extracted);
    extractionById.set(String(record.record_id), extracted);
    await persistExtractionRecord(extracted, runId);
  }

  const merged = pipelineRecords.classificationRecords
    .filter((record) => record.menu_found)
    .map((record) => extractionById.get(String(record.record_id)))
    .filter(Boolean);

  return {
    records: merged,
    fallbackRecords,
    environmentId,
    agentId,
  };
}

async function runStockifiOrchestrator({ request, payload }) {
  const deployedConfig = await getDeployedConfig();
  const mode = payload.mode || 'all';
  if (!['all', 'pipeline', 'outcome'].includes(mode)) {
    throw new Error('mode must be one of all, pipeline, outcome.');
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length && mode !== 'outcome') {
    throw new Error('rows must be a non-empty array.');
  }

  const runId = documentId(payload.runId || `stockifi_orchestrator_${stamp()}`);
  const functionUrl = String(payload.functionUrl || deployedConfig.firecrawlFunctionUrl || process.env.STOCKIFI_FIRECRAWL_FUNCTION_URL || DEFAULT_FIRECRAWL_FUNCTION_URL).replace(/\/+$/, '');
  if (!functionUrl) {
    throw new Error('STOCKIFI_FIRECRAWL_FUNCTION_URL is required before running the orchestrator.');
  }
  const batchSize = Math.max(1, Math.min(25, Number.parseInt(payload.batchSize ?? deployedConfig.batchSize ?? 5, 10) || 5));
  const startedAt = new Date().toISOString();
  const stages = [];

  let pipelineRecords = {
    discoveryRecords: payload.discoveryRecords ?? payload.discovery?.records ?? [],
    classificationRecords: payload.classificationRecords ?? payload.classification?.records ?? payload.records ?? [],
    extractionRecords: payload.extractionRecords ?? payload.extraction?.records ?? [],
    batchRuns: [],
  };

  if (mode === 'all' || mode === 'pipeline') {
    const batches = chunk(rows.map(toFunctionRow), batchSize);
    const batchRuns = [];
    for (let index = 0; index < batches.length; index += 1) {
      const batchRunId = `${runId}_batch_${String(index + 1).padStart(3, '0')}`;
      const result = await postJson(`${functionUrl}/pipeline`, {
        runId: batchRunId,
        rows: batches[index],
        includeEvidence: payload.includeEvidence !== false,
        extractStructured: payload.extractStructured !== false,
        buildOutcome: false,
        storeArtifacts: payload.storeArtifacts !== false,
      });
      batchRuns.push({
        runId: batchRunId,
        inputCount: batches[index].length,
        discoveryRecords: result.discovery?.records || [],
        classificationRecords: result.classification?.records || result.records || [],
        extractionRecords: result.extraction?.records || [],
        persistence: result.persistence || null,
        metrics: {
          discovery: result.discovery?.metrics || null,
          classification: result.classification?.metrics || null,
          extraction: result.extraction?.metrics || null,
        },
      });
    }

    pipelineRecords = {
      discoveryRecords: batchRuns.flatMap((run) => run.discoveryRecords),
      classificationRecords: batchRuns.flatMap((run) => run.classificationRecords),
      extractionRecords: batchRuns.flatMap((run) => run.extractionRecords),
      batchRuns,
    };
    stages.push({ stage: 'pipeline', status: 'completed', batches: batchRuns.length });
  }

  let extractionRecords = pipelineRecords.extractionRecords || [];
  let agentFallback = null;
  if (mode !== 'outcome' && (payload.agentFallback || payload.forceAgentFallback)) {
    const apiKey = await resolveComputerAgentsApiKey(request, payload);
    if (!apiKey) throw new Error('COMPUTER_AGENTS_API_KEY secret or request credential is required for agent fallback.');
    const { ComputerAgentsClient } = await import('computer-agents');
    const client = new ComputerAgentsClient({
      apiKey,
      baseUrl: String(payload.baseUrl || deployedConfig.baseUrl || process.env.COMPUTER_AGENTS_BASE_URL || DEFAULT_COMPUTER_AGENTS_BASE_URL).replace(/\/+$/, ''),
      timeout: 900_000,
    });
    const fallbackConfig = {
      environmentId: payload.environmentId || deployedConfig.environmentId || process.env.STOCKIFI_ENVIRONMENT_ID || DEFAULT_ENVIRONMENT_ID,
      agentId: payload.agentId || payload.extractorAgentId || '',
      extractorAgentName: payload.agentName || payload.extractorAgentName || deployedConfig.extractorAgentName || DEFAULT_EXTRACTOR_AGENT_NAME,
      extractorModel: payload.agentModel || payload.extractorModel || deployedConfig.extractorModel || DEFAULT_EXTRACTOR_MODEL,
      forceAgentFallback: Boolean(payload.forceAgentFallback),
      agentFallbackLimit: Math.max(1, Number.parseInt(payload.agentFallbackLimit ?? deployedConfig.agentFallbackLimit ?? 3, 10) || 3),
    };
    agentFallback = await runAgentFallbackStage({
      client,
      config: fallbackConfig,
      runId,
      pipelineRecords,
      currentExtractionRecords: extractionRecords,
    });
    extractionRecords = agentFallback.records;
    stages.push({
      stage: 'agent_fallback_extraction',
      status: 'completed',
      inputCount: agentFallback.fallbackRecords.length,
      environmentId: agentFallback.environmentId,
      agentId: agentFallback.agentId,
    });
  }

  let outcome = null;
  if (mode !== 'pipeline' && payload.buildOutcome !== false) {
    outcome = await postJson(`${functionUrl}/outcome`, {
      runId: `${runId}_outcome`,
      rows: rows.map(toFunctionRow),
      discoveryRecords: pipelineRecords.discoveryRecords,
      classificationRecords: pipelineRecords.classificationRecords,
      extractionRecords,
    });
    stages.push({
      stage: 'outcome',
      status: 'completed',
      rows: Array.isArray(outcome.rows) ? outcome.rows.length : 0,
      persistence: outcome.persistence || null,
    });
  }

  const responsePayload = {
    ok: true,
    object: 'stockifi.orchestrator_run',
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    mode,
    stages,
    inputRows: rows.length,
    discoveryRecords: pipelineRecords.discoveryRecords.length,
    classificationRecords: pipelineRecords.classificationRecords.length,
    extractionRecords: extractionRecords.length,
    menusFound: pipelineRecords.classificationRecords.filter((record) => record.menu_found).length,
    agentFallbackRecords: agentFallback?.fallbackRecords?.length || 0,
    agentThreads: (agentFallback?.fallbackRecords || []).map((record) => ({
      record_id: record.record_id,
      thread_id: record.thread_id,
      extraction_quality: record.extraction_quality,
      menu_items_count: Array.isArray(record.menu_items) ? record.menu_items.length : 0,
    })),
    pipeline: payload.includeRecords === true ? pipelineRecords : undefined,
    extraction: payload.includeRecords === true ? { records: extractionRecords } : undefined,
    outcome: outcome ? {
      rows: outcome.rows,
      headers: outcome.headers,
      csv: payload.includeCsv === false ? undefined : outcome.csv,
      persistence: outcome.persistence || null,
    } : null,
  };

  await putRuntimeDocument('stockifi_orchestrator_runs', 'Top-level Stockifi orchestrator function runs.', runId, {
    ...responsePayload,
    outcome: outcome ? {
      row_count: Array.isArray(outcome.rows) ? outcome.rows.length : 0,
      csv_length: typeof outcome.csv === 'string' ? outcome.csv.length : 0,
      persistence: outcome.persistence || null,
    } : null,
  });

  return responsePayload;
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const payload = await readJson(request);

    if (request.method === 'GET' && url.pathname === '/health') {
      const deployedConfig = await getDeployedConfig();
      const sdk = await getRuntimeSdk();
      const connectedDatabase = sdk && typeof sdk.getConnectedDatabase === 'function' ? sdk.getConnectedDatabase() : null;
      return json({
        ok: true,
        service: 'stockifi-orchestrator',
        endpoints: ['/health', '/run'],
        defaults: {
          firecrawlFunctionUrl: deployedConfig.firecrawlFunctionUrl || DEFAULT_FIRECRAWL_FUNCTION_URL,
          environmentId: deployedConfig.environmentId || DEFAULT_ENVIRONMENT_ID,
          extractorAgentName: deployedConfig.extractorAgentName || DEFAULT_EXTRACTOR_AGENT_NAME,
          extractorModel: deployedConfig.extractorModel || DEFAULT_EXTRACTOR_MODEL,
        },
        persistence: {
          databaseConnected: Boolean(connectedDatabase),
          databaseName: connectedDatabase?.name || null,
        },
      });
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (url.pathname !== '/run') return json({ error: 'not_found' }, 404);
    if (!await authorizeRunRequest(request)) return json({ ok: false, error: 'unauthorized' }, 401);
    return json(await runStockifiOrchestrator({ request, payload }));
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

async function requestFromNode(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const host = req.headers.host || 'localhost';
  const init = { method: req.method || 'GET', headers: req.headers };
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
    console.log(`stockifi-orchestrator listening on :${port}`);
  });
}
