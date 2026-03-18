"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
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
import { Server, FolderOpen, Link, GripVertical, Wand2, Columns2, Layers, X } from "lucide-react";

interface ProjectBoardProps {
  project: Project;
  send: (msg: ClientMessage) => void;
  onViewSession: (sessionId: string) => void;
}

export function ProjectBoard({ project, send, onViewSession }: ProjectBoardProps) {
  const { getTasksByColumn, getTaskSession } = useProjectStore();
  const { messages, streamingText, sessions } = useStore();
  const tasks = useStore((s) => s.tasks);
  const moveTaskLocal = useStore((s) => s.moveTaskLocal);
  const removeAttention = useStore((s) => s.removeAttention);
  const setSessionName = useStore((s) => s.setSessionName);
  const removePendingRequest = useStore((s) => s.removePendingRequest);
  const orchestratorSessionId = useStore((s) => s.orchestratorSessions.get(project.id));
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [openTaskIds, setOpenTaskIds] = useState<string[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [managerPanelOpen, setManagerPanelOpen] = useState(false);
  const [sidePanelMode, setSidePanelMode] = useState<"split" | "tabbed">("split");
  const [activeTab, setActiveTab] = useState<"task" | "manager">("task");
  const [taskPanelWidth, setTaskPanelWidth] = useState(480);
  const [managerPanelWidth, setManagerPanelWidth] = useState(480);
  const [tabbedPanelWidth, setTabbedPanelWidth] = useState(780);

  const projectTasks = useMemo(() => tasks.get(project.id) || [], [tasks, project.id]);

  // Derive active task from store
  const activeOpenTask = useMemo(() => {
    if (!activeTaskId) return null;
    return projectTasks.find((t) => t.id === activeTaskId) ?? null;
  }, [activeTaskId, projectTasks]);

  // Resolve open tasks for tab rendering
  const openTasks = useMemo(() => {
    return openTaskIds
      .map((id) => projectTasks.find((t) => t.id === id))
      .filter(Boolean) as Task[];
  }, [openTaskIds, projectTasks]);

  const hasTaskPanel = openTaskIds.length > 0;
  const resizeRef = useRef<{ startX: number; startWidth: number; target: "task" | "manager" | "tabbed" } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - e.clientX;
      const maxWidth = Math.floor(window.innerWidth * 0.7);
      const newWidth = Math.min(maxWidth, Math.max(300, resizeRef.current.startWidth + delta));
      if (resizeRef.current.target === "task") setTaskPanelWidth(newWidth);
      else if (resizeRef.current.target === "manager") setManagerPanelWidth(newWidth);
      else setTabbedPanelWidth(newWidth);
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

  const columnIds = useMemo(() => new Set<string | number>(KANBAN_COLUMNS.map((c) => c.id)), []);

  const collisionDetection: CollisionDetection = useCallback((args) => {
    // First: check if pointer is within any droppable (columns included)
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      // Prefer column-level droppable when pointer is inside it
      const columnHit = pointerCollisions.find((c) => columnIds.has(c.id as string));
      if (columnHit) {
        // Also check for task-level hits within the same column for reordering
        const taskHits = pointerCollisions.filter((c) => !columnIds.has(c.id as string));
        return taskHits.length > 0 ? taskHits : [columnHit];
      }
      return pointerCollisions;
    }
    // Fallback: closest center for edge cases
    return closestCenter(args);
  }, [columnIds]);

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

      // Optimistic local update
      moveTaskLocal(project.id, taskId, destColumn, destOrder);

      send({
        type: "task.move",
        projectId: project.id,
        taskId,
        column: destColumn,
        order: destOrder,
      });
    },
    [getTasksByColumn, project.id, send, moveTaskLocal]
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
      if (sidePanelMode === "tabbed") setActiveTab("manager");
      if (!orchestratorSessionId) {
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

  const handleCloseTaskTab = useCallback((taskId: string) => {
    setOpenTaskIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      if (activeTaskId === taskId) {
        const idx = prev.indexOf(taskId);
        setActiveTaskId(next[Math.min(idx, next.length - 1)] ?? null);
      }
      return next;
    });
  }, [activeTaskId]);

  const handleOpenTask = useCallback((taskId: string) => {
    setOpenTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
    setActiveTaskId(taskId);
    if (sidePanelMode === "tabbed") setActiveTab("task");
  }, [sidePanelMode]);

  const handleDeleteTask = (taskId: string) => {
    send({ type: "task.delete", projectId: project.id, taskId });
    handleCloseTaskTab(taskId);
  };

  const handleDoneTask = (task: Task) => {
    const doneTasks = getTasksByColumn(project.id, "done");
    send({ type: "task.move", projectId: project.id, taskId: task.id, column: "done", order: doneTasks.length });
    if (task.sessionId) {
      send({ type: "session.terminate", sessionId: task.sessionId });
    }
  };

  const handleResumeTask = (task: Task) => {
    send({ type: "task.resume", projectId: project.id, taskId: task.id });
  };

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
          {/* Split/Tabbed toggle — only when both panels are open */}
          {hasTaskPanel && managerPanelOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setSidePanelMode(sidePanelMode === "split" ? "tabbed" : "split")}
              title={sidePanelMode === "split" ? "Switch to tabbed view" : "Switch to split view"}
            >
              {sidePanelMode === "split" ? <Layers className="w-3.5 h-3.5" /> : <Columns2 className="w-3.5 h-3.5" />}
              {sidePanelMode === "split" ? "Tabbed" : "Split"}
            </Button>
          )}
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
              collisionDetection={collisionDetection}
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
                  onTaskClick={(task) => handleOpenTask(task.id)}
                  onTaskSubmit={handleSubmitTask}
                  onTaskDone={handleDoneTask}
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

        {/* Side panels */}
        {(hasTaskPanel || managerPanelOpen) && (() => {
          const bothOpen = hasTaskPanel && managerPanelOpen;

          const renderTaskDetail = (task: Task) => {
            const session = task.sessionId ? sessions.get(task.sessionId) : undefined;
            const msgs = task.sessionId ? messages.get(task.sessionId) || [] : [];
            const streaming = task.sessionId ? streamingText.get(task.sessionId) || "" : "";
            return (
              <TaskDetail
                key={task.id}
                task={task}
                session={session}
                messages={msgs}
                streamingText={streaming}
                onClose={() => handleCloseTaskTab(task.id)}
                onUpdate={(updates) => handleUpdateTask(task.id, updates)}
                onDelete={() => handleDeleteTask(task.id)}
                onSubmit={() => handleSubmitTask(task)}
                onDone={() => handleDoneTask(task)}
                onLinkSession={(sessionId) => handleLinkSession(task.id, sessionId)}
                onResume={() => handleResumeTask(task)}
                onViewSession={onViewSession.bind(null, task.sessionId!)}
                onSendPrompt={(prompt) => {
                  if (task.sessionId) {
                    send({ type: "session.prompt", sessionId: task.sessionId, prompt });
                  }
                }}
                onCancelPrompt={() => {
                  if (task.sessionId) {
                    send({ type: "session.interrupt", sessionId: task.sessionId });
                  }
                }}
                onPermissionResponse={(requestId, allow, answers, message) => {
                  if (task.sessionId) {
                    send({
                      type: "session.permissionResponse",
                      sessionId: task.sessionId,
                      requestId,
                      allow,
                      answers,
                      message,
                    });
                    removeAttention(task.sessionId, `perm:${requestId}`);
                    removeAttention(task.sessionId, "question");
                    removePendingRequest(task.sessionId, requestId);
                  }
                }}
              />
            );
          };

          const managerChatEl = managerPanelOpen && (
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
          );

          const resizeHandle = (target: "task" | "manager" | "tabbed", width: number) => (
            <div
              className="w-1.5 flex-shrink-0 cursor-col-resize flex items-center justify-center hover:bg-violet-500/20 active:bg-violet-500/30 transition-colors group"
              onMouseDown={(e) => {
                e.preventDefault();
                resizeRef.current = { startX: e.clientX, startWidth: width, target };
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
            >
              <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-violet-400 transition-colors" />
            </div>
          );

          // Task tab bar component
          const taskTabBar = (includeManager: boolean) => (
            <div className="flex items-center border-b border-l bg-muted/30 overflow-x-auto">
              {includeManager && (
                <button
                  className={`flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0 border-r border-border/50 ${activeTab === "manager" ? "bg-background border-b-2 border-violet-500 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                  onClick={() => setActiveTab("manager")}
                >
                  <Wand2 className="w-3 h-3" />
                  Manager
                </button>
              )}
              {openTasks.map((task) => {
                const isActive = includeManager
                  ? activeTab === "task" && task.id === activeTaskId
                  : task.id === activeTaskId;
                return (
                  <button
                    key={task.id}
                    className={`group/tab flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0 max-w-[180px] ${isActive ? "bg-background border-b-2 border-violet-500 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                    onClick={() => {
                      setActiveTaskId(task.id);
                      if (includeManager) setActiveTab("task");
                    }}
                  >
                    <span className="truncate">{task.title}</span>
                    <span
                      className="p-0.5 rounded opacity-0 group-hover/tab:opacity-100 hover:bg-accent"
                      onClick={(e) => { e.stopPropagation(); handleCloseTaskTab(task.id); }}
                    >
                      <X className="w-3 h-3" />
                    </span>
                  </button>
                );
              })}
            </div>
          );

          // Task panel content (tab bar + active task detail)
          const taskPanelContent = (
            <div className="flex flex-col h-full">
              {openTasks.length > 1 && taskTabBar(false)}
              <div className="flex-1 min-h-0">
                {activeOpenTask && renderTaskDetail(activeOpenTask)}
              </div>
            </div>
          );

          // Both panels open — split or tabbed
          if (bothOpen) {
            if (sidePanelMode === "split") {
              return (
                <>
                  {/* Task detail panel */}
                  <div className="flex-shrink-0 flex" style={{ width: taskPanelWidth }}>
                    {resizeHandle("task", taskPanelWidth)}
                    <div className="flex-1 min-w-0">{taskPanelContent}</div>
                  </div>
                  {/* Manager chat panel */}
                  <div className="flex-shrink-0 flex" style={{ width: managerPanelWidth }}>
                    {resizeHandle("manager", managerPanelWidth)}
                    <div className="flex-1 min-w-0">{managerChatEl}</div>
                  </div>
                </>
              );
            }

            // Tabbed mode — all task tabs + manager tab in one panel
            return (
              <div className="flex-shrink-0 flex" style={{ width: tabbedPanelWidth }}>
                {resizeHandle("tabbed", tabbedPanelWidth)}
                <div className="flex-1 min-w-0 flex flex-col h-full">
                  {taskTabBar(true)}
                  <div className="flex-1 min-h-0">
                    {activeTab === "task" && activeOpenTask
                      ? renderTaskDetail(activeOpenTask)
                      : managerChatEl}
                  </div>
                </div>
              </div>
            );
          }

          // Single panel type open (tasks only or manager only)
          if (hasTaskPanel) {
            return (
              <div className="flex-shrink-0 flex" style={{ width: tabbedPanelWidth }}>
                {resizeHandle("tabbed", tabbedPanelWidth)}
                <div className="flex-1 min-w-0">{taskPanelContent}</div>
              </div>
            );
          }

          // Manager only
          return (
            <div className="flex-shrink-0 flex" style={{ width: tabbedPanelWidth }}>
              {resizeHandle("tabbed", tabbedPanelWidth)}
              <div className="flex-1 min-w-0">{managerChatEl}</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
