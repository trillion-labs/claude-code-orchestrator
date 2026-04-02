import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { readdir, readFile, stat, writeFile, unlink, copyFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { ProcessAdapter } from "./adapters/process-adapter";
import { LocalAdapter } from "./adapters/local-adapter";
import { SSHAdapter } from "./adapters/ssh-adapter";
import { SSHConnectionManager } from "./ssh-manager";
import { StreamParser } from "./stream-parser";
import type { Session, MachineConfig, ClaudeStreamMessage, ConversationMessage, ClaudeSessionInfo, PermissionMode, PermissionRequest, WorktreeInfo } from "../shared/types";
import { PERMISSION_MODES } from "../shared/types";
import { resolvePermissionByMode } from "./permission-utils";
import { buildWorkerNotePrompt } from "./orchestrator-prompt";

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
  planFilePath?: string; // Last Write/Edit target in .claude/plans/ (for plan panel)
  interrupted?: boolean; // Set when user interrupts — causes re-spawn on next prompt
  promptQueue: string[];
  isProcessingPrompt: boolean;
  currentAssistantMessage: string;
  messages: ConversationMessage[];
  firstUserMessage?: string; // Cached for display name
  explicitDisplayName?: string; // Overrides firstUserMessage (e.g. task title)
  // Whether text was streamed via content_block_delta for the current message
  hasStreamedText: boolean;
  isOrchestrator?: boolean; // Orchestrator manager session
  orchestratorProjectId?: string; // Project ID for orchestrator MCP
  inManagerConversation?: boolean; // True while Manager is talking to this worker via ask_worker
}

