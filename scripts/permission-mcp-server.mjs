#!/usr/bin/env node
// Minimal MCP server for interactive permission handling.
// Claude Code calls this via --permission-prompt-tool.
// It forwards permission requests to the orchestrator via HTTP
// and blocks until the user responds in the web UI.

import { createInterface } from "readline";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:3000";
const SESSION_ID = process.env.SESSION_ID || "";

const rl = createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (!msg.method) return;

  switch (msg.method) {
    case "initialize":
      respond(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "permission-server", version: "1.0.0" },
      });
      break;

    case "notifications/initialized":
      // No response needed for notifications
      break;

    case "tools/list":
      respond(msg.id, {
        tools: [
          {
            name: "check_permission",
            description: "Check whether the user approves a tool use",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: { type: "string", description: "The tool being requested" },
                input: { type: "object", description: "The tool input parameters" },
              },
              required: ["tool_name", "input"],
            },
          },
        ],
      });
      break;

    case "tools/call": {
      const { name, arguments: args } = msg.params;
      if (name !== "check_permission") {
        respond(msg.id, {
          content: [{ type: "text", text: JSON.stringify({ behavior: "deny", message: `Unknown tool: ${name}` }) }],
          isError: true,
        });
        break;
      }

      try {
        const result = await checkPermission(args.tool_name, args.input);
        respond(msg.id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
        });
      } catch (err) {
        respond(msg.id, {
          content: [{ type: "text", text: JSON.stringify({ behavior: "deny", message: err.message }) }],
        });
      }
      break;
    }
  }
});

async function checkPermission(toolName, input) {
  const controller = new AbortController();
  // 5 minute timeout for user to respond
  const timeout = setTimeout(() => controller.abort(), 300_000);

  try {
    const resp = await fetch(`${ORCHESTRATOR_URL}/api/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID, toolName, input }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      return { behavior: "deny", message: `Orchestrator returned HTTP ${resp.status}` };
    }

    return await resp.json();
  } catch (err) {
    if (err.name === "AbortError") {
      return { behavior: "deny", message: "Permission request timed out (5 min)" };
    }
    return { behavior: "deny", message: err.message };
  } finally {
    clearTimeout(timeout);
  }
}
