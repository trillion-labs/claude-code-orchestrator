"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MachineConfig, ClaudeSessionInfo, PermissionMode } from "@/lib/shared/types";
import { PERMISSION_MODES } from "@/lib/shared/types";
import { Plus, Monitor, Server, RotateCcw, Search, Shield, ShieldAlert, ShieldOff } from "lucide-react";

type Mode = "new" | "resume";

interface MachineSelectorProps {
  machines: MachineConfig[];
  discoveredSessions: Map<string, ClaudeSessionInfo[]>;
  onCreateSession: (machineId: string, workDir: string, resumeSessionId?: string, permissionMode?: PermissionMode) => void;
  onDiscoverSessions: (machineId: string, workDir?: string) => void;
}

export function MachineSelector({
  machines,
  discoveredSessions,
  onCreateSession,
  onDiscoverSessions,
}: MachineSelectorProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("new");
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [workDir, setWorkDir] = useState("~");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [discovering, setDiscovering] = useState(false);

  const selected = machines.find((m) => m.id === selectedMachine);
  const sessions = selectedMachine ? discoveredSessions.get(selectedMachine) : undefined;

  const handleCreate = () => {
    if (!selectedMachine) return;
    onCreateSession(selectedMachine, workDir, undefined, permissionMode);
    resetAndClose();
  };

  const handleResume = (sessionId: string, sessionProject?: string) => {
    if (!selectedMachine) return;
    // Use the discovered session's project path as workDir (fall back to input field value)
    const resumeWorkDir = sessionProject
      ? (sessionProject.startsWith("/") ? sessionProject : `/${sessionProject}`)
      : workDir;
    onCreateSession(selectedMachine, resumeWorkDir, sessionId);
    resetAndClose();
  };

  const handleDiscover = useCallback(() => {
    if (!selectedMachine) return;
    setDiscovering(true);
    onDiscoverSessions(selectedMachine, workDir || undefined);
    setTimeout(() => setDiscovering(false), 3000);
  }, [selectedMachine, workDir, onDiscoverSessions]);

  const resetAndClose = () => {
    setOpen(false);
    setSelectedMachine(null);
    setWorkDir("~");
    setPermissionMode("default");
    setMode("new");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="w-full">
          <Plus className="w-4 h-4 mr-1" />
          New Session
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {mode === "new" ? "Create New Session" : "Resume Session"}
          </DialogTitle>
        </DialogHeader>

        {/* Mode Toggle */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setMode("new")}
            className={`flex-1 text-sm py-1.5 px-3 rounded-md transition-colors ${
              mode === "new" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            New
          </button>
          <button
            onClick={() => setMode("resume")}
            className={`flex-1 text-sm py-1.5 px-3 rounded-md transition-colors ${
              mode === "resume" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
            Resume
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto min-h-0 flex-1">
          {/* Machine Selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">Select Machine</label>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {machines.map((machine) => (
                <button
                  key={machine.id}
                  onClick={() => {
                    setSelectedMachine(machine.id);
                    if (machine.defaultWorkDir) setWorkDir(machine.defaultWorkDir);
                    if (mode === "resume") {
                      onDiscoverSessions(machine.id, workDir || undefined);
                      setDiscovering(true);
                      setTimeout(() => setDiscovering(false), 3000);
                    }
                  }}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    selectedMachine === machine.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  {machine.type === "local" ? (
                    <Monitor className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <Server className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{machine.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {machine.type === "local" ? "Local" : `${machine.host}:${machine.port || 22}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* New Session */}
          {mode === "new" && selected && (
            <>
              <div>
                <label className="text-sm font-medium mb-2 block">Working Directory</label>
                <Input
                  value={workDir}
                  onChange={(e) => setWorkDir(e.target.value)}
                  placeholder="~/projects/my-app"
                  className="font-mono text-sm"
                />
              </div>

              {/* Permission Mode Selection */}
              <div>
                <label className="text-sm font-medium mb-2 block">Permission Mode</label>
                <div className="grid gap-1.5">
                  {(Object.entries(PERMISSION_MODES) as [PermissionMode, typeof PERMISSION_MODES[PermissionMode]][]).map(([key, config]) => {
                    const isSelected = permissionMode === key;
                    const Icon = key === "default" ? Shield : key === "accept-edits" ? ShieldAlert : ShieldOff;
                    const dangerColors = config.dangerLevel === "dangerous"
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : config.dangerLevel === "moderate"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        : "border-primary bg-primary/5";
                    const defaultColors = "border-border hover:bg-accent";

                    return (
                      <button
                        key={key}
                        onClick={() => setPermissionMode(key)}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                          isSelected ? dangerColors : defaultColors
                        }`}
                      >
                        <Icon className={`w-4 h-4 flex-shrink-0 ${
                          isSelected && config.dangerLevel === "dangerous" ? "text-red-400" :
                          isSelected && config.dangerLevel === "moderate" ? "text-amber-400" :
                          "text-muted-foreground"
                        }`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{config.label}</span>
                            {config.dangerLevel === "dangerous" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium">
                                Unsafe
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{config.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button onClick={handleCreate} disabled={!selectedMachine || !workDir} className="w-full">
                Create Session
              </Button>
            </>
          )}

          {/* Resume Session */}
          {mode === "resume" && selected && (
            <>
              <div>
                <label className="text-sm font-medium mb-2 block">Working Directory (for resumed session)</label>
                <Input
                  value={workDir}
                  onChange={(e) => setWorkDir(e.target.value)}
                  placeholder="~/projects/my-app"
                  className="font-mono text-sm"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Existing Sessions</label>
                <Button variant="ghost" size="sm" onClick={handleDiscover} disabled={discovering}>
                  <Search className="w-3.5 h-3.5 mr-1" />
                  {discovering ? "Scanning..." : "Scan"}
                </Button>
              </div>

              <ScrollArea className="max-h-60">
                {!sessions ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Click Scan to find existing sessions
                  </p>
                ) : sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No sessions found on this machine
                  </p>
                ) : (
                  <div className="space-y-1">
                    {sessions.map((s) => (
                      <button
                        key={s.sessionId}
                        onClick={() => handleResume(s.sessionId, s.project)}
                        className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono text-muted-foreground">
                            {s.sessionId.slice(0, 8)}...
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(s.lastActivity)}
                          </span>
                        </div>
                        {s.summary && (
                          <p className="text-sm truncate">{s.summary}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{s.project}</span>
                          <span>{s.messageCount > 1000 ? `${Math.round(s.messageCount / 1024)}MB` : s.messageCount > 0 ? `${s.messageCount}KB` : ""}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
