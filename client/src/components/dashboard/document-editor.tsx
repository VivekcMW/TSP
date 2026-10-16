import { useEffect, useRef, useState } from "react";
import { EditorContent, Extension, useEditor } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { AlignCenter, AlignLeft, AlignRight, Bold, Heading2, Highlighter, Italic, List, ListOrdered, Quote, Redo2, RemoveFormatting, Strikethrough, Underline, Undo2, type LucideIcon } from "lucide-react";
import { documentFromText, documentPlainText, parseDocumentFormat } from "@shared/document-format";
import { Button } from "@/components/ui/button";

interface DocumentEditorProps {
  content: string;
  formatJson?: string;
  disabled: boolean;
  onChange: (patch: { content: string; formatJson: string }) => void;
}

export function DocumentEditor({ content, formatJson, disabled, onChange }: Readonly<DocumentEditorProps>) {
  const latest = useRef({ onChange, disabled });
  latest.current = { onChange, disabled };
  const [error, setError] = useState("");
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, code: false, codeBlock: false, horizontalRule: false, trailingNode: false }),
      Highlight,
      TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
      Extension.create({
        name: "documentLength",
        addProseMirrorPlugins: () => [new Plugin({
          filterTransaction: transaction => {
            if (!transaction.docChanged) return true;
            try {
              const next = parseDocumentFormat(JSON.stringify(transaction.doc.toJSON()));
              if (documentPlainText(next).length > 5000) {
                setError("The document limit is 5,000 characters. Shorten the text before adding more."); return false;
              }
              return true;
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "This formatting could not be applied.");
              return false;
            }
          },
        })],
      }),
    ],
    content: formatJson ? parseDocumentFormat(formatJson) : documentFromText(content),
    editable: !disabled,
    editorProps: { attributes: {
      role: "textbox", "aria-label": "Document text", "aria-multiline": "true",
      "aria-disabled": String(disabled), "data-testid": "textarea-main-draft",
      class: "min-h-96 break-words text-base leading-loose outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-lg [&_p]:my-3 [&_h1]:my-4 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:my-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:text-xl [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_mark]:rounded-sm [&_mark]:bg-accent [&_mark]:text-accent-foreground",
    } },
    onUpdate: ({ editor }) => {
      if (latest.current.disabled) return;
      const next = JSON.stringify(editor.getJSON());
      setError("");
      latest.current.onChange({ content: documentPlainText(parseDocumentFormat(next)), formatJson: next });
    },
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled, false);
    editor.view.dom.setAttribute("aria-disabled", String(disabled));
  }, [editor, disabled]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const next = formatJson ? parseDocumentFormat(formatJson) : documentFromText(content);
    const normalized = editor.schema.nodeFromJSON(next);
    if (!editor.state.doc.eq(normalized)) editor.commands.setContent(normalized.toJSON(), { emitUpdate: false });
  }, [editor, content, formatJson]);
  if (!editor) return <div className="min-h-96" role="status">Loading document editor...</div>;

  const actions: { label: string; icon: LucideIcon; run: () => void; active?: boolean; unavailable?: boolean }[] = [
    { label: "Bold", icon: Bold, active: editor.isActive("bold"), run: () => { editor.chain().focus().toggleBold().run(); } },
    { label: "Italic", icon: Italic, active: editor.isActive("italic"), run: () => { editor.chain().focus().toggleItalic().run(); } },
    { label: "Underline", icon: Underline, active: editor.isActive("underline"), run: () => { editor.chain().focus().toggleUnderline().run(); } },
    { label: "Strikethrough", icon: Strikethrough, active: editor.isActive("strike"), run: () => { editor.chain().focus().toggleStrike().run(); } },
    { label: "Highlight", icon: Highlighter, active: editor.isActive("highlight"), run: () => { editor.chain().focus().toggleHighlight().run(); } },
    { label: "Heading", icon: Heading2, active: editor.isActive("heading"), run: () => { editor.chain().focus().toggleHeading({ level: 2 }).run(); } },
    { label: "Bulleted list", icon: List, active: editor.isActive("bulletList"), run: () => { editor.chain().focus().toggleBulletList().run(); } },
    { label: "Numbered list", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => { editor.chain().focus().toggleOrderedList().run(); } },
    { label: "Quote", icon: Quote, active: editor.isActive("blockquote"), run: () => { editor.chain().focus().toggleBlockquote().run(); } },
    ...([{ label: "Align left", icon: AlignLeft, value: "left" }, { label: "Align center", icon: AlignCenter, value: "center" }, { label: "Align right", icon: AlignRight, value: "right" }] as const).map(({ label, icon, value }) => ({
      label, icon, active: editor.isActive({ textAlign: value }), run: () => { editor.chain().focus().setTextAlign(value).run(); },
    })),
    { label: "Clear formatting", icon: RemoveFormatting, run: () => { editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run(); } },
    { label: "Undo", icon: Undo2, unavailable: !editor.can().undo(), run: () => { editor.chain().focus().undo().run(); } },
    { label: "Redo", icon: Redo2, unavailable: !editor.can().redo(), run: () => { editor.chain().focus().redo().run(); } },
  ];
  return <div className="min-w-0">
    <div role="toolbar" aria-label="Document formatting" className="sticky top-0 z-10 mb-4 flex max-w-full items-center gap-1 overflow-x-auto rounded-md border bg-card p-1"
      onFocusCapture={event => {
        const viewport = event.currentTarget, control = event.target.getBoundingClientRect(), visible = viewport.getBoundingClientRect();
        if (control.left < visible.left) viewport.scrollLeft -= visible.left - control.left;
        else if (control.right > visible.right) viewport.scrollLeft += control.right - visible.right;
      }}>
      {actions.map(({ label, icon: Icon, run, active, unavailable }) => <Button key={label} type="button" variant={active ? "selected" : "ghost"}
        size="compact" aria-label={label} title={label} aria-pressed={active} disabled={disabled || unavailable}
        onMouseDown={event => event.preventDefault()} onClick={run}><Icon className="h-4 w-4" /></Button>)}
    </div>
    <EditorContent editor={editor} />
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>;
}
