import type { WebSocket } from "ws";
import type { IncomingMessage, ServerResponse } from "http";
import { SessionManager } from "./session-manager";
import { ProjectStore } from "./project-store";
import { ProjectManager } from "./project-manager";
import { loadSSHHosts } from "./ssh-config-loader";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { MachineConfig, PermissionMode, PermissionRequest } from "../shared/types";
import type { ClientMessage, ServerMessage } from "../shared/protocol";

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
  rb: "ruby", php: "php", swift: "swift", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  xml: "xml", html: "html", css: "css", scss: "scss", less: "less",
  md: "markdown", mdx: "markdown", sql: "sql",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  dockerfile: "docker", makefile: "makefile",
  graphql: "graphql", gql: "graphql", prisma: "prisma",
  env: "bash", ini: "ini", conf: "ini", cfg: "ini",
};

function extToLanguage(ext: string): string {
  return EXT_LANG_MAP[ext] || "text";
}

export class WebSocketHandler {
  private sessionManager: SessionManager;
  private projectStore: ProjectStore;
  private projectManager: ProjectManager;
  private clients = new Set<WebSocket>();
  private machines: MachineConfig[] = [];

  constructor(port = 3000) {
    this.sessionManager = new SessionManager(port);
    this.projectStore = new ProjectStore();
    this.projectManager = new ProjectManager(this.projectStore, this.sessionManager);
    this.setupSessionEvents();
  }

  async initialize() {
    // Load machines from machines.json
    try {
      const machinesPath = join(process.cwd(), "machines.json");
      const content = await readFile(machinesPath, "utf-8");
      const config = JSON.parse(content);
      this.machines = config.machines || [];
    } catch {
      console.warn("Could not load machines.json, using defaults");
      this.machines = [{
        id: "local",
        name: "Local Machine",
        type: "local",
        defaultWorkDir: "~",
      }];
    }

    // Load SSH hosts from ~/.ssh/config
    try {
      const sshHosts = await loadSSHHosts();
      this.machines.push(...sshHosts);
    } catch {
      console.warn("Could not load SSH config");
    }

    console.log(`[WS] Loaded ${this.machines.length} machines`);

    // Initialize project store (load from disk)
    await this.projectManager.initialize();
  }

