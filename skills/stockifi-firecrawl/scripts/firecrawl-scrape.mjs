import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = argv.slice(2);
  const mode = args[0] && !args[0].startsWith('--') ? args.shift() : 'scrape';
  const options = {
    mode,
    urls: [],
    format: 'markdown',
    onlyMainContent: true,
    timeoutMs: 120_000,
    output: '',
    maxExcerptChars: 1400,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];
    if (token === '--url' && next) {
      options.urls.push(next);
      index += 1;
      continue;
    }
    if (token === '--format' && next) {
      options.format = next;
      index += 1;
      continue;
    }
    if (token === '--output' && next) {
      options.output = next;
      index += 1;
      continue;
    }
    if (token === '--timeout-ms' && next) {
      options.timeoutMs = Number.parseInt(next, 10) || options.timeoutMs;
      index += 1;
      continue;
    }
    if (token === '--max-excerpt-chars' && next) {
      options.maxExcerptChars = Number.parseInt(next, 10) || options.maxExcerptChars;
      index += 1;
      continue;
    }
    if (token === '--main-only' && next) {
      options.onlyMainContent = next !== 'false';
      index += 1;
      continue;
    }
  }

  if (options.urls.length === 0) {
    throw new Error('At least one --url is required.');
  }

  if (!['scrape', 'batch'].includes(options.mode)) {
    throw new Error('Mode must be "scrape" or "batch".');
  }

  return options;
}

function resolveEndpoint() {
  const baseUrl = (
    process.env.FIRECRAWL_BASE_URL
    || process.env.STOCKIFI_FIRECRAWL_BASE_URL
    || 'https://api.firecrawl.dev/v2/scrape'
  ).trim();

  if (baseUrl.endsWith('/v2/scrape')) {
    return baseUrl;
  }

  return `${baseUrl.replace(/\/+$/, '')}/v2/scrape`;
}

function resolveAuthToken() {
  const token = (
    process.env.FIRECRAWL_BEARER_TOKEN
    || process.env.FIRECRAWL_API_KEY
    || process.env.STOCKIFI_FIRECRAWL_BEARER_TOKEN
    || process.env.STOCKIFI_FIRECRAWL_API_KEY
    || ''
  ).trim();

  if (!token) {
    throw new Error('FIRECRAWL_API_KEY or FIRECRAWL_BEARER_TOKEN is required.');
  }

  return token;
}

function slugify(value) {
  return String(value || 'scrape')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'scrape';
}

function summarizeMarkdown(markdown, maxChars) {
  const normalized = String(markdown || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

async function scrapeUrl(endpoint, token, options, url, outputOverride = '') {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'stockifi-firecrawl-skill/0.1',
    },
    body: JSON.stringify({
      url,
      formats: [options.format],
      onlyMainContent: options.onlyMainContent,
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const message = payload?.error || payload?.message || `Firecrawl request failed with status ${response.status}`;
    throw new Error(message);
  }

  const outputPath = outputOverride
    ? resolve(outputOverride)
    : resolve('/workspace/tmp/firecrawl', `${slugify(url)}.json`);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const data = payload?.data || {};
  return {
    ok: true,
    sourceUrl: url,
    finalUrl: data.metadata?.url || data.metadata?.sourceURL || url,
    contentType: data.metadata?.contentType || null,
    statusCode: data.metadata?.statusCode || null,
    creditsUsed: data.metadata?.creditsUsed || null,
    outputPath,
    markdownExcerpt: summarizeMarkdown(data.markdown, options.maxExcerptChars),
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const endpoint = resolveEndpoint();
  const token = resolveAuthToken();
  const results = [];

  for (const [index, url] of options.urls.entries()) {
    const outputOverride = options.mode === 'scrape' && options.output && index === 0 ? options.output : '';
    try {
      const result = await scrapeUrl(endpoint, token, options, url, outputOverride);
      results.push({
        mode: options.mode,
        endpoint,
        ...result,
      });
    } catch (error) {
      results.push({
        ok: false,
        mode: options.mode,
        endpoint,
        sourceUrl: url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const result of results) {
    process.stdout.write(`FIRECRAWL_SKILL_RESULT::${JSON.stringify(result)}\n`);
  }

  if (results.some((result) => result.ok === false)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`FIRECRAWL_SKILL_RESULT::${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
