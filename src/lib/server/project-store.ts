import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { Project, Task, KanbanColumn, TrashedProject } from "../shared/types";

const DATA_DIR = join(homedir(), ".claude-orchestrator");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");
const TRASH_FILE = join(DATA_DIR, "trash.json");
const TASKS_DIR = join(DATA_DIR, "tasks");

interface ProjectsFileData {
  version: number;
  projects: Project[];
}

interface TrashFileData {
  version: number;
  items: TrashedProject[];
}

interface TasksFileData {
  version: number;
  tasks: Task[];
}

export class ProjectStore {
  private projects: Project[] = [];
  private tasksByProject = new Map<string, Task[]>();
  private trash: TrashedProject[] = [];

  // Debounce timers for disk writes
  private projectsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private trashSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private tasksSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async initialize(): Promise<void> {
    // Ensure data directories exist
    await mkdir(DATA_DIR, { recursive: true });
    await mkdir(TASKS_DIR, { recursive: true });

    // Load projects
    try {
      const content = await readFile(PROJECTS_FILE, "utf-8");
      const data: ProjectsFileData = JSON.parse(content);
      this.projects = data.projects || [];
    } catch {
      // File doesn't exist yet — start empty
      this.projects = [];
    }

    // Load trash
    try {
      const trashContent = await readFile(TRASH_FILE, "utf-8");
      const trashData: TrashFileData = JSON.parse(trashContent);
      this.trash = trashData.items || [];
    } catch {
      // File doesn't exist yet — start empty
      this.trash = [];
    }

    // Load tasks for each project
    for (const project of this.projects) {
      try {
        const tasksFile = join(TASKS_DIR, `${project.id}.json`);
        const content = await readFile(tasksFile, "utf-8");
        const data: TasksFileData = JSON.parse(content);
        this.tasksByProject.set(project.id, data.tasks || []);
      } catch {
        this.tasksByProject.set(project.id, []);
      }
    }

    console.log(
      `[ProjectStore] Loaded ${this.projects.length} projects, ${
        Array.from(this.tasksByProject.values()).reduce((sum, tasks) => sum + tasks.length, 0)
      } tasks total`
    );
  }

  // ── Project CRUD ──

  getAllProjects(): Project[] {
    return this.projects;
  }

