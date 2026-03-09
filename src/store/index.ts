import { create } from "zustand";
import type { Session, MachineConfig, ConversationMessage, ClaudeSessionInfo, PermissionMode, Project, Task, PermissionRequest } from "@/lib/shared/types";

interface SessionState {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  machines: MachineConfig[];
  // Per-session message history
  messages: Map<string, ConversationMessage[]>;
  // Whether more history is available for a session (for pagination)
  hasMoreMessages: Map<string, boolean>;
  // Whether history is currently being loaded
  loadingHistory: Map<string, boolean>;
  // Per-session streaming text
  streamingText: Map<string, string>;
  // Discovered sessions per machine
  discoveredSessions: Map<string, ClaudeSessionInfo[]>;
  // Permission decisions: requestId → "allow" | "deny"
  respondedPermissions: Map<string, "allow" | "deny">;
  // Answered question selections: requestId → {questionIdx: selectedLabel}
  permissionAnswers: Map<string, Map<number, string | string[]>>;
  // Pending attention indicators per session (e.g. "perm:reqId", "question")
  pendingAttention: Map<string, Set<string>>;
  // Pending permission requests per session (for sidebar display)
  pendingRequests: Map<string, PermissionRequest[]>;
  // Custom session names (user-set or auto-extracted from first message)
  sessionNames: Map<string, string>;
  // Global config
  globalSettings: string | null;
  globalClaudeMd: string | null;
  // Session-local config
  sessionConfig: Map<string, { settings: string; claudemd: string }>;
  // Plan panel
  planContent: Map<string, string>; // sessionId → plan markdown
  planPanelOpen: Map<string, boolean>; // sessionId → panel open state
  // File preview panel
  filePreview: Map<string, { filePath: string; content: string; language: string; truncated: boolean; loading: boolean; error?: string }>;
  filePreviewOpen: Map<string, boolean>;
  // Existing worktrees per machine (from worktrees.list)
  worktrees: Map<string, Array<{ name: string; path: string; branch: string }>>
  // Projects & Kanban
  projects: Map<string, Project>;
  activeProjectId: string | null;
  tasks: Map<string, Task[]>; // projectId → Task[]
  viewMode: "sessions" | "kanban";

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSessionStatus: (
    sessionId: string,
    status: Session["status"],
    totalCostUsd?: number,
    error?: string
  ) => void;
  updateSessionPermissionMode: (sessionId: string, mode: PermissionMode) => void;
  updateSessionProject: (sessionId: string, projectId: string | null) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  setMachines: (machines: MachineConfig[]) => void;

  // Messages
  addMessage: (sessionId: string, message: ConversationMessage) => void;
  prependMessages: (sessionId: string, messages: ConversationMessage[], hasMore: boolean) => void;
  setLoadingHistory: (sessionId: string, loading: boolean) => void;

  // Streaming
  appendStreamDelta: (sessionId: string, delta: string) => void;
  clearStreamingText: (sessionId: string) => void;

  // Discovered sessions
  setDiscoveredSessions: (machineId: string, sessions: ClaudeSessionInfo[]) => void;

  // Permissions
  respondPermission: (requestId: string, decision: "allow" | "deny") => void;
  setPermissionAnswers: (requestId: string, selections: Map<number, string | string[]>) => void;
  addPendingRequest: (sessionId: string, request: PermissionRequest) => void;
  removePendingRequest: (sessionId: string, requestId: string) => void;
  clearPendingRequests: (sessionId: string) => void;

  // Attention
  addAttention: (sessionId: string, key: string) => void;
  removeAttention: (sessionId: string, key: string) => void;
  clearAttention: (sessionId: string) => void;

  // Session names
  setSessionName: (sessionId: string, name: string) => void;

