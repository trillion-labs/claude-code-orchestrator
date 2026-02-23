"use client";

import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { StreamOutput } from "./StreamOutput";
import { PromptInput } from "./PromptInput";
import type { Session, ConversationMessage } from "@/lib/shared/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Monitor, Server, X, FolderOpen, ShieldAlert, ShieldOff, Settings } from "lucide-react";
import { PERMISSION_MODES } from "@/lib/shared/types";
import { SettingsDialog } from "./SettingsDialog";
import type { ClientMessage } from "@/lib/shared/protocol";

interface SessionViewProps {
  session: Session;
  messages: ConversationMessage[];
  streamingText: string;
  displayName?: string;
  onSendPrompt: (prompt: string) => void;
  onPermissionResponse: (requestId: string, allow: boolean) => void;
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
            </div>
          </div>
          <StatusBadge status={session.status} />
          {session.permissionMode && session.permissionMode !== "default" && (
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
              session.permissionMode === "bypass-permissions"
                ? "bg-red-500/15 text-red-400 border border-red-500/25"
                : "bg-amber-500/15 text-amber-400 border border-amber-500/25"
            }`}>
              {session.permissionMode === "bypass-permissions" ? (
                <ShieldOff className="w-3 h-3" />
              ) : (
                <ShieldAlert className="w-3 h-3" />
              )}
              {PERMISSION_MODES[session.permissionMode].label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {session.totalCostUsd > 0 && (
            <span className="text-xs font-mono text-muted-foreground">
              Total: ${session.totalCostUsd.toFixed(4)}
            </span>
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
