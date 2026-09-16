import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface ArticleMedia {
  id?: string;
  type: "image" | "video" | "audio";
  name: string;
  url: string;
}
interface ArticleValue { title: string; content: string; media: ArticleMedia[] }
interface RichArticleEditorProps {
  value: ArticleValue;
  onChange: (article: ArticleValue) => void;
  isPending: boolean;
  onUploadingChange: (uploading: boolean) => void;
}

/** Controlled plain-text/Markdown source: the generation API consumes text, not HTML. */
export function RichArticleEditor({ value, onChange, isPending, onUploadingChange }: Readonly<RichArticleEditorProps>) {
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const controller = useRef<AbortController>();
  useEffect(() => () => { controller.current?.abort(); onUploadingChange(false); }, [onUploadingChange]);
  const latest = useRef(value);
  latest.current = value;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const addFiles = async (files: FileList | null) => {
    if (!files?.length || uploadLock.current || isPending || latest.current.media.length >= 8) return;
    const request = new AbortController(); controller.current = request;
    uploadLock.current = true; setUploading(true); onUploadingChange(true); setError("");
    try {
      const form = new FormData();
      Array.from(files).slice(0, 8 - latest.current.media.length).forEach(file => form.append("files", file));
      const response = await fetch("/api/media/upload", { method: "POST", body: form, credentials: "include", signal: request.signal });
      if (!response.ok) throw new Error("Media upload failed. Your article is unchanged; try again.");
      const { assets } = await response.json() as { assets: ArticleMedia[] };
      if (request.signal.aborted) return;
      if (!Array.isArray(assets) || assets.some(asset => !asset.id)) throw new Error("Upload could not be confirmed. Try again.");
      onChange({ ...latest.current, media: [...latest.current.media, ...assets].slice(0, 8) });
    } catch (error) { if (!request.signal.aborted) setError(error instanceof Error ? error.message : "Media upload failed"); }
    finally {
      uploadLock.current = false;
      // An old request must not unlock an upload in a newly mounted editor.
      if (!request.signal.aborted) {
        onUploadingChange(false);
        setUploading(false);
      }
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return <section className="min-w-0 space-y-3" aria-label="Write article">
    <p className="text-sm text-muted-foreground">Write or paste your source in plain text or Markdown. Uploads are attachments, not fact-checked evidence.</p>
    <label className="block space-y-1 text-sm">Article title<Input aria-label="Article title" maxLength={200} value={value.title} disabled={isPending} onChange={event => onChange({ ...value, title: event.target.value })} data-testid="input-manual-article-title" /></label>
    <label className="block space-y-1 text-sm">Article text<Textarea aria-label="Article text" maxLength={20_000} value={value.content} disabled={isPending} onChange={event => onChange({ ...value, content: event.target.value })} className="min-h-52" data-testid="editor-manual-article" /></label>
    <p className="text-xs text-muted-foreground">{value.content.trim().length} / 20,000 characters · At least 20 characters to generate.</p>
    <Button variant="outline" disabled={isPending || uploading || value.media.length >= 8} onClick={() => fileInput.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />{uploading ? "Uploading…" : "Add media"}</Button>
    <input ref={fileInput} type="file" aria-label="Article attachments" className="hidden" accept="image/*,video/*,audio/*" multiple onChange={event => void addFiles(event.target.files)} data-testid="input-article-media" />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {value.media.length > 0 && <ul className="space-y-2">{value.media.map((item, index) => <li key={item.id ?? item.url} className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-2"><span className="min-w-0 break-words text-sm">{item.name} ({item.type})</span><Button variant="ghost" size="icon" disabled={isPending || uploading} onClick={() => onChange({ ...value, media: value.media.filter((_, i) => i !== index) })} aria-label={`Remove ${item.name}`}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>}
  </section>;
}
