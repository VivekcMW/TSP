import { publicationCandidatesSchema, selectedPublicationCandidates, type PublicationSourceStatus } from "@shared/publication-preferences";
import type { PublicationResolution, UserProfile } from "@shared/schema";
import { storage, type TenantScope } from "../storage.js";
import { CrawlError, crawlErrorMessage, mapCrawlSettled } from "./crawlerFetch.js";
import { discoverFeed } from "./feedDiscovery.js";

type PublicationProfile = Pick<UserProfile, "publications" | "publicationCandidates">;

function selection(profile: PublicationProfile) {
  const names = profile.publications ?? [];
  // Reconcile duplicate metadata first-seen, just like profile input validation.
  const metadata = publicationCandidatesSchema.parse(profile.publicationCandidates ?? []);
  return { names, metadata, candidates: selectedPublicationCandidates(names, metadata) };
}

function checking(row: PublicationResolution | undefined, now = Date.now()): boolean {
  return row?.status === "checking" && !!row.leaseUntil && new Date(row.leaseUntil).getTime() > now;
}

/** Durable oldest-attempt-first rotation; no process-local retry cursor. */
export async function resolvePublicationSources(scope: TenantScope, profile: PublicationProfile, parentSignal?: AbortSignal): Promise<string[]> {
  const { candidates } = selection(profile);
  if (!candidates.length || parentSignal?.aborted) return [];
  const rows = await storage.getPublicationResolutions(scope, candidates.map(candidate => candidate.url));
  const resolutions = new Map(rows.map(row => [row.url, row]));
  const now = Date.now();
  const eligible = candidates.filter(candidate => {
    const row = resolutions.get(candidate.url);
    return row?.status !== "resolved" && !checking(row, now);
  }).sort((a, b) => {
    const left = resolutions.get(a.url);
    const right = resolutions.get(b.url);
    // Never-attempted URLs precede retries; stable ties preserve selection order.
    if (!left) return right ? -1 : 0;
    if (!right) return 1;
    return new Date(left.lastAttemptAt).getTime() - new Date(right.lastAttemptAt).getTime();
  }).slice(0, 4);
  if (!eligible.length) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new CrawlError("timeout", "Publication discovery exceeded its time budget. Refresh to retry.")), 6000);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  try {
    const results = await mapCrawlSettled(eligible, 2, async candidate => {
      if (signal.aborted) return;
      // Storage rechecks the latest profile and excludes live leases/tombstones.
      const token = await storage.claimPublicationResolution(scope, candidate.url);
      if (!token) return;
      let discovered: Awaited<ReturnType<typeof discoverFeed>> | undefined;
      let failure: string | undefined;
      try {
        signal.throwIfAborted();
        // Abort cooperatively and await started discovery work/cleanup. A race
        // here could return while discovery was still crawling in the background.
        discovered = await discoverFeed(candidate.url, signal);
        signal.throwIfAborted();
        if ("error" in discovered) failure = crawlErrorMessage(new Error(discovered.error));
      } catch (error) {
        failure = crawlErrorMessage(error);
      }
      // Keep persistence OUTSIDE the discovery catch: a database failure is not
      // a crawler failure, and must propagate after all workers have settled.
      if (failure) {
        await storage.finishPublicationResolution(scope, candidate.url, token, { status: "failed", error: failure });
        return failure;
      }
      if (discovered && "feedUrl" in discovered) {
        const completed = await storage.completePublicationResolution(scope, candidate.url, token, {
          name: candidate.name, feedUrl: discovered.feedUrl, sourceType: discovered.sourceType,
        });
        if (!completed) return "Publication selection changed or its discovery lease expired. Refresh to retry.";
      }
    });
    const failures = results.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Could not persist publication source resolution. Please retry.");
    return results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const messages: Record<PublicationSourceStatus["status"], string> = {
  "needs-url": "Add this publication's website or feed URL in Preferences.",
  pending: "This publication will be checked on a Discover refresh.",
  checking: "Checking this publication's website or feed.",
  failed: "Could not connect this publication. Check its URL and try again.",
  connected: "This publication is connected to an active source.",
  paused: "This publication's source is paused. Resume it in Manage Sources.",
  removed: "This publication's source was removed. Add it manually to reconnect.",
};

function statusMessage(status: PublicationSourceStatus["status"], row: PublicationResolution | undefined): string {
  if (status === "removed" && !row?.resolvedFeedUrl) {
    return "This source was removed before reconnect tracking was available. Add it in Manage Sources; this publication status cannot be restored automatically.";
  }
  return messages[status];
}

/** A projection only: never claim, discover, repair, or write from a GET. */
export async function getPublicationSourceStatuses(scope: TenantScope): Promise<PublicationSourceStatus[]> {
  const profile = await storage.getUserProfile(scope);
  if (!profile) return [];
  const { names, metadata, candidates } = selection(profile);
  const [rows, sources] = await Promise.all([
    storage.getPublicationResolutions(scope, candidates.map(candidate => candidate.url)),
    storage.getUserSources(scope),
  ]);
  const resolutions = new Map(rows.map(row => [row.url, row]));
  const now = Date.now();
  const seen = new Set<string>();
  return names.flatMap(name => {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    // Resolve individually so aliases sharing a URL each retain a status row.
    const candidate = selectedPublicationCandidates([name], metadata)[0];
    const row = candidate && resolutions.get(candidate.url);
    const source = sources.find(source => row?.status === "resolved"
      ? source.id === row.sourceId : source.feedUrl === candidate?.url);
    let status: PublicationSourceStatus["status"];
    if (!candidate) status = "needs-url";
    else if (row?.status === "resolved" && !source) status = "removed";
    else if (source) status = source.isActive ? "connected" : "paused";
    else if (checking(row, now)) status = "checking";
    else if (row?.status === "failed") status = "failed";
    else status = "pending";
    return [{ name, ...(candidate ? { url: candidate.url } : {}), status, message: statusMessage(status, row),
      lastAttemptAt: row ? new Date(row.lastAttemptAt).toISOString() : null,
      ...(source ? { sourceId: source.id } : {}),
    }];
  });
}