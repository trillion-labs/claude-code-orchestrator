import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { Project, Task, KanbanColumn, Note } from "../shared/types";

const DATA_DIR = join(homedir(), ".claude-orchestrator");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");
const TASKS_DIR = join(DATA_DIR, "tasks");
const NOTES_DIR = join(DATA_DIR, "notes");

/** Index entry — Note without content (content lives in separate .md files) */
type NoteIndex = Omit<Note, "content">;

interface ProjectsFileData {
  version: number;
  projects: Project[];
}

interface TasksFileData {
  version: number;
  tasks: Task[];
}

interface NotesIndexData {
  version: number;
  notes: NoteIndex[];
}

export class ProjectStore {
  private projects: Project[] = [];
  private tasksByProject = new Map<string, Task[]>();
  private noteIndexByProject = new Map<string, NoteIndex[]>();

  // Debounce timers for disk writes
  private projectsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private tasksSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private notesIndexSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async initialize(): Promise<void> {
    // Ensure data directories exist
    await mkdir(DATA_DIR, { recursive: true });
    await mkdir(TASKS_DIR, { recursive: true });
    await mkdir(NOTES_DIR, { recursive: true });

    // Load projects
    try {
      const content = await readFile(PROJECTS_FILE, "utf-8");
      const data: ProjectsFileData = JSON.parse(content);
      this.projects = data.projects || [];
    } catch {
      // File doesn't exist yet — start empty
      this.projects = [];
    }

    // Load tasks and notes for each project
    for (const project of this.projects) {
      try {
        const tasksFile = join(TASKS_DIR, `${project.id}.json`);
        const content = await readFile(tasksFile, "utf-8");
        const data: TasksFileData = JSON.parse(content);
        this.tasksByProject.set(project.id, data.tasks || []);
      } catch {
        this.tasksByProject.set(project.id, []);
      }
      try {
        const notesFile = join(NOTES_DIR, `${project.id}.json`);
        const content = await readFile(notesFile, "utf-8");
        const data: NotesIndexData = JSON.parse(content);
        this.noteIndexByProject.set(project.id, data.notes || []);
      } catch {
        this.noteIndexByProject.set(project.id, []);
      }
    }

    const totalTasks = Array.from(this.tasksByProject.values()).reduce((sum, tasks) => sum + tasks.length, 0);
    const totalNotes = Array.from(this.noteIndexByProject.values()).reduce((sum, notes) => sum + notes.length, 0);
    console.log(
      `[ProjectStore] Loaded ${this.projects.length} projects, ${totalTasks} tasks, ${totalNotes} notes`
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
    this.noteIndexByProject.set(project.id, []);
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
    this.noteIndexByProject.delete(id);
    await this.saveProjectsDebounced();
    // Delete tasks file (best effort)
    try {
      const { unlink } = await import("fs/promises");
      await unlink(join(TASKS_DIR, `${id}.json`));
    } catch {
      // Ignore — file may not exist
    }
    // Delete notes index + content directory
    try {
      const { unlink } = await import("fs/promises");
      await unlink(join(NOTES_DIR, `${id}.json`));
    } catch { /* ignore */ }
    try {
      await rm(join(NOTES_DIR, id), { recursive: true, force: true });
    } catch { /* ignore */ }
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

  // ── Note CRUD ──
  // Index (metadata) lives in notes/{projectId}.json
  // Content lives in notes/{projectId}/{noteId}.md

  /** Returns note index entries (without content) */
  getProjectNotes(projectId: string): NoteIndex[] {
    return this.noteIndexByProject.get(projectId) || [];
  }

  /** Returns a single note index entry (without content) */
  getNoteIndex(projectId: string, noteId: string): NoteIndex | undefined {
    const notes = this.noteIndexByProject.get(projectId) || [];
    return notes.find((n) => n.id === noteId);
  }

  /** Reads note content from .md file */
  async getNoteContent(projectId: string, noteId: string): Promise<string> {
    try {
      return await readFile(join(NOTES_DIR, projectId, `${noteId}.md`), "utf-8");
    } catch {
      return "";
    }
  }

  /** Returns full Note (index + content) */
  async getNote(projectId: string, noteId: string): Promise<Note | undefined> {
    const index = this.getNoteIndex(projectId, noteId);
    if (!index) return undefined;
    const content = await this.getNoteContent(projectId, noteId);
    return { ...index, content };
  }

  async createNote(note: Note): Promise<void> {
    const { content, ...index } = note;
    const notes = this.noteIndexByProject.get(note.projectId) || [];
    notes.push(index);
    this.noteIndexByProject.set(note.projectId, notes);
    await this.saveNotesIndexDebounced(note.projectId);
    // Write content file
    const contentDir = join(NOTES_DIR, note.projectId);
    await mkdir(contentDir, { recursive: true });
    await writeFile(join(contentDir, `${note.id}.md`), content, "utf-8");
  }

  async updateNote(projectId: string, noteId: string, updates: { title?: string; content?: string }): Promise<void> {
    const notes = this.noteIndexByProject.get(projectId) || [];
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx === -1) throw new Error(`Note ${noteId} not found in project ${projectId}`);

    const now = Date.now();
    // Update index metadata if title changed
    if (updates.title !== undefined) {
      notes[idx] = { ...notes[idx], title: updates.title, updatedAt: now };
      await this.saveNotesIndexDebounced(projectId);
    } else {
      notes[idx] = { ...notes[idx], updatedAt: now };
      await this.saveNotesIndexDebounced(projectId);
    }

    // Write content file immediately (explicit save by user)
    if (updates.content !== undefined) {
      const contentDir = join(NOTES_DIR, projectId);
      await mkdir(contentDir, { recursive: true });
      await writeFile(join(contentDir, `${noteId}.md`), updates.content, "utf-8");
    }
  }

  async deleteNote(projectId: string, noteId: string): Promise<void> {
    const notes = this.noteIndexByProject.get(projectId) || [];
    this.noteIndexByProject.set(
      projectId,
      notes.filter((n) => n.id !== noteId)
    );
    await this.saveNotesIndexDebounced(projectId);
    // Delete content file
    try {
      const { unlink } = await import("fs/promises");
      await unlink(join(NOTES_DIR, projectId, `${noteId}.md`));
    } catch { /* ignore */ }
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

  private async saveNotesIndexDebounced(projectId: string): Promise<void> {
    const existingTimer = this.notesIndexSaveTimers.get(projectId);
    if (existingTimer) clearTimeout(existingTimer);
    return new Promise((resolve) => {
      this.notesIndexSaveTimers.set(
        projectId,
        setTimeout(async () => {
          await this.saveNotesIndexNow(projectId);
          this.notesIndexSaveTimers.delete(projectId);
          resolve();
        }, 500)
      );
    });
  }

  private async saveNotesIndexNow(projectId: string): Promise<void> {
    const notes = this.noteIndexByProject.get(projectId) || [];
    const data: NotesIndexData = { version: 1, notes };
    await mkdir(NOTES_DIR, { recursive: true });
    await writeFile(join(NOTES_DIR, `${projectId}.json`), JSON.stringify(data, null, 2), "utf-8");
  }

}
