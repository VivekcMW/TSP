import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { setActiveTenantId } from "@/lib/active-tenant";

type AcceptState = { kind: "pending" } | { kind: "accepted"; tenantId: string } | { kind: "already_member" } | { kind: "error"; message: string };

function tokenFromSearch(search: string): string | null {
  const token = new URLSearchParams(search).get("token");
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "This invitation link is invalid or has expired.";
    if (error.status === 403) return "This invitation was sent to a different email address. Sign in with that address to accept it.";
    if (error.status === 400) return "This invitation link is invalid.";
  }
  return "We could not confirm this invitation. Please try again.";
}

export default function AcceptInvitePage() {
  const search = useSearch();
  const token = tokenFromSearch(search);
  const [state, setState] = useState<AcceptState>({ kind: "pending" });
  const submitting = useRef(false);

  useEffect(() => {
    if (!token) { setState({ kind: "error", message: "This invitation link is invalid." }); return; }
    if (submitting.current) return;
    submitting.current = true;
    void (async () => {
      try {
        const response = await apiRequest("POST", "/api/team-invitations/accept", { token });
        const result = await response.json();
        if (result.status === "accepted") {
          setActiveTenantId(result.tenantId);
          setState({ kind: "accepted", tenantId: result.tenantId });
        } else {
          setState({ kind: "already_member" });
        }
      } catch (error) {
        setState({ kind: "error", message: errorMessage(error) });
      }
    })();
  }, [token]);

  let content: React.ReactNode;
  if (state.kind === "pending") {
    content = <p className="text-sm text-muted-foreground">Confirming your invitation…</p>;
  } else if (state.kind === "accepted") {
    content = <div className="space-y-4">
      <output className="block text-sm text-success">You’ve joined the workspace.</output>
      <Button asChild className="w-full" data-testid="button-go-to-workspace"><Link href="/dashboard">Continue to workspace</Link></Button>
    </div>;
  } else if (state.kind === "already_member") {
    content = <div className="space-y-4">
      <p className="text-sm text-muted-foreground">You’re already a member of this workspace.</p>
      <Button asChild className="w-full"><Link href="/dashboard">Go to dashboard</Link></Button>
    </div>;
  } else {
    content = <div className="space-y-4">
      <p role="alert" className="text-sm text-destructive">{state.message}</p>
      <Button asChild variant="outline" className="w-full"><Link href="/dashboard">Go to dashboard</Link></Button>
    </div>;
  }

  return <main className="flex h-full min-w-0 flex-col overflow-hidden">
    <PageHeader width="reading" title="Workspace invitation" />
    <PageBody as="div" width="reading">
      <Card data-testid="accept-invite-page">
        <CardHeader><CardTitle>Join workspace</CardTitle><CardDescription>Accepting this invitation adds you to the workspace’s team.</CardDescription></CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
    </PageBody>
  </main>;
}
