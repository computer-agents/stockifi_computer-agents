import {
  buildChangeDetectionInstructions,
  buildClassifierInstructions,
  buildCoordinatorInstructions,
  buildDiscoveryInstructions,
  buildExtractionInstructions,
  buildOutreachInstructions,
  buildRecurringRefreshTask,
} from './prompts.mjs';

export function getEnvironmentDefinition(config) {
  const mcpServers = [];
  const secrets = [];

  if (config.firecrawlMcpUrl) {
    mcpServers.push({
      type: 'http',
      name: 'firecrawl',
      url: config.firecrawlMcpUrl,
      bearerToken: config.firecrawlBearerToken || config.firecrawlApiKey || undefined,
      enabled: true,
    });
  }

  if (config.firecrawlApiKey) {
    secrets.push({
      key: 'FIRECRAWL_API_KEY',
      value: config.firecrawlApiKey,
    });
  }

  return {
    name: config.environmentName,
    description: 'Hybrid hospitality enrichment workspace for Stockifi-style restaurant discovery, extraction, and refresh jobs.',
    runtimes: {
      nodejs: '20',
      python: '3.12',
    },
    packages: {
      system: ['curl', 'poppler-utils', 'tesseract-ocr'],
      python: ['httpx', 'beautifulsoup4', 'pdfplumber', 'pypdf', 'pillow'],
      node: ['zod'],
    },
    environmentVariables: [
      { key: 'STOCKIFI_VERTICAL', value: 'hospitality' },
      { key: 'FIRECRAWL_BASE_URL', value: config.firecrawlBaseUrl || 'https://firecrawl.internal' },
      { key: 'LOCAL_MODEL_BASE_URL', value: config.localModelBaseUrl || 'https://models.internal' },
    ],
    secrets,
    setupScripts: [
      'echo "Preparing hospitality enrichment workspace"',
      'mkdir -p /workspace/restaurant-runs /workspace/raw-menus /workspace/structured-output /workspace/batch-reports',
    ],
    mcpServers,
    documentation: [
      'Restaurant websites may expose menus in HTML, PDF, embedded platforms, or image-heavy pages.',
      'Extraction should preserve evidence URLs and prefer stable menu sources over promotional landing pages.',
      'Use the Browser skill when the menu is only visible visually and not recoverable through clean HTML or PDF extraction.',
    ],
    internetAccess: true,
  };
}

export function getResourceDefinitions(config) {
  const resources = [];

  if (config.firecrawlBaseUrl) {
    resources.push({
      name: 'stockifi-firecrawl-cluster',
      description: 'Self-hosted Firecrawl cluster used for restaurant discovery and fetch jobs.',
      kind: 'function',
      serviceUrl: config.firecrawlBaseUrl,
      region: 'europe-west1',
      authMode: 'private',
      metadata: {
        owner: 'stockifi',
        purpose: 'scraping',
        deploymentMode: 'self-hosted',
        provider: 'firecrawl',
      },
    });
  }

  if (config.localModelBaseUrl) {
    resources.push({
      name: 'stockifi-local-inference',
      description: 'Local inference gateway for hybrid deployments.',
      kind: 'agent_runtime',
      serviceUrl: config.localModelBaseUrl,
      region: 'europe-west1',
      authMode: 'private',
      metadata: {
        owner: 'stockifi',
        purpose: 'inference',
        deploymentMode: 'self-hosted',
        provider: 'custom-openai-compatible',
      },
    });
  }

  return resources;
}

