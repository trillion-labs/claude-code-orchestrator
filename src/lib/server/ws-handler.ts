import type { WebSocket } from "ws";
import type { IncomingMessage, ServerResponse } from "http";
import { SessionManager } from "./session-manager";
import { loadSSHHosts } from "./ssh-config-loader";
import { readFile } from "fs/promises";
import { join } from "path";
import type { MachineConfig, PermissionRequest } from "../shared/types";
import type { ClientMessage, ServerMessage } from "../shared/protocol";

export class WebSocketHandler {
  private sessionManager: SessionManager;
  private clients = new Set<WebSocket>();
  private machines: MachineConfig[] = [];

  constructor(port = 3000) {
    this.sessionManager = new SessionManager(port);
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
          const session = await this.sessionManager.createSession(machine, msg.workDir, msg.resumeSessionId, msg.permissionMode);
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
        this.sessionManager.resolvePermission(msg.requestId, msg.allow);
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
    });

    this.sessionManager.on("session:permissionRequest", (sessionId: string, request: PermissionRequest) => {
      this.broadcast({ type: "session.permissionRequest", sessionId, request });
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
