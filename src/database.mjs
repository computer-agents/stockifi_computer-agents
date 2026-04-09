function addDays(isoString, days) {
  const value = new Date(isoString);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function cadenceDays(config) {
  return Math.max(1, Math.round(30 / Math.max(1, config.passesPerMonth || 2)));
}

function timestampKey(isoString) {
  return String(isoString || '')
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
    .replace(/[^0-9TZ]/g, '')
    .slice(0, 15);
}

async function readDocumentOrNull(client, databaseId, collectionId, documentId) {
  try {
    return await client.databases.getDocument(databaseId, collectionId, documentId);
  } catch {
    return null;
  }
}

async function upsertDocument(client, databaseId, collectionId, documentId, data) {
  const existing = await readDocumentOrNull(client, databaseId, collectionId, documentId);
  const nextData = existing?.data ? { ...existing.data, ...data } : data;

  if (existing) {
    return client.databases.updateDocument(databaseId, collectionId, documentId, {
      data: nextData,
    });
  }

  return client.databases.createDocument(databaseId, collectionId, {
    id: documentId,
    data: nextData,
  });
}

export function getDatabaseDefinition(config) {
  return {
    name: config.databaseName,
    description: 'Structured hospitality enrichment state for the shared Stockifi and Computer Agents workflow.',
    location: 'europe-west1',
    metadata: {
      owner: 'stockifi',
      vertical: 'hospitality',
      cadence: `${config.passesPerMonth}x-monthly`,
    },
  };
}

export function getDatabaseCollectionDefinitions(config) {
  return [
    {
      key: 'restaurants',
      name: config.collectionNames.restaurants,
      description: 'Canonical restaurant records and scheduling metadata.',
    },
    {
      key: 'menuSnapshots',
      name: config.collectionNames.menuSnapshots,
      description: 'Structured menu extraction output per run.',
    },
    {
      key: 'changeEvents',
      name: config.collectionNames.changeEvents,
      description: 'Material menu or pricing changes detected between runs.',
    },
    {
      key: 'batchRuns',
      name: config.collectionNames.batchRuns,
      description: 'Operational history for each batch thread and persistence pass.',
    },
  ];
}

export async function ensureDatabase(client, config, params) {
  const existing = (await client.databases.list()).find((database) => database.name === params.name);
  if (existing) {
    return client.databases.update(existing.id, params);
  }
  return client.databases.create(params);
}

export async function ensureDatabaseCollection(client, databaseId, params) {
  const existing = (await client.databases.listCollections(databaseId)).find((collection) => collection.name === params.name);
  if (existing) {
    return existing;
  }
  return client.databases.createCollection(databaseId, params);
}

export function buildRestaurantSeedDocument(restaurant, config) {
  const now = new Date().toISOString();
  return {
    slug: restaurant.slug,
    name: restaurant.name,
    website: restaurant.website,
    city: restaurant.city,
    country: restaurant.country,
    bookingUrl: restaurant.bookingUrl ?? null,
    knownMenuUrls: restaurant.knownMenuUrls,
    notes: restaurant.notes,
    status: 'active',
    cadencePerMonth: config.passesPerMonth,
    nextCheckAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedRestaurantsIntoDatabase(client, state, restaurants, config) {
  const databaseId = state.database?.id;
  const collectionId = state.database?.collections?.restaurants?.id;
  if (!databaseId || !collectionId) {
    throw new Error('Database bootstrap state missing. Run `npm run bootstrap` first.');
  }

  const seeded = [];
  for (const restaurant of restaurants) {
    const document = await upsertDocument(
      client,
      databaseId,
      collectionId,
      restaurant.slug,
      buildRestaurantSeedDocument(restaurant, config),
    );
    seeded.push(document);
  }

  return seeded;
}

export async function listDueRestaurants(client, state, config, limit = config.batchSize) {
  const databaseId = state.database?.id;
  const collectionId = state.database?.collections?.restaurants?.id;
  if (!databaseId || !collectionId) {
    throw new Error('Database bootstrap state missing. Run `npm run bootstrap` first.');
  }

  const documents = await client.databases.listDocuments(databaseId, collectionId, { limit: 500 });
  const now = Date.now();

  return documents
    .map((document) => ({
      id: document.id,
      ...document.data,
    }))
    .filter((restaurant) => (restaurant.status ?? 'active') === 'active')
    .filter((restaurant) => {
      const nextCheckAt = typeof restaurant.nextCheckAt === 'string' ? Date.parse(restaurant.nextCheckAt) : Number.NaN;
      return !Number.isFinite(nextCheckAt) || nextCheckAt <= now;
    })
    .sort((left, right) => {
      const leftDate = typeof left.nextCheckAt === 'string' ? Date.parse(left.nextCheckAt) : 0;
      const rightDate = typeof right.nextCheckAt === 'string' ? Date.parse(right.nextCheckAt) : 0;
      return leftDate - rightDate;
    })
    .slice(0, limit);
}

export async function persistBatchRunResults(client, state, config, batchContext, batchResult, rawOutput) {
  const databaseId = state.database?.id;
  const collections = state.database?.collections || {};
  const restaurantsCollectionId = collections.restaurants?.id;
  const menuSnapshotsCollectionId = collections.menuSnapshots?.id;
  const changeEventsCollectionId = collections.changeEvents?.id;
  const batchRunsCollectionId = collections.batchRuns?.id;

  if (!databaseId || !restaurantsCollectionId || !menuSnapshotsCollectionId || !changeEventsCollectionId || !batchRunsCollectionId) {
    throw new Error('Database collections missing from local state. Run `npm run bootstrap` first.');
  }

  const executedAt = batchResult?.batch?.executedAt || new Date().toISOString();
  const restaurantRecords = Array.isArray(batchResult?.restaurants) ? batchResult.restaurants : [];
  const summary = {
    requestedRestaurantCount: batchContext.restaurants.length,
    persistedRestaurantCount: restaurantRecords.length,
    completedRestaurantCount: restaurantRecords.filter((item) => item.status === 'completed').length,
    needsFollowUpCount: restaurantRecords.filter((item) => item.status === 'needs_follow_up').length,
    failedRestaurantCount: restaurantRecords.filter((item) => item.status === 'failed').length,
  };

  await upsertDocument(client, databaseId, batchRunsCollectionId, batchContext.batchId, {
    batchId: batchContext.batchId,
    threadId: batchContext.threadId,
    title: batchContext.title,
    restaurantSlugs: batchContext.restaurants.map((restaurant) => restaurant.slug),
    executedAt,
    summary,
    rawOutput,
    createdAt: executedAt,
    updatedAt: new Date().toISOString(),
  });

  for (const record of restaurantRecords) {
    const restaurantSlug = String(record.restaurantSlug || '').trim();
    if (!restaurantSlug) {
      continue;
    }

    const snapshotId = `${restaurantSlug}--${timestampKey(executedAt)}`;
    const nextCheckAt = addDays(executedAt, cadenceDays(config));

    await upsertDocument(client, databaseId, menuSnapshotsCollectionId, snapshotId, {
      snapshotId,
      restaurantSlug,
      batchId: batchContext.batchId,
      threadId: batchContext.threadId,
      capturedAt: executedAt,
      extraction: record,
      createdAt: executedAt,
      updatedAt: new Date().toISOString(),
    });

    const existingRestaurant = await readDocumentOrNull(client, databaseId, restaurantsCollectionId, restaurantSlug);
    await upsertDocument(client, databaseId, restaurantsCollectionId, restaurantSlug, {
      ...(existingRestaurant?.data || {}),
      slug: restaurantSlug,
      status: 'active',
      latestThreadId: batchContext.threadId,
      latestSnapshotId: snapshotId,
      lastCheckedAt: executedAt,
      nextCheckAt,
      latestStatus: record.status || 'completed',
      latestPrimarySourceType: record?.crawl?.primarySourceType ?? null,
      latestBookingSystem: record?.crawl?.bookingSystem ?? null,
      latestMenuItemCount: Array.isArray(record?.menu?.items) ? record.menu.items.length : 0,
      updatedAt: new Date().toISOString(),
    });

    const changeEventId = `${snapshotId}--change`;
    await upsertDocument(client, databaseId, changeEventsCollectionId, changeEventId, {
      id: changeEventId,
      restaurantSlug,
      batchId: batchContext.batchId,
      threadId: batchContext.threadId,
      capturedAt: executedAt,
      changeDetection: record.changeDetection ?? null,
      outreach: record.outreach ?? null,
      requiresHumanReview: record?.operational?.requiresHumanReview ?? false,
      createdAt: executedAt,
      updatedAt: new Date().toISOString(),
    });
  }

  return summary;
}
