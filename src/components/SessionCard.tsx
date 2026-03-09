"use client";

import { useState, useRef, useEffect } from "react";
import { StatusBadge } from "./StatusBadge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useStore } from "@/store";
import type { Session } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";
import { Monitor, Server, GitBranch, FolderOpen, X } from "lucide-react";

interface SessionCardProps {
  session: Session;
  isActive: boolean;
  onClick: () => void;
  attentionCount: number;
  displayName?: string;
  onRename: (name: string) => void;
  send: (msg: ClientMessage) => void;
}

export function SessionCard({
  session,
  isActive,
  onClick,
  attentionCount,
  displayName,
  onRename,
  send,
}: SessionCardProps) {
  const isLocal = session.machineId === "local";
  const timeSinceActivity = formatTimeAgo(session.lastActivity);
  const hasAttention = !isActive && attentionCount > 0;

  const projects = useStore((s) => s.projects);
  const linkedProject = session.projectId ? projects.get(session.projectId) : undefined;
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(displayName || session.machineName);
    setIsEditing(true);
  };

  const handleRenameSubmit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== displayName) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  const handleSetProject = (projectId: string | null) => {
    send({ type: "session.setProject", sessionId: session.id, projectId });
    setProjectPopoverOpen(false);
  };

  return (
    <div className="relative">
      {/* Attention pulse dot — outside button to avoid overflow-hidden clipping */}
      {hasAttention && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3 z-10">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
        </span>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
        className={`w-full text-left p-3 rounded-lg border transition-colors overflow-hidden cursor-pointer ${
          isActive
            ? "bg-accent border-accent-foreground/20"
            : hasAttention
              ? "border-amber-500/40 hover:bg-accent/50"
              : "border-border hover:bg-accent/50"
        }`}
      >

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isLocal ? (
            <Monitor className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="font-medium text-sm bg-transparent border-b border-foreground/30 outline-none w-full min-w-0"
              maxLength={50}
            />
          ) : (
            <span
              className="font-medium text-sm truncate min-w-0"
              onDoubleClick={handleDoubleClick}
              title={displayName || session.machineName}
            >
              {displayName || session.machineName}
            </span>
          )}
        </div>
        <StatusBadge status={session.status} />
      </div>

      {/* Show machineName as secondary info when displayName is set */}
      {displayName && (
        <div className="text-xs text-muted-foreground truncate mb-0.5">
          {isLocal ? (
            <Monitor className="w-3 h-3 inline mr-1" />
          ) : (
            <Server className="w-3 h-3 inline mr-1" />
          )}
          {session.machineName}
        </div>
      )}

      <div className="text-xs text-muted-foreground truncate font-mono" title={session.workDir}>
        {session.workDir}
      </div>
      {session.worktree && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
          <GitBranch className="w-3 h-3" />
          <span className="font-mono truncate">{session.worktree.branch}</span>
        </div>
      )}

      {/* Project indicator with dropdown */}
      <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
        <PopoverTrigger asChild>
          <div
            onClick={(e) => { e.stopPropagation(); setProjectPopoverOpen(true); }}
            className="flex items-center gap-1 text-xs mt-0.5 cursor-pointer hover:text-foreground transition-colors"
          >
            <FolderOpen className="w-3 h-3 shrink-0" />
            <span className={`truncate ${linkedProject ? "text-muted-foreground" : "text-muted-foreground/50 italic"}`}>
              {linkedProject ? linkedProject.name : "No project"}
            </span>
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start" side="right">
          <div className="text-xs font-medium text-muted-foreground px-2 py-1">Project</div>
          {linkedProject && (
            <button
              className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent flex items-center gap-1.5 text-red-400"
              onClick={(e) => { e.stopPropagation(); handleSetProject(null); }}
            >
              <X className="w-3 h-3" />
              Unlink
            </button>
          )}
          {Array.from(projects.values())
            .filter((p) => p.id !== session.projectId)
            .map((p) => (
              <button
                key={p.id}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent flex items-center gap-1.5 truncate"
                onClick={(e) => { e.stopPropagation(); handleSetProject(p.id); }}
              >
                <FolderOpen className="w-3 h-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          {projects.size === 0 && (
            <div className="text-xs text-muted-foreground/50 px-2 py-1.5 italic">No projects</div>
          )}
        </PopoverContent>
      </Popover>

      <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
        <span>{timeSinceActivity}</span>
        {session.totalCostUsd > 0 && (
          <span className="font-mono">${session.totalCostUsd.toFixed(4)}</span>
        )}
      </div>
    </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
