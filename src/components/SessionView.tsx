"use client";

import { useState, useCallback } from "react";
import { StatusBadge } from "./StatusBadge";
import { StreamOutput } from "./StreamOutput";
import { PromptInput } from "./PromptInput";
import type { Session, ConversationMessage } from "@/lib/shared/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Monitor, Server, X, FolderOpen, Shield, ShieldAlert, ShieldCheck, ShieldOff, Settings, ChevronDown, Check, ClipboardList, GitBranch, FileText, PanelRight, Trash2 } from "lucide-react";
import { PERMISSION_MODES } from "@/lib/shared/types";
import type { PermissionMode } from "@/lib/shared/types";
import { SettingsDialog } from "./SettingsDialog";
import { PlanPanel } from "./PlanPanel";
import { FilePreviewPanel } from "./FilePreviewPanel";
import { useStore } from "@/store";
import type { ClientMessage } from "@/lib/shared/protocol";
import type { FileReadResult } from "@/hooks/useWebSocket";

interface SessionViewProps {
  session: Session;
  messages: ConversationMessage[];
  streamingText: string;
  displayName?: string;
  onSendPrompt: (prompt: string) => void;
  onPermissionResponse: (requestId: string, allow: boolean, answers?: Record<string, string>, message?: string) => void;
  onTerminate: () => void;
  send: (msg: ClientMessage) => void;
  requestFileRead: (machineId: string, filePath: string, maxLines?: number) => Promise<FileReadResult>;
  onSplitRight?: (sessionId: string) => void;
  onClosePanel?: () => void;
}

