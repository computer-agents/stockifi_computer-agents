# Scaling Plan For 100k Restaurant Websites

## Target

Re-check up to `100,000` restaurant websites `2x per month` without turning ACP threads into oversized brittle jobs.

## Recommended Operating Model

Do not treat one ACP thread as the unit for `1000+` restaurants.

Instead:

1. maintain the website catalog in the ACP database
2. select due restaurants in micro-batches
3. enqueue batches externally
4. run many ACP threads in parallel
5. persist results after each batch

## Why Micro-Batches Matter

Default batch size is `5` for safety and observability.

That gives:

- bounded context size
- smaller retry units
- clearer cost attribution
- easier debugging
- lower failure blast radius

After telemetry, batch size can be tuned upward carefully, but the architectural shape should still be:

- many small ACP runs
- queue-level concurrency

## Suggested Production Layers

- ACP:
  reasoning, extraction, persistence orchestration
- Firecrawl:
  HTML and PDF scraping
- Browser:
  visual fallback path for photo menus
- external scheduler:
  cadence, concurrency, retry policy, rate limiting

## Resource Routing Strategy

For each restaurant:

1. try to find structured HTML or PDF menu sources
2. prefer Firecrawl for machine-readable sources
3. escalate to Browser only for:
   - scanned menus
   - photo-heavy menu pages
   - canvas or JS-rendered menu experiences
   - extraction failures on the structured path

## Cost Strategy

The largest cost reductions will likely come from:

- change-detection-first logic
- minimizing Browser share
- skipping deep extraction for unchanged sites
- keeping concurrency high outside ACP rather than inside one thread

## Suggested Next Experiments

1. validate the workflow on a real Stockifi export slice
2. measure token and Firecrawl usage on 25 to 100 real restaurants
3. compare batch sizes `5`, `10`, and `20`
4. measure how often Browser is truly needed
5. tune the pricing model from observed telemetry
