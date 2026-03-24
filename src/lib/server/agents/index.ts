import type { AgentType } from "../../shared/types";
import type { AgentProvider } from "./agent-provider";
import { ClaudeProvider } from "./claude-provider";
import { CodexProvider } from "./codex-provider";

export function createAgentProvider(agentType: AgentType): AgentProvider {
  switch (agentType) {
    case "claude":
      return new ClaudeProvider();
    case "codex":
      return new CodexProvider();
  }
}

export type { AgentProvider, NormalizedEvent } from "./agent-provider";
