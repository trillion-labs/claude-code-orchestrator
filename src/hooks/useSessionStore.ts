"use client";

import { useCallback, useMemo } from "react";
import { useStore } from "@/store";
import type { Session, ConversationMessage } from "@/lib/shared/types";

export function useSessionStore() {
  const {
    sessions,
    activeSessionId,
    machines,
    messages,
    streamingText,
    discoveredSessions,
    pendingAttention,
    sessionNames,
    worktrees,
    sessionOrder,
    setActiveSession,
    setSessionName,
    removeAttention,
    clearAttention,
    reorderSessions,
  } = useStore();

  const sessionsArray = useMemo(() => {
    const all = Array.from(sessions.values());
    if (sessionOrder.length === 0) {
      return all.sort((a, b) => b.createdAt - a.createdAt);
    }
    const orderMap = new Map(sessionOrder.map((id, i) => [id, i]));
    return all.sort((a, b) => {
      const oa = orderMap.get(a.id);
      const ob = orderMap.get(b.id);
      // New sessions not in order go to the front
      if (oa === undefined && ob === undefined) return b.createdAt - a.createdAt;
      if (oa === undefined) return -1;
      if (ob === undefined) return -1;
      return oa - ob;
    });
  }, [sessions, sessionOrder]);

  const activeSession: Session | undefined = activeSessionId
    ? sessions.get(activeSessionId)
    : undefined;

  const activeMessages: ConversationMessage[] = activeSessionId
    ? messages.get(activeSessionId) || []
    : [];

  const activeStreamingText: string = activeSessionId
    ? streamingText.get(activeSessionId) || ""
    : "";

  const getSessionDisplayName = useCallback(
    (sessionId: string): string | undefined => {
      // Priority 1: user-set custom name
      const customName = sessionNames.get(sessionId);
      if (customName) return customName;

      // Priority 2: auto-extract from first user message (max 50 chars)
      const sessionMessages = messages.get(sessionId);
      if (sessionMessages) {
        const firstUserMsg = sessionMessages.find((m) => m.role === "user");
        if (firstUserMsg) {
          const text = firstUserMsg.content.trim();
          return text.length > 50 ? text.slice(0, 47) + "..." : text;
        }
      }

      return undefined;
    },
    [sessionNames, messages]
  );

  return {
    sessions: sessionsArray,
    activeSession,
    activeSessionId,
    activeMessages,
    activeStreamingText,
    machines,
    discoveredSessions,
    pendingAttention,
    sessionNames,
    worktrees,
    setActiveSession,
    setSessionName,
    removeAttention,
    clearAttention,
    getSessionDisplayName,
    reorderSessions,
  };
}
