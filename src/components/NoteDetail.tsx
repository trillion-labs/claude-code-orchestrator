"use client";

import { useState, useRef, useEffect, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { X, Pencil, Check, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Note } from "@/lib/shared/types";

const noteMarkdownComponents: ComponentProps<typeof ReactMarkdown>["components"] = {
  a({ href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  code({ className, children }) {
    const match = /language-(\S+)/.exec(className || "");
    const codeString = String(children).replace(/\n$/, "");

    if (!match) {
      const isInline = !codeString.includes("\n");
      if (isInline) {
        return (
          <code className="px-1.5 py-0.5 rounded bg-black/[0.06] dark:bg-white/10 text-[0.8125rem] font-mono text-orange-600 dark:text-orange-300">
            {children}
          </code>
        );
      }
    }

    const language = match ? match[1] : "text";

    return (
      <div className="relative group not-prose my-3 max-w-full overflow-hidden">
        <div className="flex items-center px-3 py-1 bg-[#1e1e1e] rounded-t-lg border-b border-white/10">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{language}</span>
        </div>
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomLeftRadius: "0.5rem",
            borderBottomRightRadius: "0.5rem",
            fontSize: "0.75rem",
            lineHeight: "1.5",
            overflowX: "auto",
          }}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-white/10">{children}</thead>;
  },
  th({ children }) {
    return <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300 border-t border-black/[0.04] dark:border-white/[0.04]">{children}</td>;
  },
};

interface NoteDetailProps {
  note: Omit<Note, "content">; // index entry (no content)
  content: string; // loaded separately
  onClose: () => void;
  onUpdate: (updates: { title?: string; content?: string }) => void;
  onDelete: () => void;
}

export function NoteDetail({ note, content, onClose, onUpdate, onDelete }: NoteDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [contentDraft, setContentDraft] = useState(content);
  const lastSavedContentRef = useRef(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = contentDraft !== lastSavedContentRef.current;

  // Sync title draft when note changes externally
  useEffect(() => {
    setTitleDraft(note.title);
  }, [note.title]);

  // Sync content when loaded from server (but not if user has unsaved changes)
  useEffect(() => {
    if (content !== lastSavedContentRef.current) {
      setContentDraft(content);
      lastSavedContentRef.current = content;
    }
  }, [content]);

  const saveTitle = () => {
    if (titleDraft.trim() && titleDraft !== note.title) {
      onUpdate({ title: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const saveContent = () => {
    if (isDirty) {
      lastSavedContentRef.current = contentDraft;
      onUpdate({ content: contentDraft });
    }
    setEditingContent(false);
  };

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (editingContent) {
      textareaRef.current?.focus();
    }
  }, [editingContent]);

  // Cmd+S to save, Escape to exit edit mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveContent();
      }
      if (e.key === "Escape" && editingContent) {
        e.preventDefault();
        // Discard draft if dirty, revert to last saved
        if (isDirty) {
          setContentDraft(lastSavedContentRef.current);
        }
        setEditingContent(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") {
                    if (e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    saveTitle();
                    if (e.key === "Tab") textareaRef.current?.focus();
                  }
                  if (e.key === "Escape") {
                    setTitleDraft(note.title);
                    setEditingTitle(false);
                  }
                }}
                autoFocus
                className="h-7 w-full text-sm font-semibold bg-transparent border-none outline-none ring-0 placeholder:text-muted-foreground"
                placeholder="Note title..."
              />
              <button onClick={saveTitle} className="p-1 text-muted-foreground hover:text-foreground">
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <h3
              className="text-sm font-semibold truncate cursor-pointer hover:text-foreground/80 flex items-center gap-1 group"
              onClick={() => setEditingTitle(true)}
            >
              {note.title}
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50" />
            </h3>
          )}
        </div>
        <Button
          variant={isDirty ? "default" : "outline"}
          size="sm"
          className="gap-1.5 text-xs"
          disabled={!isDirty}
          onClick={saveContent}
        >
          <Save className="w-3.5 h-3.5" />
          {isDirty ? "Save" : "Saved"}
        </Button>
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content: markdown preview or editor */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {editingContent ? (
          <div className="h-full p-4">
            <textarea
              ref={textareaRef}
              value={contentDraft}
              onChange={(e) => setContentDraft(e.target.value)}
              placeholder="Write your notes here... (Markdown supported)"
              className="h-full w-full resize-none text-sm font-mono leading-relaxed bg-transparent border-none outline-none ring-0 placeholder:text-muted-foreground"
            />
          </div>
        ) : (
          <div
            className="h-full p-4 cursor-text"
            onClick={() => setEditingContent(true)}
          >
            {contentDraft ? (
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-7 prose-li:leading-7 prose-headings:text-gray-800 dark:prose-headings:text-gray-100 prose-p:text-gray-600 dark:prose-p:text-gray-300 prose-li:text-gray-600 dark:prose-li:text-gray-300 prose-strong:text-gray-800 dark:prose-strong:text-gray-100 prose-a:text-blue-600 dark:prose-a:text-blue-400">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={noteMarkdownComponents}>
                  {contentDraft}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Click to edit... (Markdown supported)</p>
            )}
          </div>
        )}
      </div>

      {/* Footer: meta info + delete */}
      <div className="flex items-center justify-between px-4 py-2 border-t text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>Created {formatDate(note.createdAt)}</span>
          <span>Updated {formatDate(note.updatedAt)}</span>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Note</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{note.title}&quot;? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
