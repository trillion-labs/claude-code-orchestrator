import { create } from "zustand";
import type { Session, MachineConfig, ConversationMessage, ClaudeSessionInfo, PermissionMode, Project, Task, PermissionRequest, KanbanColumn } from "@/lib/shared/types";

export interface SplitPanel {
  id: string;
  sessionId: string;
}

export interface FilePreviewTab {
  id: string;
  filePath: string;
  content: string;
  language: string;
  truncated: boolean;
  loading: boolean;
  error?: string;
}

export interface ShowUserTab {
  id: string;
  title: string;
  html: string;
}

const MAX_SHOW_USER_CACHE = 20;

const MAX_SPLIT_PANELS = 4;

interface SessionState {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  machines: MachineConfig[];
  // Split panel
  splitPanels: SplitPanel[];
  splitPanelWidths: Map<string, number>;
  focusedPanelId: string | null;
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
  // File preview tabs (multiple files per session)
  filePreviewTabs: Map<string, FilePreviewTab[]>;
  activeFilePreviewTabId: Map<string, string>;
  filePreviewOpen: Map<string, boolean>;
  // Show user tabs (multiple show_user contents per session)
  showUserTabs: Map<string, ShowUserTab[]>;       // open tabs
  showUserCache: Map<string, ShowUserTab[]>;       // all received content (max 20)
  activeShowUserTabId: Map<string, string>;
  showUserPanelOpen: Map<string, boolean>;
  // Merged side panel mode (plan + file + show_user in one panel)
  sidePanelMerged: Map<string, boolean>;
  activeMergedTabId: Map<string, string>; // active tab in merged mode
  // Existing worktrees per machine (from worktrees.list)
  worktrees: Map<string, Array<{ name: string; path: string; branch: string }>>
  // Projects & Kanban
  projects: Map<string, Project>;
  activeProjectId: string | null;
  tasks: Map<string, Task[]>; // projectId → Task[]
  viewMode: "sessions" | "kanban";
  // Orchestrator manager sessions (projectId → sessionId)
  orchestratorSessions: Map<string, string>;
  // Custom ordering for sidebar lists (array of IDs)
  sessionOrder: string[];
  projectOrder: string[];

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

  // Prompt queue
  promptQueue: Map<string, string[]>;
  setPromptQueue: (sessionId: string, queue: string[]) => void;

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
  removePendingRequestById: (requestId: string) => void;
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
  // File preview tabs
  addFilePreviewTab: (sessionId: string, data: { filePath: string; content: string; language: string; truncated: boolean }) => void;
  setFilePreviewLoading: (sessionId: string, filePath: string) => void;
  setFilePreviewError: (sessionId: string, filePath: string, error: string) => void;
  closeFilePreviewTab: (sessionId: string, tabId: string) => void;
  setActiveFilePreviewTab: (sessionId: string, tabId: string) => void;
  setFilePreviewOpen: (sessionId: string, open: boolean) => void;
  clearFilePreview: (sessionId: string) => void;
  // Show user tabs
  addShowUserTab: (sessionId: string, title: string, html: string) => void;
  closeShowUserTab: (sessionId: string, tabId: string) => void;
  reopenShowUserTab: (sessionId: string, tabId: string) => void;
  setActiveShowUserTab: (sessionId: string, tabId: string) => void;
  setShowUserPanelOpen: (sessionId: string, open: boolean) => void;
  clearShowUserContent: (sessionId: string) => void;
  // Merged side panel
  setSidePanelMerged: (sessionId: string, merged: boolean) => void;
  setActiveMergedTab: (sessionId: string, tabId: string) => void;
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
  moveTaskLocal: (projectId: string, taskId: string, destColumn: KanbanColumn, destOrder: number) => void;
  updateSessionLink: (sessionId: string, projectId: string, taskId: string) => void;
  setViewMode: (mode: "sessions" | "kanban") => void;
  // Sidebar ordering
  reorderSessions: (orderedIds: string[]) => void;
  reorderProjects: (orderedIds: string[]) => void;
  // Orchestrator sessions
  setOrchestratorSession: (projectId: string, sessionId: string | null) => void;

