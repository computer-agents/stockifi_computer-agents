import { batchEnrichmentSchemaJson, menuExtractionSchemaJson } from './schema.mjs';

export function buildDiscoveryInstructions() {
  return [
    'You discover the highest-value crawl entrypoints for hospitality businesses.',
    'Prioritize menu pages, PDF menus, ordering widgets, reservations, and contact channels.',
    'Classify each source as HTML, PDF, embedded platform, photo menu, or unknown.',
    'If the page is image-heavy, menu text is embedded in photos, or Firecrawl cannot capture the menu cleanly, switch to a browser-first path.',
    'Be explicit about what should be crawled first vs. revisited later.',
  ].join(' ');
}

export function buildClassifierInstructions() {
  return [
    'You classify restaurant menu sources for downstream extraction.',
    'Choose the best primary source for structured extraction and explain why.',
    'Prefer direct HTML or PDF extraction when reliable, but explicitly mark photo menus that require visual inspection.',
    'If the menu is spread across multiple pages or formats, define the fallback order.',
  ].join(' ');
}

export function buildExtractionInstructions() {
  return [
    'You extract restaurant data into consistent structured output.',
    'Focus on proteins, pricing, cuisine styles, dietary signals, and booking systems.',
    'When menus appear as photos or scans, use the Browser skill to inspect them visually before extracting.',
    'Return concise evidence notes and avoid inventing fields that the source does not support.',
  ].join(' ');
}

export function buildChangeDetectionInstructions() {
  return [
    'You compare current restaurant menu data against the last known snapshot.',
    'Flag meaningful changes for outreach or downstream refreshes.',
    'Ignore purely cosmetic website changes when the menu semantics did not change.',
  ].join(' ');
}

export function buildOutreachInstructions() {
  return [
    'You turn restaurant intelligence into outreach angles for a hospitality sales workflow.',
    'Use concrete signals like pricing, cuisine style, booking tools, and menu updates.',
    'Keep the output structured and commercially relevant.',
  ].join(' ');
}

export function buildCoordinatorInstructions() {
  return [
    'You coordinate the full Stockifi hospitality enrichment workflow for batches of restaurant websites.',
    'Run the work in five phases: discover sources, classify the primary menu source, extract structured data, detect changes, and produce an outreach-ready brief.',
    'Keep cost discipline: do not browse or scrape more sources than needed to reach a confident answer.',
    'If the menu is accessible as clean HTML or PDF, use the Stockifi Firecrawl Scraper skill first.',
    'If the menu is image-based, scan-based, hidden behind a visual interaction, or Firecrawl cannot recover enough evidence, use the Browser skill and the Stockifi Visual Menu Inspector playbook before extracting.',
    'For each restaurant, explicitly state which path you used: firecrawl_only, browser_then_firecrawl, browser_only, or unknown.',
    'Always end with valid JSON only. Do not wrap it in markdown fences.',
  ].join(' ');
}

export function buildSingleRestaurantPrompt(restaurant, firecrawlEvidence = null) {
  const bookingLine = restaurant.bookingUrl
    ? `Known booking URL: ${restaurant.bookingUrl}`
    : null;
  const firecrawlLine = firecrawlEvidence
    ? [
        'The following source payloads were scraped live via Firecrawl immediately before this run.',
        'Use them as the primary extraction evidence and only browse further if something important is still missing.',
        JSON.stringify(firecrawlEvidence, null, 2),
      ].join('\n')
    : null;

  return [
    `Run the Stockifi hospitality enrichment workflow for ${restaurant.name}.`,
    `Target website: ${restaurant.website}`,
    `Location: ${restaurant.city}, ${restaurant.country}`,
    `Known menu entry points: ${restaurant.knownMenuUrls.join(', ')}`,
    bookingLine,
    `Operator notes: ${restaurant.notes.join(' ')}`,
    firecrawlLine,
    'Output only valid JSON that matches the following schema:',
    menuExtractionSchemaJson,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildRecurringRefreshTask() {
  return [
    'Find the next due batch of restaurants for refresh.',
    'Process no more than five restaurant websites in one run unless the operator explicitly increases the batch size.',
    'Re-run discovery, source classification, structured extraction, and change detection.',
    'Use the Browser skill when menu content is image-based and the Firecrawl skill when HTML or PDF sources are available.',
    'Group the output by restaurant and include an outreach-ready summary for the materially changed accounts.',
  ].join(' ');
}

export function buildBatchEnrichmentPrompt(restaurants, options = {}) {
  const batchId = options.batchId ?? 'stockifi-batch';
  const cadenceNote = options.cadenceNote ?? 'This batch is part of the twice-monthly refresh cycle.';

  const restaurantLines = restaurants.map((restaurant, index) => {
    const bookingLine = restaurant.bookingUrl ? `Known booking URL: ${restaurant.bookingUrl}` : 'Known booking URL: null';
    return [
      `Restaurant ${index + 1}`,
      `slug: ${restaurant.slug}`,
      `name: ${restaurant.name}`,
      `website: ${restaurant.website}`,
      `location: ${restaurant.city}, ${restaurant.country}`,
      `knownMenuUrls: ${restaurant.knownMenuUrls.join(', ')}`,
      bookingLine,
      `notes: ${restaurant.notes.join(' ')}`,
    ].join('\n');
  });

  return [
    `Run the Stockifi hospitality enrichment workflow for batch ${batchId}.`,
    cadenceNote,
    `You must process exactly ${restaurants.length} restaurant websites in this run.`,
    'Decision policy:',
    '- Start with the official site and obvious menu links.',
    '- Use Firecrawl first when the menu is available as clean HTML or PDF.',
    '- If the menu is image-heavy, scan-based, or hidden behind interactions, use the Browser skill and visually inspect the page.',
    '- Browse or scrape only the minimum number of sources needed for a confident extraction.',
    'Return one structured record per restaurant and include evidence URLs.',
    'Output only valid JSON matching this schema:',
    batchEnrichmentSchemaJson,
    'Restaurants to process:',
    restaurantLines.join('\n\n'),
  ].join('\n\n');
}