const MAX_RECENT_MESSAGES = 20; // Keep last 10 turns (user + assistant)

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

  async createSession(machine: MachineConfig, workDir: string, resumeSessionId?: string, permissionMode: PermissionMode = "default", worktree?: { enabled: boolean; name: string; existingPath?: string }, projectId?: string, taskId?: string, options?: { isOrchestrator?: boolean; orchestratorProjectId?: string; systemPrompt?: string }): Promise<Session> {
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
      ...(projectId && { projectId }),
      ...(taskId && { taskId }),
      ...(options?.isOrchestrator && { isOrchestrator: true }),
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
      ...(options?.isOrchestrator && { isOrchestrator: true, orchestratorProjectId: options.orchestratorProjectId }),
    };

    this.sessions.set(sessionId, managed);

    // Handle worktree (new sessions only)
    if (worktree?.enabled && !resumeSessionId) {
      try {
        if (machine.type === "local") {
          // ── Local worktree ──
          if (worktree.existingPath) {
            // Use existing worktree — just set workDir and worktree info
            const { execSync } = await import("child_process");
            const expandedWorkDir = workDir.replace(/^~/, process.env.HOME || "/root");
            const repoRoot = execSync("git rev-parse --show-toplevel", {
              cwd: expandedWorkDir,
              encoding: "utf-8",
            }).trim();
            // Detect branch from the existing worktree
            let branch = `claude/${worktree.name}`;
            try {
              branch = execSync("git rev-parse --abbrev-ref HEAD", {
                cwd: worktree.existingPath,
                encoding: "utf-8",
              }).trim();
            } catch { /* fallback to claude/<name> */ }
            session.workDir = worktree.existingPath;
            session.worktree = {
              name: worktree.name,
              worktreePath: worktree.existingPath,
              branch,
              baseDir: repoRoot,
            };
          } else {
            // Create new worktree
            const worktreeInfo = await this.setupWorktree(workDir, worktree.name);
            session.workDir = worktreeInfo.worktreePath;
            session.worktree = worktreeInfo;
          }
        } else {
          // ── Remote (SSH) worktree ──
          if (worktree.existingPath) {
            // Use existing remote worktree — detect branch + repo root via SSH
            const detectScript = `cd "${worktree.existingPath}" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "claude/${worktree.name}" ; echo "---SEPARATOR---" ; cd "${workDir}" && git rev-parse --show-toplevel 2>/dev/null || echo "${workDir}"`;
            const detectChannel = await this.sshManager.execFresh(machine, detectScript);
            const detectOutput = await new Promise<string>((resolve) => {
              let out = "";
              detectChannel.on("data", (data: Buffer) => { out += data.toString(); });
              detectChannel.on("close", () => resolve(out.trim()));
              detectChannel.on("error", () => resolve(""));
            });
            const parts = detectOutput.split("---SEPARATOR---").map(s => s.trim());
            const branch = parts[0] || `claude/${worktree.name}`;
            const repoRoot = parts[1] || workDir;
            session.workDir = worktree.existingPath;
            session.worktree = {
              name: worktree.name,
              worktreePath: worktree.existingPath,
              branch,
              baseDir: repoRoot,
            };
          } else {
            // Create new remote worktree
            const worktreeInfo = await this.setupRemoteWorktree(machine, workDir, worktree.name);
            session.workDir = worktreeInfo.worktreePath;
            session.worktree = worktreeInfo;
          }
        }
      } catch (err) {
        session.status = "error";
        session.error = (err as Error).message;
        this.emit("session:status", sessionId, session.status, session.error);
        return session;
      }
    }

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
      if (session.status === "terminated") return;

      if (managed.interrupted) {
        // Interrupted by user — return to idle so they can send new prompts
        managed.interrupted = false;
        managed.isProcessingPrompt = false;
        session.status = "idle";
        session.error = undefined;
        console.log(`[Session ${sessionId}] Interrupted — returning to idle (will re-spawn on next prompt)`);
        this.emit("session:status", sessionId, "idle");
      } else {
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

    // Always set up MCP permission prompt tool — permission mode is resolved
    // dynamically in handlePermissionRequest() via resolvePermissionByMode()
    try {
      if (machine.type === "local") {
        const mcpConfigPath = await this.writeMcpConfig(sessionId, managed.orchestratorProjectId, projectId);
        managed.mcpConfigPath = mcpConfigPath;
        args.push(
          "--permission-prompt-tool", "mcp__perm__check_permission",
          "--mcp-config", mcpConfigPath,
        );
      } else {
        // Remote: set up reverse port forward + remote MCP server (with timeout)
        const remoteConfig = await Promise.race([
          this.setupRemoteMcpPermission(sessionId, machine, projectId),
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

    // Orchestrator manager: restrict tools to read-only + inject system prompt
    if (options?.isOrchestrator && options.systemPrompt) {
      args.push("--allowedTools", "Read,Glob,Grep,mcp__orch__*,mcp__perm__*");
      // Only inject system prompt on fresh sessions (not resume — CLI rejects it)
      if (!resumeSessionId) {
        args.push("--append-system-prompt", options.systemPrompt);
      }
    }

    // Worker sessions with project context: inject note protocol (fresh only)
    if (!options?.isOrchestrator && projectId && !resumeSessionId) {
      args.push("--append-system-prompt", buildWorkerNotePrompt());
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

      // Emit display name (explicit name takes priority over first user message)
      const displayName = managed.explicitDisplayName || managed.firstUserMessage;
      if (displayName) {
        this.emit("session:displayName", sessionId, displayName);
      }

      // Restore plan panel if history contained a plan file Write/Edit
      if (managed.planFilePath) {
        try {
          let planContent: string;
          if (machine.type === "local") {
            planContent = await readFile(managed.planFilePath, "utf-8");
          } else {
            planContent = await this.execRemoteRead(machine, `cat "${managed.planFilePath}"`);
          }
          if (planContent.trim()) {
            this.emit("session:planContent", sessionId, planContent, managed.planFilePath);
          }
        } catch {
          // Plan file no longer exists or unreadable — skip silently
        }
      }

      // Pass custom CLAUDE_CONFIG_DIR if detected (e.g. direnv-managed sessions)
      const spawnEnv: Record<string, string> = {};
      if (managed.claudeConfigDir) {
        spawnEnv.CLAUDE_CONFIG_DIR = managed.claudeConfigDir;
      }
      // Use worktree path if created, original cwd for resume, or workDir as fallback
      const spawnCwd = session.worktree
        ? session.worktree.worktreePath
        : (resumeSessionId && managed.originalCwd) || workDir;
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

  private async setupWorktree(workDir: string, name: string): Promise<WorktreeInfo> {
    const { execSync } = await import("child_process");
    const { mkdirSync } = await import("fs");
    const expandedWorkDir = workDir.replace(/^~/, process.env.HOME || "/root");

    // 1. Validate this is a git repository
    try {
      execSync("git rev-parse --is-inside-work-tree", {
        cwd: expandedWorkDir,
        stdio: "pipe",
      });
    } catch {
      throw new Error(
        `"${workDir}" is not a git repository. Worktree creation requires a git repo.`
      );
    }

    // 2. Get the git repo root
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      cwd: expandedWorkDir,
      encoding: "utf-8",
    }).trim();

    const worktreePath = join(repoRoot, ".claude", "worktrees", name);
    const branch = `claude/${name}`;

    // 3. Check if worktree already exists at that path
    try {
      const existingWorktrees = execSync("git worktree list --porcelain", {
        cwd: repoRoot,
        encoding: "utf-8",
      });
      if (existingWorktrees.includes(worktreePath)) {
        throw new Error(`Worktree "${name}" already exists at ${worktreePath}`);
      }
    } catch (err) {
      if ((err as Error).message.includes("already exists")) throw err;
    }

    // 4. Check if branch already exists
    try {
      execSync(`git rev-parse --verify "refs/heads/${branch}"`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
      throw new Error(
        `Branch "${branch}" already exists. Choose a different worktree name.`
      );
    } catch (err) {
      if ((err as Error).message.includes("already exists")) throw err;
      // Expected: branch doesn't exist yet
    }

    // 5. Create directory and worktree
    mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });

    try {
      execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
    } catch (err) {
      throw new Error(`Failed to create worktree: ${(err as Error).message}`);
    }

    console.log(`[Worktree] Created worktree "${name}" at ${worktreePath} on branch ${branch}`);
    return { name, worktreePath, branch, baseDir: repoRoot };
  }

  private async setupRemoteWorktree(
    machine: MachineConfig,
    workDir: string,
    name: string,
  ): Promise<WorktreeInfo> {
    const escapedWorkDir = workDir.replace(/"/g, '\\"');
    const escapedName = name.replace(/"/g, '\\"');

    const script = `python3 -c '
import os, json, subprocess as sp, sys

work_dir = os.path.expanduser("${escapedWorkDir}")
name = "${escapedName}"
branch = f"claude/{name}"

def run(cmd, cwd):
    return sp.check_output(cmd, shell=True, cwd=cwd, stderr=sp.PIPE).decode().strip()

try:
    run("git rev-parse --is-inside-work-tree", work_dir)
    repo_root = run("git rev-parse --show-toplevel", work_dir)
    wt_path = os.path.join(repo_root, ".claude", "worktrees", name)

    existing = run("git worktree list --porcelain", repo_root)
    if wt_path in existing:
        print(json.dumps({"error": f"Worktree \\"{name}\\" already exists at {wt_path}"}))
        sys.exit(0)

    try:
        run(f"git rev-parse --verify \\"refs/heads/{branch}\\"", repo_root)
        print(json.dumps({"error": f"Branch \\"{branch}\\" already exists. Choose a different worktree name."}))
        sys.exit(0)
    except:
        pass

    os.makedirs(os.path.join(repo_root, ".claude", "worktrees"), exist_ok=True)
    run(f"git worktree add \\"{wt_path}\\" -b \\"{branch}\\"", repo_root)
    print(json.dumps({"name": name, "worktreePath": wt_path, "branch": branch, "baseDir": repo_root}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
'`;

    const channel = await this.sshManager.execFresh(machine, script);
    const output = await new Promise<string>((resolve) => {
      let out = "";
      channel.on("data", (data: Buffer) => { out += data.toString(); });
      channel.on("close", () => resolve(out.trim()));
      channel.on("error", () => resolve(""));
    });

    if (!output) {
      throw new Error("No response from remote machine during worktree creation");
    }

    let result: Record<string, string>;
    try {
      result = JSON.parse(output);
    } catch {
      throw new Error(`Invalid response from remote: ${output.slice(0, 200)}`);
    }

    if (result.error) {
      throw new Error(result.error);
    }

    console.log(`[Worktree] Created remote worktree "${name}" at ${result.worktreePath} on branch ${result.branch}`);
    return {
      name: result.name,
      worktreePath: result.worktreePath,
      branch: result.branch,
      baseDir: result.baseDir,
    };
  }

  // ── Directory Listing for Path Autocomplete ──

  async listDirectory(
    machine: MachineConfig,
    dirPath: string,
    limit = 50,
  ): Promise<{ entries: Array<{ name: string; isDir: boolean }>; resolvedPath: string; prefix?: string; error?: string }> {
    return machine.type === "local"
      ? this.listLocalDirectory(dirPath, limit)
      : this.listRemoteDirectory(machine, dirPath, limit);
  }

  async createDirectory(
    machine: MachineConfig,
    dirPath: string,
  ): Promise<{ success: boolean; resolvedPath: string; error?: string }> {
    const expandedPath = dirPath.startsWith("~")
      ? dirPath.replace(/^~/, homedir())
      : dirPath;

    if (machine.type === "local") {
      const { mkdir: mkdirFs } = await import("fs/promises");
      await mkdirFs(expandedPath, { recursive: true });
      return { success: true, resolvedPath: expandedPath };
    } else {
      const mkdirCmd = `mkdir -p "${dirPath}" && cd "${dirPath}" && pwd`;
      const ch = await this.sshManager.execFresh(machine, mkdirCmd);
      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        ch.on("data", (data: Buffer) => { stdout += data.toString(); });
        ch.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
        ch.on("close", (code: number | null) => {
          if (code !== 0) {
            resolve({ success: false, resolvedPath: dirPath, error: stderr.trim() || `mkdir failed (code ${code})` });
          } else {
            resolve({ success: true, resolvedPath: stdout.trim() || dirPath });
          }
        });
        ch.on("error", (err: Error) => {
          resolve({ success: false, resolvedPath: dirPath, error: err.message });
        });
      });
    }
  }

  async readFileContent(
    machine: MachineConfig,
    filePath: string,
    maxLines = 2000,
  ): Promise<{ content: string; truncated: boolean; totalLines?: number; error?: string }> {
    if (machine.type === "local") {
      return this.readLocalFile(filePath, maxLines);
    } else {
      return this.readRemoteFile(machine, filePath, maxLines);
    }
  }

  private async readLocalFile(
    filePath: string,
    maxLines: number,
  ): Promise<{ content: string; truncated: boolean; totalLines?: number; error?: string }> {
    try {
      const { resolve } = await import("path");
      const resolved = resolve(filePath.replace(/^~/, process.env.HOME || "/root"));
      const raw = await readFile(resolved);

      // Binary detection: check for null bytes in first 8KB
      const sample = raw.subarray(0, 8192);
      if (sample.includes(0)) {
        return { content: "", truncated: false, error: "Binary file — preview not available" };
      }

      const text = raw.toString("utf-8");
      const lines = text.split("\n");
      const truncated = lines.length > maxLines;
      const content = truncated ? lines.slice(0, maxLines).join("\n") : text;
      return { content, truncated, totalLines: lines.length };
    } catch (err) {
      return { content: "", truncated: false, error: (err as Error).message };
    }
  }

  private async readRemoteFile(
    machine: MachineConfig,
    filePath: string,
    maxLines: number,
  ): Promise<{ content: string; truncated: boolean; totalLines?: number; error?: string }> {
    try {
      // Get file content (head) and total line count in one command
      const cmd = `head -n ${maxLines} "${filePath}" && echo "___EOF___" && wc -l < "${filePath}"`;
      const ch = await this.sshManager.execFresh(machine, cmd);
      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        ch.on("data", (data: Buffer) => { stdout += data.toString(); });
        ch.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
        ch.on("close", (code: number | null) => {
          if (code !== 0) {
            resolve({ content: "", truncated: false, error: stderr.trim() || `Failed to read file (code ${code})` });
            return;
          }
          const eofIdx = stdout.lastIndexOf("___EOF___");
          if (eofIdx === -1) {
            resolve({ content: stdout, truncated: false });
            return;
          }
          const content = stdout.substring(0, eofIdx).replace(/\n$/, "");
          const totalLines = parseInt(stdout.substring(eofIdx + "___EOF___\n".length).trim(), 10) || undefined;
          const truncated = totalLines !== undefined && totalLines > maxLines;
          resolve({ content, truncated, totalLines });
        });
        ch.on("error", (err: Error) => {
          resolve({ content: "", truncated: false, error: err.message });
        });
      });
    } catch (err) {
      return { content: "", truncated: false, error: (err as Error).message };
    }
  }

  private async listLocalDirectory(
    dirPath: string,
    limit: number,
  ): Promise<{ entries: Array<{ name: string; isDir: boolean }>; resolvedPath: string; prefix?: string; error?: string }> {
    const { readdir: readdirFs } = await import("fs/promises");
    const { resolve, dirname, basename } = await import("path");

    const resolvedPath = resolve(dirPath.replace(/^~/, process.env.HOME || "/root"));

    try {
      const items = await readdirFs(resolvedPath, { withFileTypes: true });

      const dirs: Array<{ name: string; isDir: boolean }> = [];
      const files: Array<{ name: string; isDir: boolean }> = [];

      for (const item of items) {
        // Hide dotfiles by default
        if (item.name.startsWith(".")) continue;
        if (item.isDirectory()) {
          dirs.push({ name: item.name, isDir: true });
        } else {
          files.push({ name: item.name, isDir: false });
        }
      }

      // Sort alphabetically: dirs first, then files
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      const entries: Array<{ name: string; isDir: boolean }> = [];

      // Add ".." unless at root
      if (resolvedPath !== "/") {
        entries.push({ name: "..", isDir: true });
      }

      entries.push(...dirs, ...files);

      return { entries: entries.slice(0, limit), resolvedPath };
    } catch {
      // ★ Prefix fallback: path is not a directory — try parent + prefix filter
      const parent = dirname(resolvedPath);
      const prefix = basename(resolvedPath);

      try {
        const items = await readdirFs(parent, { withFileTypes: true });
        const prefixLower = prefix.toLowerCase();

        const dirs: Array<{ name: string; isDir: boolean }> = [];
        const files: Array<{ name: string; isDir: boolean }> = [];

        for (const item of items) {
          if (item.name.startsWith(".")) continue;
          if (!item.name.toLowerCase().startsWith(prefixLower)) continue;
          if (item.isDirectory()) {
            dirs.push({ name: item.name, isDir: true });
          } else {
            files.push({ name: item.name, isDir: false });
          }
        }

        dirs.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));

        // No ".." in prefix mode
        const entries = [...dirs, ...files];
        return { entries: entries.slice(0, limit), resolvedPath: parent, prefix };
      } catch (innerErr) {
        return { entries: [], resolvedPath, error: (innerErr as Error).message };
      }
    }
  }

  private async listRemoteDirectory(
    machine: MachineConfig,
    dirPath: string,
    limit: number,
  ): Promise<{ entries: Array<{ name: string; isDir: boolean }>; resolvedPath: string; prefix?: string; error?: string }> {
    try {
      const script = `python3 -c '
import os, json, sys
p = os.path.expanduser("""${dirPath.replace(/"/g, '\\"')}""")
p = os.path.abspath(p)

def list_dir(d, prefix=None, lim=${limit}):
    items = os.listdir(d)
    dirs = []
    files = []
    pfx = prefix.lower() if prefix else None
    for name in sorted(items):
        if name.startswith("."):
            continue
        if pfx and not name.lower().startswith(pfx):
            continue
        full = os.path.join(d, name)
        if os.path.isdir(full):
            dirs.append({"name": name, "isDir": True})
        else:
            files.append({"name": name, "isDir": False})
    entries = []
    if not prefix and d != "/":
        entries.append({"name": "..", "isDir": True})
    entries.extend(dirs[:lim])
    entries.extend(files[:lim])
    return entries[:lim]

try:
    if os.path.isdir(p):
        entries = list_dir(p)
        print(json.dumps({"entries": entries, "resolvedPath": p}))
    else:
        parent = os.path.dirname(p)
        prefix = os.path.basename(p)
        entries = list_dir(parent, prefix)
        print(json.dumps({"entries": entries, "resolvedPath": parent, "prefix": prefix}))
except Exception as e:
    print(json.dumps({"entries": [], "resolvedPath": p, "error": str(e)}))
'`;

      const channel = await this.sshManager.execFresh(machine, script);
      const output = await new Promise<string>((resolve) => {
        let out = "";
        channel.on("data", (data: Buffer) => { out += data.toString(); });
        channel.on("close", () => resolve(out.trim()));
        channel.on("error", () => resolve(""));
      });

      if (!output) {
        return { entries: [], resolvedPath: dirPath, error: "No response from remote" };
      }

      return JSON.parse(output);
    } catch (err) {
      return { entries: [], resolvedPath: dirPath, error: (err as Error).message };
    }
  }

  async listLocalWorktrees(workDir: string): Promise<Array<{ name: string; path: string; branch: string }>> {
    const { execSync } = await import("child_process");
    const expandedWorkDir = workDir.replace(/^~/, process.env.HOME || "/root");

    try {
      const repoRoot = execSync("git rev-parse --show-toplevel", {
        cwd: expandedWorkDir,
        encoding: "utf-8",
      }).trim();

      const output = execSync("git worktree list --porcelain", {
        cwd: repoRoot,
        encoding: "utf-8",
      });

      // Parse porcelain output: blocks separated by blank lines
      const worktrees: Array<{ name: string; path: string; branch: string }> = [];
      const blocks = output.split("\n\n").filter(Boolean);

      for (const block of blocks) {
        const lines = block.split("\n");
        const wtPath = lines.find((l) => l.startsWith("worktree "))?.slice(9);
        const branchLine = lines.find((l) => l.startsWith("branch "));
        const branch = branchLine?.slice(7).replace("refs/heads/", "") || "";
        if (!wtPath) continue;

        // Only list .claude/worktrees/ pattern
        const match = wtPath.match(/\.claude\/worktrees\/([^/]+)$/);
        if (match) {
          worktrees.push({ name: match[1], path: wtPath, branch });
        }
      }

      return worktrees;
    } catch {
      return []; // Not a git repo or no worktrees
    }
  }

  async listRemoteWorktrees(
    machine: MachineConfig,
    workDir: string,
  ): Promise<Array<{ name: string; path: string; branch: string }>> {
    const escapedWorkDir = workDir.replace(/"/g, '\\"');

    const script = `python3 -c '
import os, json, subprocess as sp, re

work_dir = os.path.expanduser("${escapedWorkDir}")
try:
    repo_root = sp.check_output("git rev-parse --show-toplevel",
        shell=True, cwd=work_dir, stderr=sp.PIPE).decode().strip()
    output = sp.check_output("git worktree list --porcelain",
        shell=True, cwd=repo_root, stderr=sp.PIPE).decode()
    result = []
    for block in output.split("\\n\\n"):
        lines = block.strip().split("\\n")
        wt_path = ""
        branch = ""
        for l in lines:
            if l.startswith("worktree "):
                wt_path = l[9:]
            elif l.startswith("branch "):
                branch = l[7:].replace("refs/heads/", "")
        if not wt_path:
            continue
        m = re.search(r"\\.claude/worktrees/([^/]+)$", wt_path)
        if m:
            result.append({"name": m.group(1), "path": wt_path, "branch": branch})
    print(json.dumps(result))
except:
    print("[]")
'`;

    try {
      const channel = await this.sshManager.execFresh(machine, script);
      const output = await new Promise<string>((resolve) => {
        let out = "";
        channel.on("data", (data: Buffer) => { out += data.toString(); });
        channel.on("close", () => resolve(out.trim()));
        channel.on("error", () => resolve("[]"));
      });

      return JSON.parse(output || "[]");
    } catch {
      return [];
    }
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`Session ${sessionId} not found`);

    if (managed.isProcessingPrompt) {
      // Queue the prompt — don't add to history or emit yet
      managed.promptQueue.push(prompt);
      if (!managed.firstUserMessage) managed.firstUserMessage = prompt;
      this.emit("session:queueUpdate", sessionId, [...managed.promptQueue]);
      return;
    }

    // Add user message to history
    const userMsg: ConversationMessage = {
      id: uuidv4(),
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };
    if (!managed.firstUserMessage) managed.firstUserMessage = prompt;
    managed.messages.push(userMsg);
    this.trimMessages(managed);
    this.emit("session:message", sessionId, userMsg);

    this.processPrompt(managed, prompt);
  }

  /**
   * Send a prompt to a session and wait for the complete response.
   * Returns the assistant's response text. Used by Manager to ask Workers.
   * Rejects after timeout (default 5 minutes).
   */
  sendPromptAndWaitForResponse(
    sessionId: string,
    prompt: string,
    timeoutMs = 5 * 60 * 1000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const managed = this.sessions.get(sessionId);
      if (!managed) return reject(new Error(`Session ${sessionId} not found`));

      // Mark worker as in manager conversation — suppresses completion notifications
      managed.inManagerConversation = true;

      let timer: ReturnType<typeof setTimeout>;

      const onMessage = (sid: string, message: ConversationMessage) => {
        if (sid !== sessionId || message.role !== "assistant") return;
        cleanup();
        resolve(message.content);
      };

      const onStatus = (sid: string, status: string, error?: string) => {
        if (sid !== sessionId) return;
        if (status === "error" || status === "terminated") {
          cleanup();
          reject(new Error(`Worker session ${status}: ${error || "unknown"}`));
        }
      };

      const cleanup = () => {
        managed.inManagerConversation = false;
        clearTimeout(timer);
        this.removeListener("session:message", onMessage);
        this.removeListener("session:status", onStatus);
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for worker response (${timeoutMs}ms)`));
      }, timeoutMs);

      this.on("session:message", onMessage);
      this.on("session:status", onStatus);

      // Send the prompt (this queues if busy)
      this.sendPrompt(sessionId, prompt).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  dequeuePrompt(sessionId: string, index: number): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    if (index < 0 || index >= managed.promptQueue.length) return;
    managed.promptQueue.splice(index, 1);
    this.emit("session:queueUpdate", sessionId, [...managed.promptQueue]);
  }

  private async processPrompt(managed: ManagedSession, prompt: string) {
    managed.isProcessingPrompt = true;
    managed.currentAssistantMessage = "";
    managed.hasStreamedText = false;
    managed.session.status = "busy";
    managed.session.lastActivity = Date.now();
    this.emit("session:status", managed.session.id, "busy");

    // If the process was killed (e.g. after interrupt), re-spawn with --resume
    if (!managed.adapter.isRunning) {
      console.log(`[Session ${managed.session.id}] Process not running — re-spawning with --resume ${managed.session.claudeSessionId}`);
      await this.respawnClaude(managed);
    }

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

              // Track plan file path from Write/Edit tool_use blocks
              // Two cases: (1) orchestrator permission mode is "plan", or
              // (2) Claude Code entered plan mode on its own and writes to .claude/plans/
              if (block.name === "Write" || block.name === "Edit") {
                const fp = block.input?.file_path ? String(block.input.file_path) : "";
                if (fp && (managed.permissionMode === "plan" || this.isPlanFilePath(fp))) {
                  managed.planFilePath = fp;
                }
              }
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
          this.trimMessages(managed);
          this.emit("session:message", sessionId, assistantMsg);
        }

        managed.currentAssistantMessage = "";
        managed.hasStreamedText = false;
        managed.isProcessingPrompt = false;
        managed.session.status = "idle";
        this.emit("session:status", sessionId, "idle", undefined, managed.session.totalCostUsd);

        if (managed.promptQueue.length > 0) {
          const nextPrompt = managed.promptQueue.shift()!;
          // Now add the queued user message to history and emit
          const queuedUserMsg: ConversationMessage = {
            id: uuidv4(),
            role: "user",
            content: nextPrompt,
            timestamp: Date.now(),
          };
          managed.messages.push(queuedUserMsg);
          this.trimMessages(managed);
          this.emit("session:message", sessionId, queuedUserMsg);
          this.emit("session:queueUpdate", sessionId, [...managed.promptQueue]);
          this.processPrompt(managed, nextPrompt);
        }
        break;
      }
    }
  }

  private isPlanFilePath(filePath: string): boolean {
    // .claude/plans/ directory
    if (/[/\\]\.claude[/\\]plans[/\\]/.test(filePath)) return true;
    // plan.md at project root (Claude sometimes writes here)
    if (/[/\\]plan\.md$|^plan\.md$/.test(filePath)) return true;
    return false;
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
      case "ExitPlanMode":
        // These are rendered from the tool-permission-request block
        // (MCP is always active, so they always go through the permission flow).
        // Suppress here to avoid duplicate cards.
        return "";
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

  private async writeMcpConfig(sessionId: string, orchestratorProjectId?: string, projectId?: string): Promise<string> {
    const srcPath = join(process.cwd(), "scripts", "permission-mcp-server.mjs");
    // Copy MCP server script to /tmp to avoid issues with .claude/ worktree paths
    const mcpServerPath = join(tmpdir(), `claude-orch-${sessionId}.mcp.mjs`);
    await copyFile(srcPath, mcpServerPath);
    const configPath = join(tmpdir(), `claude-orch-${sessionId}.mcp.json`);
    const config: Record<string, unknown> = {
      mcpServers: {
        perm: {
          command: "node",
          args: [mcpServerPath],
          env: {
            ORCHESTRATOR_URL: `http://localhost:${this.orchestratorPort}`,
            SESSION_ID: sessionId,
          },
        },
        // Orchestrator MCP server — only included for manager sessions
        ...(orchestratorProjectId && {
          orch: {
            command: "node",
            args: [join(tmpdir(), `claude-orch-${sessionId}.orchestrator.mjs`)],
            env: {
              ORCHESTRATOR_URL: `http://localhost:${this.orchestratorPort}`,
              SESSION_ID: sessionId,
              PROJECT_ID: orchestratorProjectId,
            },
          },
        }),
        // Note MCP server — included for project-linked worker sessions (non-orchestrator)
        ...(!orchestratorProjectId && projectId && {
          note: {
            command: "node",
            args: [join(tmpdir(), `claude-orch-${sessionId}.note.mjs`)],
            env: {
              ORCHESTRATOR_URL: `http://localhost:${this.orchestratorPort}`,
              SESSION_ID: sessionId,
              PROJECT_ID: projectId,
            },
          },
        }),
      },
    };

    // Copy orchestrator MCP server script if needed
    if (orchestratorProjectId) {
      const orchSrcPath = join(process.cwd(), "scripts", "orchestrator-mcp-server.mjs");
      const orchDestPath = join(tmpdir(), `claude-orch-${sessionId}.orchestrator.mjs`);
      await copyFile(orchSrcPath, orchDestPath);
    }

    // Copy note MCP server script for project-linked worker sessions
    if (!orchestratorProjectId && projectId) {
      const noteSrcPath = join(process.cwd(), "scripts", "note-mcp-server.mjs");
      const noteDestPath = join(tmpdir(), `claude-orch-${sessionId}.note.mjs`);
      await copyFile(noteSrcPath, noteDestPath);
    }

    await writeFile(configPath, JSON.stringify(config), "utf-8");
    return configPath;
  }

  private async cleanupMcpConfig(managed: ManagedSession): Promise<void> {
    if (!managed.mcpConfigPath) return;
    if (managed.machine.type === "local") {
      try { await unlink(managed.mcpConfigPath); } catch { /* ignore */ }
      // Also clean up copied MCP server script
      try { await unlink(managed.mcpConfigPath.replace(".mcp.json", ".mcp.mjs")); } catch { /* ignore */ }
      try { await unlink(managed.mcpConfigPath.replace(".mcp.json", ".orchestrator.mjs")); } catch { /* ignore */ }
      try { await unlink(managed.mcpConfigPath.replace(".mcp.json", ".note.mjs")); } catch { /* ignore */ }
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
  private async setupRemoteMcpPermission(sessionId: string, machine: MachineConfig, projectId?: string): Promise<string | null> {
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
        send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [
            {
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
            },
            {
                "name": "show_user",
                "description": "Show visual HTML content to the user in a side panel next to the chat. Use this proactively whenever your response would benefit from visual presentation — especially when the user asks you to explain, show, visualize, or demonstrate something. Great for: charts and data visualizations (use Chart.js, D3.js, Mermaid via CDN), interactive UI mockups or previews, visual explanations of concepts or architecture, formatted tables, timelines, diagrams, or any rich content beyond plain text. The html parameter must be a complete, self-contained HTML document (inline style and script tags are supported). External CDN libraries can be loaded via script src. Note: Content renders in a sandboxed iframe without same-origin access, so localStorage, cookies, and fetch to parent origin are unavailable. This is fire-and-forget.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Title shown in the panel header"},
                        "html": {"type": "string", "description": "Complete, self-contained HTML document with inline style/script. CDN libraries can be loaded via script src."}
                    },
                    "required": ["html"]
                }
            }
        ]}})
    elif method == "tools/call":
        args = msg.get("params", {}).get("arguments", {})
        name = msg.get("params", {}).get("name", "")
        if name == "show_user":
            title = args.get("title", "Preview")
            html = args.get("html", "")
            try:
                data = json.dumps({
                    "sessionId": SESSION_ID,
                    "title": title,
                    "html": html
                }).encode()
                req = urllib.request.Request(
                    ORCHESTRATOR_URL + "/api/show-user",
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=30)
                send({"jsonrpc": "2.0", "id": mid, "result": {
                    "content": [{"type": "text", "text": "Content displayed to user in side panel."}]
                }})
            except Exception as e:
                send({"jsonrpc": "2.0", "id": mid, "result": {
                    "content": [{"type": "text", "text": "Failed to show content: " + str(e)}],
                    "isError": True
                }})
        else:
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

    // Step 2: Write files via SFTP (exec hangs after forwardIn on same connection)
    const orchUrl = `http://127.0.0.1:${remotePort}`;

    const mcpServers: Record<string, unknown> = {
      perm: {
        command: "python3",
        args: [scriptPath],
        env: {
          ORCHESTRATOR_URL: orchUrl,
          SESSION_ID: sessionId,
        },
      },
    };

    // Add note MCP server for project-linked worker sessions
    if (projectId) {
      const noteScriptPath = `/tmp/claude-orch-${sessionId}.note.py`;
      const notePythonScript = this.buildRemoteNoteMcpScript();
      mcpServers.note = {
        command: "python3",
        args: [noteScriptPath],
        env: {
          ORCHESTRATOR_URL: orchUrl,
          SESSION_ID: sessionId,
          PROJECT_ID: projectId,
        },
      };
      await this.sshManager.writeRemoteFile(machine, noteScriptPath, notePythonScript, { mode: 0o755 });
    }

    const mcpConfig = JSON.stringify({ mcpServers });

    console.log(`[Remote MCP] Writing files to ${machine.name} via SFTP...`);
    await this.sshManager.writeRemoteFile(machine, scriptPath, pythonScript, { mode: 0o755 });
    await this.sshManager.writeRemoteFile(machine, configPath, mcpConfig);

    console.log(`[Session ${sessionId}] Remote MCP permission: port ${remotePort}, script ${scriptPath}${projectId ? " + note server" : ""}`);
    return configPath;
  }

  private buildRemoteNoteMcpScript(): string {
    return `#!/usr/bin/env python3
import sys, json, os
try:
    from urllib.request import Request, urlopen
except ImportError:
    from urllib2 import Request, urlopen

SESSION_ID = os.environ.get("SESSION_ID", "")
PROJECT_ID = os.environ.get("PROJECT_ID", "")
ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "http://127.0.0.1:0")

TOOLS = [
    {"name": "list_notes", "description": "List note summaries (id, title, createdAt, updatedAt) in the current project. Does NOT include content.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "get_note", "description": "Get full note content (title + markdown content) by note ID.", "inputSchema": {"type": "object", "properties": {"noteId": {"type": "string", "description": "The note ID to retrieve"}}, "required": ["noteId"]}},
    {"name": "create_note", "description": "Create a new note. Notes are markdown documents for plans, research, decisions, or project knowledge.", "inputSchema": {"type": "object", "properties": {"title": {"type": "string", "description": "Note title"}, "content": {"type": "string", "description": "Note content in markdown"}}, "required": ["title", "content"]}},
    {"name": "update_note", "description": "Update an existing note's title or content.", "inputSchema": {"type": "object", "properties": {"noteId": {"type": "string", "description": "The note ID to update"}, "title": {"type": "string", "description": "New title (optional)"}, "content": {"type": "string", "description": "New content in markdown (optional)"}}, "required": ["noteId"]}},
    {"name": "delete_note", "description": "Delete a note from the project.", "inputSchema": {"type": "object", "properties": {"noteId": {"type": "string", "description": "The note ID to delete"}}, "required": ["noteId"]}}
]

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\\n")
    sys.stdout.flush()

def call_orchestrator(tool, args):
    data = json.dumps({"sessionId": SESSION_ID, "projectId": PROJECT_ID, "tool": tool, "args": args}).encode()
    req = Request(ORCHESTRATOR_URL + "/api/orchestrator", data=data, headers={"Content-Type": "application/json"}, method="POST")
    resp = urlopen(req, timeout=30)
    return json.loads(resp.read())

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
        send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "note-server", "version": "1.0.0"}}})
    elif method == "notifications/initialized":
        pass
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}})
    elif method == "tools/call":
        name = msg.get("params", {}).get("name", "")
        args = msg.get("params", {}).get("arguments", {})
        try:
            result = call_orchestrator(name, args)
            send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}})
        except Exception as e:
            send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "Error: " + str(e)}], "isError": True}})
`;
  }

  /**
   * Called by the HTTP endpoint when the MCP show_user tool is invoked.
   * Fire-and-forget: injects a tool block into the stream and emits an event.
   */
  handleShowUser(sessionId: string, title: string, html: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    // Inject a show-user tool card into the stream
    const block = `\n\`\`\`tool-show-user\n${JSON.stringify({ title })}\n\`\`\`\n`;
    if (managed.currentAssistantMessage && !managed.currentAssistantMessage.endsWith("\n\n")) {
      managed.currentAssistantMessage += "\n\n";
      this.emit("session:stream", sessionId, "\n\n");
    }
    managed.currentAssistantMessage += block;
    this.emit("session:stream", sessionId, block);

    // Broadcast to clients
    this.emit("session:showUser", sessionId, title, html);
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

    // Auto-resolve based on current permission mode
    const autoResult = resolvePermissionByMode(managed.permissionMode, toolName, input);
    if (autoResult) {
      // Track plan file path when Write/Edit is auto-allowed in plan mode
      if (autoResult.behavior === "allow" && managed.permissionMode === "plan" && (toolName === "Write" || toolName === "Edit")) {
        const fp = typeof input.file_path === "string" ? input.file_path : "";
        if (fp) {
          managed.planFilePath = fp;
        }
      }
      return autoResult;
    }

    // ExitPlanMode: read the plan file and send content to the client before showing the approval card
    if (toolName === "ExitPlanMode" && managed.planFilePath) {
      try {
        let planContent: string;
        if (managed.machine.type === "local") {
          planContent = await readFile(managed.planFilePath, "utf-8");
        } else {
          planContent = await this.execRemoteRead(
            managed.machine,
            `cat "${managed.planFilePath}"`,
          );
        }
        if (planContent.trim()) {
          this.emit("session:planContent", sessionId, planContent, managed.planFilePath);
        }
      } catch (err) {
        console.warn(`[Session ${sessionId}] Could not read plan file:`, (err as Error).message);
      }
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
  resolvePermission(requestId: string, allow: boolean, answers?: Record<string, string>, message?: string): void {
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
      // When ExitPlanMode is approved, transition out of plan mode
      // so Claude can proceed with implementation using write tools.
      if (pending.request.toolName === "ExitPlanMode" && managed && managed.permissionMode === "plan") {
        this.setPermissionMode(pending.request.sessionId, "default");
      }

      const updatedInput = answers
        ? { ...pending.request.input, answers }
        : pending.request.input;
      pending.resolve({ behavior: "allow", updatedInput });
    } else {
      pending.resolve({ behavior: "deny", message: message || "Denied by user in web UI" });
    }
  }

  /**
   * Dynamically change the permission mode for a running session.
   * The new mode takes effect for subsequent permission requests.
   */
  setPermissionMode(sessionId: string, mode: PermissionMode): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    managed.permissionMode = mode;
    managed.session.permissionMode = mode;
    this.emit("session:permissionModeChanged", sessionId, mode);
  }

  setSessionProject(sessionId: string, projectId: string | null): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    if (projectId) {
      managed.session.projectId = projectId;
    } else {
      delete managed.session.projectId;
      delete managed.session.taskId;
    }
    this.emit("session:projectChanged", sessionId, projectId);
  }

  interruptSession(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.session.status !== "busy") return;
    console.log(`[Session ${sessionId}] Interrupting (SIGINT)`);
    managed.interrupted = true;
    managed.adapter.interrupt();
  }

  /**
   * Re-spawn the Claude process after an interrupt.
   * Uses --resume with the existing claudeSessionId to continue the conversation.
   */
  private async respawnClaude(managed: ManagedSession): Promise<void> {
    const { session } = managed;
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
    ];

    // Re-use existing MCP config if available
    if (managed.mcpConfigPath) {
      args.push(
        "--permission-prompt-tool", "mcp__perm__check_permission",
        "--mcp-config", managed.mcpConfigPath,
      );
    }

    // Resume the existing Claude session
    args.push("--resume", session.claudeSessionId);

    const spawnEnv: Record<string, string> = {};
    if (managed.claudeConfigDir) {
      spawnEnv.CLAUDE_CONFIG_DIR = managed.claudeConfigDir;
    }
    const spawnCwd = session.worktree
      ? session.worktree.worktreePath
      : managed.originalCwd || session.workDir;

    console.log(`[Session ${session.id}] Re-spawning claude with cwd=${spawnCwd}, args=${args.join(" ")}`);
    await managed.adapter.spawn("claude", args, { cwd: spawnCwd, env: spawnEnv });
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

  /**
   * Link an existing session to a project/task (bidirectional).
   */
  linkSessionToProject(sessionId: string, projectId: string, taskId: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`Session ${sessionId} not found`);
    managed.session.projectId = projectId;
    managed.session.taskId = taskId;
  }

  /**
   * Set an explicit display name for a session (e.g. from task title).
   * This overrides the auto-derived name from the first user message.
   */
  setSessionDisplayName(sessionId: string, name: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    managed.explicitDisplayName = name;
    this.emit("session:displayName", sessionId, name);
  }

  /**
   * Extract a display name from the session.
   * Priority: explicitDisplayName > firstUserMessage > first user message in history.
   */
  getSessionDisplayName(sessionId: string): string {
    const managed = this.sessions.get(sessionId);
    if (!managed) return "Imported session";
    if (managed.explicitDisplayName) return managed.explicitDisplayName;
    const content = managed.firstUserMessage
      || managed.messages.find((m) => m.role === "user")?.content;
    if (content) {
      const text = content.replace(/\n/g, " ").trim();
      return text.length > 80 ? text.slice(0, 77) + "..." : text;
    }
    return "Imported session";
  }

  isOrchestratorSession(sessionId: string): boolean {
    const managed = this.sessions.get(sessionId);
    return managed?.isOrchestrator === true;
  }

  isInManagerConversation(sessionId: string): boolean {
    const managed = this.sessions.get(sessionId);
    return managed?.inManagerConversation === true;
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
    const allMessages: ConversationMessage[] = [];

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

          if (!managed.firstUserMessage) managed.firstUserMessage = text;
          allMessages.push({
            id: uuidv4(),
            role: "user",
            content: text,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          });
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

                // Track plan file path from Write/Edit in history for resume plan recovery
                if (block.name === "Write" || block.name === "Edit") {
                  const fp = block.input?.file_path;
                  if (typeof fp === "string" && this.isPlanFilePath(fp)) {
                    managed.planFilePath = fp;
                  }
                }
              }
            }
            text = parts.join("\n");
          }
          if (!text.trim()) continue;

          allMessages.push({
            id: uuidv4(),
            role: "assistant",
            content: text,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          });
        }
      } catch { /* skip invalid lines */ }
    }

    // Only keep and emit the most recent messages
    const recent = allMessages.slice(-MAX_RECENT_MESSAGES);
    managed.messages = recent;
    for (const m of recent) {
      this.emit("session:message", managed.session.id, m);
    }
  }

  private trimMessages(managed: ManagedSession): void {
    if (managed.messages.length > MAX_RECENT_MESSAGES) {
      managed.messages = managed.messages.slice(-MAX_RECENT_MESSAGES);
    }
  }

  /**
   * Load older messages from .jsonl history for pagination.
   * Returns messages with timestamp < `before`, up to `limit` items (newest first within the batch).
   */
  async loadMessageHistory(sessionId: string, before: number, limit = 20): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return { messages: [], hasMore: false };

    const allMessages = await this.parseFullHistory(managed);
    // Filter messages older than `before`
    const older = allMessages.filter((m) => m.timestamp < before);
    const hasMore = older.length > limit;
    // Return the most recent `limit` messages from the older set
    const page = older.slice(-limit);
    return { messages: page, hasMore };
  }

  /**
   * Parse the full .jsonl history without storing it in memory.
   * Returns all ConversationMessages from the session's history file.
   */
  private async parseFullHistory(managed: ManagedSession): Promise<ConversationMessage[]> {
    const claudeSessionId = managed.session.claudeSessionId;
    const messages: ConversationMessage[] = [];

    const content = managed.machine.type === "local"
      ? await this.readLocalJsonl(claudeSessionId)
      : await this.readRemoteJsonl(managed.machine, claudeSessionId);

    if (!content) return messages;

    const lines = content.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);

        if (msg.type === "user" && msg.message?.content) {
          const c = msg.message.content;
          const text = typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")
              : "";
          if (!text) continue;
          messages.push({
            id: uuidv4(),
            role: "user",
            content: text,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          });
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
          messages.push({
            id: uuidv4(),
            role: "assistant",
            content: text,
            timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          });
        }
      } catch { /* skip invalid lines */ }
    }

    return messages;
  }

  private async readLocalJsonl(claudeSessionId: string): Promise<string | null> {
    const claudeDir = join(homedir(), ".claude", "projects");
    try {
      const projects = await readdir(claudeDir);
      for (const project of projects) {
        const filePath = join(claudeDir, project, `${claudeSessionId}.jsonl`);
        try {
          return await readFile(filePath, "utf-8");
        } catch {
          // Not in this project dir, try next
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  private async readRemoteJsonl(machine: MachineConfig, claudeSessionId: string): Promise<string | null> {
    const script = `python3 -c "
import os, glob
home = os.path.expanduser('~')
pattern = os.path.join(home, '.claude', 'projects', '*', '${claudeSessionId}.jsonl')
files = glob.glob(pattern)
if files:
    with open(files[0]) as f:
        print(f.read())
"`;
    try {
      const channel = await this.sshManager.execFresh(machine, script);
      return await new Promise<string>((resolve) => {
        let out = "";
        channel.on("data", (data: Buffer) => { out += data.toString(); });
        channel.on("close", () => resolve(out || ""));
      });
    } catch { return null; }
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

          // Detect worktree name from RAW project dir name
          // Claude encodes paths: "/" → "-" and "." → "-"
          // e.g. "/repo/.claude/worktrees/amazing-khayyam" → "-repo--claude-worktrees-amazing-khayyam"
          // Pattern: "--claude-worktrees-" (double dash from "/.claude/")
          let worktreeName: string | undefined;
          const wtMatch = project.match(/-claude-worktrees-(.+)$/);
          if (wtMatch) worktreeName = wtMatch[1];

          results.push({
            sessionId,
            project: projectPath,
            lastActivity: fileStat.mtimeMs,
            messageCount,
            summary,
            worktreeName,
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
                wt_match = re.search(r"-claude-worktrees-(.+)$", proj)
                wt_name = wt_match.group(1) if wt_match else ""
                print(f"SESSION|{sid}|{proj}|{cwd}|{mtime}|{size_kb}|{wt_name}|{summary}")
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
            // Format: SESSION|sid|proj|cwd|mtime|sizeKb|wtName|summary
            const [, sessionId, projDir, cwd, mtime, sizeKb, wtName, ...summaryParts] = line.split("|");
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
              worktreeName: wtName || undefined,
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

  // ── Session-local config (.claude/settings.local.json + .claude/CLAUDE.md) ──

  async readSessionConfig(sessionId: string): Promise<{ settings: string; claudemd: string }> {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`Session ${sessionId} not found`);

    const rawWorkDir = managed.session.workDir;
    const machine = managed.machine;
    // Expand ~ to home directory for local filesystem operations
    const workDir = rawWorkDir.startsWith("~")
      ? rawWorkDir.replace(/^~/, homedir())
      : rawWorkDir;

    if (machine.type === "local") {
      // Local: read from filesystem directly
      let settings = "{}";
      let claudemd = "";
      try {
        settings = await readFile(join(workDir, ".claude", "settings.local.json"), "utf-8");
      } catch { /* file may not exist */ }
      try {
        claudemd = await readFile(join(workDir, ".claude", "CLAUDE.md"), "utf-8");
      } catch { /* file may not exist */ }
      return { settings, claudemd };
    } else {
      // SSH: use execFresh to avoid hanging on connections with forwardIn
      const readCmd = (filePath: string, fallback: string) =>
        `cat "${filePath}" 2>/dev/null || echo '${fallback}'`;

      const settingsPath = `${workDir}/.claude/settings.local.json`;
      const claudemdPath = `${workDir}/.claude/CLAUDE.md`;

      const [settings, claudemd] = await Promise.all([
        this.execRemoteRead(machine, readCmd(settingsPath, "{}")),
        this.execRemoteRead(machine, readCmd(claudemdPath, "")),
      ]);

      return { settings, claudemd };
    }
  }

  async writeSessionConfig(sessionId: string, file: "settings" | "claudemd", content: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`Session ${sessionId} not found`);

    const rawWorkDir = managed.session.workDir;
    const machine = managed.machine;
    // Expand ~ to home directory for local filesystem operations
    const workDir = rawWorkDir.startsWith("~")
      ? rawWorkDir.replace(/^~/, homedir())
      : rawWorkDir;
    const dirPath = `${workDir}/.claude`;
    const fileName = file === "settings" ? "settings.local.json" : "CLAUDE.md";

    if (file === "settings") {
      // Validate JSON before writing
      JSON.parse(content);
    }

    if (machine.type === "local") {
      const { mkdir: mkdirFs } = await import("fs/promises");
      await mkdirFs(join(workDir, ".claude"), { recursive: true });
      await writeFile(join(workDir, ".claude", fileName), content, "utf-8");
    } else {
      // SSH: use execFresh to write (avoids SFTP hanging on connections with forwardIn)
      const filePath = `${dirPath}/${fileName}`;
      const escaped = content.replace(/'/g, "'\\''");
      const writeCmd = `mkdir -p "${dirPath}" && printf '%s' '${escaped}' > "${filePath}"`;
      const writeCh = await this.sshManager.execFresh(machine, writeCmd);
      await new Promise<void>((resolve, reject) => {
        let stderr = "";
        writeCh.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
        writeCh.on("close", (code: number | null) => {
          if (code !== 0) {
            reject(new Error(`Remote write failed (code ${code}): ${stderr}`));
          } else {
            resolve();
          }
        });
        writeCh.on("error", (err: Error) => reject(err));
      });
    }
  }

  private async execRemoteRead(machine: MachineConfig, command: string): Promise<string> {
    const channel = await this.sshManager.execFresh(machine, command);
    return new Promise((resolve) => {
      let out = "";
      channel.on("data", (data: Buffer) => { out += data.toString(); });
      channel.on("close", () => resolve(out));
      channel.on("error", () => resolve(""));
    });
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
