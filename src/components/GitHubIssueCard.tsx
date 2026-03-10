"use client";

import type { GitHubIssue } from "@/lib/shared/types";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, CircleDot, CircleCheck } from "lucide-react";

interface GitHubIssueCardProps {
  issue: GitHubIssue;
  onClick: () => void;
  isSelected?: boolean;
}

export function GitHubIssueCard({ issue, onClick, isSelected }: GitHubIssueCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-accent/50 ${
        isSelected
          ? "border-violet-500/50 bg-violet-500/5"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-2 min-w-0">
        {issue.state === "open" ? (
          <CircleDot className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
        ) : (
          <CircleCheck className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-xs text-muted-foreground flex-shrink-0">#{issue.number}</span>
            <span className="text-sm font-medium truncate">{issue.title}</span>
          </div>

          {/* Labels */}
          {issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
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

          {/* Footer: author, assignees, comments */}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
            <span>{issue.author.login}</span>
            {issue.assignees.length > 0 && (
              <>
                <span>&middot;</span>
                <span>{issue.assignees.map((a) => a.login).join(", ")}</span>
              </>
            )}
            {issue.commentsCount > 0 && (
              <span className="flex items-center gap-0.5 ml-auto">
                <MessageSquare className="w-3 h-3" />
                {issue.commentsCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