  // Split panel
  splitSession: (sessionId: string) => void;
  removeSplitPanel: (panelId: string) => void;
  focusSplitPanel: (panelId: string) => void;
  setSplitPanelWidth: (panelId: string, width: number) => void;
  clearSplitPanels: () => void;
}

export const useStore = create<SessionState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,
  machines: [],
  messages: new Map(),
  hasMoreMessages: new Map(),
  loadingHistory: new Map(),
  streamingText: new Map(),
  promptQueue: new Map(),
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
  filePreviewTabs: new Map(),
  activeFilePreviewTabId: new Map(),
  filePreviewOpen: new Map(),
  showUserTabs: new Map(),
  showUserCache: new Map(),
  activeShowUserTabId: new Map(),
  showUserPanelOpen: new Map(),
  sidePanelMerged: new Map(),
  activeMergedTabId: new Map(),
  worktrees: new Map(),
  projects: new Map(),
  activeProjectId: null,
  tasks: new Map(),
  splitPanels: [],
  splitPanelWidths: new Map(),
  focusedPanelId: null,
  orchestratorSessions: new Map(),
  viewMode: "sessions" as const,
  sessionOrder: [],
  projectOrder: [],

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
      const filePreviewTabs = new Map(state.filePreviewTabs);
      filePreviewTabs.delete(sessionId);
      const activeFilePreviewTabId = new Map(state.activeFilePreviewTabId);
      activeFilePreviewTabId.delete(sessionId);
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.delete(sessionId);
      const showUserTabs = new Map(state.showUserTabs);
      showUserTabs.delete(sessionId);
      const showUserCache = new Map(state.showUserCache);
      showUserCache.delete(sessionId);
      const activeShowUserTabId = new Map(state.activeShowUserTabId);
      activeShowUserTabId.delete(sessionId);
      const showUserPanelOpen = new Map(state.showUserPanelOpen);
      showUserPanelOpen.delete(sessionId);
      const sidePanelMerged = new Map(state.sidePanelMerged);
      sidePanelMerged.delete(sessionId);
      const activeMergedTabId = new Map(state.activeMergedTabId);
      activeMergedTabId.delete(sessionId);
      // Clean up split panels referencing this session
      let splitPanels = state.splitPanels.filter((p) => p.sessionId !== sessionId);
      const splitPanelWidths = new Map(state.splitPanelWidths);
      for (const p of state.splitPanels) {
        if (p.sessionId === sessionId) splitPanelWidths.delete(p.id);
      }
      let focusedPanelId = state.focusedPanelId;
      // Compute next session to auto-select when active session is deleted
      const getNextSessionId = (): string | null => {
        const orderMap = state.sessionOrder.length > 0
          ? new Map(state.sessionOrder.map((id, i) => [id, i]))
          : null;
        const ordered = Array.from(state.sessions.values()).sort((a, b) => {
          if (!orderMap) return b.createdAt - a.createdAt;
          const oa = orderMap.get(a.id);
          const ob = orderMap.get(b.id);
          if (oa === undefined && ob === undefined) return b.createdAt - a.createdAt;
          if (oa === undefined) return -1;
          if (ob === undefined) return -1;
          return oa - ob;
        });
        const idx = ordered.findIndex((s) => s.id === sessionId);
        const candidate = ordered[idx + 1] ?? ordered[idx - 1];
        return candidate?.id ?? null;
      };
      // If only one panel remains, collapse to single mode
      if (splitPanels.length <= 1) {
        const remainingSessionId = splitPanels[0]?.sessionId ?? null;
        splitPanels = [];
        splitPanelWidths.clear();
        focusedPanelId = null;
        return {
          sessions, messages, hasMoreMessages, loadingHistory, streamingText,
          pendingAttention, pendingRequests, sessionNames, sessionConfig,
          planContent, planPanelOpen, filePreviewTabs, activeFilePreviewTabId, filePreviewOpen, showUserTabs, showUserCache, activeShowUserTabId, showUserPanelOpen, sidePanelMerged, activeMergedTabId,
          splitPanels, splitPanelWidths, focusedPanelId,
          activeSessionId: state.activeSessionId === sessionId
            ? (remainingSessionId ?? getNextSessionId())
            : state.activeSessionId,
        };
      }
      // Multiple panels still remain
      if (state.splitPanels.find((p) => p.id === focusedPanelId)?.sessionId === sessionId) {
        focusedPanelId = splitPanels[0]?.id ?? null;
      }
      return {
        sessions, messages, hasMoreMessages, loadingHistory, streamingText,
        pendingAttention, pendingRequests, sessionNames, sessionConfig,
        planContent, planPanelOpen, filePreviewTabs, activeFilePreviewTabId, filePreviewOpen,
        splitPanels, splitPanelWidths, focusedPanelId,
        activeSessionId: focusedPanelId
          ? splitPanels.find((p) => p.id === focusedPanelId)?.sessionId ?? state.activeSessionId
          : (state.activeSessionId === sessionId ? getNextSessionId() : state.activeSessionId),
      };
    }),

  setActiveSession: (sessionId) =>
    set((state) => {
      if (state.splitPanels.length === 0 || !sessionId) {
        return { activeSessionId: sessionId };
      }
      // In split mode: if session already in a panel, focus it
      const existing = state.splitPanels.find((p) => p.sessionId === sessionId);
      if (existing) {
        return { activeSessionId: sessionId, focusedPanelId: existing.id };
      }
      // Otherwise, replace the focused panel's session
      if (state.focusedPanelId) {
        const splitPanels = state.splitPanels.map((p) =>
          p.id === state.focusedPanelId ? { ...p, sessionId } : p
        );
        return { activeSessionId: sessionId, splitPanels };
      }
      return { activeSessionId: sessionId };
    }),

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

  setPromptQueue: (sessionId, queue) =>
    set((state) => {
      const promptQueue = new Map(state.promptQueue);
      if (queue.length === 0) {
        promptQueue.delete(sessionId);
      } else {
        promptQueue.set(sessionId, queue);
      }
      return { promptQueue };
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

  removePendingRequestById: (requestId) =>
    set((state) => {
      const pendingRequests = new Map(state.pendingRequests);
      for (const [sessionId, requests] of pendingRequests) {
        const filtered = requests.filter((r) => r.requestId !== requestId);
        if (filtered.length !== requests.length) {
          if (filtered.length === 0) {
            pendingRequests.delete(sessionId);
          } else {
            pendingRequests.set(sessionId, filtered);
          }
          // Also clear attention for this permission
          const pendingAttention = new Map(state.pendingAttention);
          const keys = pendingAttention.get(sessionId);
          if (keys) {
            const newKeys = new Set(keys);
            newKeys.delete(`perm:${requestId}`);
            if (newKeys.size === 0) {
              pendingAttention.delete(sessionId);
            } else {
              pendingAttention.set(sessionId, newKeys);
            }
            return { pendingRequests, pendingAttention };
          }
          break;
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
      planPanelOpen.set(sessionId, true);
      const isMerged = state.sidePanelMerged.get(sessionId) ?? false;
      if (isMerged) {
        // In merged mode, set active tab to plan and ensure all panels open
        const activeMergedTabId = new Map(state.activeMergedTabId);
        activeMergedTabId.set(sessionId, "plan");
        const filePreviewOpen = new Map(state.filePreviewOpen);
        if ((state.filePreviewTabs.get(sessionId) || []).length > 0) filePreviewOpen.set(sessionId, true);
        const showUserPanelOpen = new Map(state.showUserPanelOpen);
        if ((state.showUserTabs.get(sessionId) || []).length > 0) showUserPanelOpen.set(sessionId, true);
        return { planContent, planPanelOpen, filePreviewOpen, showUserPanelOpen, activeMergedTabId };
      }
      // Split mode: mutual exclusion
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, false);
      const showUserPanelOpen = new Map(state.showUserPanelOpen);
      showUserPanelOpen.set(sessionId, false);
      return { planContent, planPanelOpen, filePreviewOpen, showUserPanelOpen };
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

  addFilePreviewTab: (sessionId, data) =>
    set((state) => {
      const filePreviewTabs = new Map(state.filePreviewTabs);
      const tabs = [...(filePreviewTabs.get(sessionId) || [])];
      // Check if same file already open — update it
      const existingIdx = tabs.findIndex((t) => t.filePath === data.filePath);
      let tabId: string;
      if (existingIdx !== -1) {
        tabId = tabs[existingIdx].id;
        tabs[existingIdx] = { ...tabs[existingIdx], ...data, loading: false, error: undefined };
      } else {
        tabId = crypto.randomUUID();
        tabs.push({ id: tabId, ...data, loading: false });
      }
      filePreviewTabs.set(sessionId, tabs);
      const activeFilePreviewTabId = new Map(state.activeFilePreviewTabId);
      activeFilePreviewTabId.set(sessionId, tabId);
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, true);
      const isMerged = state.sidePanelMerged.get(sessionId) ?? false;
      if (isMerged) {
        const activeMergedTabId = new Map(state.activeMergedTabId);
        activeMergedTabId.set(sessionId, `file:${tabId}`);
        const planPanelOpen = new Map(state.planPanelOpen);
        if (state.planContent.has(sessionId)) planPanelOpen.set(sessionId, true);
        const showUserPanelOpen = new Map(state.showUserPanelOpen);
        if ((state.showUserTabs.get(sessionId) || []).length > 0) showUserPanelOpen.set(sessionId, true);
        return { filePreviewTabs, activeFilePreviewTabId, filePreviewOpen, planPanelOpen, showUserPanelOpen, activeMergedTabId };
      }
      // Split mode: mutual exclusion
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.set(sessionId, false);
      const showUserPanelOpen = new Map(state.showUserPanelOpen);
      showUserPanelOpen.set(sessionId, false);
      return { filePreviewTabs, activeFilePreviewTabId, filePreviewOpen, planPanelOpen, showUserPanelOpen };
    }),

  setFilePreviewLoading: (sessionId, filePath) =>
    set((state) => {
      const filePreviewTabs = new Map(state.filePreviewTabs);
      const tabs = [...(filePreviewTabs.get(sessionId) || [])];
      const existingIdx = tabs.findIndex((t) => t.filePath === filePath);
      let tabId: string;
      if (existingIdx !== -1) {
        tabId = tabs[existingIdx].id;
        tabs[existingIdx] = { ...tabs[existingIdx], loading: true, error: undefined };
      } else {
        tabId = crypto.randomUUID();
        tabs.push({ id: tabId, filePath, content: "", language: "text", truncated: false, loading: true });
      }
      filePreviewTabs.set(sessionId, tabs);
      const activeFilePreviewTabId = new Map(state.activeFilePreviewTabId);
      activeFilePreviewTabId.set(sessionId, tabId);
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, true);
      const isMerged = state.sidePanelMerged.get(sessionId) ?? false;
      if (isMerged) {
        const activeMergedTabId = new Map(state.activeMergedTabId);
        activeMergedTabId.set(sessionId, `file:${tabId}`);
        const planPanelOpen = new Map(state.planPanelOpen);
        if (state.planContent.has(sessionId)) planPanelOpen.set(sessionId, true);
        const showUserPanelOpen = new Map(state.showUserPanelOpen);
        if ((state.showUserTabs.get(sessionId) || []).length > 0) showUserPanelOpen.set(sessionId, true);
        return { filePreviewTabs, activeFilePreviewTabId, filePreviewOpen, planPanelOpen, showUserPanelOpen, activeMergedTabId };
      }
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.set(sessionId, false);
      const showUserPanelOpen = new Map(state.showUserPanelOpen);
      showUserPanelOpen.set(sessionId, false);
      return { filePreviewTabs, activeFilePreviewTabId, filePreviewOpen, planPanelOpen, showUserPanelOpen };
    }),

  setFilePreviewError: (sessionId, filePath, error) =>
    set((state) => {
      const filePreviewTabs = new Map(state.filePreviewTabs);
      const tabs = [...(filePreviewTabs.get(sessionId) || [])];
      const idx = tabs.findIndex((t) => t.filePath === filePath);
      if (idx !== -1) {
        tabs[idx] = { ...tabs[idx], loading: false, error };
        filePreviewTabs.set(sessionId, tabs);
      }
      return { filePreviewTabs };
    }),

  closeFilePreviewTab: (sessionId, tabId) =>
    set((state) => {
      const filePreviewTabs = new Map(state.filePreviewTabs);
      const tabs = (filePreviewTabs.get(sessionId) || []).filter((t) => t.id !== tabId);
      filePreviewTabs.set(sessionId, tabs);
      const activeFilePreviewTabId = new Map(state.activeFilePreviewTabId);
      if (activeFilePreviewTabId.get(sessionId) === tabId) {
        activeFilePreviewTabId.set(sessionId, tabs[tabs.length - 1]?.id || "");
      }
      if (tabs.length === 0) {
        const filePreviewOpen = new Map(state.filePreviewOpen);
        filePreviewOpen.set(sessionId, false);
        return { filePreviewTabs, activeFilePreviewTabId, filePreviewOpen };
      }
      return { filePreviewTabs, activeFilePreviewTabId };
    }),

  setActiveFilePreviewTab: (sessionId, tabId) =>
    set((state) => {
      const activeFilePreviewTabId = new Map(state.activeFilePreviewTabId);
      activeFilePreviewTabId.set(sessionId, tabId);
      return { activeFilePreviewTabId };
    }),

  setFilePreviewOpen: (sessionId, open) =>
    set((state) => {
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, open);
      return { filePreviewOpen };
    }),

  clearFilePreview: (sessionId) =>
    set((state) => {
      const filePreviewTabs = new Map(state.filePreviewTabs);
      filePreviewTabs.delete(sessionId);
      const activeFilePreviewTabId = new Map(state.activeFilePreviewTabId);
      activeFilePreviewTabId.delete(sessionId);
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.delete(sessionId);
      return { filePreviewTabs, activeFilePreviewTabId, filePreviewOpen };
    }),

  addShowUserTab: (sessionId, title, html) =>
    set((state) => {
      const newTab: ShowUserTab = { id: crypto.randomUUID(), title, html };
      // Add to cache (capped)
      const showUserCache = new Map(state.showUserCache);
      const cache = [...(showUserCache.get(sessionId) || []), newTab];
      if (cache.length > MAX_SHOW_USER_CACHE) cache.splice(0, cache.length - MAX_SHOW_USER_CACHE);
      showUserCache.set(sessionId, cache);
      // Add to open tabs
      const showUserTabs = new Map(state.showUserTabs);
      const tabs = [...(showUserTabs.get(sessionId) || []), newTab];
      showUserTabs.set(sessionId, tabs);
      const tabId = newTab.id;
      const activeShowUserTabId = new Map(state.activeShowUserTabId);
      activeShowUserTabId.set(sessionId, tabId);
      const showUserPanelOpen = new Map(state.showUserPanelOpen);
      showUserPanelOpen.set(sessionId, true);
      const isMerged = state.sidePanelMerged.get(sessionId) ?? false;
      if (isMerged) {
        const activeMergedTabId = new Map(state.activeMergedTabId);
        activeMergedTabId.set(sessionId, `show:${tabId}`);
        const planPanelOpen = new Map(state.planPanelOpen);
        if (state.planContent.has(sessionId)) planPanelOpen.set(sessionId, true);
        const filePreviewOpen = new Map(state.filePreviewOpen);
        if ((state.filePreviewTabs.get(sessionId) || []).length > 0) filePreviewOpen.set(sessionId, true);
        return { showUserTabs, showUserCache, activeShowUserTabId, showUserPanelOpen, planPanelOpen, filePreviewOpen, activeMergedTabId };
      }
      // Split mode: mutual exclusion
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.set(sessionId, false);
      const filePreviewOpen = new Map(state.filePreviewOpen);
      filePreviewOpen.set(sessionId, false);
      return { showUserTabs, showUserCache, activeShowUserTabId, showUserPanelOpen, planPanelOpen, filePreviewOpen };
    }),

  closeShowUserTab: (sessionId, tabId) =>
    set((state) => {
      const showUserTabs = new Map(state.showUserTabs);
      const tabs = (showUserTabs.get(sessionId) || []).filter((t) => t.id !== tabId);
      showUserTabs.set(sessionId, tabs);
      const activeShowUserTabId = new Map(state.activeShowUserTabId);
      if (activeShowUserTabId.get(sessionId) === tabId) {
        activeShowUserTabId.set(sessionId, tabs[tabs.length - 1]?.id || "");
      }
      if (tabs.length === 0) {
        const showUserPanelOpen = new Map(state.showUserPanelOpen);
        showUserPanelOpen.set(sessionId, false);
        return { showUserTabs, activeShowUserTabId, showUserPanelOpen };
      }
      return { showUserTabs, activeShowUserTabId };
    }),

  reopenShowUserTab: (sessionId, tabId) =>
    set((state) => {
      const cache = state.showUserCache.get(sessionId) || [];
      const cached = cache.find((t) => t.id === tabId);
      if (!cached) return {};
      // Check if already open
      const existingTabs = state.showUserTabs.get(sessionId) || [];
      if (existingTabs.some((t) => t.id === tabId)) {
        // Already open, just focus it
        const activeShowUserTabId = new Map(state.activeShowUserTabId);
        activeShowUserTabId.set(sessionId, tabId);
        const showUserPanelOpen = new Map(state.showUserPanelOpen);
        showUserPanelOpen.set(sessionId, true);
        return { activeShowUserTabId, showUserPanelOpen };
      }
      // Reopen from cache
      const showUserTabs = new Map(state.showUserTabs);
      showUserTabs.set(sessionId, [...existingTabs, cached]);
      const activeShowUserTabId = new Map(state.activeShowUserTabId);
      activeShowUserTabId.set(sessionId, tabId);
      const showUserPanelOpen = new Map(state.showUserPanelOpen);
      showUserPanelOpen.set(sessionId, true);
      return { showUserTabs, activeShowUserTabId, showUserPanelOpen };
    }),

  setActiveShowUserTab: (sessionId, tabId) =>
    set((state) => {
      const activeShowUserTabId = new Map(state.activeShowUserTabId);
      activeShowUserTabId.set(sessionId, tabId);
      return { activeShowUserTabId };
    }),

  setShowUserPanelOpen: (sessionId, open) =>
    set((state) => {
      const showUserPanelOpen = new Map(state.showUserPanelOpen);
      showUserPanelOpen.set(sessionId, open);
      return { showUserPanelOpen };
    }),

  clearShowUserContent: (sessionId) =>
    set((state) => {
      const showUserTabs = new Map(state.showUserTabs);
      showUserTabs.delete(sessionId);
      const showUserCache = new Map(state.showUserCache);
      showUserCache.delete(sessionId);
      const activeShowUserTabId = new Map(state.activeShowUserTabId);
      activeShowUserTabId.delete(sessionId);
      const showUserPanelOpen = new Map(state.showUserPanelOpen);
      showUserPanelOpen.delete(sessionId);
      return { showUserTabs, showUserCache, activeShowUserTabId, showUserPanelOpen };
    }),

  setSidePanelMerged: (sessionId, merged) =>
    set((state) => {
      const sidePanelMerged = new Map(state.sidePanelMerged);
      sidePanelMerged.set(sessionId, merged);
      if (merged) {
        // When merging, open all panels that have content
        const planPanelOpen = new Map(state.planPanelOpen);
        const filePreviewOpen = new Map(state.filePreviewOpen);
        const showUserPanelOpen = new Map(state.showUserPanelOpen);
        if (state.planContent.has(sessionId)) planPanelOpen.set(sessionId, true);
        if ((state.filePreviewTabs.get(sessionId) || []).length > 0) filePreviewOpen.set(sessionId, true);
        if ((state.showUserTabs.get(sessionId) || []).length > 0) showUserPanelOpen.set(sessionId, true);
        return { sidePanelMerged, planPanelOpen, filePreviewOpen, showUserPanelOpen };
      }
      return { sidePanelMerged };
    }),

  setActiveMergedTab: (sessionId, tabId) =>
    set((state) => {
      const activeMergedTabId = new Map(state.activeMergedTabId);
      activeMergedTabId.set(sessionId, tabId);
      return { activeMergedTabId };
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

  moveTaskLocal: (projectId, taskId, destColumn, destOrder) =>
    set((state) => {
      const tasks = new Map(state.tasks);
      const existing = tasks.get(projectId) || [];
      const taskIdx = existing.findIndex((t) => t.id === taskId);
      if (taskIdx === -1) return state;

      const task = existing[taskIdx];
      const srcColumn = task.column;
      const srcOrder = task.order;

      let updated: Task[];

      if (srcColumn === destColumn) {
        // Same-column reorder
        updated = existing.map((t) => {
          if (t.column !== srcColumn) return t;
          if (t.id === taskId) return { ...t, order: destOrder };
          if (srcOrder < destOrder) {
            if (t.order > srcOrder && t.order <= destOrder) {
              return { ...t, order: t.order - 1 };
            }
          } else {
            if (t.order >= destOrder && t.order < srcOrder) {
              return { ...t, order: t.order + 1 };
            }
          }
          return t;
        });
      } else {
        // Cross-column move
        updated = existing.map((t) => {
          if (t.id === taskId) {
            return { ...t, column: destColumn, order: destOrder };
          }
          if (t.column === srcColumn && t.order > srcOrder) {
            return { ...t, order: t.order - 1 };
          }
          if (t.column === destColumn && t.order >= destOrder) {
            return { ...t, order: t.order + 1 };
          }
          return t;
        });
      }

      tasks.set(projectId, updated);
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

  reorderSessions: (orderedIds) => set({ sessionOrder: orderedIds }),
  reorderProjects: (orderedIds) => set({ projectOrder: orderedIds }),

  setOrchestratorSession: (projectId, sessionId) =>
    set((state) => {
      const orchestratorSessions = new Map(state.orchestratorSessions);
      if (sessionId) {
        orchestratorSessions.set(projectId, sessionId);
      } else {
        orchestratorSessions.delete(projectId);
      }
      return { orchestratorSessions };
    }),

  // ── Split Panel ──

  splitSession: (sessionId) =>
    set((state) => {
      if (state.splitPanels.length >= MAX_SPLIT_PANELS) return {};
      if (state.splitPanels.length === 0) {
        // Transition from single to split: create panel for current active + new
        if (!state.activeSessionId) return {};
        const panel1: SplitPanel = { id: crypto.randomUUID(), sessionId: state.activeSessionId };
        const panel2: SplitPanel = { id: crypto.randomUUID(), sessionId };
        return {
          splitPanels: [panel1, panel2],
          focusedPanelId: panel2.id,
          activeSessionId: sessionId,
        };
      }
      // Already in split mode: add a new panel
      const newPanel: SplitPanel = { id: crypto.randomUUID(), sessionId };
      return {
        splitPanels: [...state.splitPanels, newPanel],
        focusedPanelId: newPanel.id,
        activeSessionId: sessionId,
      };
    }),

  removeSplitPanel: (panelId) =>
    set((state) => {
      const remaining = state.splitPanels.filter((p) => p.id !== panelId);
      const splitPanelWidths = new Map(state.splitPanelWidths);
      splitPanelWidths.delete(panelId);
      if (remaining.length <= 1) {
        // Collapse to single mode
        const sessionId = remaining[0]?.sessionId ?? state.activeSessionId;
        return {
          splitPanels: [],
          splitPanelWidths: new Map(),
          focusedPanelId: null,
          activeSessionId: sessionId,
        };
      }
      // Re-focus if the removed panel was focused
      let focusedPanelId = state.focusedPanelId;
      if (focusedPanelId === panelId) {
        focusedPanelId = remaining[0].id;
      }
      return {
        splitPanels: remaining,
        splitPanelWidths,
        focusedPanelId,
        activeSessionId: remaining.find((p) => p.id === focusedPanelId)?.sessionId ?? state.activeSessionId,
      };
    }),

  focusSplitPanel: (panelId) =>
    set((state) => {
      const panel = state.splitPanels.find((p) => p.id === panelId);
      if (!panel) return {};
      return { focusedPanelId: panelId, activeSessionId: panel.sessionId };
    }),

  setSplitPanelWidth: (panelId, width) =>
    set((state) => {
      const splitPanelWidths = new Map(state.splitPanelWidths);
      splitPanelWidths.set(panelId, width);
      return { splitPanelWidths };
    }),

  clearSplitPanels: () =>
    set((state) => ({
      splitPanels: [],
      splitPanelWidths: new Map(),
      focusedPanelId: null,
    })),
}));
