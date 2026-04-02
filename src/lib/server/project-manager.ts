import { v4 as uuidv4 } from "uuid";
import type { ProjectStore } from "./project-store";
import type { SessionManager } from "./session-manager";
import type { Project, Task, MachineConfig, PermissionMode, ReviewMode, KanbanColumn, Session } from "../shared/types";

export class ProjectManager {
  constructor(
    private store: ProjectStore,
    private sessionManager: SessionManager,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  // ── Project CRUD ──

  async createProject(
    name: string,
    machineId: string,
    workDir: string,
    permissionMode: PermissionMode,
  ): Promise<Project> {
    const now = Date.now();
    const project: Project = {
      id: uuidv4(),
      name,
      machineId,
      workDir,
      permissionMode,
      reviewMode: "manager-tasks",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createProject(project);
    return project;
  }

  async updateProject(
    projectId: string,
    updates: { name?: string; permissionMode?: PermissionMode; reviewMode?: ReviewMode },
  ): Promise<Project> {
    await this.store.updateProject(projectId, updates);
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return project;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.store.deleteProject(projectId);
  }

  getAllProjects(): Project[] {
    return this.store.getAllProjects();
  }

  getProject(projectId: string): Project | undefined {
    return this.store.getProject(projectId);
  }

  // ── Task CRUD ──

  async createTask(
    projectId: string,
    title: string,
    description: string,
  ): Promise<Task> {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Calculate order — append to end of "todo" column
    const existingTasks = this.store.getProjectTasks(projectId);
    const todoTasks = existingTasks.filter((t) => t.column === "todo");
    const order = todoTasks.length;

    const now = Date.now();
    const task: Task = {
      id: uuidv4(),
      projectId,
      title,
      description,
      column: "todo",
      order,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.createTask(task);
    return task;
  }

  async updateTask(
    projectId: string,
    taskId: string,
    updates: { title?: string; description?: string; sessionId?: string },
  ): Promise<Task> {
    await this.store.updateTask(projectId, taskId, updates);
    const task = this.store.getTask(projectId, taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    return task;
  }

  /**
   * Fully unlink a session from a task — clears sessionId, claudeSessionId, lastMachineId.
   * Used when user deliberately unlinks a project from a SessionCard.
   */
  async unlinkTaskSession(projectId: string, taskId: string): Promise<Task> {
    await this.store.updateTask(projectId, taskId, {
      sessionId: undefined,
      claudeSessionId: undefined,
      lastMachineId: undefined,
    });
    const task = this.store.getTask(projectId, taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    return task;
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.store.deleteTask(projectId, taskId);
  }

  async moveTask(
    projectId: string,
    taskId: string,
    column: KanbanColumn,
    order: number,
  ): Promise<Task> {
    await this.store.moveTask(projectId, taskId, column, order);
    const task = this.store.getTask(projectId, taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    return task;
  }

  async reorderTasks(
    projectId: string,
    column: KanbanColumn,
    taskIds: string[],
  ): Promise<void> {
    await this.store.reorderTasks(projectId, column, taskIds);
  }

  getProjectTasks(projectId: string): Task[] {
    return this.store.getProjectTasks(projectId);
  }

  // ── Task Submission (핵심 로직) ──

  async submitTask(
    projectId: string,
    taskId: string,
    machine: MachineConfig,
    submittedBy: "manager" | "user" = "user",
  ): Promise<{ task: Task; session: Session }> {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const task = this.store.getTask(projectId, taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.column !== "todo") {
      throw new Error("Can only submit tasks from the Todo column");
    }

    // Create session through SessionManager
    const session = await this.sessionManager.createSession(
      machine,
      project.workDir,
      undefined, // no resume
      project.permissionMode,
      undefined, // worktree options (could add later)
      project.id,
      task.id,
    );

    // Set session display name to task title
    this.sessionManager.setSessionDisplayName(session.id, task.title);

    // Move task to in-progress and link session
    await this.store.updateTask(projectId, taskId, {
      column: "in-progress",
      order: 0,
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      lastMachineId: machine.id,
      submittedBy,
    });

    // Wait for session to be idle, then send the task description as prompt
    this.waitForIdleAndSendPrompt(session.id, task.description);

    const updatedTask = this.store.getTask(projectId, taskId)!;
    return { task: updatedTask, session };
  }

  async resumeTask(
    projectId: string,
    taskId: string,
    machine: MachineConfig,
  ): Promise<{ task: Task; session: Session }> {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const task = this.store.getTask(projectId, taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (!task.claudeSessionId) {
      throw new Error("Task has no claudeSessionId — cannot resume");
    }
    if (task.column === "todo") {
      throw new Error(`Cannot resume task in "todo" column`);
    }
    const shouldMoveToReview = task.column === "done";

    // If the task already has an active session, return it instead of creating a duplicate
    if (task.sessionId) {
      const existing = this.sessionManager.getSession(task.sessionId);
      if (existing) return { task, session: existing };
    }

    // Create a new session with --resume pointing to the old Claude session
    const session = await this.sessionManager.createSession(
      machine,
      project.workDir,
      task.claudeSessionId,    // resumeSessionId
      project.permissionMode,
      undefined,               // worktree (not re-creating)
      project.id,
      task.id,
    );

    // Set session display name to task title
    this.sessionManager.setSessionDisplayName(session.id, task.title);

    // Update the task's sessionId to the new orchestrator session
    // If resuming from "done", move back to "in-review"
    await this.store.updateTask(projectId, taskId, {
      sessionId: session.id,
      lastMachineId: machine.id,
      ...(shouldMoveToReview && { column: "in-review" as const, order: 0 }),
    });

    const updatedTask = this.store.getTask(projectId, taskId)!;
    return { task: updatedTask, session };
  }

  private waitForIdleAndSendPrompt(sessionId: string, prompt: string): void {
    const check = () => {
      const session = this.sessionManager.getSession(sessionId);
      if (!session) return;

      if (session.status === "idle") {
        this.sessionManager.sendPrompt(sessionId, prompt).catch((err) => {
          console.error(`[ProjectManager] Failed to send prompt to session ${sessionId}:`, err);
        });
      } else if (session.status === "starting") {
        setTimeout(check, 500);
      }
      // If error or terminated, don't send
    };
    setTimeout(check, 500);
  }

  // ── Session Import / Link ──

  /**
   * Import an existing session as a new task in a project.
   * Places the task in "in-progress" or "in-review" depending on session status.
   */
  async importSessionAsTask(
    projectId: string,
    sessionId: string,
    title?: string,
  ): Promise<{ task: Task; session: Session }> {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.projectId) throw new Error(`Session ${sessionId} is already linked to a project`);

    // Determine column based on session status
    const column: KanbanColumn = session.status === "idle" || session.status === "terminated"
      ? "in-review" : "in-progress";

    const taskTitle = title || this.sessionManager.getSessionDisplayName(sessionId);

    const existingTasks = this.store.getProjectTasks(projectId);
    const colTasks = existingTasks.filter((t) => t.column === column);

    const now = Date.now();
    const task: Task = {
      id: uuidv4(),
      projectId,
      title: taskTitle,
      description: "",
      column,
      order: colTasks.length,
      sessionId,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.createTask(task);
    this.sessionManager.linkSessionToProject(sessionId, projectId, task.id);

    return { task, session: this.sessionManager.getSession(sessionId)! };
  }

  /**
   * Link an existing session to an existing task.
   */
  async linkSessionToTask(
    projectId: string,
    taskId: string,
    sessionId: string,
  ): Promise<{ task: Task; session: Session }> {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const task = this.store.getTask(projectId, taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.sessionId) throw new Error(`Task ${taskId} already has a linked session`);

    const session = this.sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.projectId) throw new Error(`Session ${sessionId} is already linked to a project`);

    // Link both sides
    await this.store.updateTask(projectId, taskId, { sessionId });
    this.sessionManager.linkSessionToProject(sessionId, projectId, taskId);

    // Set session display name to task title
    this.sessionManager.setSessionDisplayName(sessionId, task.title);

    const updatedTask = this.store.getTask(projectId, taskId)!;
    return { task: updatedTask, session: this.sessionManager.getSession(sessionId)! };
  }

  // ── Session Completion Handling ──

  /**
   * Called when a session transitions from busy to idle (after a result).
   * Checks if the session is linked to a task and auto-moves it to "in-review".
   * Returns the updated task if found, or null.
   */
  handleSessionCompleted(sessionId: string): Task | null {
    for (const project of this.store.getAllProjects()) {
      const tasks = this.store.getProjectTasks(project.id);
      const task = tasks.find(
        (t) => t.sessionId === sessionId && t.column === "in-progress"
      );
      if (task) {
        this.store.updateTask(project.id, task.id, {
          column: "in-review",
          order: 0,
        }).catch((err) => {
          console.error(`[ProjectManager] Failed to move task ${task.id} to in-review:`, err);
        });
        // Return the task with updated column
        return { ...task, column: "in-review", updatedAt: Date.now() };
      }
    }
    return null;
  }

  /**
   * Called when a session becomes busy again (e.g. user sends follow-up message).
   * Moves the linked task back to "in-progress" if it's currently "in-review".
   */
  handleSessionBusy(sessionId: string): Task | null {
    for (const project of this.store.getAllProjects()) {
      const tasks = this.store.getProjectTasks(project.id);
      const task = tasks.find(
        (t) => t.sessionId === sessionId && t.column === "in-review"
      );
      if (task) {
        this.store.updateTask(project.id, task.id, {
          column: "in-progress",
          order: 0,
        }).catch((err) => {
          console.error(`[ProjectManager] Failed to move task ${task.id} back to in-progress:`, err);
        });
        return { ...task, column: "in-progress", updatedAt: Date.now() };
      }
    }
    return null;
  }

  // ── Orchestrator Session Management ──

  async setOrchestratorSession(projectId: string, sessionId: string, claudeSessionId: string): Promise<void> {
    await this.store.updateProject(projectId, { orchestratorSessionId: sessionId, orchestratorClaudeSessionId: claudeSessionId } as any);
  }

  async clearOrchestratorSession(projectId: string): Promise<void> {
    // Clear the live session ID but keep claudeSessionId for resume
    await this.store.updateProject(projectId, { orchestratorSessionId: undefined } as any);
  }

  async resetOrchestratorSession(projectId: string): Promise<void> {
    // Clear both session ID and claudeSessionId — forces fresh session on next create
    await this.store.updateProject(projectId, { orchestratorSessionId: undefined, orchestratorClaudeSessionId: undefined } as any);
  }
}
