import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { WebSocketServer } from "ws";
import { WebSocketHandler } from "./src/lib/server/ws-handler";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const app = next({ dev, hostname, port });
  await app.prepare();

  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();

  // Create WebSocket handler (pass port for MCP server config)
  const wsHandler = new WebSocketHandler(port);
  await wsHandler.initialize();

  // Create HTTP server
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url || "/", true);

    // Handle MCP permission requests from the permission server
    if (parsedUrl.pathname === "/api/permission" && req.method === "POST") {
      await wsHandler.handlePermissionHTTP(req, res);
      return;
    }

    // Handle show_user requests from the MCP server (fire-and-forget)
    if (parsedUrl.pathname === "/api/show-user" && req.method === "POST") {
      await wsHandler.handleShowUserHTTP(req, res);
      return;
    }

    handle(req, res, parsedUrl);
  });

  // Create WebSocket server on /ws path
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = parse(request.url || "/");

    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wsHandler.handleConnection(ws);
      });
    } else {
      // Let Next.js handle HMR WebSocket connections
      upgrade(request, socket, head);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    wsHandler.shutdown();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket on ws://${hostname}:${port}/ws`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
