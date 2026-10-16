import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { completeAnalyticsNavigation } from "@/lib/analytics-consent";

export function AnalyticsPage({ path }: { path?: string }) {
  const [location] = useLocation();
  const search = useSearch();
  useEffect(() => {
    completeAnalyticsNavigation(path ?? location);
  }, [path, location, search]);
  return null;
}
