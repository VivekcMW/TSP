import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import { queryClient } from "@/lib/queryClient";
import {
  bookmarkletFor, createCaptureKey, createForwardingAddress, EXTENSION_STORE_URL, forwardOutcome, forwardSender, INPUTS_KEY, inputsQuery,
  revokeCaptureKey, rotateForwardingAddress, shortDate, turnOffForwardingAddress, type CaptureKey, type ForwardingAddress, type InputsState, type NewCaptureKey,
} from "@/lib/inputs-queries";

type Toast = ReturnType<typeof useToast>["toast"];
const refresh = () => queryClient.invalidateQueries({ queryKey: INPUTS_KEY });
const failed = (toast: Toast, title: string) => (error: unknown) =>
  toast({ title, description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });

function useCopy() {
  const { toast } = useToast();
  return async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); }
    catch { toast({ title: "Couldn't copy", description: "Select the text and copy it yourself.", variant: "destructive" }); }
  };
}

/** Phase 6: newsletter forwarding and save-from-any-page, in the "More connectors" panel. */
export function InputsPanel() {
  const signedIn = useIsSignedIn();
  const inputs = useQuery(inputsQuery(signedIn));
  return <>
    <p className="text-muted-foreground">LinkedIn is the focus today. Other platforms stay available in Settings and will return here later.</p>
    <Button asChild variant="outline" className="w-full"><Link href="/dashboard/settings?tab=integrations">Open integrations</Link></Button>
    {inputs.isLoading ? <p className="text-xs text-muted-foreground">Loading inputs…</p>
      : inputs.isError || !inputs.data ? <div role="alert" className="rounded-md border p-3 text-xs">
          <p>Newsletter forwarding and saving from other pages could not be loaded.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void inputs.refetch()}>Try again</Button>
        </div>
      : <>
          <ForwardNewsletters state={inputs.data} />
          <SaveFromAnyPage state={inputs.data} />
        </>}
  </>;
}

function ForwardNewsletters({ state }: Readonly<{ state: InputsState }>) {
  const { toast } = useToast();
  const copy = useCopy();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"rotate" | "off" | null>(null);
  const { available, address, domain, recent, dailyLimit } = state.forwarding;
  const shown = (result: ForwardingAddress) => { setRevealed(result.email); setConfirming(null); void refresh(); };
  const create = useMutation({ mutationFn: createForwardingAddress, onSuccess: shown, onError: failed(toast, "Couldn't create the address") });
  const rotate = useMutation({
    mutationFn: rotateForwardingAddress,
    onSuccess: result => { shown(result); toast({ title: "New address ready", description: "The old address no longer works. Update your forwarding." }); },
    onError: failed(toast, "Couldn't replace the address"),
  });
  const turnOff = useMutation({
    mutationFn: turnOffForwardingAddress,
    onSuccess: () => { setRevealed(null); setConfirming(null); void refresh(); toast({ title: "Forwarding turned off" }); },
    onError: failed(toast, "Couldn't turn off forwarding"),
  });
  const active = address && !address.disabled;
  const email = active ? address.email ?? revealed : null;
  const busy = create.isPending || rotate.isPending || turnOff.isPending;

  return <section aria-labelledby="inputs-forward-heading" className="space-y-2 rounded-md border p-3" data-testid="section-forward-newsletters">
    <h3 id="inputs-forward-heading" className="font-medium">Forward newsletters</h3>
    {!available ? <p className="text-xs text-muted-foreground" data-testid="text-forwarding-unavailable">Newsletter forwarding is not available in this environment.</p>
      : !active ? <>
          <p className="text-xs text-muted-foreground">Get a private email address. Newsletters you forward to it add their article links to your Shortlist.</p>
          <Button size="sm" disabled={busy} onClick={() => create.mutate()} data-testid="button-create-forwarding-address">
            {create.isPending ? "Creating…" : address?.disabled ? "Turn on with a new address" : "Create address"}
          </Button>
        </>
      : <>
          {email ? <>
            <p className="text-xs text-muted-foreground">Your forwarding address</p>
            <div className="flex items-start gap-1">
              <p className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted px-2 py-1.5 font-mono text-xs" data-testid="text-forwarding-address">{email}</p>
              <Button size="sm" variant="outline" className="h-8 shrink-0 px-2" aria-label="Copy forwarding address" onClick={() => void copy(email, "Address")} data-testid="button-copy-forwarding-address">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </>
            : <p className="text-xs">Your forwarding address ends in …{address.hint}@{domain}. Replace it to see a full address again.</p>}
          <p className="text-xs text-muted-foreground">Keep it private: anyone who has it can add links to your Shortlist. Up to {dailyLimit} emails a day.</p>
          <details className="text-xs">
            <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How to forward from Gmail</summary>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>In Gmail settings, open Forwarding and add this address.</li>
              <li>Gmail sends a confirmation code. It appears under Recent forwards below.</li>
              <li>Create a filter for your newsletters and choose Forward to this address.</li>
            </ol>
          </details>
          {confirming ? <div role="group" aria-label="Confirm" className="space-y-2 rounded-md bg-muted p-2 text-xs">
              <p>{confirming === "rotate" ? "Your current address stops working right away." : "Emails sent to this address will be ignored."}</p>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant={confirming === "off" ? "destructive" : "default"} disabled={busy} autoFocus
                  onClick={() => (confirming === "rotate" ? rotate.mutate() : turnOff.mutate())} data-testid="button-confirm-forwarding-change">
                  {confirming === "rotate" ? "Replace address" : "Turn off"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
              </div>
            </div>
            : <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming("rotate")} data-testid="button-rotate-forwarding-address">Replace address</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming("off")}>Turn off</Button>
            </div>}
        </>}
    {available && <RecentForwards recent={recent} />}
  </section>;
}

