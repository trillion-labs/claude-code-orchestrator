import type { PermissionMode } from "../shared/types";

interface PermissionResult {
  behavior: string;
  updatedInput?: Record<string, unknown>;
  message?: string;
}

// Tools that are always read-only / safe for plan mode
const PLAN_MODE_ALLOWED_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
  "Task",
  "TaskList",
  "TaskGet",
  "TaskCreate",
  "TaskUpdate",
  "EnterPlanMode",
  // ExitPlanMode is intentionally NOT here — it goes through the UI flow
  // so the user can review the plan and approve before Claude proceeds.
  "AskUserQuestion",
]);

// Tools auto-allowed in accept-edits mode
const ACCEPT_EDITS_ALLOWED_TOOLS = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
]);

// Bash command patterns auto-allowed in accept-edits mode
const ACCEPT_EDITS_BASH_PATTERNS = [
  /^npm run\b/,
  /^npx\s/,
  /^node\s/,
];

/** Check if a Write/Edit target path is a plan file (.claude/plans/) */
function isPlanFilePath(input: Record<string, unknown>): boolean {
  const filePath = typeof input.file_path === "string" ? input.file_path : "";
  return /[/\\]\.claude[/\\]plans[/\\]/.test(filePath);
}

/**
 * Resolve a permission request based on the current permission mode.
 * Returns null if the request should go through the normal UI flow (ask user).
 */
export function resolvePermissionByMode(
  mode: PermissionMode,
  toolName: string,
  input: Record<string, unknown>,
): PermissionResult | null {
  // These tools always go through the UI flow regardless of mode:
  // - AskUserQuestion: requires user interaction (answer the question)
  // - ExitPlanMode: requires user approval before leaving plan mode
  if (toolName === "AskUserQuestion" || toolName === "ExitPlanMode") {
    return null;
  }

  switch (mode) {
    case "bypass-permissions":
      return { behavior: "allow", updatedInput: input };

    case "accept-edits": {
      // Allow read-only tools (same as plan mode)
      if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
        return { behavior: "allow", updatedInput: input };
      }
      // Allow edit/write tools
      if (ACCEPT_EDITS_ALLOWED_TOOLS.has(toolName)) {
        return { behavior: "allow", updatedInput: input };
      }
      // Allow specific bash patterns
      if (toolName === "Bash") {
        const command = typeof input.command === "string" ? input.command : "";
        if (ACCEPT_EDITS_BASH_PATTERNS.some((re) => re.test(command))) {
          return { behavior: "allow", updatedInput: input };
        }
      }
      // Everything else: ask user
      return null;
    }

    case "plan": {
      // Allow read-only / analysis tools
      if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
        return { behavior: "allow", updatedInput: input };
      }
      // Allow Write/Edit to plan files (.claude/plans/*.md)
      // Claude needs to write its plan to a file during plan mode
      if ((toolName === "Write" || toolName === "Edit") && isPlanFilePath(input)) {
        return { behavior: "allow", updatedInput: input };
      }
      // Deny everything else — triggers Claude's built-in plan mode behavior
      return { behavior: "deny", message: "Plan mode: read-only tools only" };
    }

    case "default":
      // Ask user for every tool
      return null;
  }
}
