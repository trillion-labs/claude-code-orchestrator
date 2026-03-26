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
import { buildOrchestratorPrompt } from "./orchestrator-prompt";

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
  private baseMachines: MachineConfig[] = [];
  private machines: MachineConfig[] = [];

  constructor(port = 3000) {
    this.sessionManager = new SessionManager(port);
    this.projectStore = new ProjectStore();
    this.projectManager = new ProjectManager(this.projectStore, this.sessionManager);
    this.setupSessionEvents();
  }

  async initialize() {
    // Load machines from machines.json (static, cached once)
    try {
      const machinesPath = join(process.cwd(), "machines.json");
      const content = await readFile(machinesPath, "utf-8");
      const config = JSON.parse(content);
      this.baseMachines = config.machines || [];
    } catch {
      console.warn("Could not load machines.json, using defaults");
      this.baseMachines = [{
        id: "local",
        name: "Local Machine",
        type: "local",
        defaultWorkDir: "~",
      }];
    }

    // Initial load of all machines (base + SSH)
    await this.reloadMachines();

    // Initialize project store (load from disk)
    await this.projectManager.initialize();
  }

  /** Reload SSH hosts from ~/.ssh/config and merge with base machines */
  private async reloadMachines() {
    let sshHosts: MachineConfig[] = [];
    try {
      sshHosts = await loadSSHHosts();
    } catch {
      console.warn("Could not load SSH config");
    }
    this.machines = [...this.baseMachines, ...sshHosts];
    console.log(`[WS] Loaded ${this.machines.length} machines (${this.baseMachines.length} base + ${sshHosts.length} SSH)`);
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

  /**
   * HTTP handler for /api/show-user — called by the MCP server.
   * Fire-and-forget: returns immediately after broadcasting content.
   */
  async handleShowUserHTTP(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }

    let body: { sessionId?: string; title?: string; html?: string };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { sessionId, title, html } = body;
    if (!sessionId || !html) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing sessionId or html" }));
      return;
    }

    console.log(`[ShowUser] Content for session ${sessionId}: "${title || "Preview"}"`);

    this.sessionManager.handleShowUser(sessionId, title || "Preview", html);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  }

  /**
   * HTTP handler for /api/orchestrator — called by the orchestrator MCP server.
   * Dispatches task management tool calls to ProjectManager.
   */
  async handleOrchestratorHTTP(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }

    let body: { sessionId?: string; projectId?: string; tool?: string; args?: Record<string, unknown> };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { sessionId, projectId, tool, args } = body;
    if (!sessionId || !projectId || !tool) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing sessionId, projectId, or tool" }));
      return;
    }

    console.log(`[Orchestrator] Tool call: ${tool} for project ${projectId}`);

    try {
      const result = await this.handleOrchestratorTool(projectId, tool, args || {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error(`[Orchestrator] Tool error:`, (err as Error).message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  private async handleOrchestratorTool(
    projectId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (tool) {
      case "list_tasks": {
        const tasks = this.projectManager.getProjectTasks(projectId);
        const column = args.column as string | undefined;
        const filtered = column ? tasks.filter((t) => t.column === column) : tasks;
        return { tasks: filtered.map((t) => ({ id: t.id, title: t.title, column: t.column, order: t.order })) };
      }

      case "get_tasks": {
        const taskIds = args.taskIds as string[];
        const allTasks = this.projectManager.getProjectTasks(projectId);
        const found = taskIds
          .map((id) => allTasks.find((t) => t.id === id))
          .filter(Boolean)
          .map((t) => ({ id: t!.id, title: t!.title, description: t!.description, column: t!.column, order: t!.order }));
        return { tasks: found };
      }

      case "create_task": {
        const task = await this.projectManager.createTask(
          projectId,
          args.title as string,
          args.description as string,
        );
        this.broadcast({ type: "task.created", task });
        return { task: { id: task.id, title: task.title, column: task.column } };
      }

      case "create_tasks": {
        const taskInputs = args.tasks as Array<{ title: string; description: string }>;
        const created = [];
        for (const input of taskInputs) {
          const task = await this.projectManager.createTask(projectId, input.title, input.description);
          this.broadcast({ type: "task.created", task });
          created.push({ id: task.id, title: task.title, column: task.column });
        }
        return { tasks: created };
      }

      case "update_task": {
        const updates: { title?: string; description?: string } = {};
        if (args.title) updates.title = args.title as string;
        if (args.description) updates.description = args.description as string;
        const task = await this.projectManager.updateTask(projectId, args.taskId as string, updates);
        this.broadcast({ type: "task.updated", task });
        return { task: { id: task.id, title: task.title, column: task.column } };
      }

      case "move_task": {
        const task = await this.projectManager.moveTask(
          projectId,
          args.taskId as string,
          args.column as import("../shared/types").KanbanColumn,
          0,
        );
        this.broadcast({ type: "task.moved", task });
        return { task: { id: task.id, title: task.title, column: task.column } };
      }

      case "delete_task": {
        await this.projectManager.deleteTask(projectId, args.taskId as string);
        this.broadcast({ type: "task.deleted", projectId, taskId: args.taskId as string });
        return { success: true };
      }

      case "submit_task": {
        const project = this.projectManager.getProject(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);
        const submitMachine = this.machines.find((m) => m.id === project.machineId);
        if (!submitMachine) throw new Error("Machine not found for project");
        const { task, session } = await this.projectManager.submitTask(projectId, args.taskId as string, submitMachine);
        this.broadcast({ type: "task.submitted", task, session });
        this.broadcast({ type: "session.created", session });
        return { task: { id: task.id, title: task.title, column: task.column }, session: { id: session.id, status: session.status } };
      }

      case "get_project_info": {
        const project = this.projectManager.getProject(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);
        const machine = this.machines.find((m) => m.id === project.machineId);
        return {
          project: {
            id: project.id,
            name: project.name,
            workDir: project.workDir,
            machineName: machine?.name || "Unknown",
            permissionMode: project.permissionMode,
          },
        };
      }

      default:
        throw new Error(`Unknown orchestrator tool: ${tool}`);
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

      case "session.dequeue": {
        this.sessionManager.dequeuePrompt(msg.sessionId, msg.index);
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
        // Re-send recent messages and explicit display names so reconnecting
        // clients restore session history and names without a full reload.
        for (const session of sessions) {
          const explicitName = this.sessionManager.getExplicitSessionName(session.id);
          if (explicitName) {
            this.send(ws, { type: "session.displayName", sessionId: session.id, name: explicitName });
          }
          const messages = this.sessionManager.getSessionMessages(session.id);
          if (messages.length > 0) {
            this.send(ws, {
              type: "session.history",
              sessionId: session.id,
              messages,
              hasMore: messages.length >= 20,
            });
          }
        }
        break;
      }

      case "machines.list": {
        await this.reloadMachines();
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

      case "orchestrator.create": {
        try {
          const project = this.projectManager.getProject(msg.projectId);
          if (!project) {
            this.send(ws, { type: "error", error: `Project ${msg.projectId} not found` });
            return;
          }
          if (project.orchestratorSessionId) {
            // Already has an orchestrator — check if it's still alive
            const existing = this.sessionManager.getSession(project.orchestratorSessionId);
            if (existing && existing.status !== "terminated" && existing.status !== "error") {
              this.send(ws, { type: "orchestrator.created", projectId: project.id, session: existing });
              return;
            }
          }
          const machine = this.machines.find((m) => m.id === project.machineId);
          if (!machine) {
            this.send(ws, { type: "error", error: "Machine not found for project" });
            return;
          }

          // Build system prompt (board state is fetched via list_tasks tool, not embedded)
          const systemPrompt = buildOrchestratorPrompt(project);

          // Resume previous orchestrator session if available
          const resumeId = project.orchestratorClaudeSessionId || undefined;

          const session = await this.sessionManager.createSession(
            machine,
            project.workDir,
            resumeId,
            project.permissionMode,
            undefined, // no worktree
            project.id,
            undefined, // no taskId
            { isOrchestrator: true, orchestratorProjectId: project.id, systemPrompt },
          );

          this.sessionManager.setSessionDisplayName(session.id, `Manager: ${project.name}`);

          // Store orchestrator session on project (including claudeSessionId for future resume)
          await this.projectManager.setOrchestratorSession(project.id, session.id, session.claudeSessionId);

          this.broadcast({ type: "session.created", session });
          this.broadcast({ type: "orchestrator.created", projectId: project.id, session });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "orchestrator.prompt": {
        try {
          const project = this.projectManager.getProject(msg.projectId);
          if (!project?.orchestratorSessionId) {
            this.send(ws, { type: "error", error: "No orchestrator session for this project" });
            return;
          }
          await this.sessionManager.sendPrompt(project.orchestratorSessionId, msg.prompt);
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      // ── Note CRUD ──

      case "note.create": {
        try {
          const now = Date.now();
          const note = {
            id: crypto.randomUUID(),
            projectId: msg.projectId,
            title: msg.title,
            content: msg.content,
            createdAt: now,
            updatedAt: now,
          };
          await this.projectStore.createNote(note);
          // Broadcast index only (without content)
          const { content: _, ...index } = note;
          this.broadcast({ type: "note.created", note: index });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "note.update": {
        try {
          await this.projectStore.updateNote(msg.projectId, msg.noteId, msg.updates);
          const index = this.projectStore.getNoteIndex(msg.projectId, msg.noteId);
          if (index) this.broadcast({ type: "note.updated", note: index });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "note.delete": {
        try {
          await this.projectStore.deleteNote(msg.projectId, msg.noteId);
          this.broadcast({ type: "note.deleted", projectId: msg.projectId, noteId: msg.noteId });
        } catch (err) {
          this.send(ws, { type: "error", error: (err as Error).message });
        }
        break;
      }

      case "note.list": {
        const notes = this.projectStore.getProjectNotes(msg.projectId);
        this.send(ws, { type: "note.list", projectId: msg.projectId, notes });
        break;
      }

      case "note.get": {
        try {
          const note = await this.projectStore.getNote(msg.projectId, msg.noteId);
          if (note) {
            this.send(ws, { type: "note.data", note });
          } else {
            this.send(ws, { type: "error", error: `Note ${msg.noteId} not found` });
          }
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

    this.sessionManager.on("session:queueUpdate", (sessionId: string, queue: string[]) => {
      this.broadcast({ type: "session.queueUpdate", sessionId, queue });
    });

    this.sessionManager.on("session:status", (sessionId: string, status: string, error?: string, totalCostUsd?: number) => {
      this.broadcast({
        type: "session.status",
        sessionId,
        status: status as import("../shared/types").Session["status"],
        totalCostUsd,
        error,
      });

      // Auto-move task back to "in-progress" when session becomes busy again
      if (status === "busy") {
        const updatedTask = this.projectManager.handleSessionBusy(sessionId);
        if (updatedTask) {
          this.broadcast({ type: "task.sessionBusy", task: updatedTask });
        }
      }

      // Auto-move task to "in-review" when linked session completes
      if (status === "idle" && !error) {
        const updatedTask = this.projectManager.handleSessionCompleted(sessionId);
        if (updatedTask) {
          this.broadcast({ type: "task.sessionCompleted", task: updatedTask });
        }
      }

      // Clean up orchestrator session reference when terminated or errored
      if (status === "error" || status === "terminated") {
        if (this.sessionManager.isOrchestratorSession(sessionId)) {
          for (const project of this.projectManager.getAllProjects()) {
            if (project.orchestratorSessionId === sessionId) {
              this.projectManager.clearOrchestratorSession(project.id).catch(() => {});
              this.broadcast({ type: "orchestrator.terminated", projectId: project.id });
              break;
            }
          }
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

    this.sessionManager.on("session:showUser", (sessionId: string, title: string, html: string) => {
      this.broadcast({ type: "session.showUser", sessionId, title, html });
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
