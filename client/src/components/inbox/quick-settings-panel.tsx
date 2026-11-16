import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Phase 4 owns this: Gmail-style quick settings. */
export function QuickSettingsPanel() {
  return <Button asChild variant="outline" className="w-full"><Link href="/dashboard/settings">See all settings</Link></Button>;
}
