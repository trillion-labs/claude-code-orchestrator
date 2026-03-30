#!/usr/bin/env node
// MCP server for project notes.
// Exposes note read/write tools so Claude worker sessions can
// access project notes (plans, research, decisions, etc.).
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
        serverInfo: { name: "note-server", version: "1.0.0" },
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
