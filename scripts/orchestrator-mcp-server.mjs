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
    description: "List task summaries (id, title, column, order) in the current project. Does NOT include descriptions — use get_tasks for full details. Optionally filter by Kanban column.",
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
    name: "get_tasks",
    description: "Get full details (including description) for specific tasks by their IDs. Use this after list_tasks to inspect tasks you need more context on.",
    inputSchema: {
      type: "object",
      properties: {
        taskIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of task IDs to retrieve full details for",
        },
      },
      required: ["taskIds"],
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
  // ── Manager ↔ Worker Communication ──
  {
    name: "ask_worker",
    description: "Send a message to a worker session and WAIT for its response (blocking, up to 5 min). Use for questions that need an answer before you can proceed — e.g. requesting a summary, asking for clarification. Use list_tasks to find worker sessionIds.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The worker session ID. Get this from list_tasks (sessionId field on in-progress/in-review tasks).",
        },
        message: {
          type: "string",
          description: "The message to send. E.g. 'Summarize what you implemented and any issues you encountered.'",
        },
      },
      required: ["sessionId", "message"],
    },
  },
  {
    name: "send_to_worker",
    description: "Send a message to a worker session and return immediately (non-blocking). Use for assigning follow-up work or giving instructions when you don't need to wait for the result. You'll receive a completion notification when the worker finishes.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The worker session ID. Get this from list_tasks (sessionId field on in-progress/in-review tasks).",
        },
        message: {
          type: "string",
          description: "The instruction to send. E.g. 'Also add input validation for the email field and run the tests.'",
        },
      },
      required: ["sessionId", "message"],
    },
  },
  // ── Note Tools ──
  {
    name: "list_notes",
    description: "List note summaries (id, title, createdAt, updatedAt) in the current project. Does NOT include content — use get_note for full content.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_note",
    description: "Get full note content (title + markdown content) by note ID.",
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "The note ID to retrieve" },
      },
      required: ["noteId"],
    },
  },
  {
    name: "create_note",
    description: "Create a new note in the current project. Notes are markdown documents for storing plans, research, decisions, or any project knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title" },
        content: { type: "string", description: "Note content in markdown format" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "update_note",
    description: "Update an existing note's title or content.",
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "The note ID to update" },
        title: { type: "string", description: "New title (optional)" },
        content: { type: "string", description: "New content in markdown (optional)" },
      },
      required: ["noteId"],
    },
  },
  {
    name: "delete_note",
    description: "Delete a note from the project.",
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "The note ID to delete" },
      },
      required: ["noteId"],
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
