/** Onboarding's "Write a post" opens Create with a story link carried in navigation state. */
export const STORY_LINK_KEY = "createFromUrl";

export function storyLinkFromState(state: unknown): string | undefined {
  if (!state || typeof state !== "object") return undefined;
  const value = (state as Record<string, unknown>)[STORY_LINK_KEY];
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function withoutStoryLink(state: unknown): unknown {
  if (!state || typeof state !== "object") return state;
  const { [STORY_LINK_KEY]: _link, ...rest } = state as Record<string, unknown>;
  return rest;
}
