"use client";

import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { StreamOutput } from "./StreamOutput";
import { PromptInput } from "./PromptInput";
import type { Session, ConversationMessage } from "@/lib/shared/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Monitor, Server, X, FolderOpen, Shield, ShieldAlert, ShieldCheck, ShieldOff, Settings, ChevronDown, Check, ClipboardList, GitBranch } from "lucide-react";
import { PERMISSION_MODES } from "@/lib/shared/types";
import type { PermissionMode } from "@/lib/shared/types";
import { SettingsDialog } from "./SettingsDialog";
import { PlanPanel } from "./PlanPanel";
import { useStore } from "@/store";
import type { ClientMessage } from "@/lib/shared/protocol";

interface SessionViewProps {
  session: Session;
  messages: ConversationMessage[];
  streamingText: string;
  displayName?: string;
  onSendPrompt: (prompt: string) => void;
  onPermissionResponse: (requestId: string, allow: boolean, answers?: Record<string, string>, message?: string) => void;
  onTerminate: () => void;
  send: (msg: ClientMessage) => void;
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
}: SessionViewProps) {
  const isLocal = session.machineId === "local";
  const isBusy = session.status === "busy" || session.status === "starting";
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  const [modePopoverOpen, setModePopoverOpen] = useState(false);

  const planContent = useStore((s) => s.planContent.get(session.id));
  const planPanelOpen = useStore((s) => s.planPanelOpen.get(session.id) ?? false);
  const setPlanPanelOpen = useStore((s) => s.setPlanPanelOpen);

  const handleSessionSettingsOpen = (open: boolean) => {
    setSessionSettingsOpen(open);
    if (open) {
      send({ type: "session.config.read", sessionId: session.id });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-3">
          {isLocal ? (
            <Monitor className="w-4 h-4 text-muted-foreground" />
          ) : (
            <Server className="w-4 h-4 text-muted-foreground" />
          )}
          <div>
            <div className="font-medium text-sm">{displayName || session.machineName}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
              <button className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer transition-colors ${
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
        <div className="flex items-center gap-2">
          {session.totalCostUsd > 0 && (
            <span className="text-xs font-mono text-muted-foreground">
              Total: ${session.totalCostUsd.toFixed(4)}
            </span>
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
          >
            <X className="w-4 h-4" />
          </Button>
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
            <StreamOutput messages={messages} streamingText={streamingText} onSendPrompt={onSendPrompt} onPermissionResponse={onPermissionResponse} />
          )}

          {/* Input */}
          <PromptInput onSend={onSendPrompt} disabled={isBusy} />
        </div>

        {/* Plan panel */}
        {planContent && planPanelOpen && (
          <PlanPanel
            content={planContent}
            onClose={() => setPlanPanelOpen(session.id, false)}
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
