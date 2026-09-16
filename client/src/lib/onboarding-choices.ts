/** Match the server's 20-item limit without selecting hidden defaults. */
export function normalizeOnboardingChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const choices = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const trimmed = item.trim().slice(0, 100);
    if (!choices.has(trimmed.toLocaleLowerCase())) choices.set(trimmed.toLocaleLowerCase(), trimmed);
  }
  return [...choices.values()].slice(0, 20);
}

/** Selected AI/custom choices must be rendered even outside the static catalog. */
export function visibleOnboardingChoices(catalog: string[], selected: string[]): string[] {
  const choices = new Map<string, string>();
  for (const item of [...selected, ...catalog]) {
    if (!choices.has(item.toLocaleLowerCase())) choices.set(item.toLocaleLowerCase(), item);
  }
  return [...choices.values()];
}