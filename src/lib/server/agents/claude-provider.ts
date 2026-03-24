import type { AgentProvider, NormalizedEvent } from "./agent-provider";
import type { AgentType, PermissionMode, ClaudeStreamMessage } from "../../shared/types";
import { ClaudeStreamMessageSchema } from "../../shared/types";

export class ClaudeProvider implements AgentProvider {
  readonly agentType: AgentType = "claude";
  readonly isProcessPerPrompt = false;
  readonly supportsMcpPermissions = true;

  buildSpawnCommand(opts: {
    sessionId: string;
    claudeSessionId: string;
    resumeSessionId?: string;
    workDir: string;
    mcpConfigPath?: string;
    isOrchestrator?: boolean;
    systemPrompt?: string;
  }): { command: string; args: string[] } {
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
    ];

    if (opts.mcpConfigPath) {
      args.push(
        "--permission-prompt-tool", "mcp__perm__check_permission",
        "--mcp-config", opts.mcpConfigPath,
      );
    }

    if (opts.isOrchestrator && opts.systemPrompt) {
      args.push("--allowedTools", "Read,Glob,Grep,mcp__orch__*,mcp__perm__*");
      args.push("--append-system-prompt", opts.systemPrompt);
    }

    if (opts.resumeSessionId) {
      args.push("--resume", opts.resumeSessionId);
    } else {
      args.push("--session-id", opts.claudeSessionId);
    }

    return { command: "claude", args };
  }

  buildRespawnCommand(opts: {
    claudeSessionId: string;
    mcpConfigPath?: string;
  }): { command: string; args: string[] } {
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
    ];

    if (opts.mcpConfigPath) {
      args.push(
        "--permission-prompt-tool", "mcp__perm__check_permission",
        "--mcp-config", opts.mcpConfigPath,
      );
    }

    args.push("--resume", opts.claudeSessionId);
    return { command: "claude", args };
  }

  formatPrompt(prompt: string): string | null {
    return JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
  }

  parseMessage(raw: unknown): NormalizedEvent[] {
    const parsed = ClaudeStreamMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return [{ kind: "ignored" }];
    }

    const msg: ClaudeStreamMessage = parsed.data;

    switch (msg.type) {
      case "system":
        return [{ kind: "init", sessionId: msg.session_id, model: msg.model }];

      case "message_start":
        return [{ kind: "message_start" }];

      case "content_block_delta":
        if (msg.delta.type === "text_delta" && msg.delta.text) {
          return [{ kind: "text_delta", text: msg.delta.text }];
        }
        return [{ kind: "ignored" }];

      case "assistant": {
        const events: NormalizedEvent[] = [];
        if (msg.message.content) {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              // Text blocks — only rendered if not already streamed
              events.push({ kind: "text_delta", text: block.text });
            } else if (block.type === "tool_use") {
              events.push({
                kind: "tool_use",
                name: block.name,
                input: block.input ? (typeof block.input === "object" ? block.input : {}) : {},
              });
            }
          }
        }
        return events.length > 0 ? events : [{ kind: "ignored" }];
      }

      case "user": {
        // Detect permission denials from tool_result blocks
        const events: NormalizedEvent[] = [];
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result" && block.is_error) {
              const errorText = typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")
                  : "Permission denied";
              events.push({ kind: "tool_result", content: errorText, isError: true });
            }
          }
        }
        return events.length > 0 ? events : [{ kind: "ignored" }];
      }

      case "result":
        return [{
          kind: "result",
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
        }];

      default:
        return [{ kind: "ignored" }];
    }
  }

  getPermissionFlags(_mode: PermissionMode): string[] {
    // Claude handles permissions via MCP, not CLI flags
    return [];
  }
}
