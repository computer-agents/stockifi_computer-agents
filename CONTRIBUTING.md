# Contributing

## Setup

1. `npm ci`
2. `cp .env.example .env`
3. fill in required ACP and Firecrawl credentials
4. run `npm run doctor`

## Recommended Validation

Before opening a pull request:

1. `npm run validate`
2. `npm run blueprint`
3. if relevant, run the affected workflow against a non-production workspace

## Change Guidelines

- keep workflow behavior explicit
- document pricing assumption changes
- avoid committing secrets or local state
- prefer additive changes to database shapes unless both sides agree

## Review Priorities

- correctness of source discovery and extraction flow
- cost implications
- retry and persistence behavior
- clarity of docs for both teams