  getProject(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id);
  }

  async createProject(project: Project): Promise<void> {
    this.projects.push(project);
    this.tasksByProject.set(project.id, []);
    await this.saveProjectsDebounced();
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Project ${id} not found`);
    this.projects[idx] = { ...this.projects[idx], ...updates, updatedAt: Date.now() };
    await this.saveProjectsDebounced();
  }

  async deleteProject(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.tasksByProject.delete(id);
    await this.saveProjectsDebounced();
    // Delete tasks file (best effort)
    try {
      const { unlink } = await import("fs/promises");
      await unlink(join(TASKS_DIR, `${id}.json`));
    } catch {
      // Ignore — file may not exist
    }
  }

  async trashProject(id: string): Promise<TrashedProject> {
    const project = this.projects.find((p) => p.id === id);
    if (!project) throw new Error(`Project ${id} not found`);
    const tasks = this.tasksByProject.get(id) || [];
    const trashedProject: TrashedProject = {
      project,
      tasks,
      deletedAt: new Date().toISOString(),
    };
    this.trash.push(trashedProject);
    this.projects = this.projects.filter((p) => p.id !== id);
    this.tasksByProject.delete(id);
    await this.saveProjectsDebounced();
    await this.saveTrashDebounced();
    return trashedProject;
  }

  async restoreProject(id: string): Promise<TrashedProject> {
    const item = this.trash.find((t) => t.project.id === id);
    if (!item) throw new Error(`Project ${id} not found in trash`);
    this.projects.push(item.project);
    this.tasksByProject.set(id, item.tasks);
    this.trash = this.trash.filter((t) => t.project.id !== id);
    await this.saveProjectsDebounced();
    await this.saveTrashDebounced();
    // Restore tasks file
    await this.saveTasksNow(id);
    return item;
  }

  async purgeProject(id: string): Promise<void> {
    this.trash = this.trash.filter((t) => t.project.id !== id);
    await this.saveTrashDebounced();
    // Delete tasks file (best effort)
    try {
      const { unlink } = await import("fs/promises");
      await unlink(join(TASKS_DIR, `${id}.json`));
    } catch {
      // Ignore — file may not exist
    }
  }

  getTrash(): TrashedProject[] {
    return this.trash;
  }

  // ── Task CRUD ──

  getProjectTasks(projectId: string): Task[] {
    return this.tasksByProject.get(projectId) || [];
  }

  async createTask(task: Task): Promise<void> {
    const tasks = this.tasksByProject.get(task.projectId) || [];
    tasks.push(task);
    this.tasksByProject.set(task.projectId, tasks);
    await this.saveTasksDebounced(task.projectId);
  }

  async updateTask(projectId: string, taskId: string, updates: Partial<Task>): Promise<void> {
    const tasks = this.tasksByProject.get(projectId) || [];
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) throw new Error(`Task ${taskId} not found in project ${projectId}`);
    tasks[idx] = { ...tasks[idx], ...updates, updatedAt: Date.now() };
    await this.saveTasksDebounced(projectId);
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    const tasks = this.tasksByProject.get(projectId) || [];
    this.tasksByProject.set(
      projectId,
      tasks.filter((t) => t.id !== taskId)
    );
    await this.saveTasksDebounced(projectId);
  }

  async moveTask(projectId: string, taskId: string, column: KanbanColumn, order: number): Promise<void> {
    const tasks = this.tasksByProject.get(projectId) || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const oldColumn = task.column;
    task.column = column;
    task.order = order;
    task.updatedAt = Date.now();

    if (column === "done" && oldColumn !== "done") {
      task.completedAt = Date.now();
    } else if (column !== "done") {
      task.completedAt = undefined;
    }

    // Re-order tasks in the target column
    const columnTasks = tasks
      .filter((t) => t.column === column && t.id !== taskId)
      .sort((a, b) => a.order - b.order);

    // Insert at the specified position
    columnTasks.splice(order, 0, task);
    columnTasks.forEach((t, i) => {
      t.order = i;
    });

    await this.saveTasksDebounced(projectId);
  }

  async reorderTasks(projectId: string, column: KanbanColumn, taskIds: string[]): Promise<void> {
    const tasks = this.tasksByProject.get(projectId) || [];

    // Update order for tasks in the specified column
    for (let i = 0; i < taskIds.length; i++) {
      const task = tasks.find((t) => t.id === taskIds[i]);
      if (task && task.column === column) {
        task.order = i;
        task.updatedAt = Date.now();
      }
    }

    await this.saveTasksDebounced(projectId);
  }

  getTask(projectId: string, taskId: string): Task | undefined {
    const tasks = this.tasksByProject.get(projectId) || [];
    return tasks.find((t) => t.id === taskId);
  }

  // ── Persistence ──

  private async saveProjectsDebounced(): Promise<void> {
    if (this.projectsSaveTimer) clearTimeout(this.projectsSaveTimer);
    return new Promise((resolve) => {
      this.projectsSaveTimer = setTimeout(async () => {
        await this.saveProjectsNow();
        resolve();
      }, 500);
    });
  }

  private async saveTrashDebounced(): Promise<void> {
    if (this.trashSaveTimer) clearTimeout(this.trashSaveTimer);
    return new Promise((resolve) => {
      this.trashSaveTimer = setTimeout(async () => {
        await this.saveTrashNow();
        resolve();
      }, 500);
    });
  }

  private async saveTrashNow(): Promise<void> {
    const data: TrashFileData = { version: 1, items: this.trash };
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(TRASH_FILE, JSON.stringify(data, null, 2), "utf-8");
  }

  private async saveTasksDebounced(projectId: string): Promise<void> {
    const existingTimer = this.tasksSaveTimers.get(projectId);
    if (existingTimer) clearTimeout(existingTimer);
    return new Promise((resolve) => {
      this.tasksSaveTimers.set(
        projectId,
        setTimeout(async () => {
          await this.saveTasksNow(projectId);
          this.tasksSaveTimers.delete(projectId);
          resolve();
        }, 500)
      );
    });
  }

  private async saveProjectsNow(): Promise<void> {
    const data: ProjectsFileData = { version: 1, projects: this.projects };
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(PROJECTS_FILE, JSON.stringify(data, null, 2), "utf-8");
  }

  private async saveTasksNow(projectId: string): Promise<void> {
    const tasks = this.tasksByProject.get(projectId) || [];
    const data: TasksFileData = { version: 1, tasks };
    await mkdir(TASKS_DIR, { recursive: true });
    await writeFile(join(TASKS_DIR, `${projectId}.json`), JSON.stringify(data, null, 2), "utf-8");
  }
}
