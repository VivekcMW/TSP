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

/** Reminder emails open Create at /dashboard/create?article=<story URL>. */
export function storyLinkFromSearch(search: string): string | undefined {
  return storyLinkFromState({ [STORY_LINK_KEY]: new URLSearchParams(search).get("article") ?? undefined });
}

export function withoutArticleParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("article");
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
