export function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function printHeading(title) {
  console.log(`\n=== ${title} ===`);
}

export function printJson(label, value) {
  console.log(`${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

export function summarizeEventItem(item) {
  if (!item) {
    return 'unknown item';
  }
  if (item.type === 'tool_call') {
    return `tool_call:${item.name ?? 'unknown-tool'}`;
  }
  if (item.type === 'reasoning') {
    return `reasoning:${String(item.content ?? '').slice(0, 80)}`;
  }
  if (item.type === 'text') {
    return `text:${String(item.content ?? '').slice(0, 80)}`;
  }
  return item.type ?? 'unknown-item';
}

export function extractJsonPayload(text) {
  const input = String(text || '').trim();
  if (!input) {
    throw new Error('The model response was empty.');
  }

  const fencedMatch = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : input;

  try {
    return JSON.parse(candidate);
  } catch {}

  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
  }

  throw new Error('Could not parse JSON from the model response.');
}
