import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Phase 6 owns this: newsletter forwarding and save-from-any-page. */
export function InputsPanel() {
  return <>
    <p className="text-muted-foreground">LinkedIn is the focus today. Other platforms stay available in Settings and will return here later.</p>
    <Button asChild variant="outline" className="w-full"><Link href="/dashboard/settings?tab=integrations">Open integrations</Link></Button>
    {["Newsletter forwarding", "Save from any page"].map(name => <div key={name} className="rounded-md border p-3">
      <p className="font-medium">{name}</p><p className="text-xs text-muted-foreground">Coming in a later phase.</p>
    </div>)}
  </>;
}
