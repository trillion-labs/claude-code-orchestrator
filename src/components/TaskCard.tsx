"use client";

import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Play, ExternalLink, AlertCircle, RotateCcw, Pencil, CheckCircle2, TriangleAlert } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { TimeAgo } from "./TimeAgo";
import type { Task, Session } from "@/lib/shared/types";

interface TaskCardProps {
  task: Task;
  session?: Session;
  onClick: () => void;
  onSubmit?: () => void;
  onDone?: () => void;
  onViewSession?: () => void;
  onEditTitle?: (taskId: string, newTitle: string) => void;
  projectName?: string;
  projectWorkDir?: string;
}

export function TaskCard({ task, session, onClick, onSubmit, onDone, onViewSession, onEditTitle, projectName, projectWorkDir }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const hasError = session?.status === "error";
  const hasWorkDirMismatch =
    !!task.lastWorkDir &&
    !!projectWorkDir &&
    task.lastWorkDir !== projectWorkDir &&
    task.column !== "todo" &&
    task.column !== "done";

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(task.title);
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.title && onEditTitle) {
      onEditTitle(task.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        if (!isEditing) onClick();
      }}
      className={`
        group/task rounded-lg border bg-card p-3 cursor-grab active:cursor-grabbing
        hover:border-foreground/20 transition-colors select-none
        ${isDragging ? "opacity-50 shadow-lg z-50" : ""}
        ${hasError ? "border-red-500/30" : ""}
      `}
    >
      {/* Project badge (shown in All Tasks view) */}
      {projectName && (
        <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/25 mb-1">
          {projectName}
        </span>
      )}

      {/* Title with inline edit */}
      {isEditing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-medium leading-tight w-full bg-transparent border-b border-foreground/30 outline-none"
          maxLength={100}
        />
      ) : (
        <div className="flex items-start gap-1">
          <p className="text-sm font-medium leading-tight line-clamp-2 flex-1">
            {task.title}
          </p>
          {onEditTitle && (
            <button
              onClick={handleEditClick}
              className="opacity-0 group-hover/task:opacity-100 p-0.5 rounded text-muted-foreground hover:text-foreground transition-all shrink-0 mt-0.5"
              title="Edit title"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* WorkDir mismatch warning */}
      {hasWorkDirMismatch && (
        <div
          className="mt-1 flex items-center gap-1 text-[10px] text-amber-400"
          title={`Session workDir (${task.lastWorkDir}) differs from project workDir (${projectWorkDir}). Resume will use original workDir.`}
        >
          <TriangleAlert className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">workDir changed — resume uses original path</span>
        </div>
      )}

      {/* Description preview */}
      {task.description && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Session info (when linked) */}
      {session && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <StatusBadge status={session.status} />
          {session.totalCostUsd > 0 && (
            <span className="text-muted-foreground">
              ${session.totalCostUsd.toFixed(4)}
            </span>
          )}
          {onViewSession && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewSession();
              }}
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              title="View Session"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Error indicator */}
      {hasError && session?.error && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="w-3 h-3" />
          <span className="line-clamp-1">{session.error}</span>
        </div>
      )}

      {/* Footer: timestamp + actions */}
      <div className="mt-2 flex items-center gap-2">
        <TimeAgo timestamp={task.updatedAt} className="text-[10px] text-muted-foreground" />

        <div className="ml-auto flex gap-1">
          {/* Submit button — only in Todo */}
          {task.column === "todo" && onSubmit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSubmit();
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium
                bg-blue-500/15 text-blue-400 border border-blue-500/25
                hover:bg-blue-500/25 transition-colors"
            >
              <Play className="w-2.5 h-2.5" />
              Submit
            </button>
          )}

          {/* Done button — only in In Review */}
          {task.column === "in-review" && onDone && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDone();
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium
                bg-emerald-500/15 text-emerald-400 border border-emerald-500/25
                hover:bg-emerald-500/25 transition-colors"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              Done
            </button>
          )}

          {/* Retry button — in-progress with error */}
          {hasError && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                // TODO: retry logic
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium
                bg-amber-500/15 text-amber-400 border border-amber-500/25
                hover:bg-amber-500/25 transition-colors"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
