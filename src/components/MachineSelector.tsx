"use client";

import { useState, useCallback, useEffect } from "react";
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
import { PathInput } from "./PathInput";
import type { PathListResult } from "@/hooks/useWebSocket";
import type { MachineConfig, ClaudeSessionInfo, PermissionMode } from "@/lib/shared/types";
import { PERMISSION_MODES } from "@/lib/shared/types";
import { Plus, Monitor, Server, RotateCcw, Search, Shield, ShieldAlert, ShieldOff, GitBranch, RefreshCw, Check } from "lucide-react";
import { generateWorktreeName } from "@/lib/shared/worktree-names";
import { TimeAgo } from "./TimeAgo";

type Mode = "new" | "resume";
type WorktreeMode = "off" | "new" | "existing";

interface MachineSelectorProps {
  machines: MachineConfig[];
  discoveredSessions: Map<string, ClaudeSessionInfo[]>;
  worktrees: Map<string, Array<{ name: string; path: string; branch: string }>>;
  onCreateSession: (
    machineId: string,
    workDir: string,
    resumeSessionId?: string,
    permissionMode?: PermissionMode,
    worktree?: { enabled: boolean; name: string; existingPath?: string },
  ) => void;
  onDiscoverSessions: (machineId: string, workDir?: string) => void;
  onListWorktrees: (machineId: string, workDir: string) => void;
  requestPathList: (machineId: string, path: string) => Promise<PathListResult>;
  onRefreshMachines?: () => void;
}

