import { printHeading, printJson } from './utils.mjs';

export async function ensureEnvironment(client, config, params) {
  printHeading(`Environment :: ${params.name}`);
  printJson('desired', params);

  const existing = (await client.environments.list()).find((item) => item.name === params.name);
  if (existing) {
    const updated = await client.environments.update(existing.id, params);
    console.log(`updated environment ${updated.id}`);
    return updated;
  }

  const created = await client.environments.create(params);
  console.log(`created environment ${created.id}`);
  return created;
}

export async function ensureResource(client, config, params) {
  printHeading(`Resource :: ${params.name}`);
  printJson('desired', params);

  const existing = (await client.resources.list()).find((item) => item.name === params.name);
  if (existing) {
    const updated = await client.resources.update(existing.id, params);
    console.log(`updated resource ${updated.id}`);
    return updated;
  }

  const created = await client.resources.create(params);
  console.log(`created resource ${created.id}`);
  return created;
}

export async function ensureDatabase(client, config, params) {
  printHeading(`Database :: ${params.name}`);
  printJson('desired', params);

  const existing = (await client.databases.list()).find((item) => item.name === params.name);
  if (existing) {
    const updated = await client.databases.update(existing.id, params);
    console.log(`updated database ${updated.id}`);
    return updated;
  }

  const created = await client.databases.create(params);
  console.log(`created database ${created.id}`);
  return created;
}

export async function ensureDatabaseCollection(client, databaseId, params) {
  printHeading(`Database Collection :: ${params.name}`);
  printJson('desired', params);

  const existing = (await client.databases.listCollections(databaseId)).find((item) => item.name === params.name);
  if (existing) {
    console.log(`reusing database collection ${existing.id}`);
    return existing;
  }

  const created = await client.databases.createCollection(databaseId, params);
  console.log(`created database collection ${created.id}`);
  return created;
}

export async function ensureAgent(client, config, params) {
  printHeading(`Agent :: ${params.name}`);
  printJson('desired', params);

  const existing = (await client.agents.list()).find((item) => item.name === params.name);
  if (existing) {
    const updated = await client.agents.update(existing.id, params);
    console.log(`updated agent ${updated.id}`);
    return updated;
  }

  const created = await client.agents.create(params);
  console.log(`created agent ${created.id}`);
  return created;
}

export async function ensureOrchestration(client, config, params) {
  printHeading(`Orchestration :: ${params.name}`);
  printJson('desired', params);

  const existing = (await client.orchestrations.list({ environmentId: params.environmentId }))
    .find((item) => item.name === params.name);

  if (existing) {
    const updated = await client.orchestrations.update(existing.id, {
      strategy: params.strategy,
      coordinatorAgentId: params.coordinatorAgentId,
      steps: params.steps,
    });
    console.log(`updated orchestration ${updated.id}`);
    return updated;
  }

  const created = await client.orchestrations.create(params);
  console.log(`created orchestration ${created.id}`);
  return created;
}

export async function ensureSchedule(client, config, params) {
  printHeading(`Schedule :: ${params.name}`);
  printJson('desired', params);

  const existing = (await client.schedules.list()).find((item) => item.name === params.name);

  if (existing) {
    if (existing.agentId !== params.agentId || existing.environmentId !== params.environmentId) {
      await client.schedules.delete(existing.id);
      const recreated = await client.schedules.create(params);
      console.log(`recreated schedule ${recreated.id}`);
      return recreated;
    }

    const updated = await client.schedules.update(existing.id, {
      name: params.name,
      description: params.description,
      task: params.task,
      cronExpression: params.cronExpression,
      timezone: params.timezone,
      enabled: params.enabled,
      metadata: params.metadata,
    });

    if (params.enabled) {
      await client.schedules.enable(updated.id);
    }

    console.log(`updated schedule ${updated.id}`);
    return updated;
  }

  const created = await client.schedules.create(params);
  console.log(`created schedule ${created.id}`);
  return created;
}
