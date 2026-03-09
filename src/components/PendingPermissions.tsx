"use client";

import { useStore } from "@/store";
import { ShieldAlert, Terminal as TerminalIcon, FileEdit, FilePlus, MessageSquareMore } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PermissionRequest } from "@/lib/shared/types";

interface PendingPermissionsProps {
  onNavigate: (sessionId: string) => void;
}

function getToolIcon(toolName: string) {
  switch (toolName) {
    case "Bash":
      return <TerminalIcon className="w-3 h-3 shrink-0" />;
    case "Edit":
      return <FileEdit className="w-3 h-3 shrink-0" />;
    case "Write":
      return <FilePlus className="w-3 h-3 shrink-0" />;
    case "AskUserQuestion":
      return <MessageSquareMore className="w-3 h-3 shrink-0" />;
    default:
      return <ShieldAlert className="w-3 h-3 shrink-0" />;
  }
}

function getToolSummary(req: PermissionRequest): string {
  const { toolName, input } = req;
  if (toolName === "Bash" && input.command) {
    const cmd = String(input.command);
    return cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
  }
  if (toolName === "Write" && input.file_path) {
    const p = String(input.file_path);
    return `Write ${p.length > 50 ? "..." + p.slice(-47) : p}`;
  }
  if (toolName === "Edit" && input.file_path) {
    const p = String(input.file_path);
    return `Edit ${p.length > 50 ? "..." + p.slice(-47) : p}`;
  }
  if (toolName === "AskUserQuestion") return "Question";
  if (toolName === "ExitPlanMode") return "Plan approval";
  if (input.file_path) return String(input.file_path);
  return toolName;
}

export function PendingPermissions({ onNavigate }: PendingPermissionsProps) {
  const pendingRequests = useStore((s) => s.pendingRequests);
  const sessionNames = useStore((s) => s.sessionNames);
  const sessions = useStore((s) => s.sessions);
  const messages = useStore((s) => s.messages);

  // Collect all pending requests across sessions
  const allPending: Array<{ sessionId: string; request: PermissionRequest }> = [];
  for (const [sessionId, requests] of pendingRequests) {
    for (const request of requests) {
      allPending.push({ sessionId, request });
    }
  }

  if (allPending.length === 0) return null;

  const getDisplayName = (sessionId: string): string => {
    const customName = sessionNames.get(sessionId);
    if (customName) return customName;
    const sessionMessages = messages.get(sessionId);
    if (sessionMessages) {
      const firstUserMsg = sessionMessages.find((m) => m.role === "user");
      if (firstUserMsg) {
        const text = firstUserMsg.content.trim();
        return text.length > 30 ? text.slice(0, 27) + "..." : text;
      }
    }
    const session = sessions.get(sessionId);
    return session?.machineName ?? sessionId.slice(0, 8);
  };

  return (
    <div className="border-t overflow-hidden min-w-0">
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-500">
        <ShieldAlert className="w-3.5 h-3.5" />
        <span>Pending Permissions</span>
        <span className="ml-auto bg-amber-500/15 text-amber-500 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none">
          {allPending.length}
        </span>
      </div>
      <ScrollArea className="max-h-48">
        <div className="px-2 pb-2 space-y-1">
          {allPending.map(({ sessionId, request }) => (
            <button
              key={request.requestId}
              onClick={() => onNavigate(sessionId)}
              className="w-full text-left px-2.5 py-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.08] transition-colors group overflow-hidden"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5 min-w-0">
                <span className="truncate">{getDisplayName(sessionId)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs min-w-0">
                {getToolIcon(request.toolName)}
                <span className="truncate font-mono text-foreground/80">
                  {getToolSummary(request)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
