"use client";

import { useState, useEffect, useRef } from "react";
import { useStore } from "@/store";
import type { GitHubIssue, GitHubComment } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  CircleDot,
  CircleCheck,
  MessageSquare,
  ExternalLink,
  Send,
  Loader2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

interface GitHubIssueDetailProps {
  projectId: string;
  issue: GitHubIssue;
  send: (msg: ClientMessage) => void;
  onClose: () => void;
}

export function GitHubIssueDetail({ projectId, issue, send, onClose }: GitHubIssueDetailProps) {
  const comments = useStore((s) => s.githubComments.get(`${projectId}:${issue.number}`));
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    send({ type: "github.issues.comments", projectId, issueNumber: issue.number });
  }, [send, projectId, issue.number]);

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    send({ type: "github.issues.addComment", projectId, issueNumber: issue.number, body: commentText.trim() });
    setCommentText("");
    // Will be reset when comment arrives via store update
    setTimeout(() => setSubmitting(false), 2000);
  };

  const handleToggleState = () => {
    send({
      type: "github.issues.update",
      projectId,
      issueNumber: issue.number,
      state: issue.state === "open" ? "closed" : "open",
    });
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {issue.state === "open" ? (
              <CircleDot className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <CircleCheck className="w-4 h-4 text-violet-400 flex-shrink-0" />
            )}
            <span className="text-sm font-semibold truncate">{issue.title}</span>
            <span className="text-xs text-muted-foreground flex-shrink-0">#{issue.number}</span>
          </div>
        </div>
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Meta bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b text-xs text-muted-foreground">
        <span>{issue.author.login}</span>
        <span>&middot;</span>
        <span>{timeAgo(issue.createdAt)}</span>
        {issue.assignees.length > 0 && (
          <>
            <span>&middot;</span>
            <span>Assigned: {issue.assignees.map((a) => a.login).join(", ")}</span>
          </>
        )}
        {issue.milestone && (
          <>
            <span>&middot;</span>
            <span>{issue.milestone.title}</span>
          </>
        )}
      </div>

      {/* Labels */}
      {issue.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 py-2 border-b">
          {issue.labels.map((label) => (
            <Badge
              key={label.name}
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 font-normal"
              style={{
                borderColor: `#${label.color}`,
                color: `#${label.color}`,
                backgroundColor: `#${label.color}15`,
              }}
            >
              {label.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Body + Comments */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Issue body */}
          {issue.body && (
            <div className="prose prose-sm prose-invert max-w-none text-sm">
              <ReactMarkdown>{issue.body}</ReactMarkdown>
            </div>
          )}

          {/* Comments */}
          {comments && comments.length > 0 && (
            <div className="space-y-3 pt-3 border-t">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MessageSquare className="w-3 h-3" />
                {comments.length} comment{comments.length !== 1 ? "s" : ""}
              </div>
              {comments.map((comment, idx) => (
                <CommentCard key={comment.id || idx} comment={comment} timeAgo={timeAgo} />
              ))}
            </div>
          )}
          <div ref={commentsEndRef} />
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="border-t p-3 space-y-2">
        <div className="flex gap-2">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            className="text-sm min-h-[60px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleAddComment();
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleState}
          >
            {issue.state === "open" ? (
              <>
                <CircleCheck className="w-3.5 h-3.5 mr-1" />
                Close
              </>
            ) : (
              <>
                <CircleDot className="w-3.5 h-3.5 mr-1" />
                Reopen
              </>
            )}
          </Button>
          <Button
            size="sm"
            onClick={handleAddComment}
            disabled={!commentText.trim() || submitting}
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5 mr-1" />
            )}
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentCard({ comment, timeAgo }: { comment: GitHubComment; timeAgo: (d: string) => string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <span className="font-medium text-foreground">{comment.author.login}</span>
        <span>{timeAgo(comment.createdAt)}</span>
      </div>
      <div className="prose prose-sm prose-invert max-w-none text-sm">
        <ReactMarkdown>{comment.body}</ReactMarkdown>
      </div>
    </div>
  );
}
