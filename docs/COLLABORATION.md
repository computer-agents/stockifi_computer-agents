# Collaboration Guide

This repository is intended for shared implementation work between Stockifi and Computer Agents.

## What Should Live Here

- workflow definitions
- skill definitions
- restaurant import logic
- ACP bootstrap scripts
- operational docs
- pricing assumptions

## What Should Not Be Committed

- `.env`
- `.stockifi-workflow-state.json`
- customer exports unless explicitly agreed
- raw secrets or service credentials
- ad hoc local notes

## Recommended Working Style

- use feature branches for changes
- keep pull requests small and reviewable
- prefer sample or anonymized restaurant records in commits
- document assumption changes when touching pricing or extraction logic

## Shared Review Focus

Typical review questions for this repo:

- is the source selection logic correct?
- are Browser escalations justified?
- is the structured schema sufficient for downstream pricing and outreach?
- is batch sizing still appropriate?
- do the cost assumptions still match telemetry?

## Operational State

This repo writes local ACP object references into:

- `.stockifi-workflow-state.json`

That file is intentionally local-only and ignored by git.

## Suggested Pull Request Themes

- importer and data-shape updates
- extraction prompt changes
- Firecrawl integration improvements
- Browser fallback logic
- pricing model calibration
- scheduling and scaling changes
