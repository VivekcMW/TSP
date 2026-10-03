import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { loadVoice, changeVoice } from "@/components/settings/editorial-voice-settings";

/** Saving/copying/editing a draft never calls this. Separate explicit consent only. */
export function ApproveVoiceEdit({ content }: Readonly<{ content: string }>) {
  const permissionId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function approve() {
    if (!consent || busy) return;
    setBusy(true); setNotice("");
    try {
      const voice = await loadVoice();
      await changeVoice({ action: "add", revision: voice.revision, origin: "approved-edit", text, consent: true });
      setOpen(false); setText(""); setConsent(false);
      setNotice("Approved edit retained. Enable or remove voice samples in Settings. Saving a draft alone never retains a sample.");
    } catch { setNotice("Could not confirm sample approval. Check voice settings before retrying; five samples maximum."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-2 text-sm" aria-label="Approve edit for voice">
    <Button variant="outline" disabled={busy} onClick={() => { setText(content); setConsent(false); setOpen(true); setNotice(""); }}>Approve an edit as a voice sample…</Button>
    {open && <>
      <Field label="Approved edit sample" help="Optional: select 20–1,000 characters." controlProps={{ "aria-describedby": permissionId }}
        counter={`${text.trim().length} / 1,000 characters`}
        error={text.trim().length < 20 || text.trim().length > 1000 ? "Choose between 20 and 1,000 characters before approving." : undefined}
        render={controlProps => <Textarea {...controlProps} value={text} disabled={busy} onChange={event => { setText(event.target.value); setConsent(false); }} />} />
      <p id={permissionId} className="text-muted-foreground">Only select text you have permission to retain. This does not enable voice guidance, verify facts or approve publishing.</p>
      <label className="flex min-h-11 items-start gap-2 py-2"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" aria-describedby={permissionId} checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />I explicitly approve retaining this exact edit as tone guidance.</label>
      <Button disabled={busy || !consent || text.trim().length < 20 || text.trim().length > 1000} onClick={() => void approve()}>Retain approved edit</Button>
      <Button variant="outline" disabled={busy} onClick={() => { setOpen(false); setText(""); setConsent(false); }}>Cancel approval</Button>
    </>}
    {notice && <output className="block">{notice}</output>}
  </section>;
}