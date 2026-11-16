import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Phase 3 owns this: the side-panel view of the 30-day plan (posting slots, ideas, moments). */
export function PlanPanel() {
  return <>
    <p className="text-muted-foreground">See scheduled posts by date.</p>
    <Button asChild variant="outline" className="w-full"><Link href="/dashboard/calendar">Open Calendar</Link></Button>
  </>;
}
