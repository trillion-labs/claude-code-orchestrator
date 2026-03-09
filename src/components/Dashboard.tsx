"use client";

import { useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useSessionStore } from "@/hooks/useSessionStore";
import { useProjectStore } from "@/hooks/useProjectStore";
import { SessionCard } from "./SessionCard";
import { SessionView } from "./SessionView";
import { MachineSelector } from "./MachineSelector";
import { SettingsDialog } from "./SettingsDialog";
import { ProjectSidebar } from "./ProjectSidebar";
import { ProjectCreateDialog } from "./ProjectCreateDialog";
import { ProjectBoard } from "./ProjectBoard";
import { PendingPermissions } from "./PendingPermissions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Terminal, Settings, LayoutGrid, FolderOpen } from "lucide-react";
import { useStore } from "@/store";
import type { PermissionMode } from "@/lib/shared/types";

export function Dashboard() {
  const { send, requestPathList, requestMkdir, requestFileRead } = useWebSocket();
  const {
    sessions,
    activeSession,
    activeSessionId,
    activeMessages,
    activeStreamingText,
    machines,
    discoveredSessions,
    pendingAttention,
    worktrees,
    setActiveSession,
    setSessionName,
    removeAttention,
    getSessionDisplayName,
  } = useSessionStore();

  const {
    activeProject,
    viewMode,
    setViewMode,
  } = useProjectStore();

  const handleCreateSession = (
    machineId: string,
    workDir: string,
    resumeSessionId?: string,
    permissionMode?: PermissionMode,
    worktree?: { enabled: boolean; name: string; existingPath?: string },
  ) => {
    send({ type: "session.create", machineId, workDir, resumeSessionId, permissionMode, worktree });
  };

  const handleListWorktrees = (machineId: string, workDir: string) => {
    send({ type: "worktrees.list", machineId, workDir });
  };

  const handleDiscoverSessions = (machineId: string, workDir?: string) => {
    send({ type: "session.discover", machineId, workDir });
  };

  const handleSendPrompt = (prompt: string) => {
    if (!activeSessionId) return;
    send({ type: "session.prompt", sessionId: activeSessionId, prompt });
    removeAttention(activeSessionId, "question");
  };

  const removePendingRequest = useStore((s) => s.removePendingRequest);

  const handlePermissionResponse = (requestId: string, allow: boolean, answers?: Record<string, string>, message?: string) => {
    if (!activeSessionId) return;
    send({ type: "session.permissionResponse", sessionId: activeSessionId, requestId, allow, answers, message });
    removeAttention(activeSessionId, `perm:${requestId}`);
    removeAttention(activeSessionId, "question");
    removePendingRequest(activeSessionId, requestId);
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

  // Cross-view navigation: from kanban to session view
  const handleViewSession = (sessionId: string) => {
    setViewMode("sessions");
    setActiveSession(sessionId);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left Panel - Sidebar */}
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

          {/* View mode toggle */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg mb-3">
            <button
              onClick={() => setViewMode("sessions")}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 px-3 rounded-md transition-colors ${
                viewMode === "sessions"
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Terminal className="w-3 h-3" />
              Sessions
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 px-3 rounded-md transition-colors ${
                viewMode === "kanban"
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              Projects
            </button>
          </div>

          <SettingsDialog
            open={settingsOpen}
            onOpenChange={handleSettingsOpen}
            send={send}
            mode="global"
          />

          {/* Conditional action button */}
          {viewMode === "sessions" ? (
            <MachineSelector
              machines={machines}
              discoveredSessions={discoveredSessions}
              worktrees={worktrees}
              onCreateSession={handleCreateSession}
              onDiscoverSessions={handleDiscoverSessions}
              onListWorktrees={handleListWorktrees}
              requestPathList={requestPathList}
            />
          ) : (
            <ProjectCreateDialog
              machines={machines}
              requestPathList={requestPathList}
              requestMkdir={requestMkdir}
              onCreateProject={(name, machineId, workDir, permissionMode) => {
                send({ type: "project.create", name, machineId, workDir, permissionMode });
              }}
            />
          )}
        </div>

        {/* Sidebar content */}
        {viewMode === "sessions" ? (
          <>
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
                        send={send}
                      />
                    );
                  })
                )}
              </div>
            </ScrollArea>

            <PendingPermissions onNavigate={handleViewSession} />

            <Separator />
            <div className="p-3 text-xs text-muted-foreground text-center">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""} active
            </div>
          </>
        ) : (
          <ProjectSidebar
            send={send}
            onNavigateToSession={handleViewSession}
          />
        )}
      </div>

      {/* Right Panel - Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {viewMode === "sessions" ? (
          // Sessions view (unchanged)
          activeSession ? (
            <SessionView
              session={activeSession}
              messages={activeMessages}
              streamingText={activeStreamingText}
              displayName={activeDisplayName}
              onSendPrompt={handleSendPrompt}
              onPermissionResponse={handlePermissionResponse}
              onTerminate={handleTerminate}
              send={send}
              requestFileRead={requestFileRead}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Terminal className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a session or create a new one</p>
              </div>
            </div>
          )
        ) : (
          // Kanban view
          activeProject ? (
            <ProjectBoard
              project={activeProject}
              send={send}
              onViewSession={handleViewSession}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a project or create a new one</p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
