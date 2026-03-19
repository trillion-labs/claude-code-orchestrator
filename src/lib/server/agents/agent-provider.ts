import type { AgentType, PermissionMode } from "../../shared/types";

// ── Normalized Events ──
// Union type covering both Claude and Codex output, used by SessionManager

export type NormalizedEvent =
  | { kind: "init"; sessionId: string; model?: string }
  | { kind: "text_delta"; text: string }
  | { kind: "message_start" }
  | { kind: "tool_use"; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; content: string; isError: boolean }
  | { kind: "result"; costUsd?: number; durationMs?: number; inputTokens?: number; outputTokens?: number }
  | { kind: "ignored" };

// ── Agent Provider Interface ──

export interface AgentProvider {
  readonly agentType: AgentType;

  /** Whether each user prompt spawns a new process (Codex) vs writing to stdin (Claude) */
  readonly isProcessPerPrompt: boolean;

  /** Whether this agent supports MCP permission-prompt-tool */
  readonly supportsMcpPermissions: boolean;

  /** Build CLI command + args for initial spawn */
  buildSpawnCommand(opts: {
    sessionId: string;
    claudeSessionId: string;
    resumeSessionId?: string;
    workDir: string;
    mcpConfigPath?: string;
    isOrchestrator?: boolean;
    systemPrompt?: string;
  }): { command: string; args: string[] };

  /** Build CLI command + args for respawn (resume after interrupt) */
  buildRespawnCommand(opts: {
    claudeSessionId: string;
    mcpConfigPath?: string;
  }): { command: string; args: string[] };

  /** Build command + args for process-per-prompt agents. Only required when isProcessPerPrompt is true. */
  buildPromptCommand?(opts: {
    prompt: string;
    workDir: string;
    permissionMode: PermissionMode;
  }): { command: string; args: string[] };

  /** Format a user prompt for stdin writing (long-lived agents). Returns null for process-per-prompt agents. */
  formatPrompt(prompt: string): string | null;

  /** Parse a raw JSONL message into normalized events */
  parseMessage(raw: unknown): NormalizedEvent[];

  /** Map orchestrator PermissionMode to CLI flags */
  getPermissionFlags(mode: PermissionMode): string[];
}