function RecentForwards({ recent }: Readonly<{ recent: InputsState["forwarding"]["recent"] }>) {
  return <div className="space-y-1 pt-1">
    <h4 className="text-xs font-medium" id="inputs-recent-forwards">Recent forwards</h4>
    {recent.length ? <ul aria-labelledby="inputs-recent-forwards" className="divide-y rounded-md border" data-testid="list-recent-forwards">
        {recent.map(forward => <li key={forward.id} className="min-w-0 p-2 text-xs" data-testid={`forward-${forward.id}`}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate font-medium" title={forward.fromAddress ?? undefined}>{forwardSender(forward)}</p>
            <time className="shrink-0 text-muted-foreground" dateTime={forward.receivedAt}>{shortDate(forward.receivedAt)}</time>
          </div>
          {forward.subject && <p className="truncate text-muted-foreground" title={forward.subject}>{forward.subject}</p>}
          <p className={forward.status === "confirmation" ? "font-medium" : undefined}>{forwardOutcome(forward)}</p>
        </li>)}
      </ul>
      : <p className="text-xs text-muted-foreground">Nothing forwarded yet.</p>}
  </div>;
}

function SaveFromAnyPage({ state }: Readonly<{ state: InputsState }>) {
  const { toast } = useToast();
  const [label, setLabel] = useState("Browser");
  const [created, setCreated] = useState<NewCaptureKey | null>(null);
  const { tokens, limit, hourlyLimit } = state.capture;
  const create = useMutation({
    mutationFn: createCaptureKey,
    onSuccess: key => { setCreated(key); void refresh(); },
    onError: failed(toast, "Couldn't create the key"),
  });
  const revoke = useMutation({
    mutationFn: async (key: CaptureKey) => { await revokeCaptureKey(key.id); return key; },
    onSuccess: key => {
      if (created?.id === key.id) setCreated(null);
      void refresh();
      toast({ title: "Key revoked", description: `“${key.label}” can no longer save pages.` });
    },
    onError: failed(toast, "Couldn't revoke the key"),
  });
  const atLimit = tokens.length >= limit;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (label.trim() && !atLimit && !create.isPending) create.mutate(label.trim());
  };

  return <section aria-labelledby="inputs-capture-heading" className="space-y-2 rounded-md border p-3" data-testid="section-save-from-any-page">
    <h3 id="inputs-capture-heading" className="font-medium">Save from any page</h3>
    <p className="text-xs text-muted-foreground">Save the page you are reading to your Shortlist with the browser extension or a bookmarklet. Selected text is kept as a note.</p>
    {created ? <NewKey created={created} onRevoke={() => revoke.mutate(created)} revoking={revoke.isPending} onDone={() => setCreated(null)} />
      : <form onSubmit={submit} className="space-y-1">
          <label htmlFor="inputs-key-label" className="block text-xs text-muted-foreground">Key name</label>
          <div className="flex gap-1">
            <Input id="inputs-key-label" value={label} maxLength={60} onChange={event => setLabel(event.target.value)} className="h-8 min-w-0 flex-1 text-xs" disabled={atLimit} data-testid="input-capture-key-label" />
            <Button type="submit" size="sm" className="h-8 shrink-0" disabled={!label.trim() || atLimit || create.isPending} data-testid="button-create-capture-key">
              {create.isPending ? "Creating…" : "Create key"}
            </Button>
          </div>
          {atLimit && <p className="text-xs text-muted-foreground">You have {limit} keys. Revoke one to create another.</p>}
        </form>}
    <details className="text-xs">
      <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Install the browser extension</summary>
      <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
        {EXTENSION_STORE_URL
          ? <li>Add it from the <a href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer" className="text-primary underline">Chrome Web Store</a>.</li>
          : <li>Get the extension folder from your administrator. In Chrome, open chrome://extensions, turn on Developer mode, choose Load unpacked and select the folder.</li>}
        <li>Open the extension options. Enter <span className="break-all font-mono">{window.location.origin}</span> and a key, then allow access when Chrome asks.</li>
        <li>Use the toolbar button, or right-click a page, link or selected text and choose Save to TheSocialPundit.</li>
      </ol>
    </details>
    <div className="space-y-1">
      <h4 className="text-xs font-medium" id="inputs-capture-keys">Your keys</h4>
      {tokens.length ? <ul aria-labelledby="inputs-capture-keys" className="divide-y rounded-md border" data-testid="list-capture-keys">
          {tokens.map(key => <li key={key.id} className="flex items-center gap-2 p-2 text-xs" data-testid={`capture-key-${key.id}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{key.label} <span className="font-mono font-normal text-muted-foreground">…{key.hint}</span></p>
              <p className="text-muted-foreground">Created {shortDate(key.createdAt)} · {key.lastUsedAt ? `Last used ${shortDate(key.lastUsedAt)}` : "Not used yet"}</p>
            </div>
            <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" disabled={revoke.isPending} aria-label={`Revoke key ${key.label}`}
              onClick={() => revoke.mutate(key)} data-testid={`button-revoke-capture-key-${key.id}`}>Revoke</Button>
          </li>)}
        </ul>
        : <p className="text-xs text-muted-foreground">No keys yet.</p>}
      <p className="text-xs text-muted-foreground">Each key can save up to {hourlyLimit} pages an hour.</p>
    </div>
  </section>;
}

function NewKey({ created, onRevoke, revoking, onDone }: Readonly<{ created: NewCaptureKey; onRevoke: () => void; revoking: boolean; onDone: () => void }>) {
  const { toast } = useToast();
  const copy = useCopy();
  const origin = window.location.origin;
  const bookmarklet = bookmarkletFor(origin, created.token);
  return <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-xs" data-testid="new-capture-key">
    <p role="status" className="font-medium">Copy your key now. It is shown only once.</p>
    <div className="flex items-start gap-1">
      <p className="min-w-0 flex-1 select-all break-all rounded-md border bg-card px-2 py-1.5 font-mono" data-testid="text-new-capture-key">{created.token}</p>
      <Button size="sm" variant="outline" className="h-8 shrink-0 px-2" aria-label="Copy key" onClick={() => void copy(created.token, "Key")} data-testid="button-copy-capture-key">
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
    <p>In the extension options, use this app address: <span className="break-all font-mono">{origin}</span></p>
    <p>Or drag this button to your bookmarks bar:</p>
    {/* href is set through the DOM: React warns about javascript: URLs, and this one is meant for the bookmarks bar, not for clicking here. */}
    <a ref={element => element?.setAttribute("href", bookmarklet)} draggable="true"
      onClick={event => { event.preventDefault(); toast({ title: "Drag it to your bookmarks bar", description: "Then click it on any page to save that page." }); }}
      className="inline-flex rounded-md border bg-card px-2 py-1 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="link-bookmarklet">Save to TheSocialPundit</a>
    <p className="text-muted-foreground">Anyone with this key or bookmarklet can add pages to your Shortlist. A page you use the bookmarklet on could read the key, so the extension is safer. If you lose the key, revoke it.</p>
    <div className="flex flex-wrap gap-1">
      <Button size="sm" onClick={onDone} data-testid="button-done-capture-key">Done</Button>
      <Button size="sm" variant="ghost" disabled={revoking} onClick={onRevoke}>Revoke this key</Button>
    </div>
  </div>;
}
