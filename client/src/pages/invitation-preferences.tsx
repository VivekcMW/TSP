import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const invalidMessage = "This invitation preferences link is invalid or expired. Please use the link from your invitation.";

export default function InvitationPreferencesPage() {
  // Keep the token only in component memory, never in query caches, storage,
  // rendered text or history state. A pure initializer also survives StrictMode.
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [state, setState] = useState<"ready" | "pending" | "done" | "invalid" | "error">("ready");
  const inFlight = useRef(false);
  useLayoutEffect(() => {
    const stripHash = () => {
      if (window.location.hash) history.replaceState(history.state, "", window.location.pathname + window.location.search);
    };
    const captureHash = () => {
      if (!window.location.hash) return;
      // Opening another email link can be a same-document navigation. Never
      // replace the intent of an explicit request that is already in flight.
      if (!inFlight.current) {
        setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
        setState("ready");
      }
      stripHash();
    };
    stripHash();
    window.addEventListener("hashchange", captureHash);
    return () => window.removeEventListener("hashchange", captureHash);
  }, []);

  async function unsubscribe() {
    if (!token || inFlight.current || state === "done" || state === "invalid") return;
    inFlight.current = true;
    setState("pending");
    try {
      // Deliberately independent of account availability and authentication.
      const response = await fetch("/api/public/invitations/unsubscribe", {
        method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if ([400, 404, 410].includes(response.status)) { setState("invalid"); setToken(""); }
      else if (response.ok) { setState("done"); setToken(""); }
      else setState("error");
    } catch {
      setState("error");
    } finally {
      inFlight.current = false;
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
    <Card className="w-full max-w-lg">
      <CardHeader><p className="text-sm text-muted-foreground">TheSocialPundit</p><CardTitle><h1>Invitation preferences</h1></CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {state === "done" && <output className="block">Your preference has been saved. You will not receive further friend invitations.</output>}
        {state !== "done" && (!token || state === "invalid") && <p role="alert">{invalidMessage}</p>}
        {token && state !== "done" && state !== "invalid" && <><p className="text-sm text-muted-foreground">Choose below to stop receiving friend invitations from TheSocialPundit. Nothing changes until you confirm.</p>
              {state === "error" && <p role="alert" className="text-sm text-destructive">We could not save your preference. Please try again.</p>}
              <Button type="button" disabled={state === "pending"} onClick={() => void unsubscribe()}>{state === "pending" ? "Saving…" : "Stop friend invitations"}</Button></>}
      </CardContent>
    </Card>
  </main>;
}