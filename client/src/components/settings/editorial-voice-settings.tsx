import { useState } from "react";
import { editorialVoiceSchema, voiceMutationSchema, type EditorialVoice } from "@shared/editorial-voice";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsDirty } from "./settings-navigation-guard";

export async function loadVoice(): Promise<EditorialVoice> {
  return editorialVoiceSchema.parse(await (await apiRequest("GET", "/api/editorial/voice")).json());
}
export async function changeVoice(input: unknown): Promise<EditorialVoice> {
  const change = voiceMutationSchema.parse(input);
  return editorialVoiceSchema.parse(await (await apiRequest("PATCH", "/api/editorial/voice", change)).json());
}

/** No history fetch, extraction, or automatic retention. Opening is read-only. */
export function EditorialVoiceSettings() {
  const [voice, setVoice] = useState<EditorialVoice | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [origin, setOrigin] = useState<"explicit-sample" | "approved-edit">("explicit-sample");
  useSettingsDirty(busy || Boolean(text.trim()) || editing !== null);
  async function load() {
    setBusy(true); setError(""); setOpen(true);
    try { setVoice(await loadVoice()); }
    catch { setError("Could not load voice settings. Retry loading; no changes were made."); }
    finally { setBusy(false); }
  }
  async function mutate(action: Record<string, unknown>) {
    if (!voice || busy) return;
    setBusy(true); setError("");
    try {
      setVoice(await changeVoice({ ...action, revision: voice.revision }));
      if (action.action === "add" || action.action === "edit" || action.id === editing) {
        setText(""); setEditing(null); setConsent(false);
      }
    } catch { setError("Change could not be confirmed. Reload voice settings before retrying; your text is still here."); }
    finally { setBusy(false); }
  }
  const valid = text.trim().length >= 20 && text.trim().length <= 1000 && consent;
  return <section aria-label="Optional editorial voice" className="mb-6 space-y-3 rounded-lg border bg-card p-4 text-sm">
    <h3 className="font-semibold">Optional editorial voice</h3>
    <p>Off by default. Only samples you explicitly approve are retained. No private history is inferred. Samples guide tone, not facts or identity; they never authorize impersonation.</p>
    <Button variant="outline" disabled={busy} onClick={() => void load()}>{open ? "Reload voice settings" : "Manage optional voice"}</Button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {open && voice && <>
      <p>Voice is <strong>{voice.enabled ? "on" : "off"}</strong>. Existing four tones and source rules remain in effect.</p>
      <Button variant="outline" disabled={busy} onClick={() => void mutate({ action: "enable", enabled: !voice.enabled, consent: true })}>{voice.enabled ? "Disable voice guidance" : "Enable approved samples as tone guidance"}</Button>
      <p className="text-xs text-muted-foreground">Up to five samples, 20–1,000 characters each, including removed samples. Remove stops future use and keeps a reversible copy here until you permanently forget it. A request already sent to a provider cannot be recalled.</p>
      <ul className="space-y-3">{voice.samples.map(sample => <li key={sample.id} className="space-y-2 rounded-md border p-3">
        <p className="whitespace-pre-wrap break-words">{sample.text}</p>
        <p className="text-xs">{sample.origin === "approved-edit" ? "Explicitly approved edit" : "Explicit sample"}{sample.deletedAt ? " · Removed — not used" : " · Approved"}</p>
        <div className="flex flex-wrap gap-2">
          {sample.deletedAt ? <>
            <Button variant="outline" disabled={busy} onClick={() => void mutate({ action: "restore", id: sample.id, consent: true })}>Approve and restore sample</Button>
            <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm("Permanently forget this removed sample? This cannot be undone.")) void mutate({ action: "forget", id: sample.id, confirm: true }); }}>Permanently forget sample</Button>
          </> : <>
            <Button variant="outline" disabled={busy} onClick={() => { setEditing(sample.id); setText(sample.text); setConsent(false); }}>Edit sample</Button>
            <Button variant="outline" disabled={busy} onClick={() => void mutate({ action: "delete", id: sample.id })}>Remove sample</Button>
          </>}
        </div>
      </li>)}</ul>
      <label className="block space-y-1">{editing ? "Edit voice sample" : "New voice sample"}<Textarea aria-label="Voice sample text" value={text} disabled={busy} maxLength={1000} onChange={event => { setText(event.target.value); setConsent(false); }} /></label>
      {!editing && <label className="block">Sample type <select aria-label="Sample type" className="rounded-md border bg-background p-2" disabled={busy} value={origin} onChange={event => { setOrigin(event.target.value as typeof origin); setConsent(false); }}><option value="explicit-sample">My explicit writing sample</option><option value="approved-edit">An edit I explicitly approve</option></select></label>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />I approve retaining this exact text as optional tone guidance and have permission to use it.</label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !valid || (!editing && voice.samples.length >= 5)} onClick={() => void mutate(editing ? { action: "edit", id: editing, text, consent: true } : { action: "add", text, origin, consent: true })}>{editing ? "Approve sample changes" : "Approve and add sample"}</Button>
        {editing && <Button variant="outline" disabled={busy} onClick={() => { setEditing(null); setText(""); setConsent(false); }}>Cancel sample edit</Button>}</div>
    </>}
  </section>;
}