  handleConnection(ws: WebSocket) {
    this.clients.add(ws);
    console.log(`[WS] Client connected (total: ${this.clients.size})`);

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        await this.handleMessage(ws, msg);
      } catch (err) {
        this.send(ws, { type: "error", error: (err as Error).message });
      }
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      console.log(`[WS] Client disconnected (total: ${this.clients.size})`);
    });

    ws.on("error", (err) => {
      console.error("[WS] Client error:", err.message);
      this.clients.delete(ws);
    });
  }

  /**
   * HTTP handler for /api/permission — called by the MCP permission server.
   * Blocks until the user responds in the web UI.
   */
  async handlePermissionHTTP(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Parse JSON body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }

    let body: { sessionId?: string; toolName?: string; input?: Record<string, unknown> };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ behavior: "deny", message: "Invalid JSON" }));
      return;
    }

    const { sessionId, toolName, input } = body;
    if (!sessionId || !toolName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ behavior: "deny", message: "Missing sessionId or toolName" }));
      return;
    }

    console.log(`[Permission] Request for ${toolName} in session ${sessionId}`);

    try {
      // This blocks until the user responds or the session is terminated
      const result = await this.sessionManager.handlePermissionRequest(
        sessionId,
        toolName,
        input || {},
      );

      console.log(`[Permission] Response for ${toolName}: ${result.behavior}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ behavior: "deny", message: (err as Error).message }));
    }
  }

  private async handleMessage(ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case "session.create": {
        const machine = this.machines.find((m) => m.id === msg.machineId);
        if (!machine) {
          this.send(ws, { type: "error", error: `Machine ${msg.machineId} not found` });
          return;
        }
        try {
          const session = await this.sessionManager.createSession(machine, msg.workDir, msg.resumeSessionId, msg.permissionMode, msg.worktree);
          this.send(ws, { type: "session.created", session });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "session.discover": {
        const discoverMachine = this.machines.find((m) => m.id === msg.machineId);
        if (!discoverMachine) {
          this.send(ws, { type: "error", error: `Machine ${msg.machineId} not found` });
          return;
        }
        try {
          const discovered = await this.sessionManager.discoverSessions(discoverMachine, msg.workDir);
          this.send(ws, { type: "session.discovered", machineId: msg.machineId, sessions: discovered });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "session.prompt": {
        try {
          await this.sessionManager.sendPrompt(msg.sessionId, msg.prompt);
        } catch (err) {
          this.send(ws, {
            type: "session.error",
            sessionId: msg.sessionId,
            error: (err as Error).message,
          });
        }
        break;
      }

      case "session.interrupt": {
        this.sessionManager.interruptSession(msg.sessionId);
        break;
      }

      case "session.terminate": {
        this.sessionManager.terminateSession(msg.sessionId);
        this.broadcast({ type: "session.terminated", sessionId: msg.sessionId });
        break;
      }

      case "session.list": {
        const sessions = this.sessionManager.getAllSessions();
        this.send(ws, { type: "session.list", sessions });
        break;
      }

      case "machines.list": {
        this.send(ws, { type: "machines.list", machines: this.machines });
        break;
      }

      case "session.permissionResponse": {
        this.sessionManager.resolvePermission(msg.requestId, msg.allow, msg.answers, msg.message);
        break;
      }

      case "session.setPermissionMode": {
        this.sessionManager.setPermissionMode(msg.sessionId, msg.mode);
        break;
      }

      case "session.setProject": {
        // When unlinking (projectId=null), also clear the task side
        if (!msg.projectId) {
          for (const project of this.projectManager.getAllProjects()) {
            const tasks = this.projectManager.getProjectTasks(project.id);
            const linkedTask = tasks.find((t) => t.sessionId === msg.sessionId);
            if (linkedTask) {
              // Clear all session references so task shows "No session linked"
              this.projectManager.unlinkTaskSession(project.id, linkedTask.id)
                .then((updatedTask) => {
                  this.broadcast({ type: "task.updated", task: updatedTask });
                })
                .catch((err) => {
                  console.error(`[WsHandler] Failed to unlink task ${linkedTask.id} from session:`, err);
                });
              break;
            }
          }
        }
        this.sessionManager.setSessionProject(msg.sessionId, msg.projectId);
        break;
      }

      case "config.read": {
        try {
          const claudeDir = join(homedir(), ".claude");
          let settings = "";
          let claudemd = "";
          try {
            settings = await readFile(join(claudeDir, "settings.json"), "utf-8");
          } catch {
            settings = "{}";
          }
          try {
            claudemd = await readFile(join(claudeDir, "CLAUDE.md"), "utf-8");
          } catch {
            claudemd = "";
          }
          this.send(ws, { type: "config.data", settings, claudemd });
        } catch (err) {
          this.send(ws, { type: "config.error", error: (err as Error).message });
        }
        break;
      }

      case "session.config.read": {
        try {
          const config = await this.sessionManager.readSessionConfig(msg.sessionId);
          this.send(ws, {
            type: "session.config.data",
            sessionId: msg.sessionId,
            settings: config.settings,
            claudemd: config.claudemd,
          });
        } catch (err) {
          this.send(ws, {
            type: "session.config.error",
            sessionId: msg.sessionId,
            error: (err as Error).message,
          });
        }
        break;
      }

      case "session.config.write": {
        try {
          await this.sessionManager.writeSessionConfig(msg.sessionId, msg.file, msg.content);
          this.send(ws, {
            type: "session.config.saved",
            sessionId: msg.sessionId,
            file: msg.file,
          });
        } catch (err) {
          this.send(ws, {
            type: "session.config.error",
            sessionId: msg.sessionId,
            error: (err as Error).message,
          });
        }
        break;
      }

      case "path.list": {
        const pathMachine = this.machines.find((m) => m.id === msg.machineId);
        if (!pathMachine) {
          this.send(ws, {
            type: "path.list",
            machineId: msg.machineId,
            requestId: msg.requestId,
            entries: [],
            resolvedPath: msg.path,
            error: `Machine ${msg.machineId} not found`,
          });
          return;
        }
        try {
          const result = await this.sessionManager.listDirectory(pathMachine, msg.path);
          this.send(ws, {
            type: "path.list",
            machineId: msg.machineId,
            requestId: msg.requestId,
            ...result,
          });
        } catch (err) {
          this.send(ws, {
            type: "path.list",
            machineId: msg.machineId,
            requestId: msg.requestId,
            entries: [],
            resolvedPath: msg.path,
            error: (err as Error).message,
          });
        }
        break;
      }

      case "path.mkdir": {
        const mkdirMachine = this.machines.find((m) => m.id === msg.machineId);
        if (!mkdirMachine) {
          this.send(ws, {
            type: "path.mkdir",
            requestId: msg.requestId,
            success: false,
            resolvedPath: msg.path,
            error: `Machine ${msg.machineId} not found`,
          });
          return;
        }
        try {
          const result = await this.sessionManager.createDirectory(mkdirMachine, msg.path);
          this.send(ws, {
            type: "path.mkdir",
            requestId: msg.requestId,
            ...result,
          });
        } catch (err) {
          this.send(ws, {
            type: "path.mkdir",
            requestId: msg.requestId,
            success: false,
            resolvedPath: msg.path,
            error: (err as Error).message,
          });
        }
        break;
      }

      case "file.read": {
        const frMachine = this.machines.find((m) => m.id === msg.machineId);
        if (!frMachine) {
          this.send(ws, {
            type: "file.read",
            requestId: msg.requestId,
            content: "",
            language: "text",
            filePath: msg.filePath,
            truncated: false,
            error: `Machine ${msg.machineId} not found`,
          });
          return;
        }
        try {
          const result = await this.sessionManager.readFileContent(frMachine, msg.filePath, msg.maxLines);
          const ext = msg.filePath.split(".").pop()?.toLowerCase() || "";
          const language = extToLanguage(ext);
          this.send(ws, {
            type: "file.read",
            requestId: msg.requestId,
            filePath: msg.filePath,
            language,
            content: result.content,
            truncated: result.truncated,
            totalLines: result.totalLines,
            error: result.error,
          });
        } catch (err) {
          this.send(ws, {
            type: "file.read",
            requestId: msg.requestId,
            content: "",
            language: "text",
            filePath: msg.filePath,
            truncated: false,
            error: (err as Error).message,
          });
        }
        break;
      }

      case "worktrees.list": {
        const wtMachine = this.machines.find((m) => m.id === msg.machineId);
        if (!wtMachine) {
          this.send(ws, { type: "error", error: `Machine ${msg.machineId} not found` });
          return;
        }
        try {
          const worktrees = wtMachine.type === "local"
            ? await this.sessionManager.listLocalWorktrees(msg.workDir)
            : await this.sessionManager.listRemoteWorktrees(wtMachine, msg.workDir);
          this.send(ws, { type: "worktrees.list", machineId: msg.machineId, worktrees });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "config.write": {
        try {
          const claudeDir = join(homedir(), ".claude");
          await mkdir(claudeDir, { recursive: true });
          if (msg.file === "settings") {
            // Validate JSON before writing
            JSON.parse(msg.content);
            await writeFile(join(claudeDir, "settings.json"), msg.content, "utf-8");
          } else {
            await writeFile(join(claudeDir, "CLAUDE.md"), msg.content, "utf-8");
          }
          this.send(ws, { type: "config.saved", file: msg.file });
        } catch (err) {
          this.send(ws, { type: "config.error", error: (err as Error).message });
        }
        break;
      }

      // ── Project CRUD ──

      case "project.create": {
        try {
          const project = await this.projectManager.createProject(
            msg.name, msg.machineId, msg.workDir, msg.permissionMode
          );
          this.broadcast({ type: "project.created", project });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "project.update": {
        try {
          const project = await this.projectManager.updateProject(msg.projectId, msg.updates);
          this.broadcast({ type: "project.updated", project });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "project.delete": {
        try {
          await this.projectManager.deleteProject(msg.projectId);
          this.broadcast({ type: "project.deleted", projectId: msg.projectId });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "project.list": {
        const projects = this.projectManager.getAllProjects();
        this.send(ws, { type: "project.list", projects });
        break;
      }

      // ── Task CRUD ──

      case "task.create": {
        try {
          const task = await this.projectManager.createTask(msg.projectId, msg.title, msg.description);
          this.broadcast({ type: "task.created", task });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "task.update": {
        try {
          const task = await this.projectManager.updateTask(msg.projectId, msg.taskId, msg.updates);
          this.broadcast({ type: "task.updated", task });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "task.delete": {
        try {
          await this.projectManager.deleteTask(msg.projectId, msg.taskId);
          this.broadcast({ type: "task.deleted", projectId: msg.projectId, taskId: msg.taskId });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "task.move": {
        try {
          const task = await this.projectManager.moveTask(msg.projectId, msg.taskId, msg.column, msg.order);
          this.broadcast({ type: "task.moved", task });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "task.reorder": {
        try {
          await this.projectManager.reorderTasks(msg.projectId, msg.column, msg.taskIds);
          this.broadcast({ type: "task.reordered", projectId: msg.projectId, column: msg.column, taskIds: msg.taskIds });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "task.list": {
        const tasks = this.projectManager.getProjectTasks(msg.projectId);
        this.send(ws, { type: "task.list", projectId: msg.projectId, tasks });
        break;
      }

      case "task.submit": {
        try {
          const submitMachine = this.machines.find((m) => {
            const project = this.projectManager.getProject(msg.projectId);
            return project && m.id === project.machineId;
          });
          if (!submitMachine) {
            this.send(ws, { type: "error", error: "Machine not found for project" });
            return;
          }
          const { task, session } = await this.projectManager.submitTask(msg.projectId, msg.taskId, submitMachine);
          this.broadcast({ type: "task.submitted", task, session });
          this.broadcast({ type: "session.created", session });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "task.resume": {
        try {
          const taskForResume = this.projectManager.getProjectTasks(msg.projectId)
            .find((t) => t.id === msg.taskId);
          const project = this.projectManager.getProject(msg.projectId);
          const machineId = taskForResume?.lastMachineId || project?.machineId;
          const resumeMachine = this.machines.find((m) => m.id === machineId);
          if (!resumeMachine) {
            this.send(ws, { type: "error", error: "Machine not found for resume" });
            return;
          }
          const { task, session } = await this.projectManager.resumeTask(msg.projectId, msg.taskId, resumeMachine);
          this.broadcast({ type: "task.resumed", task, session });
          this.broadcast({ type: "session.created", session });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "task.importSession": {
        try {
          const { task, session } = await this.projectManager.importSessionAsTask(
            msg.projectId, msg.sessionId, msg.title
          );
          this.broadcast({ type: "task.sessionImported", task, session });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "session.history": {
        try {
          const { messages, hasMore } = await this.sessionManager.loadMessageHistory(
            msg.sessionId, msg.before, msg.limit
          );
          this.send(ws, { type: "session.history", sessionId: msg.sessionId, messages, hasMore });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "task.linkSession": {
        try {
          const { task, session } = await this.projectManager.linkSessionToTask(
            msg.projectId, msg.taskId, msg.sessionId
          );
          this.broadcast({ type: "task.sessionLinked", task, session });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }
    }
  }

  private setupSessionEvents() {
    this.sessionManager.on("session:stream", (sessionId: string, delta: string) => {
      this.broadcast({ type: "session.stream", sessionId, delta });
    });

    this.sessionManager.on("session:message", (sessionId: string, message: import("../shared/types").ConversationMessage) => {
      this.broadcast({ type: "session.message", sessionId, message });
    });

    this.sessionManager.on("session:status", (sessionId: string, status: string, error?: string, totalCostUsd?: number) => {
      this.broadcast({
        type: "session.status",
        sessionId,
        status: status as import("../shared/types").Session["status"],
        totalCostUsd,
        error,
      });

      // Auto-move task to "in-review" when linked session completes
      if (status === "idle" && !error) {
        const updatedTask = this.projectManager.handleSessionCompleted(sessionId);
        if (updatedTask) {
          this.broadcast({ type: "task.sessionCompleted", task: updatedTask });
        }
      }
    });

    this.sessionManager.on("session:permissionRequest", (sessionId: string, request: PermissionRequest) => {
      this.broadcast({ type: "session.permissionRequest", sessionId, request });
    });

    this.sessionManager.on("session:permissionModeChanged", (sessionId: string, mode: PermissionMode) => {
      this.broadcast({ type: "session.permissionModeChanged", sessionId, mode });
    });

    this.sessionManager.on("session:planContent", (sessionId: string, content: string, filePath: string) => {
      this.broadcast({ type: "session.planContent", sessionId, content, filePath });
    });

    this.sessionManager.on("session:projectChanged", (sessionId: string, projectId: string | null) => {
      this.broadcast({ type: "session.projectChanged", sessionId, projectId });
    });

    this.sessionManager.on("session:displayName", (sessionId: string, name: string) => {
      this.broadcast({ type: "session.displayName", sessionId, name });
    });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  }

  shutdown() {
    this.sessionManager.shutdown();
    for (const client of this.clients) {
      client.close();
    }
  }
}
