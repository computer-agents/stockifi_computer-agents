import process from 'node:process';

function resolveScrapeUrl(baseUrl) {
  const trimmed = (baseUrl || '').trim();
  if (!trimmed) {
    throw new Error('STOCKIFI_FIRECRAWL_BASE_URL is required for live scrape runs.');
  }

  if (trimmed.endsWith('/v2/scrape')) {
    return trimmed;
  }

  return `${trimmed.replace(/\/+$/, '')}/v2/scrape`;
}

function buildHeaders(config) {
  const apiKey = config.firecrawlBearerToken || config.firecrawlApiKey;
  if (!apiKey) {
    throw new Error('A Firecrawl API key or bearer token is required.');
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'stockifi-workflow/0.2',
  };
}

function summarizeMarkdown(markdown, maxChars = 3200) {
  const normalized = String(markdown || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}...`;
}

export async function scrapeSourceWithFirecrawl(config, url) {
  const endpoint = resolveScrapeUrl(config.firecrawlBaseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const message = payload?.error || payload?.message || `Firecrawl scrape failed with status ${response.status}`;
    throw new Error(message);
  }

  const data = payload?.data || {};
  return {
    sourceUrl: url,
    finalUrl: data.metadata?.url || data.metadata?.sourceURL || url,
    title: data.metadata?.title || null,
    contentType: data.metadata?.contentType || null,
    statusCode: data.metadata?.statusCode || null,
    creditsUsed: data.metadata?.creditsUsed || null,
    markdownExcerpt: summarizeMarkdown(data.markdown),
  };
}

export async function scrapeRestaurantSources(config, restaurant, log = console.log) {
  const evidence = [];

  for (const url of restaurant.knownMenuUrls || []) {
    log(`firecrawl scraping ${url}`);
    try {
      const result = await scrapeSourceWithFirecrawl(config, url);
      evidence.push({
        ok: true,
        ...result,
      });
      log(
        `firecrawl ok ${url} [${result.contentType || 'unknown'}] ${result.statusCode || 'n/a'}`
      );
    } catch (error) {
      evidence.push({
        ok: false,
        sourceUrl: url,
        error: error instanceof Error ? error.message : String(error),
      });
      log(`firecrawl failed ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    scrapedAt: new Date().toISOString(),
    usedEndpoint: resolveScrapeUrl(config.firecrawlBaseUrl),
    sources: evidence,
  };
}
