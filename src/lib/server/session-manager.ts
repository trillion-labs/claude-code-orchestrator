import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { readdir, readFile, stat, writeFile, unlink } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { ProcessAdapter } from "./adapters/process-adapter";
import { LocalAdapter } from "./adapters/local-adapter";
import { SSHAdapter } from "./adapters/ssh-adapter";
import { SSHConnectionManager } from "./ssh-manager";
import { StreamParser } from "./stream-parser";
import type { Session, MachineConfig, ClaudeStreamMessage, ConversationMessage, ClaudeSessionInfo, PermissionMode, PermissionRequest } from "../shared/types";
import { PERMISSION_MODES } from "../shared/types";

interface PermissionResolver {
  resolve: (result: { behavior: string; updatedInput?: Record<string, unknown>; message?: string }) => void;
  request: PermissionRequest;
}

interface ManagedSession {
  session: Session;
  adapter: ProcessAdapter;
  parser: StreamParser;
  machine: MachineConfig;
  permissionMode: PermissionMode;
  mcpConfigPath?: string; // Temp MCP config file path
  claudeConfigDir?: string; // Custom CLAUDE_CONFIG_DIR (e.g. from direnv)
  originalCwd?: string; // Original working directory the session was created in
  promptQueue: string[];
  isProcessingPrompt: boolean;
  currentAssistantMessage: string;
  messages: ConversationMessage[];
  // Whether text was streamed via content_block_delta for the current message
  hasStreamedText: boolean;
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, ManagedSession>();
  private sshManager: SSHConnectionManager;
  private pendingPermissions = new Map<string, PermissionResolver>();
  private orchestratorPort: number;

  constructor(orchestratorPort = 3000) {
    super();
    this.sshManager = new SSHConnectionManager();
    this.orchestratorPort = orchestratorPort;
  }

  async createSession(machine: MachineConfig, workDir: string, resumeSessionId?: string, permissionMode: PermissionMode = "default"): Promise<Session> {
    const sessionId = uuidv4();
    const claudeSessionId = resumeSessionId || uuidv4();

    const session: Session = {
      id: sessionId,
      machineId: machine.id,
      machineName: machine.name,
      workDir,
      status: "starting",
      claudeSessionId,
      createdAt: Date.now(),
      totalCostUsd: 0,
      lastActivity: Date.now(),
      permissionMode,
    };

    // Create the appropriate adapter
    const adapter = machine.type === "local"
      ? new LocalAdapter()
      : new SSHAdapter(this.sshManager, machine);

    const parser = new StreamParser();

    const managed: ManagedSession = {
      session,
      adapter,
      parser,
      machine,
      permissionMode,
      promptQueue: [],
      isProcessingPrompt: false,
      currentAssistantMessage: "",
      messages: [],
      hasStreamedText: false,
    };

    this.sessions.set(sessionId, managed);

    // Wire up parser events
    parser.on("message", (msg: ClaudeStreamMessage) => {
      this.handleClaudeMessage(sessionId, msg);
    });

    parser.on("stderr", (line: string) => {
      console.warn(`[Session ${sessionId}] stderr:`, line);
    });

    // Wire up adapter events
    adapter.on("data", (chunk: string) => {
      parser.feed(chunk);
    });

    let stderrBuffer = "";
    adapter.on("stderr", (chunk: string) => {
      console.warn(`[Session ${sessionId}] process stderr:`, chunk);
      // Keep last 500 chars of stderr for error reporting
      stderrBuffer += chunk;
      if (stderrBuffer.length > 500) {
        stderrBuffer = stderrBuffer.slice(-500);
      }
    });

    adapter.on("error", (err: Error) => {
      console.error(`[Session ${sessionId}] process error:`, err);
      session.status = "error";
      session.error = err.message;
      this.emit("session:status", sessionId, session.status, session.error);
    });

    adapter.on("close", (code: number | null) => {
      console.log(`[Session ${sessionId}] process exited with code ${code}`);
      if (session.status !== "terminated") {
        session.status = "error";
        const stderrMsg = stderrBuffer.trim();
        session.error = stderrMsg
          ? `Process exited with code ${code}: ${stderrMsg}`
          : `Process exited with code ${code}`;
        this.emit("session:status", sessionId, session.status, session.error);
      }
    });

    // Spawn the Claude process
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
    ];

