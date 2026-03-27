import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { PermissionMode, WorktreeInfo } from "../shared/types";

const DATA_DIR = join(homedir(), ".claude-orchestrator");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

export interface SessionRecord {
  id: string;
  claudeSessionId: string;
  machineId: string;
  machineName: string;
  workDir: string;
  permissionMode: PermissionMode;
  createdAt: number;
  lastActivity: number;
  totalCostUsd: number;
  worktree?: WorktreeInfo;
  projectId?: string;
  taskId?: string;
  explicitDisplayName?: string;
  firstUserMessage?: string;
}

interface SessionsFileData {
  version: number;
  sessions: SessionRecord[];
}

export class SessionStore {
  private records = new Map<string, SessionRecord>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async initialize(): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    try {
      const content = await readFile(SESSIONS_FILE, "utf-8");
      const data: SessionsFileData = JSON.parse(content);
      for (const record of data.sessions || []) {
        this.records.set(record.id, record);
      }
    } catch {
      // File doesn't exist yet — start empty
    }
    console.log(`[SessionStore] Loaded ${this.records.size} sessions`);
  }

  getAll(): SessionRecord[] {
    return Array.from(this.records.values());
  }

  save(record: SessionRecord): void {
    this.records.set(record.id, record);
    this.scheduleSave();
  }

  delete(id: string): void {
    this.records.delete(id);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const data: SessionsFileData = {
      version: 1,
      sessions: Array.from(this.records.values()),
    };
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SESSIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
  }
}
