import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSettingsDirty } from "./settings-navigation-guard";

interface InvitationTemplate { subject: string; body: string; enabled?: boolean }
interface Inviter { name?: string | null; firstName?: string | null; lastName?: string | null }
const acceptedMessage = "Invitation requested. If the address is eligible, we will send it.";

function requestError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return "Check the email, first name, and permission, then try again.";
    if (error.status === 429) return "Your daily invitation limit has been reached. Please try again later.";
    if (error.status === 503) return "Invitations are temporarily unavailable. Please try again later.";
    if (error.status === 401 || error.status === 403) return "Please sign in again before requesting an invitation.";
    if (error.status === 409) return "This request was already used with different details. Refresh Settings before trying again.";
  }
  return "We could not confirm your invitation request. Please retry with the same details.";
}

export function InvitationSettings() {
  const [email, setEmail] = useState("");
  const [emailValid, setEmailValid] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [consent, setConsent] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  // Memory only: edits, tab switches and failed requests must not turn a retry
  // of an already-submitted email/name pair into another invitation request.
  const requestIds = useRef(new Map<string, string>());
  useSettingsDirty(Boolean(email || firstName || consent || pending));

  const me = useQuery<Inviter | null>({ queryKey: ["/api/me"], retry: false });
  const template = useQuery<InvitationTemplate>({
    queryKey: ["/api/invitations/template"],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", "/api/invitations/template", undefined, { signal });
      const value = await response.json();
      if (typeof value?.subject !== "string" || typeof value?.body !== "string") throw new Error("Invalid template");
      return value;
    },
  });
  const inviterName = me.data?.name?.trim()
    || [me.data?.firstName, me.data?.lastName].filter(Boolean).join(" ").trim()
    || "Your friend";
  // One pass prevents supplied names containing placeholder syntax or '$&'
  // from being interpreted as another replacement. React renders plain text.
  const previewText = (text: string) => text.replace(/\{FirstName\}|\{InviterName\}|\{link\}/g, (placeholder) => {
    if (placeholder === "{FirstName}") return firstName.trim() || "there";
    return placeholder === "{InviterName}" ? inviterName : "Your signup link";
  });
  const sendingAvailable = template.data?.enabled === true;
  const canSubmit = sendingAvailable && emailValid && consent && firstName.trim().length <= 80 && !pending;
  let sendLabel = sendingAvailable ? "Send invitation" : "Sending unavailable";
  if (pending) sendLabel = "Requesting…";
  let previewContent = <output>Loading preview…</output>;
  if (template.isError || me.isError || me.data === null) {
    previewContent = <div className="space-y-3"><p role="alert">The invitation preview is unavailable. Please try again.</p><Button type="button" variant="outline" disabled={pending || template.isFetching || me.isFetching} onClick={() => { void template.refetch(); void me.refetch(); }}>Retry preview</Button></div>;
  } else if (template.data && me.data) {
    previewContent = <><p className="whitespace-pre-wrap break-words"><strong>Subject: </strong>{previewText(template.data.subject)}</p><div className="whitespace-pre-wrap break-words text-sm">{previewText(template.data.body)}</div><p className="text-xs text-muted-foreground">Preview only. “Your signup link” stands in for the signup link.</p></>;
  }

  async function sendInvitation() {
    if (inFlight.current) return;
    setAccepted(false);
    if (!form.current?.reportValidity()) return;
    if (!email.trim() || firstName.trim().length > 80 || !consent) {
      setError("Enter a valid email, a first name of at most 80 characters, and confirm permission.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const values = { email: email.trim().toLowerCase(), ...(firstName.trim() ? { firstName: firstName.trim() } : {}) };
      const key = JSON.stringify(values);
      let requestId = requestIds.current.get(key);
      if (!requestId) {
        requestId = crypto.randomUUID();
        requestIds.current.set(key, requestId);
      }
      const response = await apiRequest("POST", "/api/invitations", { ...values, consent: true, requestId });
      const result = await response.json();
      if (response.status !== 202 || result?.status !== "accepted") throw new Error("Unexpected invitation response");
      setAccepted(true);
      setEmail("");
      setEmailValid(false);
      setFirstName("");
      setConsent(false);
      setShowPreview(false);
      requestIds.current.clear();
    } catch (error_) {
      setError(requestError(error_));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <Card>
    <CardHeader><CardTitle>Invite friends</CardTitle><CardDescription>Request a single invitation for someone who has given you permission.</CardDescription></CardHeader>
    <CardContent className="space-y-6">
      <p className="text-sm text-muted-foreground">Up to 5 invitations a day. Your friend chooses whether to sign up; we won’t subscribe them or send reminders.</p>
      {template.data?.enabled === false && <output id="invitation-unavailable" className="block text-sm text-muted-foreground">Sending invitations is not enabled in this environment. You can still preview the email.</output>}
      <form ref={form} className="space-y-4" onSubmit={(event) => event.preventDefault()}>
        <fieldset disabled={pending} className="min-w-0 space-y-4">
          <Field id="invitation-email" label="Friend’s email" render={(controlProps) => <Input {...controlProps} type="email" maxLength={254} required autoComplete="off" value={email} onChange={(event) => { setEmail(event.target.value); setEmailValid(event.target.validity.valid); setAccepted(false); }} />} />
          <Field id="invitation-first-name" label="First name (optional)" render={(controlProps) => <Input {...controlProps} maxLength={80} autoComplete="off" value={firstName} onChange={(event) => { setFirstName(event.target.value); setAccepted(false); }} />} />
          <label className="flex min-h-11 items-center gap-3 text-sm" htmlFor="invitation-consent"><span className="flex h-11 w-11 shrink-0 items-center justify-center"><input id="invitation-consent" type="checkbox" required checked={consent} onChange={(event) => { setConsent(event.target.checked); setAccepted(false); }} className="h-4 w-4 accent-primary" /></span>I have permission to send this person one invitation.</label>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" aria-expanded={showPreview} aria-controls="invitation-preview" onClick={() => setShowPreview((value) => !value)}>Preview invitation</Button>
            <Button type="button" data-testid="button-send-invitation" disabled={!canSubmit} aria-describedby={template.data?.enabled === false ? "invitation-unavailable" : undefined} onClick={() => void sendInvitation()}>{sendLabel}</Button>
          </div>
        </fieldset>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {accepted && <output className="block text-sm text-success">{acceptedMessage}</output>}
      {showPreview && <section id="invitation-preview" aria-label="Invitation preview" className="space-y-3 rounded-md border bg-muted/30 p-4">
        <h3 className="font-semibold">Invitation preview</h3>
        {previewContent}
      </section>}
    </CardContent>
  </Card>;
}