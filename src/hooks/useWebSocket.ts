"use client";

import { useEffect, useRef, useCallback } from "react";
import { useStore } from "@/store";
import type { ClientMessage, ServerMessage } from "@/lib/shared/protocol";

const WS_URL = typeof window !== "undefined"
  ? `ws://${window.location.hostname}:${window.location.port}/ws`
  : "";

const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

export interface PathListResult {
  entries: Array<{ name: string; isDir: boolean }>;
  resolvedPath: string;
  prefix?: string;
  error?: string;
}

export interface MkdirResult {
  success: boolean;
  resolvedPath: string;
  error?: string;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathListCallbacksRef = useRef<Map<string, (result: PathListResult) => void>>(new Map());
  const mkdirCallbacksRef = useRef<Map<string, (result: MkdirResult) => void>>(new Map());

  const {
    addSession,
    updateSessionStatus,
    updateSessionPermissionMode,
    removeSession,
    setSessions,
    setMachines,
    addMessage,
    appendStreamDelta,
    setDiscoveredSessions,
    addAttention,
    clearAttention,
    addPendingRequest,
    clearPendingRequests,
    setGlobalConfig,
    setSessionConfig,
    setPlanContent,
    setWorktrees,
    // Projects & Kanban
    setProjects,
    addProject,
    updateProject,
    removeProject,
    setTasks,
    addTask,
    updateTask,
    removeTask,
    updateSessionLink,
    updateSessionProject,
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
          }
          addAttention(msg.sessionId, `perm:${msg.request.requestId}`);
          addPendingRequest(msg.sessionId, msg.request);
          break;

        case "session.permissionModeChanged":
          updateSessionPermissionMode(msg.sessionId, msg.mode);
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
          // Clear attention and pending requests when session is no longer busy
          // (expired permission requests are no longer actionable)
          if (msg.status !== "busy") {
            clearAttention(msg.sessionId);
            clearPendingRequests(msg.sessionId);
          }
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

        case "worktrees.list":
          setWorktrees(msg.machineId, msg.worktrees);
          break;

        case "path.list": {
          const cb = pathListCallbacksRef.current.get(msg.requestId);
          if (cb) {
            cb({ entries: msg.entries, resolvedPath: msg.resolvedPath, prefix: msg.prefix, error: msg.error });
            pathListCallbacksRef.current.delete(msg.requestId);
          }
          break;
        }

        case "path.mkdir": {
          const mkdirCb = mkdirCallbacksRef.current.get(msg.requestId);
          if (mkdirCb) {
            mkdirCb({ success: msg.success, resolvedPath: msg.resolvedPath, error: msg.error });
            mkdirCallbacksRef.current.delete(msg.requestId);
          }
          break;
        }

        case "config.data":
          setGlobalConfig(msg.settings, msg.claudemd);
          break;

        case "config.saved":
          console.log(`[Config] Saved ${msg.file}`);
          break;

        case "config.error":
          console.error("[Config] Error:", msg.error);
          break;

        case "session.planContent":
          setPlanContent(msg.sessionId, msg.content);
          break;

        case "session.config.data":
          setSessionConfig(msg.sessionId, msg.settings, msg.claudemd);
          break;

        case "session.config.saved":
          console.log(`[SessionConfig] Saved ${msg.file} for ${msg.sessionId}`);
          break;

        case "session.config.error":
          console.error(`[SessionConfig] Error for ${msg.sessionId}:`, msg.error);
          break;

        case "session.error":
          console.error(`Session ${msg.sessionId} error:`, msg.error);
          break;

        case "error":
          console.error("Server error:", msg.error);
          break;

        // ── Project & Task messages ──

        case "project.created":
          addProject(msg.project);
          break;

        case "project.updated":
          updateProject(msg.project);
          break;

        case "project.deleted":
          removeProject(msg.projectId);
          break;

        case "project.list":
          setProjects(msg.projects);
          break;

        case "task.created":
          addTask(msg.task);
          break;

        case "task.updated":
          updateTask(msg.task);
          break;

        case "task.deleted":
          removeTask(msg.projectId, msg.taskId);
          break;

        case "task.moved":
          updateTask(msg.task);
          break;

        case "task.reordered":
          // Re-fetch tasks for the project to get correct order
          break;

        case "task.list":
          setTasks(msg.projectId, msg.tasks);
          break;

        case "task.submitted":
          updateTask(msg.task);
          addSession(msg.session);
          break;

        case "task.resumed":
          updateTask(msg.task);
          addSession(msg.session);
          break;

        case "task.sessionImported":
          addTask(msg.task);
          updateSessionLink(msg.session.id, msg.task.projectId, msg.task.id);
          break;

        case "task.sessionLinked":
          updateTask(msg.task);
          updateSessionLink(msg.session.id, msg.task.projectId, msg.task.id);
          break;

        case "task.sessionCompleted":
          updateTask(msg.task);
          break;

        case "session.projectChanged":
          updateSessionProject(msg.sessionId, msg.projectId);
          break;
      }
    },
    [addSession, updateSessionStatus, updateSessionPermissionMode, removeSession, setSessions, setMachines, addMessage, appendStreamDelta, setDiscoveredSessions, addAttention, clearAttention, addPendingRequest, clearPendingRequests, setGlobalConfig, setSessionConfig, setPlanContent, setWorktrees, setProjects, addProject, updateProject, removeProject, setTasks, addTask, updateTask, removeTask, updateSessionLink, updateSessionProject]
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
      ws.send(JSON.stringify({ type: "project.list" }));
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

  const requestPathList = useCallback(
    (machineId: string, path: string): Promise<PathListResult> => {
      return new Promise((resolve) => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          pathListCallbacksRef.current.delete(requestId);
          resolve({ entries: [], resolvedPath: path, error: "Request timed out" });
        }, 5000);

        pathListCallbacksRef.current.set(requestId, (result) => {
          clearTimeout(timer);
          resolve(result);
        });

        send({ type: "path.list", machineId, path, requestId });
      });
    },
    [send],
  );

  const requestMkdir = useCallback(
    (machineId: string, path: string): Promise<MkdirResult> => {
      return new Promise((resolve) => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          mkdirCallbacksRef.current.delete(requestId);
          resolve({ success: false, resolvedPath: path, error: "Request timed out" });
        }, 5000);

        mkdirCallbacksRef.current.set(requestId, (result) => {
          clearTimeout(timer);
          resolve(result);
        });

        send({ type: "path.mkdir", machineId, path, requestId });
      });
    },
    [send],
  );

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return { send, requestPathList, requestMkdir };
}
