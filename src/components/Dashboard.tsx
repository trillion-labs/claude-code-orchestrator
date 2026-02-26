"use client";

import { useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useSessionStore } from "@/hooks/useSessionStore";
import { SessionCard } from "./SessionCard";
import { SessionView } from "./SessionView";
import { MachineSelector } from "./MachineSelector";
import { SettingsDialog } from "./SettingsDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Terminal, Settings } from "lucide-react";
import type { PermissionMode } from "@/lib/shared/types";

export function Dashboard() {
  const { send } = useWebSocket();
  const {
    sessions,
    activeSession,
    activeSessionId,
    activeMessages,
    activeStreamingText,
    machines,
    discoveredSessions,
    pendingAttention,
    setActiveSession,
    setSessionName,
    removeAttention,
    getSessionDisplayName,
  } = useSessionStore();

  const handleCreateSession = (machineId: string, workDir: string, resumeSessionId?: string, permissionMode?: PermissionMode) => {
    send({ type: "session.create", machineId, workDir, resumeSessionId, permissionMode });
  };

  const handleDiscoverSessions = (machineId: string, workDir?: string) => {
    send({ type: "session.discover", machineId, workDir });
  };

  const handleSendPrompt = (prompt: string) => {
    if (!activeSessionId) return;
    send({ type: "session.prompt", sessionId: activeSessionId, prompt });
    removeAttention(activeSessionId, "question");
  };

  const handlePermissionResponse = (requestId: string, allow: boolean, answers?: Record<string, string>, message?: string) => {
    if (!activeSessionId) return;
    send({ type: "session.permissionResponse", sessionId: activeSessionId, requestId, allow, answers, message });
    removeAttention(activeSessionId, `perm:${requestId}`);
    removeAttention(activeSessionId, "question");
  };

  const handleTerminate = () => {
    if (!activeSessionId) return;
    send({ type: "session.terminate", sessionId: activeSessionId });
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleSettingsOpen = (open: boolean) => {
    setSettingsOpen(open);
    if (open) {
      send({ type: "config.read" });
    }
  };

  const activeDisplayName = activeSessionId
    ? getSessionDisplayName(activeSessionId)
    : undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left Panel - Session List */}
      <div className="w-72 border-r flex flex-col overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="w-5 h-5" />
            <h1 className="font-semibold text-sm flex-1">Claude Orchestrator</h1>
            <button
              onClick={() => handleSettingsOpen(true)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={handleSettingsOpen}
            send={send}
            mode="global"
          />
          <MachineSelector
            machines={machines}
            discoveredSessions={discoveredSessions}
            onCreateSession={handleCreateSession}
            onDiscoverSessions={handleDiscoverSessions}
          />
        </div>

        <ScrollArea className="flex-1 min-w-0" data-sidebar-scroll>
          <div className="p-2 space-y-1">
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No active sessions
              </p>
            ) : (
              sessions.map((session) => {
                const attentionSet = pendingAttention.get(session.id);
                return (
                  <SessionCard
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onClick={() => setActiveSession(session.id)}
                    attentionCount={attentionSet ? attentionSet.size : 0}
                    displayName={getSessionDisplayName(session.id)}
                    onRename={(name) => setSessionName(session.id, name)}
                  />
                );
              })
            )}
          </div>
        </ScrollArea>

        <Separator />
        <div className="p-3 text-xs text-muted-foreground text-center">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""} active
        </div>
      </div>

      {/* Right Panel - Session Detail */}
      <div className="flex-1 flex flex-col">
        {activeSession ? (
          <SessionView
            session={activeSession}
            messages={activeMessages}
            streamingText={activeStreamingText}
            displayName={activeDisplayName}
            onSendPrompt={handleSendPrompt}
            onPermissionResponse={handlePermissionResponse}
            onTerminate={handleTerminate}
            send={send}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Terminal className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a session or create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
