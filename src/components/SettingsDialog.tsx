"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/store";
import { X, Plus, ChevronDown } from "lucide-react";
import type { ClientMessage } from "@/lib/shared/protocol";

type Tab = "permissions" | "hooks" | "claudemd";

interface HookEntry {
  matcher: string;
  command: string;
}

interface HooksConfig {
  [event: string]: HookEntry[];
}

const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
] as const;

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  send: (msg: ClientMessage) => void;
  mode: "global" | "session";
  sessionId?: string; // required when mode === "session"
}

export function SettingsDialog({
  open,
  onOpenChange,
  send,
  mode,
  sessionId,
}: SettingsDialogProps) {
  const { globalSettings, globalClaudeMd, sessionConfig } = useStore();

  // Derive data source from mode
  const sourceSettings = mode === "global"
    ? globalSettings
    : sessionId ? (sessionConfig.get(sessionId)?.settings ?? null) : null;
  const sourceClaudeMd = mode === "global"
    ? globalClaudeMd
    : sessionId ? (sessionConfig.get(sessionId)?.claudemd ?? null) : null;

  const [tab, setTab] = useState<Tab>("permissions");

  // Local editable state
  const [permissions, setPermissions] = useState<string[]>([]);
  const [hooks, setHooks] = useState<HooksConfig>({});
  const [claudemd, setClaudemd] = useState("");
  const [newPermission, setNewPermission] = useState("");

  // Hook add form
  const [hookEvent, setHookEvent] = useState<string>(HOOK_EVENTS[0]);
  const [hookMatcher, setHookMatcher] = useState("");
  const [hookCommand, setHookCommand] = useState("");
  const [hookEventOpen, setHookEventOpen] = useState(false);

  // Track original values for dirty checking
  const [originalSettings, setOriginalSettings] = useState("");
  const [originalClaudemd, setOriginalClaudemd] = useState("");

  // Sync store → local state when data arrives
  useEffect(() => {
    if (sourceSettings !== null) {
      try {
        const parsed = JSON.parse(sourceSettings);
        setPermissions(parsed?.permissions?.allow || []);
        setHooks(parsed?.hooks || {});
      } catch {
        setPermissions([]);
        setHooks({});
      }
      setOriginalSettings(sourceSettings);
    }
  }, [sourceSettings]);

  useEffect(() => {
    if (sourceClaudeMd !== null) {
      setClaudemd(sourceClaudeMd);
      setOriginalClaudemd(sourceClaudeMd);
    }
  }, [sourceClaudeMd]);

  // Build current settings JSON from local state
  const buildSettingsJson = useCallback(() => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(originalSettings || "{}");
    } catch {
      parsed = {};
    }
    // Update only the fields we manage
    if (permissions.length > 0) {
      parsed.permissions = { ...((parsed.permissions as Record<string, unknown>) || {}), allow: permissions };
    } else {
      if (parsed.permissions && typeof parsed.permissions === "object") {
        const p = parsed.permissions as Record<string, unknown>;
        delete p.allow;
        if (Object.keys(p).length === 0) delete parsed.permissions;
      }
    }
    if (Object.keys(hooks).length > 0) {
      parsed.hooks = hooks;
    } else {
      delete parsed.hooks;
    }
    return JSON.stringify(parsed, null, 2);
  }, [permissions, hooks, originalSettings]);

  const isDirty = useCallback(() => {
    const currentSettingsJson = buildSettingsJson();
    // Normalize original for comparison
    let normalizedOriginal = "{}";
    try {
      normalizedOriginal = JSON.stringify(JSON.parse(originalSettings || "{}"), null, 2);
    } catch {
      normalizedOriginal = "{}";
    }
    return currentSettingsJson !== normalizedOriginal || claudemd !== originalClaudemd;
  }, [buildSettingsJson, claudemd, originalSettings, originalClaudemd]);

  const settingsDirty = useCallback(() => {
    const currentSettingsJson = buildSettingsJson();
    let normalizedOriginal = "{}";
    try {
      normalizedOriginal = JSON.stringify(JSON.parse(originalSettings || "{}"), null, 2);
    } catch {
      normalizedOriginal = "{}";
    }
    return currentSettingsJson !== normalizedOriginal;
  }, [buildSettingsJson, originalSettings]);

  const claudemdDirty = useCallback(() => {
    return claudemd !== originalClaudemd;
  }, [claudemd, originalClaudemd]);

  const handleSave = () => {
    if (settingsDirty()) {
      const content = buildSettingsJson();
      if (mode === "global") {
        send({ type: "config.write", file: "settings", content });
      } else {
        send({ type: "session.config.write", sessionId: sessionId!, file: "settings", content });
      }
      setOriginalSettings(content);
    }
    if (claudemdDirty()) {
      if (mode === "global") {
        send({ type: "config.write", file: "claudemd", content: claudemd });
      } else {
        send({ type: "session.config.write", sessionId: sessionId!, file: "claudemd", content: claudemd });
      }
      setOriginalClaudemd(claudemd);
    }
  };

  // Permission helpers
  const addPermission = () => {
    const trimmed = newPermission.trim();
    if (!trimmed || permissions.includes(trimmed)) return;
    setPermissions([...permissions, trimmed]);
    setNewPermission("");
  };

  const removePermission = (index: number) => {
    setPermissions(permissions.filter((_, i) => i !== index));
  };

  // Hook helpers
  const addHook = () => {
    const cmd = hookCommand.trim();
    if (!cmd) return;
    const entry: HookEntry = { matcher: hookMatcher.trim() || "", command: cmd };
    const existing = hooks[hookEvent] || [];
    setHooks({ ...hooks, [hookEvent]: [...existing, entry] });
    setHookMatcher("");
    setHookCommand("");
  };

  const removeHook = (event: string, index: number) => {
    const entries = [...(hooks[event] || [])];
    entries.splice(index, 1);
    if (entries.length === 0) {
      const newHooks = { ...hooks };
      delete newHooks[event];
      setHooks(newHooks);
    } else {
      setHooks({ ...hooks, [event]: entries });
    }
  };

  // Mode-dependent labels
  const title = mode === "global" ? "Global Settings" : "Session Settings";
  const settingsFilePath = mode === "global"
    ? "~/.claude/settings.json"
    : "{workDir}/.claude/settings.local.json";
  const claudemdFilePath = mode === "global"
    ? "~/.claude/CLAUDE.md"
    : "{workDir}/.claude/CLAUDE.md";
  const claudemdDescription = mode === "global"
    ? "Global instructions that apply to all Claude Code sessions."
    : "Project-local instructions that apply to sessions in this working directory.";

  const tabs: { key: Tab; label: string }[] = [
    { key: "permissions", label: "Permissions" },
    { key: "hooks", label: "Hooks" },
    { key: "claudemd", label: "CLAUDE.md" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl !grid-rows-[auto_1fr_auto] max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Scrollable middle section */}
        <div className="flex flex-col gap-4 overflow-hidden min-h-0">
          {/* Tab Bar */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg shrink-0">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 text-sm py-1.5 px-3 rounded-md transition-colors ${
                  tab === t.key
                    ? "bg-background shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-1">
              {/* Permissions Tab */}
              {tab === "permissions" && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Allow Rules
                  </label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Tools matching these patterns will be automatically allowed without prompting.
                  </p>
                  <p className="text-xs text-muted-foreground/60 mb-3 font-mono">
                    {settingsFilePath}
                  </p>
                  {permissions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                      No allow rules configured
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {permissions.map((rule, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border bg-muted/30"
                        >
                          <Badge variant="secondary" className="font-mono text-xs">
                            {rule}
                          </Badge>
                          <button
                            onClick={() => removePermission(i)}
                            className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newPermission}
                    onChange={(e) => setNewPermission(e.target.value)}
                    placeholder="e.g., Bash(npm test:*), Read, Edit"
                    className="font-mono text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addPermission();
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addPermission}
                    disabled={!newPermission.trim()}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </div>
              </div>
            )}

            {/* Hooks Tab */}
            {tab === "hooks" && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Hook Rules
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Shell commands that execute in response to specific events.
                  </p>
                  {Object.keys(hooks).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                      No hooks configured
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(hooks).map(([event, entries]) => (
                        <div key={event} className="border rounded-lg overflow-hidden">
                          <div className="px-3 py-2 bg-muted/50 border-b">
                            <span className="text-sm font-medium">{event}</span>
                          </div>
                          <div className="divide-y">
                            {entries.map((entry, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between gap-2 px-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  {entry.matcher && (
                                    <span className="text-xs text-muted-foreground mr-2">
                                      matcher: <code className="text-orange-400">{entry.matcher}</code>
                                    </span>
                                  )}
                                  <code className="text-xs font-mono">{entry.command}</code>
                                </div>
                                <button
                                  onClick={() => removeHook(event, i)}
                                  className="text-muted-foreground hover:text-destructive transition-colors p-1 flex-shrink-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add hook form */}
                <div className="border rounded-lg p-3 space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Add Hook</label>
                  <div className="flex gap-2">
                    <div className="relative">
                      <button
                        onClick={() => setHookEventOpen(!hookEventOpen)}
                        className="flex items-center gap-1 px-3 py-2 text-sm border rounded-md bg-background hover:bg-accent transition-colors min-w-[140px] justify-between"
                      >
                        {hookEvent}
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      {hookEventOpen && (
                        <div className="absolute top-full left-0 mt-1 border rounded-md bg-popover shadow-md z-50 min-w-[140px]">
                          {HOOK_EVENTS.map((ev) => (
                            <button
                              key={ev}
                              onClick={() => {
                                setHookEvent(ev);
                                setHookEventOpen(false);
                              }}
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                            >
                              {ev}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Input
                      value={hookMatcher}
                      onChange={(e) => setHookMatcher(e.target.value)}
                      placeholder="Matcher (optional)"
                      className="text-sm flex-1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={hookCommand}
                      onChange={(e) => setHookCommand(e.target.value)}
                      placeholder="Command (e.g., echo 'hook fired')"
                      className="font-mono text-sm flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addHook();
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addHook}
                      disabled={!hookCommand.trim()}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* CLAUDE.md Tab */}
            {tab === "claudemd" && (
              <div className="space-y-2">
                <label className="text-sm font-medium block">
                  {claudemdFilePath}
                </label>
                <p className="text-xs text-muted-foreground">
                  {claudemdDescription}
                </p>
                <Textarea
                  value={claudemd}
                  onChange={(e) => setClaudemd(e.target.value)}
                  className="font-mono text-sm min-h-[400px] resize-none"
                  placeholder={mode === "global" ? "# Global Instructions..." : "# Project Instructions..."}
                />
              </div>
            )}
            </div>
          </ScrollArea>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t">
          <Button onClick={handleSave} disabled={!isDirty()}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
