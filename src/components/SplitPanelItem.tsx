"use client";

import { useCallback } from "react";
import { SessionView } from "./SessionView";
import { useStore } from "@/store";
import type { SplitPanel } from "@/store";
import type { ClientMessage } from "@/lib/shared/protocol";
import type { FileReadResult } from "@/hooks/useWebSocket";

interface SplitPanelItemProps {
  panel: SplitPanel;
  isFocused: boolean;
  isLast: boolean;
  canClose: boolean;
  send: (msg: ClientMessage) => void;
  requestFileRead: (machineId: string, filePath: string, maxLines?: number) => Promise<FileReadResult>;
}

export function SplitPanelItem({
  panel,
  isFocused,
  isLast,
  canClose,
  send,
  requestFileRead,
}: SplitPanelItemProps) {
  const session = useStore((s) => s.sessions.get(panel.sessionId));
  const messages = useStore((s) => s.messages.get(panel.sessionId) || []);
  const streamingText = useStore((s) => s.streamingText.get(panel.sessionId) || "");
  const sessionNames = useStore((s) => s.sessionNames);
  const sessionMessages = useStore((s) => s.messages);
  const width = useStore((s) => s.splitPanelWidths.get(panel.id));
  const focusSplitPanel = useStore((s) => s.focusSplitPanel);
  const removeSplitPanel = useStore((s) => s.removeSplitPanel);
  const splitSession = useStore((s) => s.splitSession);
  const removeAttention = useStore((s) => s.removeAttention);
  const removePendingRequest = useStore((s) => s.removePendingRequest);

  const getDisplayName = useCallback((): string | undefined => {
    const customName = sessionNames.get(panel.sessionId);
    if (customName) return customName;
    const msgs = sessionMessages.get(panel.sessionId);
    if (msgs) {
      const firstUserMsg = msgs.find((m) => m.role === "user");
      if (firstUserMsg) {
        const text = firstUserMsg.content.trim();
        return text.length > 50 ? text.slice(0, 47) + "..." : text;
      }
    }
    return undefined;
  }, [panel.sessionId, sessionNames, sessionMessages]);

  const handleSendPrompt = useCallback((prompt: string) => {
    send({ type: "session.prompt", sessionId: panel.sessionId, prompt });
    removeAttention(panel.sessionId, "question");
  }, [panel.sessionId, send, removeAttention]);

  const handlePermissionResponse = useCallback((requestId: string, allow: boolean, answers?: Record<string, string>, message?: string) => {
    send({ type: "session.permissionResponse", sessionId: panel.sessionId, requestId, allow, answers, message });
    removeAttention(panel.sessionId, `perm:${requestId}`);
    removeAttention(panel.sessionId, "question");
    removePendingRequest(panel.sessionId, requestId);
  }, [panel.sessionId, send, removeAttention, removePendingRequest]);

  const handleTerminate = useCallback(() => {
    send({ type: "session.terminate", sessionId: panel.sessionId });
  }, [panel.sessionId, send]);

  const handleFocus = useCallback(() => {
    if (!isFocused) {
      focusSplitPanel(panel.id);
    }
  }, [panel.id, isFocused, focusSplitPanel]);

  const handleClose = useCallback(() => {
    removeSplitPanel(panel.id);
  }, [panel.id, removeSplitPanel]);

  if (!session) return null;

  const style: React.CSSProperties = isLast
    ? { flex: 1, minWidth: 400 }
    : { width: width ?? undefined, flex: width ? undefined : 1, minWidth: 400 };

  return (
    <div
      className={`flex flex-col min-w-0 overflow-hidden relative ${
        isFocused ? "border-t-2 border-primary" : "border-t-2 border-transparent"
      }`}
      style={style}
      onMouseDown={handleFocus}
    >
      <SessionView
        session={session}
        messages={messages}
        streamingText={streamingText}
        displayName={getDisplayName()}
        onSendPrompt={handleSendPrompt}
        onPermissionResponse={handlePermissionResponse}
        onTerminate={handleTerminate}
        send={send}
        requestFileRead={requestFileRead}
        onSplitRight={splitSession}
        onClosePanel={canClose ? handleClose : undefined}
      />
    </div>
  );
}