    // Inject permission mode CLI args
    const modeConfig = PERMISSION_MODES[permissionMode];
    if (modeConfig.cliArgs.length > 0) {
      args.push(...modeConfig.cliArgs);
    }

    // Set up MCP permission prompt tool for non-bypass modes
    if (permissionMode !== "bypass-permissions") {
      try {
        if (machine.type === "local") {
          const mcpConfigPath = await this.writeMcpConfig(sessionId);
          managed.mcpConfigPath = mcpConfigPath;
          args.push(
            "--permission-prompt-tool", "mcp__perm__check_permission",
            "--mcp-config", mcpConfigPath,
          );
        } else {
          // Remote: set up reverse port forward + remote MCP server (with timeout)
          const remoteConfig = await Promise.race([
            this.setupRemoteMcpPermission(sessionId, machine),
            new Promise<null>((resolve) => setTimeout(() => {
              console.warn(`[Session ${sessionId}] Remote MCP setup timed out after 10s`);
              resolve(null);
            }, 10000)),
          ]);
          if (remoteConfig) {
            managed.mcpConfigPath = remoteConfig; // Remote path for cleanup
            args.push(
              "--permission-prompt-tool", "mcp__perm__check_permission",
              "--mcp-config", remoteConfig,
            );
          }
        }
      } catch (err) {
        console.warn(`[Session ${sessionId}] Could not set up MCP permission tool:`, (err as Error).message);
      }
    }

    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    } else {
      args.push("--session-id", claudeSessionId);
    }

    try {
      // Load chat history from .jsonl if resuming
      if (resumeSessionId) {
        if (machine.type === "local") {
          await this.loadSessionHistory(managed, resumeSessionId);
        } else {
          await this.loadRemoteSessionHistory(managed, machine, resumeSessionId);
        }
      }

      // Pass custom CLAUDE_CONFIG_DIR if detected (e.g. direnv-managed sessions)
      const spawnEnv: Record<string, string> = {};
      if (managed.claudeConfigDir) {
        spawnEnv.CLAUDE_CONFIG_DIR = managed.claudeConfigDir;
      }
      // Use original cwd for resume (claude --resume looks up session by cwd-based project dir)
      const spawnCwd = (resumeSessionId && managed.originalCwd) || workDir;
      console.log(`[Session ${sessionId}] Spawning claude with cwd=${spawnCwd}, args=${args.join(" ")}`);
      await adapter.spawn("claude", args, { cwd: spawnCwd, env: spawnEnv });
      session.status = "idle";
      this.emit("session:status", sessionId, session.status);
    } catch (err) {
      session.status = "error";
      session.error = (err as Error).message;
      this.emit("session:status", sessionId, session.status, session.error);
    }

    return session;
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`Session ${sessionId} not found`);

    // Add user message to history
    const userMsg: ConversationMessage = {
      id: uuidv4(),
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };
    managed.messages.push(userMsg);
    this.emit("session:message", sessionId, userMsg);

    if (managed.isProcessingPrompt) {
      // Queue the prompt
      managed.promptQueue.push(prompt);
      return;
    }

    this.processPrompt(managed, prompt);
  }

  private processPrompt(managed: ManagedSession, prompt: string) {
    managed.isProcessingPrompt = true;
    managed.currentAssistantMessage = "";
    managed.hasStreamedText = false;
    managed.session.status = "busy";
    managed.session.lastActivity = Date.now();
    this.emit("session:status", managed.session.id, "busy");

    // Send the prompt as stream-json
    const message = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: prompt,
      },
    }) + "\n";

    managed.adapter.write(message);
  }

  private handleClaudeMessage(sessionId: string, msg: ClaudeStreamMessage) {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    managed.session.lastActivity = Date.now();

    switch (msg.type) {
      case "system":
        managed.session.claudeSessionId = msg.session_id;
        break;

      case "message_start":
        // New assistant message — reset per-message flag and add separator
        managed.hasStreamedText = false;
        if (managed.currentAssistantMessage) {
          managed.currentAssistantMessage += "\n\n---\n\n";
          this.emit("session:stream", sessionId, "\n\n---\n\n");
        }
        break;

      case "content_block_delta":
        if (msg.delta.type === "text_delta" && msg.delta.text) {
          managed.currentAssistantMessage += msg.delta.text;
          this.emit("session:stream", sessionId, msg.delta.text);
          managed.hasStreamedText = true;
        }
        // input_json_delta is ignored here — tool_use content is
        // rendered from the complete `assistant` message instead
        break;

      case "content_block_start":
      case "content_block_stop":
      case "message_delta":
      case "message_stop":
        break;

      case "assistant":
        // Process tool_use blocks (these are never streamed via deltas).
        // Text blocks: only render if not already streamed via content_block_delta.
        if (msg.message.content) {
          let newContent = "";
          for (const block of msg.message.content) {
            if (block.type === "text") {
              if (!managed.hasStreamedText) {
                newContent += block.text;
              }
            } else if (block.type === "tool_use") {
              if (newContent) newContent += "\n\n";
              const inputStr = block.input ? JSON.stringify(block.input) : "";
              newContent += this.renderToolUse(block.name, inputStr);
            }
          }

          if (newContent) {
            if (managed.currentAssistantMessage && !managed.currentAssistantMessage.endsWith("\n\n") && !managed.currentAssistantMessage.endsWith("---\n\n")) {
              managed.currentAssistantMessage += "\n\n";
              this.emit("session:stream", sessionId, "\n\n");
            }
            managed.currentAssistantMessage += newContent;
            this.emit("session:stream", sessionId, newContent);
          }
        }
        break;

      case "user": {
        // Detect permission denials from tool_result blocks with is_error
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result" && block.is_error) {
              const errorText = typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")
                  : "Permission denied";

              // Check if it looks like a permission denial
              if (errorText.toLowerCase().includes("permission") || errorText.toLowerCase().includes("not allowed") || errorText.toLowerCase().includes("denied")) {
                const toolName = block.tool_use_id || "Unknown tool";
                const denialBlock = `\n\`\`\`tool-permission-denied\n${JSON.stringify({ tool: toolName, error: errorText })}\n\`\`\`\n`;

                if (managed.currentAssistantMessage && !managed.currentAssistantMessage.endsWith("\n\n")) {
                  managed.currentAssistantMessage += "\n\n";
                  this.emit("session:stream", sessionId, "\n\n");
                }
                managed.currentAssistantMessage += denialBlock;
                this.emit("session:stream", sessionId, denialBlock);
              }
            }
          }
        }
        break;
      }

      case "result": {
        const costUsd = msg.total_cost_usd || 0;
        managed.session.totalCostUsd += costUsd;

        const resultText = managed.currentAssistantMessage || msg.result || "";

        if (resultText) {
          const assistantMsg: ConversationMessage = {
            id: uuidv4(),
            role: "assistant",
            content: resultText,
            timestamp: Date.now(),
            costUsd,
            durationMs: msg.duration_ms,
          };
          managed.messages.push(assistantMsg);
          this.emit("session:message", sessionId, assistantMsg);
        }

        managed.currentAssistantMessage = "";
        managed.hasStreamedText = false;
        managed.isProcessingPrompt = false;
        managed.session.status = "idle";
        this.emit("session:status", sessionId, "idle", undefined, managed.session.totalCostUsd);

        if (managed.promptQueue.length > 0) {
          const nextPrompt = managed.promptQueue.shift()!;
          this.processPrompt(managed, nextPrompt);
        }
        break;
      }
    }
  }

  private renderToolUse(toolName: string, inputJsonStr: string): string {
    let input: Record<string, unknown> = {};
    try {
      input = typeof inputJsonStr === "string" && inputJsonStr
        ? JSON.parse(inputJsonStr)
        : (inputJsonStr as unknown as Record<string, unknown>);
    } catch {
      return `\n\`\`\`tool-generic\n${JSON.stringify({ name: toolName })}\n\`\`\`\n`;
    }

    // Tool calls that get dedicated card UIs
    switch (toolName) {
      case "AskUserQuestion":
        return `\n\`\`\`tool-ask-user-question\n${JSON.stringify(input)}\n\`\`\`\n`;
      case "Bash":
        return `\n\`\`\`tool-bash\n${JSON.stringify({ command: input.command, description: input.description })}\n\`\`\`\n`;
      case "Read":
      case "Write":
      case "Edit":
        return `\n\`\`\`tool-file\n${JSON.stringify({ action: toolName, file_path: input.file_path })}\n\`\`\`\n`;
      case "Grep":
        return `\n\`\`\`tool-search\n${JSON.stringify({ action: "Grep", pattern: input.pattern, path: input.path })}\n\`\`\`\n`;
      case "Glob":
        return `\n\`\`\`tool-search\n${JSON.stringify({ action: "Glob", pattern: input.pattern, path: input.path })}\n\`\`\`\n`;
      case "WebSearch":
        return `\n\`\`\`tool-web\n${JSON.stringify({ action: "WebSearch", query: input.query })}\n\`\`\`\n`;
      case "WebFetch":
        return `\n\`\`\`tool-web\n${JSON.stringify({ action: "WebFetch", url: input.url })}\n\`\`\`\n`;
      case "Task":
        return `\n\`\`\`tool-task\n${JSON.stringify({ description: input.description, prompt: (input.prompt as string || "").slice(0, 200) })}\n\`\`\`\n`;
      default:
        return `\n\`\`\`tool-generic\n${JSON.stringify({ name: toolName })}\n\`\`\`\n`;
    }
  }

  // ── MCP Permission Prompt Tool ──

  private async writeMcpConfig(sessionId: string): Promise<string> {
    const mcpServerPath = join(process.cwd(), "scripts", "permission-mcp-server.mjs");
    const configPath = join(tmpdir(), `claude-orch-${sessionId}.mcp.json`);
    const config = {
      mcpServers: {
        perm: {
          command: "node",
          args: [mcpServerPath],
          env: {
            ORCHESTRATOR_URL: `http://localhost:${this.orchestratorPort}`,
            SESSION_ID: sessionId,
          },
        },
      },
    };
    await writeFile(configPath, JSON.stringify(config), "utf-8");
    return configPath;
  }

  private async cleanupMcpConfig(managed: ManagedSession): Promise<void> {
    if (!managed.mcpConfigPath) return;
    if (managed.machine.type === "local") {
      try { await unlink(managed.mcpConfigPath); } catch { /* ignore */ }
    } else {
      // Remote: clean up remote temp files
      try {
        const scriptPath = managed.mcpConfigPath.replace(".mcp.json", ".mcp.py");
        await this.sshManager.exec(managed.machine, `rm -f "${managed.mcpConfigPath}" "${scriptPath}"`);
      } catch { /* ignore */ }
    }
  }

  /**
   * Set up reverse port forward + Python MCP server on remote machine.
   * Returns the remote MCP config path, or null if setup fails.
   */
  private async setupRemoteMcpPermission(sessionId: string, machine: MachineConfig): Promise<string | null> {
    const scriptPath = `/tmp/claude-orch-${sessionId}.mcp.py`;
    const configPath = `/tmp/claude-orch-${sessionId}.mcp.json`;

    // 1. Write Python MCP server script BEFORE forwardIn (exec hangs after forwardIn on same connection)
    const pythonScript = `#!/usr/bin/env python3
import sys, json, urllib.request, os

SESSION_ID = os.environ.get("SESSION_ID", "")
ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "http://127.0.0.1:0")

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\\n")
    sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except:
        continue

    mid = msg.get("id")
    method = msg.get("method", "")

    if method == "initialize":
        send({"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "perm", "version": "1.0.0"}
        }})
    elif method == "notifications/initialized":
        pass
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [{
            "name": "check_permission",
            "description": "Check if a tool use is allowed",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tool_name": {"type": "string"},
                    "input": {"type": "object"}
                },
                "required": ["tool_name", "input"]
            }
        }]}})
    elif method == "tools/call":
        args = msg.get("params", {}).get("arguments", {})
        tool_name = args.get("tool_name", "unknown")
        tool_input = args.get("input", {})
        try:
            data = json.dumps({
                "sessionId": SESSION_ID,
                "toolName": tool_name,
                "input": tool_input
            }).encode()
            req = urllib.request.Request(
                ORCHESTRATOR_URL + "/api/permission",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            resp = urllib.request.urlopen(req, timeout=300)
            result = json.loads(resp.read())
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": json.dumps(result)}]
            }})
        except Exception as e:
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": json.dumps({
                    "behavior": "deny", "message": str(e)
                })}]
            }})
`;

    // Step 1: Set up reverse port forward
    const remotePort = await this.sshManager.setupReversePortForward(machine, this.orchestratorPort);

    // Step 2: Write both files via SFTP (exec hangs after forwardIn on same connection)
    const mcpConfig = JSON.stringify({
      mcpServers: {
        perm: {
          command: "python3",
          args: [scriptPath],
          env: {
            ORCHESTRATOR_URL: `http://127.0.0.1:${remotePort}`,
            SESSION_ID: sessionId,
          },
        },
      },
    });

    console.log(`[Remote MCP] Writing files to ${machine.name} via SFTP...`);
    await this.sshManager.writeRemoteFile(machine, scriptPath, pythonScript, { mode: 0o755 });
    await this.sshManager.writeRemoteFile(machine, configPath, mcpConfig);

    console.log(`[Session ${sessionId}] Remote MCP permission: port ${remotePort}, script ${scriptPath}`);
    return configPath;
  }

  /**
   * Called by the HTTP endpoint when the MCP server sends a permission request.
   * Returns a Promise that resolves when the user responds in the UI.
   */
  async handlePermissionRequest(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string }> {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return { behavior: "deny", message: "Session not found" };
    }

    const requestId = uuidv4();
    const request: PermissionRequest = { requestId, sessionId, toolName, input };

    // Inject a permission-request card into the stream
    const block = `\n\`\`\`tool-permission-request\n${JSON.stringify({ requestId, toolName, input })}\n\`\`\`\n`;
    if (managed.currentAssistantMessage && !managed.currentAssistantMessage.endsWith("\n\n")) {
      managed.currentAssistantMessage += "\n\n";
      this.emit("session:stream", sessionId, "\n\n");
    }
    managed.currentAssistantMessage += block;
    this.emit("session:stream", sessionId, block);

    // Emit event for WebSocket broadcast
    this.emit("session:permissionRequest", sessionId, request);

    // Wait for user response (or timeout)
    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, { resolve, request });
    });
  }

  /**
   * Called when the user responds to a permission request via WebSocket.
   */
  resolvePermission(requestId: string, allow: boolean): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;

    this.pendingPermissions.delete(requestId);

    // Update the permission-request block in currentAssistantMessage with "resolved" field
    // so the finalized ConversationMessage contains the decision
    const managed = this.sessions.get(pending.request.sessionId);
    if (managed) {
      const decision = allow ? "allow" : "deny";
      // Find and replace the JSON inside the tool-permission-request block
      const blockRegex = new RegExp(
        `(\`\`\`tool-permission-request\\n)(\\{[^]*?"requestId"\\s*:\\s*"${requestId}"[^]*?\\})(\\n\`\`\`)`,
      );
      const match = managed.currentAssistantMessage.match(blockRegex);
      if (match) {
        try {
          const blockData = JSON.parse(match[2]);
          blockData.resolved = decision;
          managed.currentAssistantMessage = managed.currentAssistantMessage.replace(
            match[0],
            `${match[1]}${JSON.stringify(blockData)}${match[3]}`,
          );
        } catch { /* keep original if parse fails */ }
      }
    }

    if (allow) {
      pending.resolve({ behavior: "allow", updatedInput: pending.request.input });
    } else {
      pending.resolve({ behavior: "deny", message: "Denied by user in web UI" });
    }
  }

  terminateSession(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    managed.session.status = "terminated";
    managed.adapter.kill();
    managed.parser.flush();
    this.cleanupMcpConfig(managed);

    // Reject any pending permission requests
    for (const [reqId, pending] of this.pendingPermissions) {
      if (pending.request.sessionId === sessionId) {
        pending.resolve({ behavior: "deny", message: "Session terminated" });
        this.pendingPermissions.delete(reqId);
      }
    }

    this.emit("session:status", sessionId, "terminated");
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  getSessionMessages(sessionId: string): ConversationMessage[] {
    return this.sessions.get(sessionId)?.messages || [];
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).map((m) => m.session);
  }

  private async loadSessionHistory(managed: ManagedSession, claudeSessionId: string): Promise<void> {
    const claudeDir = join(homedir(), ".claude", "projects");

    try {
      const projects = await readdir(claudeDir);

      for (const project of projects) {
        const filePath = join(claudeDir, project, `${claudeSessionId}.jsonl`);
        try {
          const content = await readFile(filePath, "utf-8");
          this.parseSessionJsonl(managed, content);
          console.log(`[Session ${managed.session.id}] Loaded ${managed.messages.length} history messages from ${project}/${claudeSessionId}.jsonl`);
          return; // Found the file, done
        } catch {
          // File not in this project dir, try next
        }
      }
    } catch (err) {
      console.warn("Could not load session history:", (err as Error).message);
    }
  }

  private async loadRemoteSessionHistory(managed: ManagedSession, machine: MachineConfig, claudeSessionId: string): Promise<void> {
    try {
      // Search for the session file in ~/.claude/projects AND workDir ancestors' .claude/projects
      // This handles direnv setups where CLAUDE_CONFIG_DIR points to a custom location
      const workDir = managed.session.workDir || "~";
      const findScript = `
p="${workDir}"
# Search default location first
find ~/.claude/projects -maxdepth 2 -name "${claudeSessionId}.jsonl" -not -path "*/subagents/*" 2>/dev/null | head -1
# Walk up from workDir looking for .claude/projects
p=$(cd "$p" 2>/dev/null && pwd || echo "")
while [ -n "$p" ] && [ "$p" != "/" ]; do
  if [ -d "$p/.claude/projects" ]; then
    find "$p/.claude/projects" -maxdepth 2 -name "${claudeSessionId}.jsonl" -not -path "*/subagents/*" 2>/dev/null | head -1
  fi
  p=$(dirname "$p")
done
`.trim();

      const findChannel = await this.sshManager.exec(machine, findScript);
      const findOutput = await new Promise<string>((resolve) => {
        let out = "";
        findChannel.on("data", (data: Buffer) => { out += data.toString(); });
        findChannel.on("close", () => resolve(out.trim()));
        findChannel.on("error", () => resolve(""));
      });

      // Take the first non-empty result
      const filePath = findOutput.split("\n").map(l => l.trim()).find(l => l.length > 0);

      if (!filePath) {
        console.warn(`[Session ${managed.session.id}] Remote session file not found for ${claudeSessionId}`);
        return;
      }

      // Detect custom CLAUDE_CONFIG_DIR from the file path
      // e.g. /fsx/suyeong/.claude/projects/xxx/session.jsonl → /fsx/suyeong/.claude
      const homeClaudePrefix = "/.claude/projects/";
      const claudeIdx = filePath.indexOf(homeClaudePrefix);
      if (claudeIdx >= 0) {
        const configDir = filePath.slice(0, claudeIdx) + "/.claude";
        const homeDir = await this.getRemoteHomeDir(machine);
        if (configDir !== `${homeDir}/.claude`) {
          managed.claudeConfigDir = configDir;
          console.log(`[Session ${managed.session.id}] Detected custom CLAUDE_CONFIG_DIR: ${configDir}`);
        }
      }

      // originalCwd will be set from the JSONL's cwd field in parseSessionJsonl
      // (project dir name like -fsx-suyeong-lm-evaluation-harness is lossy — can't distinguish hyphens from path separators)

      // Cat the file content
      const catChannel = await this.sshManager.exec(machine, `cat "${filePath}"`);
      const content = await new Promise<string>((resolve) => {
        let out = "";
        catChannel.on("data", (data: Buffer) => { out += data.toString(); });
        catChannel.on("close", () => resolve(out));
        catChannel.on("error", () => resolve(""));
      });

      if (!content) return;

      // Parse the JSONL content — same logic as loadSessionHistory
      this.parseSessionJsonl(managed, content);
      const project = filePath.split("/").slice(-2, -1)[0] || "unknown";
      console.log(`[Session ${managed.session.id}] Loaded ${managed.messages.length} history messages from remote ${project}/${claudeSessionId}.jsonl`);
    } catch (err) {
      console.warn("Could not load remote session history:", (err as Error).message);
    }
  }

  private async getRemoteHomeDir(machine: MachineConfig): Promise<string> {
    try {
      const ch = await this.sshManager.exec(machine, 'echo "$HOME"');
      return new Promise((resolve) => {
        let out = "";
        ch.on("data", (d: Buffer) => { out += d.toString(); });
        ch.on("close", () => resolve(out.trim() || "/root"));
        ch.on("error", () => resolve("/root"));
      });
    } catch {
      return "/root";
    }
  }

  private parseSessionJsonl(managed: ManagedSession, content: string): void {
    const lines = content.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);

        // Extract original cwd from the first user message (most reliable source)
        if (msg.type === "user" && msg.cwd && !managed.originalCwd) {
          managed.originalCwd = msg.cwd;
        }

        if (msg.type === "user" && msg.message?.content) {
          const c = msg.message.content;
          const text = typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")
              : "";
          if (!text) continue;

          const userMsg: ConversationMessage = {
            id: uuidv4(),
            role: "user",
            content: text,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          };
          managed.messages.push(userMsg);
          this.emit("session:message", managed.session.id, userMsg);
        }

        if (msg.type === "assistant" && msg.message?.content) {
          const c = msg.message.content;
          let text = "";
          if (typeof c === "string") {
            text = c;
          } else if (Array.isArray(c)) {
            const parts: string[] = [];
            for (const block of c) {
              if (block.type === "text") {
                parts.push(block.text);
              } else if (block.type === "tool_use") {
                const inputStr = block.input ? JSON.stringify(block.input) : "";
                parts.push(this.renderToolUse(block.name, inputStr));
              }
            }
            text = parts.join("\n");
          }
          if (!text.trim()) continue;

          const assistantMsg: ConversationMessage = {
            id: uuidv4(),
            role: "assistant",
            content: text,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          };
          managed.messages.push(assistantMsg);
          this.emit("session:message", managed.session.id, assistantMsg);
        }
      } catch { /* skip invalid lines */ }
    }
  }

  async discoverSessions(machine: MachineConfig, workDir?: string): Promise<ClaudeSessionInfo[]> {
    if (machine.type === "local") {
      return this.discoverLocalSessions(workDir);
    } else {
      return this.discoverRemoteSessions(machine, workDir);
    }
  }

  private async discoverLocalSessions(workDir?: string): Promise<ClaudeSessionInfo[]> {
    const claudeDir = join(homedir(), ".claude", "projects");
    const results: ClaudeSessionInfo[] = [];
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    try {
      const projects = await readdir(claudeDir);

      for (const project of projects) {
        // Filter by workDir if provided (skip filter for "~" which means "show all")
        // project dir name is like "-Users-suyeongan-dev" for path "/Users/suyeongan/dev"
        if (workDir && workDir !== "~") {
          const expandedWork = workDir.replace(/^~/, homedir());
          const expectedDirName = expandedWork.replace(/\//g, "-");
          // Also try matching with leading dash (Claude stores dirs as "-Users-foo-bar")
          if (!project.startsWith(expectedDirName) && project !== expectedDirName && !project.startsWith(`-${expectedDirName.replace(/^\//, "")}`)) continue;
        }

        const projectDir = join(claudeDir, project);
        const projectStat = await stat(projectDir);
        if (!projectStat.isDirectory()) continue;

        // Session .jsonl files live directly inside the project directory
        const files = await readdir(projectDir);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;
          const sessionId = file.replace(".jsonl", "");
          if (!UUID_RE.test(sessionId)) continue;

          const filePath = join(projectDir, file);
          const fileStat = await stat(filePath);

          // Extract summary from first user message
          let summary: string | undefined;
          let messageCount = 0;
          try {
            const content = await readFile(filePath, "utf-8");
            const lines = content.split("\n").filter(Boolean);
            messageCount = lines.length;
            for (const line of lines.slice(0, 20)) {
              try {
                const msg = JSON.parse(line);
                if (msg.type === "user" && msg.message?.content) {
                  const c = msg.message.content;
                  const text = typeof c === "string"
                    ? c
                    : Array.isArray(c) ? (c[0]?.text || "") : "";
                  summary = text.slice(0, 100);
                  break;
                }
              } catch { /* skip invalid lines */ }
            }
          } catch { /* skip unreadable files */ }

          // Convert project dir name back to path for display
          // e.g. "-Users-suyeongan-dev" -> "/Users/suyeongan/dev"
          const projectPath = project.replace(/-/g, "/").replace(/^\//, "");

          results.push({
            sessionId,
            project: projectPath,
            lastActivity: fileStat.mtimeMs,
            messageCount,
            summary,
          });
        }
      }
    } catch (err) {
      console.warn("Could not discover local sessions:", (err as Error).message);
    }

    // Sort by most recent first
    return results.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  private async discoverRemoteSessions(machine: MachineConfig, workDir?: string): Promise<ClaudeSessionInfo[]> {
    try {
      // Run a script on the remote machine to list sessions
      // Use find with maxdepth to avoid subagent directories, and basename -- to handle dash-prefixed names
      // Use Python for reliable JSON parsing — avoids shell quoting nightmares over SSH
      // Search ~/.claude/projects/ AND .claude/projects/ in workDir ancestors (for direnv setups)
      const searchWorkDir = workDir ? workDir.replace(/^~/, "$HOME") : "";
      const script = `python3 -c '
import os, json, re, sys

uuid_re = re.compile(r"^[0-9a-f]{8}-", re.IGNORECASE)
seen = set()

def scan_base(base):
    if not os.path.isdir(base):
        return
    for proj in sorted(os.listdir(base)):
        pdir = os.path.join(base, proj)
        if not os.path.isdir(pdir):
            continue
        for fn in os.listdir(pdir):
            if not fn.endswith(".jsonl"):
                continue
            sid = fn[:-6]
            if not uuid_re.match(sid):
                continue
            if sid in seen:
                continue
            seen.add(sid)
            fp = os.path.join(pdir, fn)
            try:
                st = os.stat(fp)
                mtime = int(st.st_mtime)
                size_kb = st.st_size // 1024
                cwd = ""
                summary = ""
                with open(fp, errors="replace") as f:
                    for i, line in enumerate(f):
                        if i >= 50:
                            break
                        try:
                            obj = json.loads(line)
                            if obj.get("type") == "user" and not cwd:
                                cwd = obj.get("cwd") or ""
                                msg = obj.get("message", {})
                                content = msg.get("content", [])
                                if isinstance(content, list):
                                    for b in content:
                                        if isinstance(b, dict) and b.get("type") == "text":
                                            summary = b["text"][:100]
                                            break
                                elif isinstance(content, str):
                                    summary = content[:100]
                                break
                        except:
                            pass
                print(f"SESSION|{sid}|{proj}|{cwd}|{mtime}|{size_kb}|{summary}")
            except Exception as e:
                print(f"ERROR|{proj}|{fn}|{e}", file=sys.stderr)

# 1) Always scan default ~/.claude/projects
scan_base(os.path.expanduser("~/.claude/projects"))

# 2) Walk up from workDir looking for .claude/projects (direnv / custom config)
work = "${searchWorkDir}"
if work:
    work = os.path.expanduser(work)
    p = os.path.abspath(work)
    checked = set()
    while p and p != "/" and len(checked) < 10:
        if p in checked:
            break
        checked.add(p)
        candidate = os.path.join(p, ".claude", "projects")
        if os.path.isdir(candidate) and candidate != os.path.expanduser("~/.claude/projects"):
            scan_base(candidate)
        p = os.path.dirname(p)
'`;
      const channel = await this.sshManager.exec(machine, script);
      return new Promise((resolve) => {
        let output = "";
        channel.on("data", (data: Buffer) => { output += data.toString(); });
        channel.on("close", () => {
          const sessions: ClaudeSessionInfo[] = [];
          for (const line of output.split("\n")) {
            if (!line.startsWith("SESSION|")) continue;
            // Format: SESSION|sid|proj|cwd|mtime|sizeKb|summary
            const [, sessionId, projDir, cwd, mtime, sizeKb, ...summaryParts] = line.split("|");
            const summary = summaryParts.join("|"); // summary may contain |

            // Derive display path: prefer cwd from JSONL, fall back to project dir name
            // projDir is like "-fsx-suyeong-gdpval" → convert to "/fsx/suyeong/gdpval"
            const projPath = projDir.replace(/-/g, "/");
            const displayPath = cwd || projPath;

            // Filter by workDir (skip filter for "~" which means "show all")
            if (workDir && workDir !== "~") {
              // Normalize workDir: strip trailing slash
              const normalizedWork = workDir.replace(/\/+$/, "");
              // Match against: cwd (actual path), projDir (dash-encoded), projPath (decoded)
              const matches =
                (cwd && cwd.includes(normalizedWork)) ||
                projPath.includes(normalizedWork) ||
                projDir.includes(normalizedWork.replace(/\//g, "-"));
              if (!matches) continue;
            }

            sessions.push({
              sessionId,
              project: displayPath.startsWith("/") ? displayPath : displayPath.replace(/\/$/, ""),
              lastActivity: parseInt(mtime, 10) * 1000,
              messageCount: parseInt(sizeKb, 10) || 0, // Now stores size in KB
              summary: summary || undefined,
            });
          }
          resolve(sessions.sort((a, b) => b.lastActivity - a.lastActivity));
        });
        channel.on("error", () => resolve([]));
      });
    } catch {
      return [];
    }
  }

  getSSHManager(): SSHConnectionManager {
    return this.sshManager;
  }

  shutdown(): void {
    for (const [id] of this.sessions) {
      this.terminateSession(id);
    }
    this.sshManager.disconnectAll();
  }
}
