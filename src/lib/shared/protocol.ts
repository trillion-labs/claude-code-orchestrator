import type { Session, MachineConfig, ConversationMessage, ClaudeSessionInfo, PermissionMode, PermissionRequest, Project, Task, KanbanColumn } from "./types";

// ── Client → Server Messages ──

export type ClientMessage =
  | {
      type: "session.create";
      machineId: string;
      workDir: string;
      resumeSessionId?: string; // Claude session ID to resume
      permissionMode?: PermissionMode;
      worktree?: { enabled: boolean; name: string; existingPath?: string };
    }
  | {
      type: "session.discover";
      machineId: string;
      workDir?: string; // Filter by project path
    }
  | {
      type: "session.prompt";
      sessionId: string;
      prompt: string;
    }
  | {
      type: "session.interrupt";
      sessionId: string;
    }
  | {
      type: "session.terminate";
      sessionId: string;
    }
  | {
      type: "session.list";
    }
  | {
      type: "machines.list";
    }
  | {
      type: "session.permissionResponse";
      sessionId: string;
      requestId: string;
      allow: boolean;
      answers?: Record<string, string>; // AskUserQuestion: user's selected answers
      message?: string; // Deny message (e.g. plan feedback from "Request Changes")
    }
  | {
      type: "session.setPermissionMode";
      sessionId: string;
      mode: PermissionMode;
    }
  | { type: "config.read" }
  | { type: "config.write"; file: "settings" | "claudemd"; content: string }
  | { type: "session.config.read"; sessionId: string }
  | { type: "session.config.write"; sessionId: string; file: "settings" | "claudemd"; content: string }
  | { type: "worktrees.list"; machineId: string; workDir: string }
  | { type: "path.list"; machineId: string; path: string; requestId: string }
  // ── Project CRUD ──
  | { type: "project.create"; name: string; machineId: string; workDir: string; permissionMode: PermissionMode }
  | { type: "project.update"; projectId: string; updates: { name?: string; permissionMode?: PermissionMode } }
  | { type: "project.delete"; projectId: string }
  | { type: "project.list" }
  // ── Task CRUD ──
  | { type: "task.create"; projectId: string; title: string; description: string }
  | { type: "task.update"; projectId: string; taskId: string; updates: { title?: string; description?: string } }
  | { type: "task.delete"; projectId: string; taskId: string }
  | { type: "task.move"; projectId: string; taskId: string; column: KanbanColumn; order: number }
  | { type: "task.reorder"; projectId: string; column: KanbanColumn; taskIds: string[] }
  | { type: "task.submit"; projectId: string; taskId: string }
  | { type: "task.importSession"; projectId: string; sessionId: string; title?: string }
  | { type: "task.linkSession"; projectId: string; taskId: string; sessionId: string }
  | { type: "task.list"; projectId: string };

// ── Server → Client Messages ──

export type ServerMessage =
  | {
      type: "session.created";
      session: Session;
    }
  | {
      type: "session.stream";
      sessionId: string;
      delta: string; // Text delta for streaming
    }
  | {
      type: "session.message";
      sessionId: string;
      message: ConversationMessage;
    }
  | {
      type: "session.status";
      sessionId: string;
      status: Session["status"];
      totalCostUsd?: number;
      error?: string;
    }
  | {
      type: "session.terminated";
      sessionId: string;
    }
  | {
      type: "session.error";
      sessionId: string;
      error: string;
    }
  | {
      type: "session.list";
      sessions: Session[];
    }
  | {
      type: "machines.list";
      machines: MachineConfig[];
    }
  | {
      type: "session.discovered";
      machineId: string;
      sessions: ClaudeSessionInfo[];
    }
  | {
      type: "session.permissionRequest";
      sessionId: string;
      request: PermissionRequest;
    }
  | {
      type: "session.permissionModeChanged";
      sessionId: string;
      mode: PermissionMode;
    }
  | {
      type: "session.planContent";
      sessionId: string;
      content: string;
      filePath: string;
    }
  | {
      type: "config.data";
      settings: string;
      claudemd: string;
    }
  | {
      type: "config.saved";
      file: "settings" | "claudemd";
    }
  | {
      type: "config.error";
      error: string;
    }
  | {
      type: "session.config.data";
      sessionId: string;
      settings: string;
      claudemd: string;
    }
  | {
      type: "session.config.saved";
      sessionId: string;
      file: "settings" | "claudemd";
    }
  | {
      type: "session.config.error";
      sessionId: string;
      error: string;
    }
  | {
      type: "worktrees.list";
      machineId: string;
      worktrees: Array<{ name: string; path: string; branch: string }>;
    }
  | {
      type: "path.list";
      machineId: string;
      requestId: string;
      entries: Array<{ name: string; isDir: boolean }>;
      resolvedPath: string;
      prefix?: string;
      error?: string;
    }
  | {
      type: "error";
      error: string;
    }
  // ── Project responses ──
  | { type: "project.created"; project: Project }
  | { type: "project.updated"; project: Project }
  | { type: "project.deleted"; projectId: string }
  | { type: "project.list"; projects: Project[] }
  // ── Task responses ──
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task }
  | { type: "task.deleted"; projectId: string; taskId: string }
  | { type: "task.moved"; task: Task }
  | { type: "task.reordered"; projectId: string; column: KanbanColumn; taskIds: string[] }
  | { type: "task.list"; projectId: string; tasks: Task[] }
  | { type: "task.submitted"; task: Task; session: Session }
  | { type: "task.sessionImported"; task: Task; session: Session }
  | { type: "task.sessionLinked"; task: Task; session: Session }
  | { type: "task.sessionCompleted"; task: Task };
