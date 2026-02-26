import { z } from "zod";

// ── Machine Types ──

export type MachineType = "local" | "ssh";

export interface MachineConfig {
  id: string;
  name: string;
  type: MachineType;
  host?: string; // SSH host (from ssh config or explicit)
  port?: number; // SSH port
  username?: string;
  identityFile?: string; // SSH private key path (from ssh config IdentityFile)
  defaultWorkDir?: string;
}

// ── Permission Mode ──

export type PermissionMode = "default" | "plan" | "accept-edits" | "bypass-permissions";

export interface PermissionModeConfig {
  label: string;
  description: string;
  cliArgs: string[];
  dangerLevel: "safe" | "moderate" | "dangerous";
}

export const PERMISSION_MODES: Record<PermissionMode, PermissionModeConfig> = {
  default: {
    label: "Default",
    description: "Asks permission for every tool use",
    cliArgs: [],
    dangerLevel: "safe",
  },
  plan: {
    label: "Plan",
    description: "Read-only analysis tools only",
    cliArgs: [],
    dangerLevel: "safe",
  },
  "accept-edits": {
    label: "Accept Edits",
    description: "Auto-approve file edits & common commands",
    cliArgs: ["--allowedTools", "Edit,Write,Bash(npm run*:npx *:node *)"],
    dangerLevel: "moderate",
  },
  "bypass-permissions": {
    label: "No Restrictions",
    description: "Skip all permission checks",
    cliArgs: ["--dangerously-skip-permissions"],
    dangerLevel: "dangerous",
  },
};

// ── Worktree Info ──

export interface WorktreeInfo {
  name: string;           // e.g. "amazing-khayyam"
  worktreePath: string;   // e.g. "/Users/x/repo/.claude/worktrees/amazing-khayyam"
  branch: string;         // e.g. "claude/amazing-khayyam"
  baseDir: string;        // Original git repo root
}

// ── Session Types ──

export type SessionStatus = "starting" | "idle" | "busy" | "error" | "terminated";

export interface Session {
  id: string;
  machineId: string;
  machineName: string;
  workDir: string;
  status: SessionStatus;
  claudeSessionId: string;
  createdAt: number;
  totalCostUsd: number;
  lastActivity: number;
  permissionMode: PermissionMode;
  error?: string;
  worktree?: WorktreeInfo;
}

// ── Claude Stream JSON Types ──

export const ClaudeStreamMessageSchema = z.discriminatedUnion("type", [
  // System message (first message in session)
  z.object({
    type: z.literal("system"),
    subtype: z.literal("init"),
    session_id: z.string(),
    tools: z.array(z.any()).optional(),
    model: z.string().optional(),
    mcp_servers: z.array(z.any()).optional(),
  }),
  // Assistant message
  z.object({
    type: z.literal("assistant"),
    message: z.object({
      id: z.string(),
      type: z.literal("message"),
      role: z.literal("assistant"),
      content: z.array(z.any()),
      model: z.string().optional(),
      stop_reason: z.string().nullable().optional(),
      stop_sequence: z.string().nullable().optional(),
    }),
    session_id: z.string(),
  }),
  // Content block delta (streaming)
  z.object({
    type: z.literal("content_block_delta"),
    index: z.number(),
    delta: z.object({
      type: z.string(),
      text: z.string().optional(),
      partial_json: z.string().optional(),
    }),
  }),
  // Content block start
  z.object({
    type: z.literal("content_block_start"),
    index: z.number(),
    content_block: z.object({
      type: z.string(),
      text: z.string().optional(),
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.any().optional(),
    }),
  }),
  // Content block stop
  z.object({
    type: z.literal("content_block_stop"),
    index: z.number(),
  }),
  // Message start
  z.object({
    type: z.literal("message_start"),
    message: z.object({
      id: z.string(),
      type: z.literal("message"),
      role: z.literal("assistant"),
      content: z.array(z.any()),
      model: z.string().optional(),
      stop_reason: z.string().nullable().optional(),
      stop_sequence: z.string().nullable().optional(),
      usage: z.any().optional(),
    }),
  }),
  // Message delta
  z.object({
    type: z.literal("message_delta"),
    delta: z.object({
      stop_reason: z.string().nullable().optional(),
      stop_sequence: z.string().nullable().optional(),
    }).optional(),
    usage: z.any().optional(),
  }),
  // Message stop
  z.object({
    type: z.literal("message_stop"),
  }),
  // User message (tool results, including permission denials)
  z.object({
    type: z.literal("user"),
    message: z.object({
      role: z.literal("user"),
      content: z.any(),
    }),
    session_id: z.string().optional(),
  }),
  // Result (completion of a prompt)
  z.object({
    type: z.literal("result"),
    subtype: z.literal("success").or(z.literal("error")).optional(),
    result: z.string().optional(),
    is_error: z.boolean().optional(),
    total_cost_usd: z.number().optional(),
    duration_ms: z.number().optional(),
    duration_api_ms: z.number().optional(),
    session_id: z.string().optional(),
    num_turns: z.number().optional(),
  }),
]);

export type ClaudeStreamMessage = z.infer<typeof ClaudeStreamMessageSchema>;

// ── Existing Claude Session (for resume) ──

export interface ClaudeSessionInfo {
  sessionId: string;
  project: string;
  lastActivity: number;
  messageCount: number;
  summary?: string; // First user message as summary
  worktreeName?: string; // Detected from ".claude/worktrees/<name>" in project path
}

// ── Permission Request (for interactive approval) ──

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
}

// ── Conversation Message (for UI display) ──

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  costUsd?: number;
  durationMs?: number;
  isStreaming?: boolean;
}
