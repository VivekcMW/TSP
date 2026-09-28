import { fetchPublicText } from "./crawlerFetch.js";

/**
 * Minimal robots.txt support for the shared-index crawler: the group for our agent (else
 * `*`), `Allow`/`Disallow` with `*` and `$`, longest match wins, ties allow. One fetch per
 * host, remembered for a day; a missing or unreadable file means permission.
 */
export const CRAWLER_AGENT = "TheSocialPundit";
const REMEMBER_MS = 24 * 60 * 60_000;
const REMEMBER_FAILURE_MS = 6 * 60 * 60_000;
const MAX_HOSTS = 2000;

interface Rule { allow: boolean; pattern: RegExp; specificity: number }
export interface RobotsRules { allows(path: string): boolean }

const ALLOW_ALL: RobotsRules = { allows: () => true };
const remembered = new Map<string, { rules: RobotsRules; expiresAt: number }>();

function compile(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path).split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function parseRobots(text: string, agent: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | undefined;
  let collectingAgents = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || !collectingAgents) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      collectingAgents = false;
      if (!value) continue;
      current.rules.push({ allow: field === "allow", pattern: compile(value), specificity: value.length });
    }
  }
  const wanted = agent.toLowerCase();
  const group = groups.find(g => g.agents.some(a => a !== "*" && wanted.includes(a))) ?? groups.find(g => g.agents.includes("*"));
  if (!group || !group.rules.length) return ALLOW_ALL;
  return {
    allows(path) {
      let best: Rule | undefined;
      for (const rule of group.rules) {
        if (!rule.pattern.test(path)) continue;
        if (!best || rule.specificity > best.specificity || (rule.specificity === best.specificity && rule.allow)) best = rule;
      }
      return best ? best.allow : true;
    },
  };
}

/** Test hook: forget every remembered host. */
export function forgetRobots() { remembered.clear(); }

export async function isAllowedByRobots(rawUrl: string, signal?: AbortSignal): Promise<boolean> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  const key = url.origin;
  const known = remembered.get(key);
  const now = Date.now();
  let rules = known && known.expiresAt > now ? known.rules : undefined;
  if (!rules) {
    let expiresAt = now + REMEMBER_MS;
    try {
      const page = await fetchPublicText(`${key}/robots.txt`, { signal, timeoutMs: 5000, maxBytes: 512 * 1024 });
      rules = page.status === 200 ? parseRobots(page.text, CRAWLER_AGENT) : ALLOW_ALL;
    } catch {
      rules = ALLOW_ALL;
      expiresAt = now + REMEMBER_FAILURE_MS;
    }
    if (remembered.size >= MAX_HOSTS) remembered.delete(remembered.keys().next().value!);
    remembered.set(key, { rules, expiresAt });
  }
  return rules.allows(url.pathname + url.search);
}
