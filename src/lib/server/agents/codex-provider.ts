import type { AgentProvider, NormalizedEvent } from "./agent-provider";
import type { AgentType, PermissionMode } from "../../shared/types";

export class CodexProvider implements AgentProvider {
  readonly agentType: AgentType = "codex";
  readonly isProcessPerPrompt = true;
  readonly supportsMcpPermissions = false;

  buildSpawnCommand(_opts: {
    sessionId: string;
    claudeSessionId: string;
    resumeSessionId?: string;
    workDir: string;
    mcpConfigPath?: string;
    isOrchestrator?: boolean;
    systemPrompt?: string;
  }): { command: string; args: string[] } {
    // Codex doesn't have a persistent idle process.
    // Return a no-op — session goes straight to idle.
    return { command: "", args: [] };
  }

  buildRespawnCommand(_opts: {
    claudeSessionId: string;
    mcpConfigPath?: string;
  }): { command: string; args: string[] } {
    // Not applicable for process-per-prompt agents
    return { command: "", args: [] };
  }

  buildPromptCommand(opts: {
    prompt: string;
    workDir: string;
    permissionMode: PermissionMode;
  }): { command: string; args: string[] } {
    const args = ["exec", "--json", "--cd", opts.workDir];
    args.push(...this.getPermissionFlags(opts.permissionMode));
    args.push(opts.prompt);
    return { command: "codex", args };
  }

  formatPrompt(_prompt: string): string | null {
    // Process-per-prompt: no stdin writing
    return null;
  }

  parseMessage(raw: unknown): NormalizedEvent[] {
    if (!raw || typeof raw !== "object") {
      return [{ kind: "ignored" }];
    }

    const msg = raw as Record<string, unknown>;
    const type = msg.type as string | undefined;

    switch (type) {
      case "thread.started":
        return [{ kind: "init", sessionId: (msg.thread_id as string) || "" }];

      case "turn.started":
        return [{ kind: "message_start" }];

      case "item.started": {
        const item = msg.item as Record<string, unknown> | undefined;
        if (item?.type === "command_execution") {
          const command = (item.command as string) || "";
          return [{ kind: "text_delta", text: `Running: \`${command}\`...\n` }];
        }
        return [{ kind: "ignored" }];
      }

      case "item.completed": {
        const item = msg.item as Record<string, unknown> | undefined;
        if (!item) return [{ kind: "ignored" }];

        switch (item.type) {
          case "agent_message": {
            const content = item.content as Array<{ type: string; text?: string }> | undefined;
            if (content) {
              const text = content
                .filter(b => b.type === "output_text" || b.type === "text")
                .map(b => b.text || "")
                .join("");
              if (text) return [{ kind: "text_delta", text }];
            }
            return [{ kind: "ignored" }];
          }

          case "command_execution": {
            const command = (item.command as string) || "";
            const output = (item.output as string) || "";
            const exitCode = item.exit_code as number | undefined;
            return [{
              kind: "tool_use",
              name: "Bash",
              input: { command, output, exit_code: exitCode, description: `Command execution` },
            }];
          }

          case "file_change": {
            const changes = item.changes as unknown;
            return [{
              kind: "tool_use",
              name: "FileChange",
              input: { changes: changes || {} },
            }];
          }

          case "mcp_tool_call": {
            const name = (item.name as string) || "MCP Tool";
            const input = (item.arguments as Record<string, unknown>) || {};
            return [{ kind: "tool_use", name, input }];
          }

          default:
            return [{ kind: "ignored" }];
        }
      }

      case "turn.completed": {
        const usage = msg.usage as Record<string, unknown> | undefined;
        return [{
          kind: "result",
          inputTokens: (usage?.input_tokens as number) || undefined,
          outputTokens: (usage?.output_tokens as number) || undefined,
        }];
      }

      default:
        return [{ kind: "ignored" }];
    }
  }

  getPermissionFlags(mode: PermissionMode): string[] {
    switch (mode) {
      case "default":
        return ["-a", "on-request"];
      case "plan":
        return ["-s", "read-only"];
      case "accept-edits":
        return ["-s", "workspace-write"];
      case "bypass-permissions":
        return ["--full-auto"];
    }
  }
}
