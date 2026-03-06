"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, Play, ExternalLink, AlertCircle, RotateCcw } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { Task, Session } from "@/lib/shared/types";

interface TaskCardProps {
  task: Task;
  session?: Session;
  onClick: () => void;
  onSubmit?: () => void;
  onViewSession?: () => void;
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TaskCard({ task, session, onClick, onSubmit, onViewSession }: TaskCardProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`
        group rounded-lg border bg-card p-3 cursor-grab active:cursor-grabbing
        hover:border-foreground/20 transition-colors select-none
        ${isDragging ? "opacity-50 shadow-lg z-50" : ""}
        ${hasError ? "border-red-500/30" : ""}
      `}
    >
      {/* Title */}
      <p className="text-sm font-medium leading-tight line-clamp-2">
        {task.title}
      </p>

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
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {timeAgo(task.updatedAt)}
        </span>

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
