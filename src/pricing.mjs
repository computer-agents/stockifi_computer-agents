export const PRICING_SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  firecrawl: 'https://www.firecrawl.dev/pricing',
};

function toCtFromUsd(usd) {
  return Number((Number(usd || 0) / 0.01).toFixed(2));
}

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

const ACP_COMPUTE_PROFILES = [
  {
    id: 'lite',
    label: 'Lite',
    description: 'Lowest-cost CLI-first computer profile for prompt-heavy and automation-heavy work.',
    cpuCores: 0.5,
    memoryGb: 1.5,
    guiEnabled: false,
    minuteUsd: 0.002,
  },
  {
    id: 'standard',
    label: 'Standard',
    description: 'Balanced profile for normal coding, OCR, PDF processing, and batch orchestration.',
    cpuCores: 1,
    memoryGb: 2,
    guiEnabled: false,
    minuteUsd: 0.004,
  },
  {
    id: 'power',
    label: 'Power',
    description: 'Higher CPU and memory for heavier builds and more demanding multi-step runs.',
    cpuCores: 2,
    memoryGb: 4,
    guiEnabled: false,
    minuteUsd: 0.0075,
  },
  {
    id: 'desktop',
    label: 'Desktop',
    description: 'GUI-enabled profile for browser and desktop-app workflows.',
    cpuCores: 2,
    memoryGb: 4,
    guiEnabled: true,
    minuteUsd: 0.01,
  },
].map((profile) => ({
  ...profile,
  ctPerMinute: toCtFromUsd(profile.minuteUsd),
}));

export const pricingAssumptions = {
  acp: {
    dollarsPerComputeToken: 0.01,
    computerProfiles: ACP_COMPUTE_PROFILES,
  },
  anthropic: {
    model: 'claude-haiku-4-5',
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 5,
  },
  firecrawl: {
    includedCreditsPlans: [
      { name: 'Hobby', monthlyUsd: 16, includedCredits: 3_000, overagePackCredits: 1_000, overagePackUsd: 9 },
      { name: 'Standard', monthlyUsd: 83, includedCredits: 100_000, overagePackCredits: 25_000, overagePackUsd: 27 },
      { name: 'Growth', monthlyUsd: 333, includedCredits: 500_000, overagePackCredits: 175_000, overagePackUsd: 177 },
    ],
    browserCreditsPerMinute: 2,
  },
  workflow: {
    passesPerMonth: 2,
    batchSize: 5,
    computerProfileId: 'standard',
    averageFirecrawlSourcesPerSitePerPass: 2.2,
    photoMenuShare: 0.1,
    averageBrowserMinutesPerPhotoSitePerPass: 1.25,
    averageInputTokensPerSitePerPass: 9_000,
    averageOutputTokensPerSitePerPass: 1_400,
    averageAcpRuntimeMinutesPerBatch: 6.5,
    supportRetainerByScale: {
      1000: 100,
      10000: 200,
      100000: 500,
    },
    salesPriceMultiplier: 1.2,
  },
};

function estimateFirecrawlCost(requiredCredits) {
  const plans = pricingAssumptions.firecrawl.includedCreditsPlans;
  let best = null;

  for (const plan of plans) {
    let monthlyUsd = plan.monthlyUsd;
    if (requiredCredits > plan.includedCredits) {
      const extraCredits = requiredCredits - plan.includedCredits;
      const extraPacks = Math.ceil(extraCredits / plan.overagePackCredits);
      monthlyUsd += extraPacks * plan.overagePackUsd;
    }

    if (!best || monthlyUsd < best.monthlyUsd) {
      best = {
        plan: plan.name,
        monthlyUsd,
      };
    }
  }

  return best;
}

function getComputerProfile(profileId = pricingAssumptions.workflow.computerProfileId) {
  return pricingAssumptions.acp.computerProfiles.find((profile) => profile.id === profileId)
    || pricingAssumptions.acp.computerProfiles[0];
}

