const checklist = {
  purpose: 'Browser-first hospitality menu extraction checklist',
  steps: [
    'Open the official restaurant site and find the menu view.',
    'Determine whether the menu is HTML, PDF, embedded platform, or image-based.',
    'If the menu text is embedded in images, inspect it visually with the browser.',
    'If a direct PDF or HTML menu link becomes visible, switch to Firecrawl for that source.',
    'Extract only verifiable menu items, prices, and dietary/protein signals.',
    'Flag requiresHumanReview when the visual evidence is incomplete or ambiguous.',
  ],
  pathValues: ['browser_only', 'browser_then_firecrawl'],
};

process.stdout.write(`${JSON.stringify(checklist, null, 2)}\n`);
