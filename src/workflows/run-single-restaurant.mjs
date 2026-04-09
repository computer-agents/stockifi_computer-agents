import process from 'node:process';

if (!process.env.STOCKIFI_BATCH_RESTAURANT_SLUGS?.trim()) {
  process.env.STOCKIFI_BATCH_RESTAURANT_SLUGS = process.env.STOCKIFI_RESTAURANT_SLUG || '';
}

await import('./run-batch.mjs');
