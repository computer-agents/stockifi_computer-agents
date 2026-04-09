This skill gives the agent a direct Firecrawl scraping command inside the workspace.

Use it when the task requires fetching live website or PDF content before reasoning over it. It is especially useful for hospitality enrichment, menu source discovery, booking-system detection, and recurring change checks.

## When To Use

- You need a fresh scrape of a restaurant site, menu page, or menu PDF
- You want to classify whether the best source is HTML or PDF
- You need evidence from the live source before extraction
- You want to persist the raw scrape payload to the workspace for later comparison

## Runtime

- Script path: `/workspace/.claude/skills/stockifi-firecrawl-scraper/scripts/firecrawl-scrape.mjs`
- Requires `FIRECRAWL_API_KEY` or `FIRECRAWL_BEARER_TOKEN`
- Uses `FIRECRAWL_BASE_URL` if set, otherwise defaults to `https://api.firecrawl.dev/v2/scrape`

## Usage

Scrape one source:

```bash
node /workspace/.claude/skills/stockifi-firecrawl-scraper/scripts/firecrawl-scrape.mjs scrape --url "https://example.com/menu"
```

Scrape multiple sources in sequence:

```bash
node /workspace/.claude/skills/stockifi-firecrawl-scraper/scripts/firecrawl-scrape.mjs batch \
  --url "https://example.com/menu" \
  --url "https://example.com/menu.pdf"
```

Save to a known file path:

```bash
node /workspace/.claude/skills/stockifi-firecrawl-scraper/scripts/firecrawl-scrape.mjs scrape \
  --url "https://example.com/menu" \
  --output "/workspace/restaurant-runs/jw/menu-source.json"
```

## Process

1. Scrape the obvious HTML discovery page first.
2. Scrape any linked PDF menus or embedded reservation targets next.
3. Inspect the printed `outputPath` and `markdownExcerpt`.
4. If needed, open the saved JSON file for the full Firecrawl payload.
5. Base extraction and classification on the scraped evidence, not guesses.

## Output

Each command prints one or more JSON records prefixed with:

`FIRECRAWL_SKILL_RESULT::`

Each result includes:
- `ok`
- `mode`
- `sourceUrl`
- `finalUrl`
- `contentType`
- `statusCode`
- `outputPath`
- `markdownExcerpt`

The full Firecrawl payload is written to disk so later steps can compare or reuse it.
