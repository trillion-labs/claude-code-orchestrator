import { create } from "zustand";
import type { Session, MachineConfig, ConversationMessage, ClaudeSessionInfo, PermissionMode } from "@/lib/shared/types";

interface SessionState {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  machines: MachineConfig[];
  // Per-session message history
  messages: Map<string, ConversationMessage[]>;
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
  // Existing worktrees per machine (from worktrees.list)
  worktrees: Map<string, Array<{ name: string; path: string; branch: string }>>

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
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  setMachines: (machines: MachineConfig[]) => void;

  // Messages
  addMessage: (sessionId: string, message: ConversationMessage) => void;

  // Streaming
  appendStreamDelta: (sessionId: string, delta: string) => void;
  clearStreamingText: (sessionId: string) => void;

  // Discovered sessions
  setDiscoveredSessions: (machineId: string, sessions: ClaudeSessionInfo[]) => void;

  // Permissions
  respondPermission: (requestId: string, decision: "allow" | "deny") => void;
  setPermissionAnswers: (requestId: string, selections: Map<number, string | string[]>) => void;

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
  // Worktrees
  setWorktrees: (machineId: string, worktrees: Array<{ name: string; path: string; branch: string }>) => void;
}

export const useStore = create<SessionState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,
  machines: [],
  messages: new Map(),
  streamingText: new Map(),
  discoveredSessions: new Map(),
  respondedPermissions: new Map(),
  permissionAnswers: new Map(),
  pendingAttention: new Map(),
  sessionNames: new Map(),
  globalSettings: null,
  globalClaudeMd: null,
  sessionConfig: new Map(),
  planContent: new Map(),
  planPanelOpen: new Map(),
  worktrees: new Map(),

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

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(sessionId);
      const messages = new Map(state.messages);
      messages.delete(sessionId);
      const streamingText = new Map(state.streamingText);
      streamingText.delete(sessionId);
      const pendingAttention = new Map(state.pendingAttention);
      pendingAttention.delete(sessionId);
      const sessionNames = new Map(state.sessionNames);
      sessionNames.delete(sessionId);
      const sessionConfig = new Map(state.sessionConfig);
      sessionConfig.delete(sessionId);
      const planContent = new Map(state.planContent);
      planContent.delete(sessionId);
      const planPanelOpen = new Map(state.planPanelOpen);
      planPanelOpen.delete(sessionId);
      return {
        sessions,
        messages,
        streamingText,
        pendingAttention,
        sessionNames,
        sessionConfig,
        planContent,
        planPanelOpen,
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
      return { planContent, planPanelOpen };
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

  setWorktrees: (machineId, worktrees) =>
    set((state) => {
      const wt = new Map(state.worktrees);
      wt.set(machineId, worktrees);
      return { worktrees: wt };
    }),
}));
