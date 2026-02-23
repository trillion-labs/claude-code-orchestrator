import type { Session, MachineConfig, ConversationMessage, ClaudeSessionInfo, PermissionMode, PermissionRequest } from "./types";

// ── Client → Server Messages ──

export type ClientMessage =
  | {
      type: "session.create";
      machineId: string;
      workDir: string;
      resumeSessionId?: string; // Claude session ID to resume
      permissionMode?: PermissionMode;
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
    };

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
      type: "error";
      error: string;
    };
