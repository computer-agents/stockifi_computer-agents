# Stockifi + Computer Agents Workflow Repo

This repository is the shared implementation workspace for the Stockifi hospitality enrichment pipeline on Computer Agents.

It is intended to be publishable as the collaboration repo for:

- Stockifi engineers and operators
- Computer Agents product and engineering teams

The workflow modeled here is the one discussed for the enterprise rollout:

1. import restaurant websites into an ACP database
2. process them in small cost-controlled batches
3. use Firecrawl for HTML and PDF menu sources
4. use Browser for image-heavy or visually rendered menu flows
5. extract structured menu data
6. persist snapshots and change events
7. rerun the pipeline twice per month
8. estimate operating cost and working pricing scenarios

## Shared Repo Scope

This repo is meant to hold the collaboration surface between both companies:

- ACP workspace bootstrap
- environment and agent definitions
- custom skill definitions
- restaurant import and seeding
- batch execution scripts
- recurring schedule setup
- pricing and scaling assumptions

It is not meant to contain production secrets, customer exports, or local state files.

## Current Workflow

- `bootstrap`
  creates or updates the ACP environment, database, collections, resources, skills, agents, orchestration, and recurring schedule
- `seed:restaurants`
  seeds the database from either a supplied file or the built-in sample catalog
- `run:batch`
  selects the next due restaurants, runs a real ACP batch thread, and persists the results
- `schedule:refresh`
  provisions the recurring ACP schedule object
- `estimate:pricing`
  prints the current cost assumptions and scenario estimates

## Setup

1. Copy `.env.example` to `.env`
2. Fill in:
   - `COMPUTER_AGENTS_API_KEY`
   - `STOCKIFI_FIRECRAWL_BASE_URL`
   - `STOCKIFI_FIRECRAWL_API_KEY`
3. Optionally set:
   - `STOCKIFI_RESTAURANTS_FILE`
   - `STOCKIFI_LOCAL_MODEL_BASE_URL`
   - model overrides

Default sample restaurant file:

- [`data/restaurants.sample.csv`](./data/restaurants.sample.csv)

Supported restaurant catalog formats:

- `.csv`
- `.json`
- `.jsonl`

## Commands

- `npm run doctor`
- `npm run blueprint`
- `npm run bootstrap`
- `npm run install:skills`
- `npm run seed:restaurants`
- `npm run import:restaurants`
- `npm run run:batch`
- `npm run run:restaurant`
- `npm run schedule:refresh`
- `npm run estimate:pricing`
- `npm run validate`

## Typical Working Flow

1. `npm ci`
2. `cp .env.example .env`
3. `npm run doctor`
4. `npm run blueprint`
5. `npm run bootstrap`
6. `npm run seed:restaurants`
7. `npm run run:batch`
8. inspect ACP:
   - agents
   - skills
   - orchestration
   - schedule
   - threads
   - database collections

## Database Model

The workflow provisions one ACP database with:

- `restaurants`
- `menuSnapshots`
- `changeEvents`
- `batchRuns`

This gives the shared repo a persistent operational backbone instead of only thread output.

## Skills

Custom skills in this repo:

- `Stockifi Firecrawl Scraper`
- `Stockifi Visual Menu Inspector`

System skill expected when available:

- `Browser`

## Scaling Position

The default repo batch size is intentionally conservative at `5`.

That is not the claim for the final 100k-site rollout architecture. It is the default working unit for:

- bounded context
- easier retries
- lower blast radius
- predictable CT usage
- clear observability

The long-term scaling recommendation is to run many small ACP batches behind an external scheduler or queue.

## Collaboration Notes

- do not commit `.env`
- do not commit `.stockifi-workflow-state.json`
- do not commit customer data exports unless explicitly agreed
- prefer sample or anonymized inputs in pull requests

## Docs

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- [`docs/SCALING_PLAN.md`](./docs/SCALING_PLAN.md)
- [`docs/PRICING_MODEL.md`](./docs/PRICING_MODEL.md)
- [`docs/COLLABORATION.md`](./docs/COLLABORATION.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
