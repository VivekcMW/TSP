import type { AdminMonitoring } from "@shared/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ExecutionHealth({ execution }: { execution: AdminMonitoring["execution"] }) {
  return <Card><CardHeader><CardTitle className="text-base">Scheduler execution observations</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-xs text-muted-foreground">Observed cycle completions, not per-worker liveness. Records expire after 30 days or Redis data loss. Stale means no observation within twice the configured cadence, with a five-minute minimum. Disabled tasks are not expected to run.</p>
    {!execution?.available ? <p className="text-sm text-muted-foreground">Execution observations unavailable.</p> : <ul className="divide-y">{execution.tasks.map(task => <li key={task.name} className="flex flex-wrap justify-between gap-3 py-3">
      <div><p className="font-medium">{task.name}</p><p className="text-xs text-muted-foreground">Configured cadence: {task.intervalMinutes} minutes</p><p className="text-xs text-muted-foreground">Last success: {task.lastSuccessAt ? new Date(task.lastSuccessAt).toLocaleString() : "Not observed"}</p></div>
      <Badge variant={task.state === "failed" || task.state === "stale" ? "warning" : task.state === "succeeded" ? "success" : "secondary"}>{task.state.replaceAll("_", " ")}</Badge>
    </li>)}</ul>}
  </CardContent></Card>;
}