  // Global config
  setGlobalConfig: (settings: string, claudemd: string) => void;
  // Session-local config
  setSessionConfig: (sessionId: string, settings: string, claudemd: string) => void;
  // Plan panel
  setPlanContent: (sessionId: string, content: string) => void;
  setPlanPanelOpen: (sessionId: string, open: boolean) => void;
  clearPlanContent: (sessionId: string) => void;
  // File preview
  setFilePreview: (sessionId: string, data: { filePath: string; content: string; language: string; truncated: boolean }) => void;
  setFilePreviewLoading: (sessionId: string, filePath: string) => void;
  setFilePreviewError: (sessionId: string, error: string) => void;
  setFilePreviewOpen: (sessionId: string, open: boolean) => void;
  clearFilePreview: (sessionId: string) => void;
  // Worktrees
  setWorktrees: (machineId: string, worktrees: Array<{ name: string; path: string; branch: string }>) => void;
  // Projects & Kanban
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (projectId: string) => void;
  setActiveProject: (projectId: string | null) => void;
  setTasks: (projectId: string, tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  removeTask: (projectId: string, taskId: string) => void;
  updateSessionLink: (sessionId: string, projectId: string, taskId: string) => void;
  setViewMode: (mode: "sessions" | "kanban") => void;
}

export const useStore = create<SessionState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,
  machines: [],
  messages: new Map(),
  hasMoreMessages: new Map(),
  loadingHistory: new Map(),
  streamingText: new Map(),
  discoveredSessions: new Map(),
  respondedPermissions: new Map(),
  permissionAnswers: new Map(),
  pendingAttention: new Map(),
  pendingRequests: new Map(),
  sessionNames: new Map(),
  globalSettings: null,
  globalClaudeMd: null,
  sessionConfig: new Map(),
  planContent: new Map(),
  planPanelOpen: new Map(),
  filePreview: new Map(),
  filePreviewOpen: new Map(),
  worktrees: new Map(),
  projects: new Map(),
  activeProjectId: null,
  tasks: new Map(),
  viewMode: "sessions" as const,

  setSessions: (sessions) =>
    set(() => {
      const map = new Map<string, Session>();
      for (const s of sessions) map.set(s.id, s);
      return { sessions: map };
    }),

