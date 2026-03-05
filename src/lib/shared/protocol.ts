import type { Session, MachineConfig, ConversationMessage, ClaudeSessionInfo, PermissionMode, PermissionRequest } from "./types";

// ── Output Preview Types ──

export interface OutputPreviewItem {
  id: string;
  type: "image" | "html";
  mimeType: string;       // "image/png", "text/html" 등
  data: string;           // base64 (이미지) 또는 HTML 문자열
  filePath: string;       // 원본 파일 경로 (레이블용)
  timestamp: number;
}

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
  | { type: "path.list"; machineId: string; path: string; requestId: string };

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
      type: "session.outputPreview";
      sessionId: string;
      item: OutputPreviewItem;
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
    };
