#!/usr/bin/env node
// MCP server for Orchestrator Manager.
// Exposes task management tools so Claude can create/manage tasks
// on the project Kanban board via natural language.
// Communicates with the orchestrator backend via HTTP.

import { createInterface } from "readline";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:3000";
const SESSION_ID = process.env.SESSION_ID || "";
const PROJECT_ID = process.env.PROJECT_ID || "";

const rl = createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

const TOOLS = [
  {
    name: "list_tasks",
    description: "List all tasks in the current project. Optionally filter by Kanban column.",
    inputSchema: {
      type: "object",
      properties: {
        column: {
          type: "string",
          enum: ["todo", "in-progress", "in-review", "done"],
          description: "Filter tasks by column. Omit to list all tasks.",
        },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a new task in the Todo column. The description should be a complete specification that another Claude session can execute independently.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, descriptive task title (under 80 chars)" },
        description: {
          type: "string",
          description: "Detailed task specification. Include: what to implement, acceptance criteria, and any relevant context. This will be sent as a prompt to a Claude worker session.",
        },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "create_tasks",
    description: "Create multiple tasks at once in the Todo column. Use this when breaking down a requirement into several tasks.",
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short, descriptive task title" },
              description: { type: "string", description: "Detailed task specification for a Claude worker session" },
            },
            required: ["title", "description"],
          },
          description: "Array of tasks to create",
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "update_task",
    description: "Update an existing task's title or description.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task ID to update" },
        title: { type: "string", description: "New title (optional)" },
        description: { type: "string", description: "New description (optional)" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "move_task",
    description: "Move a task to a different Kanban column.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task ID to move" },
        column: {
          type: "string",
          enum: ["todo", "in-progress", "in-review", "done"],
          description: "Target column",
        },
      },
      required: ["taskId", "column"],
    },
  },
  {
    name: "delete_task",
    description: "Delete a task from the board.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task ID to delete" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "submit_task",
    description: "Submit a task for execution. This creates a new Claude worker session and sends the task description as the initial prompt. The task moves to In Progress.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task ID to submit" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "get_project_info",
    description: "Get project metadata including name, working directory, machine, and permission mode.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

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
        serverInfo: { name: "orchestrator-manager", version: "1.0.0" },
      });
      break;

    case "notifications/initialized":
      break;

    case "tools/list":
      respond(msg.id, { tools: TOOLS });
      break;

    case "tools/call": {
      const { name, arguments: args } = msg.params;
      try {
        const result = await callOrchestratorAPI(name, args || {});
        respond(msg.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        respond(msg.id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        });
      }
      break;
    }
  }
});

async function callOrchestratorAPI(tool, args) {
  const resp = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      tool,
      args,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Orchestrator returned HTTP ${resp.status}: ${text}`);
  }

  return await resp.json();
}
