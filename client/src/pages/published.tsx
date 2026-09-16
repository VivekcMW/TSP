import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getPlatformMeta } from "@/lib/platforms";
import { PageHeader } from "@/components/dashboard/page-header";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import type { Draft, PublishJobLog } from "@shared/schema";

function MediaPreview({ media }: { media: Draft["media"] }) {
  if (!media?.length) return null;
  return <div className="mt-4 flex flex-wrap gap-2">{media.map((item) => item.type === "image" ? <img key={item.id} src={item.url} alt={item.name} className="h-20 w-20 rounded-md border object-cover" /> : <Badge key={item.id} variant="outline" className="h-8 gap-1"><span className="capitalize">{item.type}</span><span className="max-w-28 truncate">{item.name}</span></Badge>)}</div>;
}

function PublishLogs({ draftId }: { draftId: string }) {
  const { data: logs = [] } = useQuery<PublishJobLog[]>({ queryKey: [`/api/drafts/${draftId}/publish-logs`] });
  if (!logs.length) return <p className="mt-3 text-xs text-muted-foreground">No publish log is available yet.</p>;
  return <ScrollArea className="mt-3 max-h-24 rounded-md border bg-muted/30"><div className="space-y-1 p-2">{logs.map((log) => <div key={log.id} className="flex items-center justify-between gap-3 text-xs"><span className="capitalize">{log.status} · attempt {log.attempt}/{log.maxAttempts}</span>{log.errorMessage ? <span className="truncate text-destructive">{log.errorMessage}</span> : <span className="text-muted-foreground">{log.publishedPostId ?? "Recorded"}</span>}</div>)}</div></ScrollArea>;
}

export default function PublishedPage() {
  const { data: drafts = [], isLoading, isError, error, refetch } = useQuery<Draft[]>({ queryKey: ["/api/drafts/published"] });
  return <div className="flex flex-col h-full overflow-hidden"><PageHeader icon={Send} title="Published" subtitle={`${drafts.length} post${drafts.length === 1 ? "" : "s"} published`} /><main className="flex-1 overflow-y-auto p-6">{isLoading ? <div className="mx-auto grid max-w-3xl gap-4">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-40 w-full" />)}</div> : isError ? <DashboardEmptyState icon={AlertTriangle} title="Published history is unavailable" description={error instanceof Error ? error.message : "We couldn't load your published history."} action={<Button onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>} /> : !drafts.length ? <DashboardEmptyState icon={FileText} title="No published posts yet" description="Publish a draft and its real delivery status will appear here." /> : <div className="mx-auto grid max-w-3xl gap-4">{drafts.map((draft) => { const platform = getPlatformMeta(draft.platform); const Icon = platform.icon; return <Card key={draft.id} className="hover-elevate hover-lift" data-testid={`card-published-${draft.id}`}><CardContent className="p-5"><div className="mb-3 flex items-start justify-between gap-4"><Badge variant="secondary" className="gap-1"><Icon className="h-3 w-3" />{platform.label}</Badge><span className="text-xs text-muted-foreground">{draft.publishedAt ? new Date(draft.publishedAt).toLocaleString() : "Published"}</span></div><p className="whitespace-pre-wrap text-sm leading-relaxed">{draft.content}</p><MediaPreview media={draft.media} /><PublishLogs draftId={draft.id} /></CardContent></Card>; })}</div>}</main></div>;
}
