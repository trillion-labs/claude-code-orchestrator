"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useStore } from "@/store";
import { NoteDetail } from "./NoteDetail";
import { Button } from "@/components/ui/button";
import { Plus, FileText, GripVertical, X } from "lucide-react";
import type { Project } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";

interface NotesListProps {
  project: Project;
  send: (msg: ClientMessage) => void;
  openNoteIds: string[];
  setOpenNoteIds: React.Dispatch<React.SetStateAction<string[]>>;
  activeNoteId: string | null;
  setActiveNoteId: React.Dispatch<React.SetStateAction<string | null>>;
}

const EMPTY_NOTES: never[] = [];

export function NotesList({ project, send, openNoteIds, setOpenNoteIds, activeNoteId, setActiveNoteId }: NotesListProps) {
  const notesMap = useStore((s) => s.notes);
  const noteContentMap = useStore((s) => s.noteContent);
  const notes = notesMap.get(project.id) || EMPTY_NOTES;
  const containerRef = useRef<HTMLDivElement>(null);
  const [notePanelWidth, setNotePanelWidth] = useState<number | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const prevNoteCountRef = useRef(notes.length);

  // Request notes index on mount
  useEffect(() => {
    send({ type: "note.list", projectId: project.id });
  }, [project.id, send]);

  // Auto-open newly created note
  useEffect(() => {
    if (notes.length > prevNoteCountRef.current) {
      const newest = [...notes].sort((a, b) => b.createdAt - a.createdAt)[0];
      if (newest) {
        handleOpenNote(newest.id);
        send({ type: "note.get", projectId: project.id, noteId: newest.id });
      }
    }
    prevNoteCountRef.current = notes.length;
  }, [notes, project.id, send]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sort by updatedAt descending
  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt),
    [notes]
  );

  // Resolve open notes for tab rendering
  const openNotes = useMemo(
    () => openNoteIds.map((id) => notes.find((n) => n.id === id)).filter(Boolean) as typeof notes,
    [openNoteIds, notes]
  );

  const activeNote = useMemo(
    () => (activeNoteId ? notes.find((n) => n.id === activeNoteId) ?? null : null),
    [activeNoteId, notes]
  );

  const activeNoteContent = activeNoteId ? noteContentMap.get(activeNoteId) : undefined;

  const handleOpenNote = useCallback(
    (noteId: string) => {
      setOpenNoteIds((prev) => (prev.includes(noteId) ? prev : [...prev, noteId]));
      setActiveNoteId(noteId);
      // Fetch content if not already loaded
      if (!noteContentMap.has(noteId)) {
        send({ type: "note.get", projectId: project.id, noteId });
      }
    },
    [noteContentMap, project.id, send]
  );

  const handleCloseTab = useCallback(
    (noteId: string) => {
      setOpenNoteIds((prev) => {
        const next = prev.filter((id) => id !== noteId);
        if (activeNoteId === noteId) {
          const idx = prev.indexOf(noteId);
          setActiveNoteId(next[Math.min(idx, next.length - 1)] ?? null);
        }
        return next;
      });
    },
    [activeNoteId]
  );

  const handleCreate = () => {
    send({
      type: "note.create",
      projectId: project.id,
      title: "Untitled Note",
      content: "",
    });
  };

  const setNoteContent = useStore((s) => s.setNoteContent);

  const handleUpdate = useCallback(
    (noteId: string, updates: { title?: string; content?: string }) => {
      send({ type: "note.update", projectId: project.id, noteId, updates });
      if (updates.content !== undefined) {
        setNoteContent(noteId, updates.content);
      }
    },
    [project.id, send, setNoteContent]
  );

  const handleDelete = useCallback(
    (noteId: string) => {
      send({ type: "note.delete", projectId: project.id, noteId });
      handleCloseTab(noteId);
    },
    [project.id, send, handleCloseTab]
  );

  // Resize handling
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - e.clientX;
      const maxWidth = Math.floor(window.innerWidth * 0.7);
      setNotePanelWidth(Math.min(maxWidth, Math.max(300, resizeRef.current.startWidth + delta)));
    };
    const handleMouseUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - ts;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const hasPanel = openNotes.length > 0;

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden min-w-0">
      {/* Notes list */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-muted-foreground">
              {sortedNotes.length} {sortedNotes.length === 1 ? "note" : "notes"}
            </span>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCreate}>
              <Plus className="w-3.5 h-3.5" />
              New Note
            </Button>
          </div>

          {sortedNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm font-medium mb-1">No notes yet</p>
              <p className="text-xs mb-4">Create a note to get started</p>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCreate}>
                <Plus className="w-3.5 h-3.5" />
                New Note
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedNotes.map((note) => (
                <button
                  key={note.id}
                  className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${
                    openNoteIds.includes(note.id)
                      ? "bg-accent border-violet-500/30"
                      : "bg-card border-border hover:bg-accent/50"
                  }`}
                  onClick={() => handleOpenNote(note.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{note.title}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">
                      {formatTime(note.updatedAt)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Note detail side panel with tabs */}
      {hasPanel && (
        <div className="flex-shrink-0 flex" style={{ width: notePanelWidth ?? Math.floor((containerRef.current?.offsetWidth ?? 960) / 2) }}>
          {/* Resize handle */}
          <div
            className="w-1.5 flex-shrink-0 cursor-col-resize flex items-center justify-center hover:bg-violet-500/20 active:bg-violet-500/30 transition-colors group"
            onMouseDown={(e) => {
              e.preventDefault();
              const currentWidth = notePanelWidth ?? Math.floor((containerRef.current?.offsetWidth ?? 960) / 2);
              resizeRef.current = { startX: e.clientX, startWidth: currentWidth };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          >
            <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-violet-400 transition-colors" />
          </div>
          <div className="flex-1 min-w-0 flex flex-col h-full">
            {/* Tab bar */}
            {openNotes.length > 1 && (
              <div className="flex items-center border-b border-l bg-muted/30 overflow-x-auto">
                {openNotes.map((note) => {
                  const isActive = note.id === activeNoteId;
                  return (
                    <button
                      key={note.id}
                      className={`group/tab flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0 max-w-[180px] ${
                        isActive
                          ? "bg-background border-b-2 border-violet-500 text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                      onClick={() => setActiveNoteId(note.id)}
                    >
                      <span className="truncate">{note.title}</span>
                      <span
                        className="p-0.5 rounded opacity-0 group-hover/tab:opacity-100 hover:bg-accent"
                        onClick={(e) => { e.stopPropagation(); handleCloseTab(note.id); }}
                      >
                        <X className="w-3 h-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Active note detail */}
            <div className="flex-1 min-h-0">
              {activeNote && (
                <NoteDetail
                  key={activeNote.id}
                  note={activeNote}
                  content={activeNoteContent ?? ""}
                  onClose={() => handleCloseTab(activeNote.id)}
                  onUpdate={(updates) => handleUpdate(activeNote.id, updates)}
                  onDelete={() => handleDelete(activeNote.id)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