export function getAgentBlueprints(config, skillSets = {}) {
  return [
    {
      key: 'discovery',
      name: 'Stockifi Source Discovery',
      description: 'Find the highest-value crawl entrypoints for each restaurant.',
      model: config.models.discovery,
      reasoningEffort: 'low',
      instructions: buildDiscoveryInstructions(),
      enabledSkills: skillSets.discovery || [],
      metadata: { workflowRole: 'discovery', vertical: 'hospitality' },
    },
    {
      key: 'classifier',
      name: 'Stockifi Menu Source Classifier',
      description: 'Choose the best source for extraction and define fallback order.',
      model: config.models.classifier,
      reasoningEffort: 'low',
      instructions: buildClassifierInstructions(),
      enabledSkills: skillSets.classifier || [],
      metadata: { workflowRole: 'classification', vertical: 'hospitality' },
    },
    {
      key: 'extractor',
      name: 'Stockifi Structured Extractor',
      description: 'Turn restaurant websites and menus into structured JSON.',
      model: config.models.extraction,
      reasoningEffort: 'medium',
      instructions: buildExtractionInstructions(),
      enabledSkills: skillSets.extractor || [],
      metadata: { workflowRole: 'extraction', vertical: 'hospitality' },
    },
    {
      key: 'changeDetector',
      name: 'Stockifi Change Detector',
      description: 'Detect changes between previous and current menu snapshots.',
      model: config.models.changeDetection,
      reasoningEffort: 'low',
      instructions: buildChangeDetectionInstructions(),
      enabledSkills: skillSets.changeDetector || [],
      metadata: { workflowRole: 'change-detection', vertical: 'hospitality' },
    },
    {
      key: 'outreach',
      name: 'Stockifi Outreach Briefing',
      description: 'Turn enrichment output into outreach-ready proof points.',
      model: config.models.outreach,
      reasoningEffort: 'medium',
      instructions: buildOutreachInstructions(),
      enabledSkills: skillSets.outreach || [],
      metadata: { workflowRole: 'outreach', vertical: 'hospitality' },
    },
    {
      key: 'coordinator',
      name: 'Stockifi Pipeline Coordinator',
      description: 'Coordinate the end-to-end hospitality enrichment workflow.',
      model: config.models.coordinator,
      reasoningEffort: 'medium',
      instructions: buildCoordinatorInstructions(),
      enabledSkills: skillSets.coordinator || [],
      metadata: { workflowRole: 'coordinator', vertical: 'hospitality' },
    },
  ];
}

export function getOrchestrationDefinition(environmentId, agents) {
  return {
    name: 'Stockifi Hospitality Enrichment Pipeline',
    environmentId,
    strategy: 'sequential',
    coordinatorAgentId: agents.coordinator.id,
    steps: [
      {
        agentId: agents.discovery.id,
        name: 'Discover Sources',
        instructions: 'Identify the best crawl entrypoints for menu, reservations, and contact data.',
      },
      {
        agentId: agents.classifier.id,
        name: 'Classify Menu Source',
        instructions: 'Choose the best extraction source and note fallback sources.',
        dependsOn: ['Discover Sources'],
      },
      {
        agentId: agents.extractor.id,
        name: 'Extract Structured Menu',
        instructions: 'Produce structured menu data with pricing, proteins, and cuisine cues.',
        dependsOn: ['Classify Menu Source'],
      },
      {
        agentId: agents.changeDetector.id,
        name: 'Detect Changes',
        instructions: 'Compare the newly extracted output with the last known snapshot.',
        dependsOn: ['Extract Structured Menu'],
      },
      {
        agentId: agents.outreach.id,
        name: 'Draft Outreach Brief',
        instructions: 'Turn the enrichment result into personalization hooks and proof points.',
        dependsOn: ['Detect Changes'],
      },
    ],
  };
}

export function getRecurringRefreshScheduleDefinition(config, environment, coordinatorAgent) {
  return {
    name: 'Stockifi Twice-Monthly Menu Refresh',
    description: 'Recurring re-check of restaurant menu sources, extraction output, and booking changes in cost-optimized batches.',
    agentId: coordinatorAgent.id,
    agentName: coordinatorAgent.name,
    task: buildRecurringRefreshTask(),
    environmentId: environment.id,
    environmentName: environment.name,
    scheduleType: 'recurring',
    cronExpression: config.scheduleCron,
    timezone: config.timezone,
    enabled: true,
    metadata: {
      workflow: 'hospitality-enrichment',
      cadence: 'twice-monthly-refresh',
      batchSize: config.batchSize,
    },
  };
}