  addSession: (session) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(session.id, session);
      return { sessions, activeSessionId: session.id };
    }),

  updateSessionStatus: (sessionId, status, totalCostUsd, error) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, {
          ...session,
          status,
          ...(totalCostUsd !== undefined && { totalCostUsd }),
          ...(error !== undefined && { error }),
          lastActivity: Date.now(),
        });
      }
      return { sessions };
    }),

  updateSessionPermissionMode: (sessionId, mode) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, permissionMode: mode });
      }
      return { sessions };
    }),

  updateSessionProject: (sessionId, projectId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        const updated = { ...session };
        if (projectId) {
          updated.projectId = projectId;
        } else {
          delete updated.projectId;
        }
        sessions.set(sessionId, updated);
      }
      return { sessions };
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(sessionId);
      const messages = new Map(state.messages);
      messages.delete(sessionId);
      const hasMoreMessages = new Map(state.hasMoreMessages);
      hasMoreMessages.delete(sessionId);
      const loadingHistory = new Map(state.loadingHistory);
      loadingHistory.delete(sessionId);
      const streamingText = new Map(state.streamingText);
      streamingText.delete(sessionId);
      const pendingAttention = new Map(state.pendingAttention);
      pendingAttention.delete(sessionId);
      const pendingRequests = new Map(state.pendingRequests);
      pendingRequests.delete(sessionId);
      const sessionNames = new Map(state.sessionNames);
      sessionNames.delete(sessionId);
      const sessionConfig = new Map(state.sessionConfig);
      sessionConfig.delete(sessionId);
      const planContent = new Map(state.planContent);
      planContent.delete(sessionId);
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.delete(sessionId);
      const filePreview = new Map(state.filePreview);
      filePreview.delete(sessionId);
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.delete(sessionId);
      return {
        sessions,
        messages,
        hasMoreMessages,
        loadingHistory,
        streamingText,
        pendingAttention,
        pendingRequests,
        sessionNames,
        sessionConfig,
        planContent,
        planPanelOpen,
        filePreview,
        filePreviewOpen,
        activeSessionId:
          state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  setMachines: (machines) => set({ machines }),

  addMessage: (sessionId, message) =>
    set((state) => {
      const messages = new Map(state.messages);
      const existing = messages.get(sessionId) || [];
      messages.set(sessionId, [...existing, message]);
      // Clear streaming text when an assistant message arrives
      if (message.role === "assistant") {
        const streamingText = new Map(state.streamingText);
        streamingText.delete(sessionId);
        return { messages, streamingText };
      }
      return { messages };
    }),

  prependMessages: (sessionId, olderMessages, hasMore) =>
    set((state) => {
      const messages = new Map(state.messages);
      const existing = messages.get(sessionId) || [];
      // Deduplicate by timestamp (history messages may overlap with recent)
      const existingTimestamps = new Set(existing.map((m) => m.timestamp));
      const unique = olderMessages.filter((m) => !existingTimestamps.has(m.timestamp));
      messages.set(sessionId, [...unique, ...existing]);
      const hasMoreMessages = new Map(state.hasMoreMessages);
      hasMoreMessages.set(sessionId, hasMore);
      const loadingHistory = new Map(state.loadingHistory);
      loadingHistory.delete(sessionId);
      return { messages, hasMoreMessages, loadingHistory };
    }),

  setLoadingHistory: (sessionId, loading) =>
    set((state) => {
      const loadingHistory = new Map(state.loadingHistory);
      if (loading) {
        loadingHistory.set(sessionId, true);
      } else {
        loadingHistory.delete(sessionId);
      }
      return { loadingHistory };
    }),

  appendStreamDelta: (sessionId, delta) =>
    set((state) => {
      const streamingText = new Map(state.streamingText);
      const current = streamingText.get(sessionId) || "";
      streamingText.set(sessionId, current + delta);
      return { streamingText };
    }),

  clearStreamingText: (sessionId) =>
    set((state) => {
      const streamingText = new Map(state.streamingText);
      streamingText.delete(sessionId);
      return { streamingText };
    }),

  setDiscoveredSessions: (machineId, sessions) =>
    set((state) => {
      const discoveredSessions = new Map(state.discoveredSessions);
      discoveredSessions.set(machineId, sessions);
      return { discoveredSessions };
    }),

  respondPermission: (requestId, decision) =>
    set((state) => {
      const respondedPermissions = new Map(state.respondedPermissions);
      respondedPermissions.set(requestId, decision);
      return { respondedPermissions };
    }),

  setPermissionAnswers: (requestId, selections) =>
    set((state) => {
      const permissionAnswers = new Map(state.permissionAnswers);
      permissionAnswers.set(requestId, selections);
      return { permissionAnswers };
    }),

  addPendingRequest: (sessionId, request) =>
    set((state) => {
      const pendingRequests = new Map(state.pendingRequests);
      const existing = pendingRequests.get(sessionId) || [];
      pendingRequests.set(sessionId, [...existing, request]);
      return { pendingRequests };
    }),

  removePendingRequest: (sessionId, requestId) =>
    set((state) => {
      const pendingRequests = new Map(state.pendingRequests);
      const existing = pendingRequests.get(sessionId);
      if (existing) {
        const filtered = existing.filter((r) => r.requestId !== requestId);
        if (filtered.length === 0) {
          pendingRequests.delete(sessionId);
        } else {
          pendingRequests.set(sessionId, filtered);
        }
      }
      return { pendingRequests };
    }),

  clearPendingRequests: (sessionId) =>
    set((state) => {
      const pendingRequests = new Map(state.pendingRequests);
      pendingRequests.delete(sessionId);
      return { pendingRequests };
    }),

  addAttention: (sessionId, key) =>
    set((state) => {
      const pendingAttention = new Map(state.pendingAttention);
      const keys = new Set(pendingAttention.get(sessionId) || []);
      keys.add(key);
      pendingAttention.set(sessionId, keys);
      return { pendingAttention };
    }),

  removeAttention: (sessionId, key) =>
    set((state) => {
      const pendingAttention = new Map(state.pendingAttention);
      const keys = pendingAttention.get(sessionId);
      if (keys) {
        const updated = new Set(keys);
        updated.delete(key);
        if (updated.size === 0) {
          pendingAttention.delete(sessionId);
        } else {
          pendingAttention.set(sessionId, updated);
        }
      }
      return { pendingAttention };
    }),

  clearAttention: (sessionId) =>
    set((state) => {
      const pendingAttention = new Map(state.pendingAttention);
      pendingAttention.delete(sessionId);
      return { pendingAttention };
    }),

  setSessionName: (sessionId, name) =>
    set((state) => {
      const sessionNames = new Map(state.sessionNames);
      sessionNames.set(sessionId, name);
      return { sessionNames };
    }),

  setGlobalConfig: (settings, claudemd) =>
    set({ globalSettings: settings, globalClaudeMd: claudemd }),

  setSessionConfig: (sessionId, settings, claudemd) =>
    set((state) => {
      const sessionConfig = new Map(state.sessionConfig);
      sessionConfig.set(sessionId, { settings, claudemd });
      return { sessionConfig };
    }),

  setPlanContent: (sessionId, content) =>
    set((state) => {
      const planContent = new Map(state.planContent);
      planContent.set(sessionId, content);
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.set(sessionId, true); // Auto-open panel when plan content arrives
      // Mutual exclusion: close file preview
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, false);
      return { planContent, planPanelOpen, filePreviewOpen };
    }),

  setPlanPanelOpen: (sessionId, open) =>
    set((state) => {
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.set(sessionId, open);
      return { planPanelOpen };
    }),

  clearPlanContent: (sessionId) =>
    set((state) => {
      const planContent = new Map(state.planContent);
      planContent.delete(sessionId);
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.delete(sessionId);
      return { planContent, planPanelOpen };
    }),

  setFilePreview: (sessionId, data) =>
    set((state) => {
      const filePreview = new Map(state.filePreview);
      filePreview.set(sessionId, { ...data, loading: false });
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, true);
      // Mutual exclusion: close plan panel
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.set(sessionId, false);
      return { filePreview, filePreviewOpen, planPanelOpen };
    }),

  setFilePreviewLoading: (sessionId, filePath) =>
    set((state) => {
      const filePreview = new Map(state.filePreview);
      filePreview.set(sessionId, { filePath, content: "", language: "text", truncated: false, loading: true });
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, true);
      // Mutual exclusion: close plan panel
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.set(sessionId, false);
      return { filePreview, filePreviewOpen, planPanelOpen };
    }),

  setFilePreviewError: (sessionId, error) =>
    set((state) => {
      const filePreview = new Map(state.filePreview);
      const existing = filePreview.get(sessionId);
      if (existing) {
        filePreview.set(sessionId, { ...existing, loading: false, error });
      }
      return { filePreview };
    }),

  setFilePreviewOpen: (sessionId, open) =>
    set((state) => {
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, open);
      return { filePreviewOpen };
    }),

  clearFilePreview: (sessionId) =>
    set((state) => {
      const filePreview = new Map(state.filePreview);
      filePreview.delete(sessionId);
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.delete(sessionId);
      return { filePreview, filePreviewOpen };
    }),

  setWorktrees: (machineId, worktrees) =>
    set((state) => {
      const wt = new Map(state.worktrees);
      wt.set(machineId, worktrees);
      return { worktrees: wt };
    }),

  // ── Projects & Kanban ──

  setProjects: (projects) =>
    set(() => {
      const map = new Map<string, Project>();
      for (const p of projects) map.set(p.id, p);
      return { projects: map };
    }),

  addProject: (project) =>
    set((state) => {
      const projects = new Map(state.projects);
      projects.set(project.id, project);
      return { projects };
    }),

  updateProject: (project) =>
    set((state) => {
      const projects = new Map(state.projects);
      projects.set(project.id, project);
      return { projects };
    }),

  removeProject: (projectId) =>
    set((state) => {
      const projects = new Map(state.projects);
      projects.delete(projectId);
      const tasks = new Map(state.tasks);
      tasks.delete(projectId);
      return {
        projects,
        tasks,
        activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
      };
    }),

  setActiveProject: (projectId) => set({ activeProjectId: projectId }),

  setTasks: (projectId, taskList) =>
    set((state) => {
      const tasks = new Map(state.tasks);
      tasks.set(projectId, taskList);
      return { tasks };
    }),

  addTask: (task) =>
    set((state) => {
      const tasks = new Map(state.tasks);
      const existing = tasks.get(task.projectId) || [];
      tasks.set(task.projectId, [...existing, task]);
      return { tasks };
    }),

  updateTask: (task) =>
    set((state) => {
      const tasks = new Map(state.tasks);
      const existing = tasks.get(task.projectId) || [];
      tasks.set(
        task.projectId,
        existing.map((t) => (t.id === task.id ? task : t))
      );
      return { tasks };
    }),

  removeTask: (projectId, taskId) =>
    set((state) => {
      const tasks = new Map(state.tasks);
      const existing = tasks.get(projectId) || [];
      tasks.set(
        projectId,
        existing.filter((t) => t.id !== taskId)
      );
      return { tasks };
    }),

  updateSessionLink: (sessionId, projectId, taskId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, projectId, taskId });
      }
      return { sessions };
    }),

  setViewMode: (mode) => set({ viewMode: mode }),
}));
