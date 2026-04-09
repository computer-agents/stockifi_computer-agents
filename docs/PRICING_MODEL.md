# Stockifi Pricing And Cost Model

This repository includes a working cost model for the Stockifi rollout scenarios discussed so far:

- 1,000 restaurant websites
- 10,000 restaurant websites
- 100,000 restaurant websites

Each scenario assumes:

- twice-monthly refresh cadence
- default batch size of `5`
- `claude-haiku-4-5` across the workflow
- Firecrawl for HTML and PDF flows
- Browser usage for a minority of photo-menu sites

## Sources

- Anthropic pricing:
  https://platform.claude.com/docs/en/about-claude/pricing
- Firecrawl pricing:
  https://www.firecrawl.dev/pricing

## Current Repo Assumptions

These live in [`src/pricing.mjs`](../src/pricing.mjs):

- average Firecrawl sources per site per pass: `2.2`
- photo-menu share: `10%`
- average browser minutes per photo site per pass: `1.25`
- average input tokens per site per pass: `9,000`
- average output tokens per site per pass: `1,400`
- platform infra multiplier: `1.35`
- support retainer increases by scale

## What The Script Produces

The script currently prints:

- Firecrawl credit estimate
- Firecrawl plan estimate
- LLM monthly estimate
- platform infra estimate
- support estimate
- estimated monthly operating cost
- working suggested monthly customer price

These are working collaboration numbers, not final commercial commitments.

## How To Recalculate

Run:

```bash
npm run estimate:pricing
```

## What Still Needs Calibration

- actual average number of sources scraped per restaurant
- actual share of photo-heavy menus
- actual browser minutes per visual site
- observed token usage per batch
- retry and failure rates
- how aggressively change detection can short-circuit deeper extraction

## Cost-Lever Discussion

The main levers for the 100k-site rollout are:

- change-detection-first processing
- minimizing Browser usage
- keeping ACP execution in small batches
- increasing scheduler-level throughput rather than forcing huge single-thread batches
- reducing deep extraction for unchanged sites

The shared repo should be used to collect telemetry and revise these assumptions before any formal enterprise quote is locked.
