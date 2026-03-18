"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useStore } from "@/store";
import { useProjectStore } from "@/hooks/useProjectStore";
import { KanbanColumn } from "./KanbanColumn";
import { TaskCard } from "./TaskCard";
import { TaskDialog } from "./TaskDialog";
import { TaskDetail } from "./TaskDetail";
import { ManagerChatPanel } from "./ManagerChatPanel";
import { SessionPickerDialog } from "./SessionPickerDialog";
import { KANBAN_COLUMNS } from "@/lib/shared/types";
import type { Task, KanbanColumn as KanbanColumnType, Project } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";
import { Button } from "@/components/ui/button";
import { Server, FolderOpen, Link, GripVertical, Wand2 } from "lucide-react";

interface ProjectBoardProps {
  project: Project;
  send: (msg: ClientMessage) => void;
  onViewSession: (sessionId: string) => void;
}

export function ProjectBoard({ project, send, onViewSession }: ProjectBoardProps) {
  const { getTasksByColumn, getTaskSession } = useProjectStore();
  const { messages, streamingText, sessions } = useStore();
  const tasks = useStore((s) => s.tasks);
  const removeAttention = useStore((s) => s.removeAttention);
  const setSessionName = useStore((s) => s.setSessionName);
  const removePendingRequest = useStore((s) => s.removePendingRequest);
  const orchestratorSessionId = useStore((s) => s.orchestratorSessions.get(project.id));
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [managerPanelOpen, setManagerPanelOpen] = useState(false);
  const [detailWidth, setDetailWidth] = useState(780);

  // Derive selectedTask from store so it stays in sync with updates
  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    const projectTasks = tasks.get(project.id) || [];
    return projectTasks.find((t) => t.id === selectedTaskId) ?? null;
  }, [selectedTaskId, tasks, project.id]);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - e.clientX;
      const maxWidth = Math.floor(window.innerWidth * 0.7);
      const newWidth = Math.min(maxWidth, Math.max(320, resizeRef.current.startWidth + delta));
      setDetailWidth(newWidth);
    };
    const handleMouseUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    // Find the task being dragged across all columns
    for (const col of KANBAN_COLUMNS) {
      const tasks = getTasksByColumn(project.id, col.id);
      const task = tasks.find((t) => t.id === active.id);
      if (task) {
        setActiveTask(task);
        break;
      }
    }
  }, [getTasksByColumn, project.id]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);

      if (!over) return;

      const taskId = active.id as string;
      const overId = over.id as string;

      // Determine destination column
      let destColumn: KanbanColumnType | undefined;
      let destOrder = 0;

      // Check if dropped on a column directly
      const columnMatch = KANBAN_COLUMNS.find((c) => c.id === overId);
      if (columnMatch) {
        destColumn = columnMatch.id;
        destOrder = getTasksByColumn(project.id, destColumn).length;
      } else {
        // Dropped on another task — find which column that task is in
        for (const col of KANBAN_COLUMNS) {
          const tasks = getTasksByColumn(project.id, col.id);
          const overIdx = tasks.findIndex((t) => t.id === overId);
          if (overIdx !== -1) {
            destColumn = col.id;
            destOrder = overIdx;
            break;
          }
        }
      }

      if (!destColumn) return;

      // Find source task
      let sourceTask: Task | undefined;
      for (const col of KANBAN_COLUMNS) {
        const tasks = getTasksByColumn(project.id, col.id);
        sourceTask = tasks.find((t) => t.id === taskId);
        if (sourceTask) break;
      }

      if (!sourceTask) return;
      if (sourceTask.column === destColumn && sourceTask.order === destOrder) return;

      send({
        type: "task.move",
        projectId: project.id,
        taskId,
        column: destColumn,
        order: destOrder,
      });
    },
    [getTasksByColumn, project.id, send]
  );

  const handleCreateTask = (title: string, description: string) => {
    send({ type: "task.create", projectId: project.id, title, description });
  };

  const handleImportSession = (sessionId: string) => {
    send({ type: "task.importSession", projectId: project.id, sessionId });
  };

  const handleManagerClick = () => {
    if (managerPanelOpen) {
      setManagerPanelOpen(false);
    } else {
      setManagerPanelOpen(true);
      setSelectedTaskId(null); // Close task detail if open
      if (!orchestratorSessionId) {
        // Auto-create/resume orchestrator session
        send({ type: "orchestrator.create", projectId: project.id });
      }
    }
  };

  const handleSubmitTask = (task: Task) => {
    send({ type: "task.submit", projectId: project.id, taskId: task.id });
  };

  const handleLinkSession = (taskId: string, sessionId: string) => {
    send({ type: "task.linkSession", projectId: project.id, taskId, sessionId });
  };

  const handleUpdateTask = (taskId: string, updates: { title?: string; description?: string }) => {
    send({ type: "task.update", projectId: project.id, taskId, updates });
    // Sync title to linked session
    if (updates.title) {
      const projectTasks = tasks.get(project.id) || [];
      const task = projectTasks.find((t) => t.id === taskId);
      if (task?.sessionId) {
        setSessionName(task.sessionId, updates.title);
      }
    }
  };

  const handleEditTitle = (taskId: string, newTitle: string) => {
    handleUpdateTask(taskId, { title: newTitle });
  };

  const handleDeleteTask = (taskId: string) => {
    send({ type: "task.delete", projectId: project.id, taskId });
    setSelectedTaskId(null);
  };

  const handleResumeTask = (task: Task) => {
    send({ type: "task.resume", projectId: project.id, taskId: task.id });
  };

  const selectedSession = selectedTask?.sessionId
    ? sessions.get(selectedTask.sessionId)
    : undefined;

  const selectedMessages = selectedTask?.sessionId
    ? messages.get(selectedTask.sessionId) || []
    : [];

  const selectedStreamingText = selectedTask?.sessionId
    ? streamingText.get(selectedTask.sessionId) || ""
    : "";

  // Manager session data
  const managerSession = orchestratorSessionId
    ? sessions.get(orchestratorSessionId)
    : undefined;

  const managerMessages = orchestratorSessionId
    ? messages.get(orchestratorSessionId) || []
    : [];

  const managerStreamingText = orchestratorSessionId
    ? streamingText.get(orchestratorSessionId) || ""
    : "";

  // Whether we can resume a previous manager session (has claudeSessionId but no live session)
  const hasResumableManager = !orchestratorSessionId && !!project.orchestratorClaudeSessionId;

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Board header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b min-w-0">
        <h2 className="text-sm font-semibold truncate min-w-0 flex-1">{project.name}</h2>
        <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
          <span className="flex items-center gap-1">
            <Server className="w-3 h-3 flex-shrink-0" />
            <span className="truncate max-w-[120px]">{project.machineId}</span>
          </span>
          <span className="flex items-center gap-1">
            <FolderOpen className="w-3 h-3 flex-shrink-0" />
            <span className="truncate max-w-[200px]">{project.workDir}</span>
          </span>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <Button
            variant={managerPanelOpen || orchestratorSessionId ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={handleManagerClick}
          >
            <Wand2 className="w-3.5 h-3.5" />
            Manager
          </Button>
          <SessionPickerDialog
            title="Import Session as Task"
            onSelectSession={handleImportSession}
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5">
                <Link className="w-3.5 h-3.5" />
                Import Session
              </Button>
            }
          />
          <TaskDialog onCreateTask={handleCreateTask} />
        </div>
      </div>

      {/* Board body */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Kanban columns */}
        <div className="flex-1 overflow-x-auto min-w-0">
          <div className="flex gap-3 p-4 w-max">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              {KANBAN_COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.id}
                  column={col.id}
                  label={col.label}
                  tasks={getTasksByColumn(project.id, col.id)}
                  getSession={getTaskSession}
                  onTaskClick={(task) => { setSelectedTaskId(task.id); setManagerPanelOpen(false); }}
                  onTaskSubmit={handleSubmitTask}
                  onViewSession={onViewSession}
                  onEditTitle={handleEditTitle}
                />
              ))}

              <DragOverlay>
                {activeTask ? (
                  <div className="opacity-80">
                    <TaskCard
                      task={activeTask}
                      session={getTaskSession(activeTask.sessionId)}
                      onClick={() => {}}
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>

        {/* Side panel (Task detail OR Manager chat — mutually exclusive) */}
        {(selectedTask || managerPanelOpen) && (
          <div className="flex-shrink-0 flex" style={{ width: detailWidth }}>
            {/* Resize handle */}
            <div
              className="w-1.5 flex-shrink-0 cursor-col-resize flex items-center justify-center hover:bg-violet-500/20 active:bg-violet-500/30 transition-colors group"
              onMouseDown={(e) => {
                e.preventDefault();
                resizeRef.current = { startX: e.clientX, startWidth: detailWidth };
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
            >
              <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-violet-400 transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
            {selectedTask ? (
              <TaskDetail
                task={selectedTask}
                session={selectedSession}
                messages={selectedMessages}
                streamingText={selectedStreamingText}
                onClose={() => setSelectedTaskId(null)}
                onUpdate={(updates) => handleUpdateTask(selectedTask.id, updates)}
                onDelete={() => handleDeleteTask(selectedTask.id)}
                onSubmit={() => handleSubmitTask(selectedTask)}
                onLinkSession={(sessionId) => handleLinkSession(selectedTask.id, sessionId)}
                onResume={() => handleResumeTask(selectedTask)}
                onViewSession={onViewSession.bind(null, selectedTask.sessionId!)}
                onSendPrompt={(prompt) => {
                  if (selectedTask.sessionId) {
                    send({ type: "session.prompt", sessionId: selectedTask.sessionId, prompt });
                  }
                }}
                onCancelPrompt={() => {
                  if (selectedTask.sessionId) {
                    send({ type: "session.interrupt", sessionId: selectedTask.sessionId });
                  }
                }}
                onPermissionResponse={(requestId, allow, answers, message) => {
                  if (selectedTask.sessionId) {
                    send({
                      type: "session.permissionResponse",
                      sessionId: selectedTask.sessionId,
                      requestId,
                      allow,
                      answers,
                      message,
                    });
                    removeAttention(selectedTask.sessionId, `perm:${requestId}`);
                    removeAttention(selectedTask.sessionId, "question");
                    removePendingRequest(selectedTask.sessionId, requestId);
                  }
                }}
              />
            ) : (
              <ManagerChatPanel
                session={managerSession}
                messages={managerMessages}
                streamingText={managerStreamingText}
                hasResumableSession={hasResumableManager}
                onClose={() => setManagerPanelOpen(false)}
                onViewSession={() => orchestratorSessionId && onViewSession(orchestratorSessionId)}
                onCreateOrResume={() => send({ type: "orchestrator.create", projectId: project.id })}
                onSendPrompt={(prompt) => send({ type: "orchestrator.prompt", projectId: project.id, prompt })}
                onCancelPrompt={() => {
                  if (orchestratorSessionId) {
                    send({ type: "session.interrupt", sessionId: orchestratorSessionId });
                  }
                }}
                onPermissionResponse={(requestId, allow, answers, message) => {
                  if (orchestratorSessionId) {
                    send({
                      type: "session.permissionResponse",
                      sessionId: orchestratorSessionId,
                      requestId,
                      allow,
                      answers,
                      message,
                    });
                    removeAttention(orchestratorSessionId, `perm:${requestId}`);
                    removeAttention(orchestratorSessionId, "question");
                    removePendingRequest(orchestratorSessionId, requestId);
                  }
                }}
              />
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