export function MachineSelector({
  machines,
  discoveredSessions,
  worktrees,
  onCreateSession,
  onDiscoverSessions,
  onListWorktrees,
  requestPathList,
  onRefreshMachines,
}: MachineSelectorProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("new");
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [workDir, setWorkDir] = useState("~");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [discovering, setDiscovering] = useState(false);

  // Worktree state
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>("off");
  const [worktreeName, setWorktreeName] = useState(() => generateWorktreeName());
  const [selectedWorktree, setSelectedWorktree] = useState<string | null>(null);

  const selected = machines.find((m) => m.id === selectedMachine);
  const sessions = selectedMachine ? discoveredSessions.get(selectedMachine) : undefined;
  const existingWorktrees = selectedMachine ? worktrees.get(selectedMachine) || [] : [];

  // Fetch worktrees when switching to "existing" mode
  useEffect(() => {
    if (worktreeMode === "existing" && selectedMachine && workDir) {
      onListWorktrees(selectedMachine, workDir);
    }
  }, [worktreeMode, selectedMachine, workDir, onListWorktrees]);

  const handleCreate = () => {
    if (!selectedMachine) return;
    let worktreeOpts: { enabled: boolean; name: string; existingPath?: string } | undefined;

    if (worktreeMode === "new") {
      worktreeOpts = { enabled: true, name: worktreeName };
    } else if (worktreeMode === "existing" && selectedWorktree) {
      const wt = existingWorktrees.find((w) => w.name === selectedWorktree);
      if (wt) {
        worktreeOpts = { enabled: true, name: wt.name, existingPath: wt.path };
      }
    }

    onCreateSession(selectedMachine, workDir, undefined, permissionMode, worktreeOpts);
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
    setWorktreeMode("off");
    setWorktreeName(generateWorktreeName());
    setSelectedWorktree(null);
  };

  const isCreateDisabled = !selectedMachine || !workDir
    || (worktreeMode === "new" && !worktreeName)
    || (worktreeMode === "existing" && !selectedWorktree);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else { onRefreshMachines?.(); setOpen(true); } }}>
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
                <PathInput
                  value={workDir}
                  onChange={setWorkDir}
                  machineId={selectedMachine}
                  requestPathList={requestPathList}
                  placeholder="~/projects/my-app"
                />
              </div>

              {/* Git Worktree */}
              <div>
                  <label className="text-sm font-medium mb-2 block">Git Worktree</label>

                  {/* 3-way toggle */}
                  <div className="flex gap-1 p-1 bg-muted rounded-lg mb-2">
                    {(["off", "new", "existing"] as WorktreeMode[]).map((wm) => (
                      <button
                        key={wm}
                        onClick={() => {
                          setWorktreeMode(wm);
                          if (wm === "new") setWorktreeName(generateWorktreeName());
                          if (wm === "existing") setSelectedWorktree(null);
                        }}
                        className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors ${
                          worktreeMode === wm
                            ? "bg-background shadow-sm font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {wm === "off" ? "Off" : wm === "new" ? "Create New" : "Use Existing"}
                      </button>
                    ))}
                  </div>

                  {/* Create New worktree */}
                  {worktreeMode === "new" && (
                    <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground w-12 shrink-0">Name</label>
                        <Input
                          value={worktreeName}
                          onChange={(e) => setWorktreeName(
                            e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                          )}
                          className="font-mono text-xs h-7 flex-1"
                        />
                        <button
                          onClick={() => setWorktreeName(generateWorktreeName())}
                          className="p-1 rounded hover:bg-accent text-muted-foreground"
                          title="Generate new name"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div className="flex gap-2">
                          <span className="w-12 shrink-0">Path</span>
                          <span className="font-mono truncate">
                            {workDir}/.claude/worktrees/{worktreeName}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <span className="w-12 shrink-0">Branch</span>
                          <span className="font-mono">claude/{worktreeName}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Use Existing worktree */}
                  {worktreeMode === "existing" && (
                    <div className="p-3 rounded-lg border border-border bg-muted/30">
                      {existingWorktrees.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-3">
                          <GitBranch className="w-4 h-4 mx-auto mb-1 opacity-40" />
                          <p>No worktrees found in this directory</p>
                          <button
                            onClick={() => selectedMachine && onListWorktrees(selectedMachine, workDir)}
                            className="mt-1 text-primary hover:underline"
                          >
                            Refresh
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {existingWorktrees.map((wt) => (
                            <button
                              key={wt.name}
                              onClick={() => setSelectedWorktree(wt.name)}
                              className={`w-full text-left p-2 rounded-md border transition-colors flex items-center gap-2 ${
                                selectedWorktree === wt.name
                                  ? "border-primary bg-primary/5"
                                  : "border-transparent hover:bg-accent"
                              }`}
                            >
                              <GitBranch className={`w-3.5 h-3.5 shrink-0 ${
                                selectedWorktree === wt.name ? "text-primary" : "text-muted-foreground"
                              }`} />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{wt.name}</div>
                                <div className="text-xs text-muted-foreground font-mono truncate">
                                  {wt.branch}
                                </div>
                              </div>
                              {selectedWorktree === wt.name && (
                                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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

              <Button
                onClick={handleCreate}
                disabled={isCreateDisabled}
                className="w-full"
              >
                Create Session
              </Button>
            </>
          )}

          {/* Resume Session */}
          {mode === "resume" && selected && (
            <>
              <div>
                <label className="text-sm font-medium mb-2 block">Working Directory (for resumed session)</label>
                <PathInput
                  value={workDir}
                  onChange={setWorkDir}
                  onConfirm={handleDiscover}
                  machineId={selectedMachine}
                  requestPathList={requestPathList}
                  placeholder="~/projects/my-app"
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
                          <TimeAgo timestamp={s.lastActivity} className="text-xs text-muted-foreground" />
                        </div>
                        {s.summary && (
                          <p className="text-sm truncate">{s.summary}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span className="truncate">{s.project}</span>
                          <span>{s.messageCount > 1000 ? `${Math.round(s.messageCount / 1024)}MB` : s.messageCount > 0 ? `${s.messageCount}KB` : ""}</span>
                        </div>
                        {s.worktreeName && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <GitBranch className="w-3 h-3" />
                            <span className="font-mono truncate">claude/{s.worktreeName}</span>
                          </div>
                        )}
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

