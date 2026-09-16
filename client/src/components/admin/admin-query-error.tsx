import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AdminQueryError({ onRetry, message = "This admin data could not be loaded." }: Readonly<{ onRetry: () => void; message?: string }>) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center" role="alert">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  );
}
