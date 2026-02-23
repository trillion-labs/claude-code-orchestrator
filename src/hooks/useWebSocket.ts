"use client";

import { useEffect, useRef, useCallback } from "react";
import { useStore } from "@/store";
import type { ClientMessage, ServerMessage } from "@/lib/shared/protocol";

const WS_URL = typeof window !== "undefined"
  ? `ws://${window.location.hostname}:${window.location.port}/ws`
  : "";

const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    addSession,
    updateSessionStatus,
    removeSession,
    setSessions,
    setMachines,
    addMessage,
    appendStreamDelta,
    setDiscoveredSessions,
    addAttention,
  } = useStore();

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const msg = JSON.parse(event.data) as ServerMessage;

      switch (msg.type) {
        case "session.created":
          addSession(msg.session);
          break;

        case "session.stream":
          appendStreamDelta(msg.sessionId, msg.delta);
          break;

        case "session.permissionRequest":
          if (msg.request.toolName === "AskUserQuestion") {
            addAttention(msg.sessionId, "question");
            // Auto-allow to unblock server's handlePermissionRequest —
            // the actual user answer is delivered via the prompt flow
            (event.target as WebSocket).send(
              JSON.stringify({
                type: "session.permissionResponse",
                sessionId: msg.sessionId,
                requestId: msg.request.requestId,
                allow: true,
              })
            );
          } else {
            addAttention(msg.sessionId, `perm:${msg.request.requestId}`);
          }
          break;

        case "session.message":
          addMessage(msg.sessionId, msg.message);
          break;

        case "session.status":
          updateSessionStatus(
            msg.sessionId,
            msg.status,
            msg.totalCostUsd,
            msg.error
          );
          break;

        case "session.terminated":
          removeSession(msg.sessionId);
          break;

        case "session.list":
          setSessions(msg.sessions);
          break;

        case "machines.list":
          setMachines(msg.machines);
          break;

        case "session.discovered":
          setDiscoveredSessions(msg.machineId, msg.sessions);
          break;

        case "session.error":
          console.error(`Session ${msg.sessionId} error:`, msg.error);
          break;

        case "error":
          console.error("Server error:", msg.error);
          break;
      }
    },
    [addSession, updateSessionStatus, removeSession, setSessions, setMachines, addMessage, appendStreamDelta, setDiscoveredSessions, addAttention]
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[WS] Connected");
      reconnectDelayRef.current = RECONNECT_DELAY;

      // Request current state
      ws.send(JSON.stringify({ type: "session.list" }));
      ws.send(JSON.stringify({ type: "machines.list" }));
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      console.log("[WS] Disconnected, reconnecting...");
      wsRef.current = null;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(
          reconnectDelayRef.current * 1.5,
          MAX_RECONNECT_DELAY
        );
        connect();
      }, reconnectDelayRef.current);
    };

    ws.onerror = () => {
      // Browser WebSocket errors don't expose details; reconnect handles recovery
    };

    wsRef.current = ws;
  }, [handleMessage]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return { send };
}
