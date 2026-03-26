"use client";

import { useState, useRef, useEffect } from "react";
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

interface NoteDetailProps {
  note: Omit<Note, "content">; // index entry (no content)
  content: string; // loaded separately
  onClose: () => void;
  onUpdate: (updates: { title?: string; content?: string }) => void;
  onDelete: () => void;
}

export function NoteDetail({ note, content, onClose, onUpdate, onDelete }: NoteDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
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
  };

  // Cmd+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveContent();
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

      {/* Content editor */}
      <div className="flex-1 min-h-0 p-4">
        <textarea
          ref={textareaRef}
          value={contentDraft}
          onChange={(e) => setContentDraft(e.target.value)}
          placeholder="Write your notes here... (Markdown supported)"
          className="h-full w-full resize-none text-sm font-mono leading-relaxed bg-transparent border-none outline-none ring-0 placeholder:text-muted-foreground"
        />
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
