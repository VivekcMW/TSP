import { useEffect, useRef, useState } from "react";
import { Bold, ImagePlus, Italic, Link, List, Mic, Send, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ArticleMedia {
  id?: string;
  type: "image" | "video" | "audio";
  name: string;
  url: string;
}

interface RichArticleEditorProps {
  onAnalyze: (article: { title: string; content: string; media: ArticleMedia[] }) => void;
  isPending: boolean;
}

export function RichArticleEditor({ onAnalyze, isPending }: RichArticleEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [contentLength, setContentLength] = useState(0);
  const [media, setMedia] = useState<ArticleMedia[]>([]);

  useEffect(() => () => media.forEach((item) => item.url.startsWith("blob:") && URL.revokeObjectURL(item.url)), [media]);

  const format = (command: string) => { editorRef.current?.focus(); document.execCommand(command); };
  const addLink = () => { const url = window.prompt("Link URL"); if (url) { editorRef.current?.focus(); document.execCommand("createLink", false, url); } };
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const formData = new FormData();
    Array.from(files).slice(0, 8).forEach((file) => formData.append("files", file));
    const response = await fetch("/api/media/upload", { method: "POST", body: formData, credentials: "include" });
    if (!response.ok) throw new Error("Media upload failed");
    const { assets } = await response.json() as { assets: ArticleMedia[] };
    setMedia((current) => [...current, ...assets].slice(0, 8));
  };
  const analyze = () => {
    const content = editorRef.current?.innerText.trim() ?? "";
    if (title.trim() && content) onAnalyze({ title: title.trim(), content, media });
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className="border-b px-5 py-4"><h3 className="font-medium">Write an article</h3><p className="text-sm text-muted-foreground">Add your perspective and optional media, then let AI create social-ready posts.</p></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Article title" data-testid="input-manual-article-title" />
      <div className="flex flex-wrap gap-1 rounded-t-md border border-b-0 bg-muted/30 p-1">
        <Button type="button" variant="ghost" size="icon" onClick={() => format("bold")} aria-label="Bold"><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => format("italic")} aria-label="Italic"><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => format("insertUnorderedList")} aria-label="Bullet list"><List className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" onClick={addLink} aria-label="Add link"><Link className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} aria-label="Add media"><ImagePlus className="h-4 w-4" /><Video className="sr-only" /><Mic className="sr-only" /></Button>
        <input ref={fileInputRef} className="hidden" type="file" accept="image/*,video/*,audio/*" multiple onChange={(event) => void addFiles(event.target.files)} data-testid="input-article-media" />
      </div>
      <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={(event) => setContentLength(event.currentTarget.innerText.trim().length)} data-placeholder="Write your article here…" className="min-h-52 rounded-b-md border bg-background p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring" data-testid="editor-manual-article" />
      {media.length > 0 && <div className="grid grid-cols-2 gap-3">{media.map((item, index) => <div key={item.url} className="relative overflow-hidden rounded-md border bg-muted p-2"><button type="button" onClick={() => setMedia((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-2 top-2 rounded bg-background p-1" aria-label={`Remove ${item.name}`}><Trash2 className="h-3 w-3" /></button>{item.type === "image" && <img src={item.url} alt={item.name} className="h-24 w-full object-cover" />}{item.type === "video" && <video src={item.url} controls className="h-24 w-full object-cover" />}{item.type === "audio" && <audio src={item.url} controls className="w-full" />}<p className="mt-1 truncate text-xs text-muted-foreground">{item.name}</p></div>)}</div>}
    </div>
    <div className="border-t p-4"><Button className="w-full" disabled={!title.trim() || contentLength < 20 || isPending} onClick={analyze} data-testid="button-analyze-manual-article"><Send className="mr-2 h-4 w-4" />{isPending ? "Analyzing article…" : "Analyze & create posts"}</Button></div>
  </div>;
}