export function SessionView({
  session,
  messages,
  streamingText,
  displayName,
  onSendPrompt,
  onPermissionResponse,
  onTerminate,
  send,
  requestFileRead,
  onSplitRight,
  onClosePanel,
}: SessionViewProps) {
  const isLocal = session.machineId === "local";
  const isBusy = session.status === "busy" || session.status === "starting";
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  const [modePopoverOpen, setModePopoverOpen] = useState(false);

  const planContent = useStore((s) => s.planContent.get(session.id));
  const planPanelOpen = useStore((s) => s.planPanelOpen.get(session.id) ?? false);
  const setPlanPanelOpen = useStore((s) => s.setPlanPanelOpen);
  const hasMoreMessages = useStore((s) => s.hasMoreMessages.get(session.id) ?? true);
  const loadingHistory = useStore((s) => s.loadingHistory.get(session.id) ?? false);
  const setLoadingHistory = useStore((s) => s.setLoadingHistory);

  const handleLoadHistory = useCallback(() => {
    if (loadingHistory || !hasMoreMessages || messages.length === 0) return;
    setLoadingHistory(session.id, true);
    const oldestTimestamp = messages[0].timestamp;
    send({ type: "session.history", sessionId: session.id, before: oldestTimestamp, limit: 20 });
  }, [loadingHistory, hasMoreMessages, messages, session.id, setLoadingHistory, send]);

  const filePreview = useStore((s) => s.filePreview.get(session.id));
  const filePreviewOpen = useStore((s) => s.filePreviewOpen.get(session.id) ?? false);
  const setFilePreviewOpen = useStore((s) => s.setFilePreviewOpen);
  const setFilePreviewLoading = useStore((s) => s.setFilePreviewLoading);
  const setFilePreview = useStore((s) => s.setFilePreview);
  const setFilePreviewError = useStore((s) => s.setFilePreviewError);

  const handleFilePreview = useCallback(async (filePath: string) => {
    // Toggle off if same file already shown
    if (filePreview?.filePath === filePath && filePreviewOpen) {
      setFilePreviewOpen(session.id, false);
      return;
    }

    setFilePreviewLoading(session.id, filePath);

    const result = await requestFileRead(session.machineId, filePath);

    if (result.error) {
      setFilePreviewError(session.id, result.error);
    } else {
      setFilePreview(session.id, {
        filePath: result.filePath,
        content: result.content,
        language: result.language,
        truncated: result.truncated,
      });
    }
  }, [session.id, session.machineId, filePreview?.filePath, filePreviewOpen, requestFileRead, setFilePreview, setFilePreviewLoading, setFilePreviewError, setFilePreviewOpen]);

  const handleSessionSettingsOpen = (open: boolean) => {
    setSessionSettingsOpen(open);
    if (open) {
      send({ type: "session.config.read", sessionId: session.id });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {isLocal ? (
            <Monitor className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <Server className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{displayName || session.machineName}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
              {displayName && (
                <>
                  {isLocal ? (
                    <Monitor className="w-3 h-3" />
                  ) : (
                    <Server className="w-3 h-3" />
                  )}
                  <span className="mr-1.5">{session.machineName}</span>
                </>
              )}
              <FolderOpen className="w-3 h-3" />
              <span className="font-mono">{session.workDir}</span>
              {session.worktree && (
                <>
                  <span className="mx-0.5">·</span>
                  <GitBranch className="w-3 h-3" />
                  <span className="font-mono">{session.worktree.branch}</span>
                </>
              )}
            </div>
          </div>
          <StatusBadge status={session.status} />
          <Popover open={modePopoverOpen} onOpenChange={setModePopoverOpen}>
            <PopoverTrigger asChild>
              <button className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer transition-colors whitespace-nowrap ${
                session.permissionMode === "bypass-permissions"
                  ? "bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25"
                  : session.permissionMode === "accept-edits"
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25"
                    : session.permissionMode === "plan"
                      ? "bg-blue-500/15 text-blue-400 border border-blue-500/25 hover:bg-blue-500/25"
                      : "bg-muted text-muted-foreground border border-border hover:bg-accent"
              }`}>
                {session.permissionMode === "bypass-permissions" ? (
                  <ShieldOff className="w-3 h-3" />
                ) : session.permissionMode === "accept-edits" ? (
                  <ShieldAlert className="w-3 h-3" />
                ) : session.permissionMode === "plan" ? (
                  <Shield className="w-3 h-3" />
                ) : (
                  <ShieldCheck className="w-3 h-3" />
                )}
                {PERMISSION_MODES[session.permissionMode].label}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="start">
              {(Object.entries(PERMISSION_MODES) as [PermissionMode, typeof PERMISSION_MODES[PermissionMode]][]).map(([mode, config]) => (
                <button
                  key={mode}
                  onClick={() => {
                    send({ type: "session.setPermissionMode", sessionId: session.id, mode });
                    setModePopoverOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                    session.permissionMode === mode
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="w-4 flex justify-center">
                    {session.permissionMode === mode && <Check className="w-3 h-3" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{config.label}</div>
                    <div className="text-[10px] opacity-70">{config.description}</div>
                  </div>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {session.totalCostUsd > 0 && (
            <span className="text-xs font-mono text-muted-foreground">
              Total: ${session.totalCostUsd.toFixed(4)}
            </span>
          )}
          {filePreview && !filePreview.loading && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFilePreviewOpen(session.id, !filePreviewOpen)}
              className={`h-8 w-8 transition-colors ${filePreviewOpen ? "text-sky-400 hover:text-sky-300" : "text-muted-foreground hover:text-foreground"}`}
            >
              <FileText className="w-4 h-4" />
            </Button>
          )}
          {planContent && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPlanPanelOpen(session.id, !planPanelOpen)}
              className={`h-8 w-8 transition-colors ${planPanelOpen ? "text-violet-400 hover:text-violet-300" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ClipboardList className="w-4 h-4" />
            </Button>
          )}
          {onSplitRight && (
            <SplitButton sessionId={session.id} onSplitRight={onSplitRight} />
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleSessionSettingsOpen(true)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Settings className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onTerminate}
            className="h-8 w-8 text-destructive hover:text-destructive"
            title="Terminate session"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          {onClosePanel && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClosePanel}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Close split panel"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {session.error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm">
          {session.error}
        </div>
      )}

      <Separator />

      {/* Content area: chat + optional plan panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Chat area */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Messages */}
          {messages.length === 0 && !streamingText ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Send a prompt to start the conversation
            </div>
          ) : (
            <StreamOutput
              messages={messages}
              streamingText={streamingText}
              sessionId={session.id}
              hasMoreMessages={hasMoreMessages}
              loadingHistory={loadingHistory}
              onLoadHistory={handleLoadHistory}
              onSendPrompt={onSendPrompt}
              onPermissionResponse={onPermissionResponse}
              onFilePreview={handleFilePreview}
            />
          )}

          {/* Input */}
          <PromptInput
            onSend={onSendPrompt}
            disabled={isBusy}
            onCancel={() => send({ type: "session.interrupt", sessionId: session.id })}
          />
        </div>

        {/* Plan panel */}
        {planContent && planPanelOpen && (
          <PlanPanel
            content={planContent}
            onClose={() => setPlanPanelOpen(session.id, false)}
          />
        )}

        {/* File preview panel */}
        {filePreview && filePreviewOpen && (
          <FilePreviewPanel
            filePath={filePreview.filePath}
            content={filePreview.content}
            language={filePreview.language}
            truncated={filePreview.truncated}
            loading={filePreview.loading}
            error={filePreview.error}
            onClose={() => setFilePreviewOpen(session.id, false)}
          />
        )}
      </div>

      <SettingsDialog
        open={sessionSettingsOpen}
        onOpenChange={handleSessionSettingsOpen}
        send={send}
        mode="session"
        sessionId={session.id}
      />
    </div>
  );
}

function SplitButton({ sessionId, onSplitRight }: { sessionId: string; onSplitRight: (sessionId: string) => void }) {
  const sessions = useStore((s) => s.sessions);
  const sessionNames = useStore((s) => s.sessionNames);
  const allMessages = useStore((s) => s.messages);
  const splitPanels = useStore((s) => s.splitPanels);

  const otherSessions = Array.from(sessions.values())
    .filter((s) => s.id !== sessionId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const getDisplayName = (sid: string): string => {
    const customName = sessionNames.get(sid);
    if (customName) return customName;
    const msgs = allMessages.get(sid);
    if (msgs) {
      const firstUserMsg = msgs.find((m) => m.role === "user");
      if (firstUserMsg) {
        const text = firstUserMsg.content.trim();
        return text.length > 40 ? text.slice(0, 37) + "..." : text;
      }
    }
    return sid.slice(0, 8);
  };

  const atMax = splitPanels.length >= 4;

  if (otherSessions.length === 0 || atMax) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        className="h-8 w-8 text-muted-foreground"
        title={atMax ? "Maximum panels reached" : "No other sessions to split"}
      >
        <PanelRight className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Split panel"
        >
          <PanelRight className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">Open in split</div>
        {otherSessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSplitRight(s.id)}
            className="w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-accent/50 truncate"
          >
            {getDisplayName(s.id)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