export function estimateScenario(websiteCount) {
  const workflow = pricingAssumptions.workflow;
  const passesPerMonth = workflow.passesPerMonth;
  const computerProfile = getComputerProfile(workflow.computerProfileId);
  const batchesPerMonth = Math.ceil(websiteCount / workflow.batchSize) * passesPerMonth;
  const firecrawlCredits =
    websiteCount * passesPerMonth * workflow.averageFirecrawlSourcesPerSitePerPass
    + websiteCount * passesPerMonth * workflow.photoMenuShare * workflow.averageBrowserMinutesPerPhotoSitePerPass * pricingAssumptions.firecrawl.browserCreditsPerMinute;

  const firecrawl = estimateFirecrawlCost(Math.ceil(firecrawlCredits));

  const inputTokens = websiteCount * passesPerMonth * workflow.averageInputTokensPerSitePerPass;
  const outputTokens = websiteCount * passesPerMonth * workflow.averageOutputTokensPerSitePerPass;

  const llmMonthlyUsd =
    (inputTokens / 1_000_000) * pricingAssumptions.anthropic.inputUsdPerMillionTokens
    + (outputTokens / 1_000_000) * pricingAssumptions.anthropic.outputUsdPerMillionTokens;

  const acpRuntimeMinutesPerMonth = batchesPerMonth * workflow.averageAcpRuntimeMinutesPerBatch;
  const acpRuntimeMonthlyUsd = acpRuntimeMinutesPerMonth * computerProfile.minuteUsd;
  const llmMonthlyCtEquivalent = toCtFromUsd(llmMonthlyUsd);
  const firecrawlMonthlyCtEquivalent = toCtFromUsd(firecrawl.monthlyUsd);
  const acpRuntimeMonthlyCt = toCtFromUsd(acpRuntimeMonthlyUsd);
  const supportRetainerUsd = workflow.supportRetainerByScale[websiteCount] ?? 0;
  const estimatedMonthlyCostUsd = llmMonthlyUsd + firecrawl.monthlyUsd + acpRuntimeMonthlyUsd + supportRetainerUsd;
  const estimatedMonthlyComputeTokensEquivalent = llmMonthlyCtEquivalent + firecrawlMonthlyCtEquivalent + acpRuntimeMonthlyCt;
  const suggestedMonthlyPriceUsd = Math.ceil(estimatedMonthlyCostUsd * workflow.salesPriceMultiplier / 100) * 100;

  return {
    websiteCount,
    passesPerMonth,
    batchSize: workflow.batchSize,
    batchesPerMonth,
    computerProfile: {
      id: computerProfile.id,
      label: computerProfile.label,
      cpuCores: computerProfile.cpuCores,
      memoryGb: computerProfile.memoryGb,
      guiEnabled: computerProfile.guiEnabled,
      minuteUsd: computerProfile.minuteUsd,
      ctPerMinute: computerProfile.ctPerMinute,
    },
    firecrawlCreditsPerMonth: Math.ceil(firecrawlCredits),
    firecrawlPlan: firecrawl.plan,
    firecrawlMonthlyUsd: roundUsd(firecrawl.monthlyUsd),
    firecrawlMonthlyCtEquivalent,
    llmMonthlyUsd: roundUsd(llmMonthlyUsd),
    llmMonthlyCtEquivalent,
    acpRuntimeMinutesPerMonth: Number(acpRuntimeMinutesPerMonth.toFixed(2)),
    acpRuntimeMonthlyUsd: roundUsd(acpRuntimeMonthlyUsd),
    acpRuntimeMonthlyCt,
    supportRetainerUsd,
    estimatedMonthlyComputeTokensEquivalent: Number(estimatedMonthlyComputeTokensEquivalent.toFixed(2)),
    estimatedMonthlyCostUsd: roundUsd(estimatedMonthlyCostUsd),
    suggestedMonthlyPriceUsd,
  };
}

export function estimatePricingTable() {
  return [1_000, 10_000, 100_000].map((count) => estimateScenario(count));
}
