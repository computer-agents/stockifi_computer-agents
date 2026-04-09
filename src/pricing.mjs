export const PRICING_SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  firecrawl: 'https://www.firecrawl.dev/pricing',
};

export const pricingAssumptions = {
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
    averageFirecrawlSourcesPerSitePerPass: 2.2,
    photoMenuShare: 0.1,
    averageBrowserMinutesPerPhotoSitePerPass: 1.25,
    averageInputTokensPerSitePerPass: 9_000,
    averageOutputTokensPerSitePerPass: 1_400,
    platformInfraMultiplier: 1.35,
    supportRetainerByScale: {
      1000: 500,
      10000: 1500,
      100000: 5000,
    },
    salesPriceMultiplier: 2.4,
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

export function estimateScenario(websiteCount) {
  const workflow = pricingAssumptions.workflow;
  const passesPerMonth = workflow.passesPerMonth;
  const firecrawlCredits =
    websiteCount * passesPerMonth * workflow.averageFirecrawlSourcesPerSitePerPass
    + websiteCount * passesPerMonth * workflow.photoMenuShare * workflow.averageBrowserMinutesPerPhotoSitePerPass * pricingAssumptions.firecrawl.browserCreditsPerMinute;

  const firecrawl = estimateFirecrawlCost(Math.ceil(firecrawlCredits));

  const inputTokens = websiteCount * passesPerMonth * workflow.averageInputTokensPerSitePerPass;
  const outputTokens = websiteCount * passesPerMonth * workflow.averageOutputTokensPerSitePerPass;

  const llmMonthlyUsd =
    (inputTokens / 1_000_000) * pricingAssumptions.anthropic.inputUsdPerMillionTokens
    + (outputTokens / 1_000_000) * pricingAssumptions.anthropic.outputUsdPerMillionTokens;

  const platformInfraUsd = (llmMonthlyUsd + firecrawl.monthlyUsd) * (workflow.platformInfraMultiplier - 1);
  const supportRetainerUsd = workflow.supportRetainerByScale[websiteCount] ?? 0;
  const estimatedMonthlyCostUsd = llmMonthlyUsd + firecrawl.monthlyUsd + platformInfraUsd + supportRetainerUsd;
  const suggestedMonthlyPriceUsd = Math.ceil(estimatedMonthlyCostUsd * workflow.salesPriceMultiplier / 100) * 100;

  return {
    websiteCount,
    passesPerMonth,
    batchSize: workflow.batchSize,
    firecrawlCreditsPerMonth: Math.ceil(firecrawlCredits),
    firecrawlPlan: firecrawl.plan,
    firecrawlMonthlyUsd: Number(firecrawl.monthlyUsd.toFixed(2)),
    llmMonthlyUsd: Number(llmMonthlyUsd.toFixed(2)),
    platformInfraUsd: Number(platformInfraUsd.toFixed(2)),
    supportRetainerUsd,
    estimatedMonthlyCostUsd: Number(estimatedMonthlyCostUsd.toFixed(2)),
    suggestedMonthlyPriceUsd,
  };
}

export function estimatePricingTable() {
  return [1_000, 10_000, 100_000].map((count) => estimateScenario(count));
}
