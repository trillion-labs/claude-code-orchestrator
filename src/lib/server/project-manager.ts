import { v4 as uuidv4 } from "uuid";
import type { ProjectStore } from "./project-store";
import type { SessionManager } from "./session-manager";
import type { Project, Task, MachineConfig, PermissionMode, KanbanColumn, Session } from "../shared/types";

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
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createProject(project);
    return project;
  }

  async updateProject(
    projectId: string,
    updates: { name?: string; permissionMode?: PermissionMode },
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
    updates: { title?: string; description?: string },
  ): Promise<Task> {
    await this.store.updateTask(projectId, taskId, updates);
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

    // Move task to in-progress and link session
    await this.store.updateTask(projectId, taskId, {
      column: "in-progress",
      order: 0,
      sessionId: session.id,
    });

    // Wait for session to be idle, then send the task description as prompt
    this.waitForIdleAndSendPrompt(session.id, task.description);

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
}
