import { apiRequest } from "@/lib/queryClient";

export const INPUTS_KEY = ["/api/inputs"] as const;

export interface ForwardingAddress { email: string | null; hint: string; createdAt: string; rotatedAt: string | null; disabled: boolean }
export interface InboundForward {
  id: string; fromName: string | null; fromAddress: string | null; subject: string | null; receivedAt: string;
  linksFound: number; itemsCreated: number; status: "processing" | "processed" | "confirmation"; confirmationCode: string | null;
}
export interface CaptureKey { id: string; label: string; hint: string; createdAt: string; lastUsedAt: string | null }
export interface NewCaptureKey extends CaptureKey { token: string }
export interface InputsState {
  forwarding: { available: boolean; domain: string | null; dailyLimit: number; address: ForwardingAddress | null; recent: InboundForward[] };
  capture: { tokens: CaptureKey[]; limit: number; hourlyLimit: number };
}

/** Chrome Web Store listing, once published (docs/external-inputs.md). */
export const EXTENSION_STORE_URL: string | undefined = import.meta.env?.VITE_CAPTURE_EXTENSION_URL || undefined;

export const inputsQuery = (enabled = true) => ({
  queryKey: INPUTS_KEY,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<InputsState> => (await apiRequest("GET", "/api/inputs", undefined, { signal })).json(),
  enabled,
  staleTime: 30_000,
});

export const createForwardingAddress = async (): Promise<ForwardingAddress> => (await apiRequest("POST", "/api/inputs/address")).json();
export const rotateForwardingAddress = async (): Promise<ForwardingAddress> => (await apiRequest("POST", "/api/inputs/address/rotate")).json();
export const turnOffForwardingAddress = async (): Promise<void> => { await apiRequest("DELETE", "/api/inputs/address"); };
export const createCaptureKey = async (label: string): Promise<NewCaptureKey> => (await apiRequest("POST", "/api/inputs/capture-tokens", { label })).json();
export const revokeCaptureKey = async (id: string): Promise<void> => { await apiRequest("DELETE", `/api/inputs/capture-tokens/${encodeURIComponent(id)}`); };

/** A bookmarklet that sends the current page (and any selected text) to /api/capture with the key. */
export function bookmarkletFor(origin: string, token: string): string {
  const code = `(()=>{const a=${JSON.stringify(origin)},k=${JSON.stringify(token)},s=String(getSelection()||"").trim().slice(0,2000),`
    + `b={url:location.href,title:document.title.slice(0,300)};if(s)b.selection=s;`
    + `fetch(a+"/api/capture",{method:"POST",headers:{Authorization:"Bearer "+k,"Content-Type":"application/json"},body:JSON.stringify(b)})`
    + `.then(r=>r.json().catch(()=>({})).then(j=>alert("TheSocialPundit: "+(r.ok?j.message||"Saved to your Shortlist.":"Not saved. "+(j.message||r.status)))))`
    + `.catch(()=>alert("TheSocialPundit: this page blocked the bookmarklet. Use the browser extension instead."))})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

export function forwardSender(forward: InboundForward): string {
  return forward.fromName || forward.fromAddress || "Unknown sender";
}

export function forwardOutcome(forward: InboundForward): string {
  if (forward.status === "confirmation") {
    return forward.confirmationCode ? `Gmail confirmation code ${forward.confirmationCode}` : "Gmail forwarding confirmation";
  }
  if (forward.status === "processing") return "Still processing";
  if (!forward.linksFound) return "No article links found";
  if (!forward.itemsCreated) return "No new links. They were already saved.";
  return `${forward.itemsCreated} ${forward.itemsCreated === 1 ? "link" : "links"} added to Shortlist`;
}

export function shortDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
}
