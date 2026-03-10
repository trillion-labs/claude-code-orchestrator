"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/store";
import type { Project, GitHubIssue } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";
import { GitHubIssueCard } from "./GitHubIssueCard";
import { GitHubIssueDetail } from "./GitHubIssueDetail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RefreshCw,
  Plus,
  Loader2,
  AlertCircle,
  Github,
  CircleDot,
  CircleCheck,
  GripVertical,
  Filter,
} from "lucide-react";

interface GitHubIssueBoardProps {
  project: Project;
  send: (msg: ClientMessage) => void;
}

type FilterState = "open" | "closed" | "all";

export function GitHubIssueBoard({ project, send }: GitHubIssueBoardProps) {
  const repo = useStore((s) => s.githubRepos.get(project.id));
  const issues = useStore((s) => s.githubIssues.get(project.id)) || [];
  const loading = useStore((s) => s.githubLoading.get(project.id)) || false;
  const error = useStore((s) => s.githubError.get(project.id));
  const setGitHubLoading = useStore((s) => s.setGitHubLoading);
  const setGitHubError = useStore((s) => s.setGitHubError);

  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null);
  const [filter, setFilter] = useState<FilterState>("open");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [detailWidth, setDetailWidth] = useState(520);
  const [resizing, setResizing] = useState<{ startX: number; startWidth: number } | null>(null);

  // Resize logic
  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizing.startX - e.clientX;
      const maxWidth = Math.floor(window.innerWidth * 0.6);
      setDetailWidth(Math.min(maxWidth, Math.max(320, resizing.startWidth + delta)));
    };
    const handleMouseUp = () => {
      setResizing(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing]);

  // Auto-detect repo on mount
  useEffect(() => {
    if (!repo) {
      setGitHubLoading(project.id, true);
      send({ type: "github.repo.detect", projectId: project.id });
    }
  }, [repo, project.id, send, setGitHubLoading]);

  // Fetch issues when repo is detected or filter changes
  useEffect(() => {
    if (repo) {
      setGitHubLoading(project.id, true);
      setGitHubError(project.id, null);
      send({
        type: "github.issues.list",
        projectId: project.id,
        state: filter,
        labels: labelFilter ? [labelFilter] : undefined,
      });
    }
  }, [repo, project.id, filter, labelFilter, send, setGitHubLoading, setGitHubError]);

  // Fetch labels when repo detected
  useEffect(() => {
    if (repo) {
      send({ type: "github.labels.list", projectId: project.id });
    }
  }, [repo, project.id, send]);

  const labels = useStore((s) => s.githubLabels.get(project.id)) || [];

  const handleRefresh = useCallback(() => {
    setGitHubLoading(project.id, true);
    setGitHubError(project.id, null);
    send({
      type: "github.issues.list",
      projectId: project.id,
      state: filter,
      labels: labelFilter ? [labelFilter] : undefined,
    });
  }, [project.id, filter, labelFilter, send, setGitHubLoading, setGitHubError]);

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    setGitHubLoading(project.id, true);
    send({
      type: "github.issues.create",
      projectId: project.id,
      title: newTitle.trim(),
      body: newBody.trim(),
    });
    setNewTitle("");
    setNewBody("");
    setCreateOpen(false);
  };

  // Keep selected issue in sync with store updates
  const selectedIssueFromStore = selectedIssue
    ? issues.find((i) => i.number === selectedIssue.number) ?? selectedIssue
    : null;

  // No repo detected
  if (!repo && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-3">
          <Github className="w-12 h-12 mx-auto opacity-20" />
          {error ? (
            <>
              <p className="text-sm">{error}</p>
              <p className="text-xs">Make sure <code>gh</code> CLI is installed and authenticated.</p>
            </>
          ) : (
            <p className="text-sm">No GitHub repository detected for this project.</p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setGitHubLoading(project.id, true);
              setGitHubError(project.id, null);
              send({ type: "github.repo.detect", projectId: project.id });
            }}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Retry Detection
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b min-w-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Github className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-semibold truncate">{repo?.fullName || "Loading..."}</h2>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />}
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          <button
            onClick={() => setFilter("open")}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
              filter === "open" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CircleDot className="w-3 h-3" />
            Open
          </button>
          <button
            onClick={() => setFilter("closed")}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
              filter === "closed" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CircleCheck className="w-3 h-3" />
            Closed
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
              filter === "all" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
        </div>

        <Button variant="ghost" size="icon-sm" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          New Issue
        </Button>
      </div>

      {/* Label filter bar */}
      {labels.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b overflow-x-auto">
          <Filter className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <button
            onClick={() => setLabelFilter(null)}
            className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
              !labelFilter ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {labels.map((label) => (
            <button
              key={label.name}
              onClick={() => setLabelFilter(labelFilter === label.name ? null : label.name)}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                labelFilter === label.name
                  ? "font-medium"
                  : "opacity-70 hover:opacity-100"
              }`}
              style={{
                borderColor: `#${label.color}`,
                color: `#${label.color}`,
                backgroundColor: labelFilter === label.name ? `#${label.color}20` : "transparent",
              }}
            >
              {label.name}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Issue list */}
        <div className="flex-1 min-w-0">
          {error && !loading && (
            <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <ScrollArea className="h-full">
            <div className="p-3 space-y-2">
              {issues.length === 0 && !loading ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No issues found
                </div>
              ) : (
                issues.map((issue) => (
                  <GitHubIssueCard
                    key={issue.number}
                    issue={issue}
                    isSelected={selectedIssueFromStore?.number === issue.number}
                    onClick={() => setSelectedIssue(issue)}
                  />
                ))
              )}

              {loading && issues.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Detail panel */}
        {selectedIssueFromStore && (
          <div className="flex-shrink-0 flex" style={{ width: detailWidth }}>
            <div
              className="w-1.5 flex-shrink-0 cursor-col-resize flex items-center justify-center hover:bg-violet-500/20 active:bg-violet-500/30 transition-colors group"
              onMouseDown={(e) => {
                e.preventDefault();
                setResizing({ startX: e.clientX, startWidth: detailWidth });
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
            >
              <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-violet-400 transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <GitHubIssueDetail
                projectId={project.id}
                issue={selectedIssueFromStore}
                send={send}
                onClose={() => setSelectedIssue(null)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Create issue dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Issue</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Issue title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) handleCreate();
              }}
            />
            <Textarea
              placeholder="Description (Markdown supported)"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              className="min-h-[120px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newTitle.trim()}>
              Create Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
