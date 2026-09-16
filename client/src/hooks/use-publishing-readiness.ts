import { useQueries, useQuery } from "@tanstack/react-query";
import type { UserProfile } from "@shared/schema";
import { DIRECT_PUBLISH_PLATFORMS, type PublishingConnection, type PublishingIntegration, type PublishingRule, type ReadinessData } from "@/lib/publishing";

export function usePublishingReadiness(enabled = true): ReadinessData {
  const options = { enabled, staleTime: 30_000, refetchOnWindowFocus: true, refetchInterval: enabled ? 30_000 : false } as const;
  const profile = useQuery<UserProfile>({ queryKey: ["/api/profile"], ...options });
  const integrations = useQuery<PublishingIntegration[]>({ queryKey: ["/api/integrations"], ...options });
  const rules = useQuery<PublishingRule[]>({ queryKey: ["/api/publishing-rules"], ...options });
  const connections = useQueries({ queries: DIRECT_PUBLISH_PLATFORMS.map((platform) => ({
    queryKey: [`/api/integrations/${platform}/status`], ...options,
    enabled: enabled && !!integrations.data?.some((item) => item.key === platform && item.enabled),
  })) });
  return {
    profile: profile.data, integrations: integrations.data, rules: rules.data,
    unavailable: profile.isError || integrations.isError || rules.isError,
    connections: Object.fromEntries(DIRECT_PUBLISH_PLATFORMS.map((platform, index) => [platform,
      connections[index].isError ? undefined : connections[index].data as PublishingConnection | undefined])),
  };
}