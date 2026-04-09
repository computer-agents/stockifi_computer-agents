export const menuExtractionSchema = {
  restaurantSlug: 'string',
  status: 'completed | needs_follow_up | failed',
  restaurant: {
    name: 'string',
    website: 'string',
    city: 'string',
    country: 'string',
  },
  crawl: {
    primarySourceType: 'html | pdf | embedded_platform | photo_menu | unknown',
    primarySourceUrl: 'string',
    fallbackSourceUrls: ['string'],
    bookingSystem: 'string | null',
    bookingUrl: 'string | null',
    confidence: 'number (0-1)',
  },
  menu: {
    currency: 'string | null',
    cuisineStyles: ['string'],
    items: [
      {
        section: 'string | null',
        name: 'string',
        description: 'string | null',
        priceDisplay: 'string | null',
        proteins: ['string'],
        dietaryTags: ['string'],
      },
    ],
  },
  changeDetection: {
    fingerprintFields: ['menu.items.name', 'menu.items.priceDisplay', 'crawl.primarySourceUrl'],
    recheckRecommendation: 'daily | weekly | monthly',
  },
  outreach: {
    personalizationHooks: ['string'],
    proofPoints: ['string'],
    recommendedAngle: 'string',
  },
  evidence: [
    {
      url: 'string',
      type: 'html | pdf | embedded_platform | image',
      note: 'string',
    },
  ],
  operational: {
    pathTaken: 'firecrawl_only | browser_then_firecrawl | browser_only | unknown',
    requiresHumanReview: 'boolean',
    confidenceNotes: ['string'],
  },
};

export const menuExtractionSchemaJson = JSON.stringify(menuExtractionSchema, null, 2);

export const batchEnrichmentSchema = {
  batch: {
    batchId: 'string',
    executedAt: 'ISO8601 timestamp',
    requestedRestaurantCount: 'number',
    completedRestaurantCount: 'number',
    needsFollowUpCount: 'number',
    failedRestaurantCount: 'number',
  },
  restaurants: [menuExtractionSchema],
};

export const batchEnrichmentSchemaJson = JSON.stringify(batchEnrichmentSchema, null, 2);
