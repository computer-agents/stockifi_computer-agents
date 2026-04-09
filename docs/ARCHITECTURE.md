# Stockifi Workflow Architecture

## Goal

Process large sets of restaurant websites on a recurring cadence and turn menu cards into structured, queryable intelligence:

- menu item catalog
- pricing by item and restaurant
- change detection between runs
- booking system and evidence metadata
- outreach-ready commercial signals

## Recommended Flow

1. Import restaurant records into ACP database collection `restaurants`
2. Select the next due micro-batch, default `5` restaurants
3. Run the `Stockifi Pipeline Coordinator`
4. For each restaurant:
   - discover candidate menu sources
   - classify the best primary source and fallback chain
   - use Firecrawl for clean HTML or PDF paths
   - use Browser for photo menus, scan-heavy pages, or visually rendered flows
   - extract structured menu data
   - compare with the previous snapshot
   - generate downstream outreach signals
5. Persist results into ACP database collections
6. Update next-check scheduling metadata

## ACP Objects

- Environment:
  `stockifi-hospitality-pipeline`
- Database:
  `stockifi-hospitality-intelligence`
- Custom skills:
  - `Stockifi Firecrawl Scraper`
  - `Stockifi Visual Menu Inspector`
- System skill:
  - `Browser`
- Agents:
  - discovery
  - classifier
  - extractor
  - change detector
  - outreach
  - coordinator

## Database Collections

## `restaurants`

Canonical restaurant and scheduling metadata:

- slug
- website
- city / country
- known menu URLs
- cadence per month
- last checked at
- next check at
- latest snapshot id

## `menuSnapshots`

One structured extraction result per restaurant run:

- crawl classification
- structured menu items
- evidence URLs
- pricing signals
- booking metadata
- operator confidence

## `changeEvents`

Diff-oriented records between checks:

- fingerprint or comparison result
- changed items
- added items
- removed items
- price changes
- review flags
- outreach hooks

## `batchRuns`

Operational records for each batch:

- batch id
- thread id
- restaurant slugs
- summary counts
- raw output

## Why The Repo Defaults To Batches Of 5

- bounded context size
- easier retries
- lower blast radius on failures
- easier cost observation
- simpler review of extraction quality

This should be treated as the default collaboration unit, not as the final maximum throughput strategy.

## Production Scheduling Recommendation

For product visibility, ACP schedule objects are useful.

For the true 100k-site rollout, the stronger operating model is:

- external scheduler
- queue or job dispatcher
- many small ACP batches
- explicit concurrency controls

Good candidates:

- GitHub Actions
- Cloud Run Jobs
- Cloud Scheduler
- internal worker queue

## Current Validation Status

This workflow has already been validated locally and on ACP for:

- workspace bootstrap
- custom skill installation
- restaurant seeding
- real batch thread execution
- persistence into ACP database collections

The next collaboration step is to swap the sample catalog for a real Stockifi export and tune batch behavior with telemetry.
