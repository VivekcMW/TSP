import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Code2, Heading2, Highlighter, ImagePlus, Indent, Italic, Link2, List, ListOrdered, Outdent, Quote, Redo2, RemoveFormatting, Strikethrough, Trash2, Type, Underline, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { InfoTooltip } from "@/components/ui/info-tooltip";

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

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br />");
}

/** Controlled plain-text/Markdown source: the generation API consumes text, not HTML. */
export function RichArticleEditor({ value, onChange, isPending, onUploadingChange }: Readonly<RichArticleEditorProps>) {
  const editorId = useId();
  const editorLabelId = `${editorId}-label`;
  const editorHelpId = `${editorId}-help`;
  const characterCountId = `${editorId}-character-count`;
  const toolbarHintId = `${editorId}-toolbar-hint`;
  const fontFamilyId = `${editorId}-font-family`;
  const fontSizeId = `${editorId}-font-size`;
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const controller = useRef<AbortController>();
  useEffect(() => () => { controller.current?.abort(); onUploadingChange(false); }, [onUploadingChange]);
  const latest = useRef(value);
  latest.current = value;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const lastExternalContent = useRef<string | null>(null);
  useEffect(() => {
    if (!editorRef.current || document.activeElement === editorRef.current || value.content === lastExternalContent.current) return;
    editorRef.current.innerHTML = escapeHtml(value.content);
    lastExternalContent.current = value.content;
  }, [value.content]);
  const runCommand = (command: string, argument?: string) => {
    if (isPending) return;
    editorRef.current?.focus();
    document.execCommand(command, false, argument);
    const content = editorRef.current?.innerText ?? "";
    lastExternalContent.current = content;
    onChange({ ...latest.current, content });
  };
  const addLink = () => {
    if (isPending) return;
    const url = window.prompt("Enter the URL");
    if (url?.trim()) runCommand("createLink", url.trim());
  };
  const applySelectCommand = (command: string, event: ChangeEvent<HTMLSelectElement>) => {
    runCommand(command, event.target.value);
    event.target.value = "";
  };
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
    <p id={editorHelpId} className="text-sm text-muted-foreground">Write or paste your source in plain text or Markdown. Formatting controls change this editor preview only: fonts, colors and rich styling are not submitted or restored after navigation, and are not promised as social-platform formatting. Only plain text is retained in this creation; Markdown remains literal text. Uploaded attachments are retained separately in this session, not inspected as fact-checked evidence.</p>
    <Field label="Article title" counter={`${value.title.length} / 200 characters`} render={controlProps => <Input {...controlProps} maxLength={200} value={value.title} disabled={isPending} placeholder="Give your article a clear title…" onChange={event => onChange({ ...value, title: event.target.value })} data-testid="input-manual-article-title" />} />
    <div className="space-y-1 text-sm">
      <div className="flex min-w-0 items-center gap-1">
        <label id={editorLabelId} htmlFor={editorId} className="min-w-0">Article text</label>
        <InfoTooltip label="Article formatting" descriptionId={toolbarHintId}>Swipe or scroll sideways for more formatting options. Tab through controls with a keyboard.</InfoTooltip>
      </div>
      <div className="min-w-0 max-w-full overflow-hidden rounded-md border bg-background" data-testid="rich-article-editor">
        <fieldset className="min-w-0 max-w-full overflow-x-auto scroll-px-2 border-b bg-muted/30" aria-label="Article formatting toolbar" aria-describedby={toolbarHintId}
          onFocusCapture={event => {
            // Native Tab scrolling can leave a partly visible control clipped.
            // Move only this viewport, leaving the editor and page in place.
            const viewport = event.currentTarget;
            const control = event.target.getBoundingClientRect();
            const visible = viewport.getBoundingClientRect();
            if (control.left < visible.left + 8) viewport.scrollLeft -= visible.left + 8 - control.left;
            else if (control.right > visible.right - 8) viewport.scrollLeft += control.right - visible.right + 8;
          }}>
        <div className="flex w-max min-w-full flex-nowrap items-center gap-1 p-2 [&>*]:shrink-0 [&_button]:scroll-mx-2 [&_select]:scroll-mx-2 [&_input]:scroll-mx-2">
          {[['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['underline', Underline, 'Underline'], ['strikeThrough', Strikethrough, 'Strikethrough']].map(([command, Icon, label]) => <Button key={command as string} type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label={label as string} onMouseDown={event => event.preventDefault()} onClick={() => runCommand(command as string)}><Icon className="h-4 w-4" /></Button>)}
          <span className="mx-1 h-5 w-px bg-border" />
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Heading" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("formatBlock", "<h2>")}><Heading2 className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Bulleted list" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("insertUnorderedList")}><List className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Numbered list" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("insertOrderedList")}><ListOrdered className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Quote" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("formatBlock", "<blockquote>")}><Quote className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Add link" onMouseDown={event => event.preventDefault()} onClick={addLink}><Link2 className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Inline code" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("formatBlock", "<pre>")}><Code2 className="h-4 w-4" /></Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <label className="sr-only" htmlFor={fontFamilyId}>Font family</label>
          <select id={fontFamilyId} aria-label="Font family" defaultValue="" disabled={isPending} className="control-touch-target min-h-8 rounded-md border bg-background px-2 py-1 text-xs" onChange={event => applySelectCommand("fontName", event)}>
            <option value="">Font</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Courier New">Monospace</option><option value="Verdana">Verdana</option>
          </select>
          <label className="sr-only" htmlFor={fontSizeId}>Font size</label>
          <select id={fontSizeId} aria-label="Font size" defaultValue="" disabled={isPending} className="control-touch-target min-h-8 min-w-20 rounded-md border bg-background px-2 py-1 text-xs" onChange={event => applySelectCommand("fontSize", event)}>
            <option value="">Size</option><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">XL</option><option value="6">Huge</option>
          </select>
          <label className="control-touch-target relative flex min-h-8 items-center gap-1 rounded-md border border-input bg-background px-2" title="Text color"><Type className="h-3.5 w-3.5" /><input type="color" aria-label="Text color" defaultValue="#111827" disabled={isPending} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" onChange={event => runCommand("foreColor", event.target.value)} /></label>
          <label className="control-touch-target relative flex min-h-8 items-center gap-1 rounded-md border border-input bg-background px-2" title="Highlight color"><Highlighter className="h-3.5 w-3.5" /><input type="color" aria-label="Highlight color" defaultValue="#fff59d" disabled={isPending} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" onChange={event => runCommand("hiliteColor", event.target.value)} /></label>
          <span className="mx-1 h-5 w-px bg-border" />
          {[['justifyLeft', AlignLeft, 'Align left'], ['justifyCenter', AlignCenter, 'Align center'], ['justifyRight', AlignRight, 'Align right'], ['indent', Indent, 'Indent'], ['outdent', Outdent, 'Outdent']].map(([command, Icon, label]) => <Button key={command as string} type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label={label as string} onMouseDown={event => event.preventDefault()} onClick={() => runCommand(command as string)}><Icon className="h-4 w-4" /></Button>)}
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Superscript" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("superscript")}><span className="text-xs">x²</span></Button>
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Subscript" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("subscript")}><span className="text-xs">x₂</span></Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Undo" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("undo")}><Undo2 className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Redo" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("redo")}><Redo2 className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="compact" className="p-1" disabled={isPending} aria-label="Clear formatting" onMouseDown={event => event.preventDefault()} onClick={() => runCommand("removeFormat")}><RemoveFormatting className="h-4 w-4" /></Button>
        </div>
        </fieldset>
        <div
          id={editorId}
          ref={editorRef}
          contentEditable={!isPending}
          role="textbox"
          aria-multiline="true"
          aria-readonly={isPending}
          aria-label="Article text"
          aria-labelledby={editorLabelId}
          aria-describedby={`${editorHelpId} ${characterCountId}`}
          suppressContentEditableWarning
          onInput={event => { const content = event.currentTarget.innerText; lastExternalContent.current = content; onChange({ ...latest.current, content }); }}
          onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData("text/plain"); document.execCommand("insertText", false, text); }}
          data-placeholder="Start writing your article here…"
          className="min-w-0 min-h-60 max-h-[32rem] overflow-y-auto [overflow-wrap:anywhere] p-4 text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&:empty]:before:text-muted-foreground [&:empty]:before:content-[attr(data-placeholder)] [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-6"
          data-testid="editor-manual-article"
        />
      </div>
    </div>
    <p id={characterCountId} className="text-xs text-muted-foreground">{value.content.trim().length} / 20,000 characters · At least 20 characters to generate.</p>
    <Button variant="outline" disabled={isPending || uploading || value.media.length >= 8} onClick={() => fileInput.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />{uploading ? "Uploading…" : "Add media"}</Button>
    <input ref={fileInput} type="file" aria-label="Article attachments" className="hidden" accept="image/*,video/*,audio/*" multiple onChange={event => void addFiles(event.target.files)} data-testid="input-article-media" />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {value.media.length > 0 && <ul className="space-y-2">{value.media.map((item, index) => <li key={item.id ?? item.url} className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-2"><span className="min-w-0 break-words text-sm">{item.name} ({item.type})</span><Button variant="ghost" size="icon" disabled={isPending || uploading} onClick={() => onChange({ ...value, media: value.media.filter((_, i) => i !== index) })} aria-label={`Remove ${item.name}`}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>}
  </section>;
}
