export function filterEnabledPlatforms(enabledPlatforms: string[] | undefined, disabledPlatforms: Set<string>): string[] {
  const base = enabledPlatforms ?? [];
  return base.filter((platform) => !disabledPlatforms.has(platform));
}
