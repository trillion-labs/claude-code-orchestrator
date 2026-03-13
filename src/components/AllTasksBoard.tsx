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
import { TaskDetail } from "./TaskDetail";
import { SessionPickerDialog } from "./SessionPickerDialog";
import { KANBAN_COLUMNS } from "@/lib/shared/types";
import type { Task, KanbanColumn as KanbanColumnType } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LayoutGrid, Filter, Check, GripVertical } from "lucide-react";

interface AllTasksBoardProps {
  send: (msg: ClientMessage) => void;
  onViewSession: (sessionId: string) => void;
}

export function AllTasksBoard({ send, onViewSession }: AllTasksBoardProps) {
  const { projects, getAllTasksByColumn, getTaskSession, getProjectName } = useProjectStore();
  const { messages, streamingText, sessions } = useStore();
  const tasks = useStore((s) => s.tasks);
  const setSessionName = useStore((s) => s.setSessionName);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailWidth, setDetailWidth] = useState(780);
  const [excludedProjects, setExcludedProjects] = useState<Set<string>>(new Set());

  // Derive selectedTask across all projects
  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    for (const [, projectTasks] of tasks) {
      const found = projectTasks.find((t) => t.id === selectedTaskId);
      if (found) return found;
    }
    return null;
  }, [selectedTaskId, tasks]);

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

  // Find a task across all projects
  const findTask = useCallback((taskId: string): Task | undefined => {
    for (const [, projectTasks] of tasks) {
      const found = projectTasks.find((t) => t.id === taskId);
      if (found) return found;
    }
    return undefined;
  }, [tasks]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = findTask(event.active.id as string);
    if (task) setActiveTask(task);
  }, [findTask]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);
      if (!over) return;

      const taskId = active.id as string;
      const overId = over.id as string;
      const sourceTask = findTask(taskId);
      if (!sourceTask) return;

      // Determine destination column
      let destColumn: KanbanColumnType | undefined;
      let destOrder = 0;

      const columnMatch = KANBAN_COLUMNS.find((c) => c.id === overId);
      if (columnMatch) {
        destColumn = columnMatch.id;
        destOrder = getAllTasksByColumn(destColumn, excludedProjects).length;
      } else {
        // Dropped on another task
        const overTask = findTask(overId);
        if (overTask) {
          destColumn = overTask.column;
          const colTasks = getAllTasksByColumn(overTask.column, excludedProjects);
          const overIdx = colTasks.findIndex((t) => t.id === overId);
          destOrder = overIdx !== -1 ? overIdx : 0;
        }
      }

      if (!destColumn) return;
      if (sourceTask.column === destColumn && sourceTask.order === destOrder) return;

      send({
        type: "task.move",
        projectId: sourceTask.projectId,
        taskId,
        column: destColumn,
        order: destOrder,
      });
    },
    [findTask, getAllTasksByColumn, excludedProjects, send]
  );

  const handleSubmitTask = (task: Task) => {
    send({ type: "task.submit", projectId: task.projectId, taskId: task.id });
  };

  const handleDoneTask = (task: Task) => {
    const doneTasks = getAllTasksByColumn("done", excludedProjects);
    send({ type: "task.move", projectId: task.projectId, taskId: task.id, column: "done", order: doneTasks.length });
  };

  const handleLinkSession = (taskId: string, sessionId: string) => {
    const task = findTask(taskId);
    if (task) {
      send({ type: "task.linkSession", projectId: task.projectId, taskId, sessionId });
    }
  };

  const handleUpdateTask = (taskId: string, updates: { title?: string; description?: string }) => {
    const task = findTask(taskId);
    if (task) {
      send({ type: "task.update", projectId: task.projectId, taskId, updates });
      // Sync title to linked session
      if (updates.title && task.sessionId) {
        setSessionName(task.sessionId, updates.title);
      }
    }
  };

  const handleEditTitle = (taskId: string, newTitle: string) => {
    handleUpdateTask(taskId, { title: newTitle });
  };

  const handleDeleteTask = (task: Task) => {
    send({ type: "task.delete", projectId: task.projectId, taskId: task.id });
    setSelectedTaskId(null);
  };

  const handleResumeTask = (task: Task) => {
    send({ type: "task.resume", projectId: task.projectId, taskId: task.id });
  };

  const toggleProjectFilter = (projectId: string) => {
    setExcludedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const totalTaskCount = useMemo(() => {
    let count = 0;
    for (const [projectId, projectTasks] of tasks) {
      if (!excludedProjects.has(projectId)) count += projectTasks.length;
    }
    return count;
  }, [tasks, excludedProjects]);

  const selectedSession = selectedTask?.sessionId
    ? sessions.get(selectedTask.sessionId)
    : undefined;

  const selectedMessages = selectedTask?.sessionId
    ? messages.get(selectedTask.sessionId) || []
    : [];

  const selectedStreamingText = selectedTask?.sessionId
    ? streamingText.get(selectedTask.sessionId) || ""
    : "";

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Board header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b min-w-0">
        <LayoutGrid className="w-4 h-4 flex-shrink-0" />
        <h2 className="text-sm font-semibold truncate min-w-0 flex-1">All Tasks</h2>
        <span className="text-xs text-muted-foreground">
          {totalTaskCount} task{totalTaskCount !== 1 ? "s" : ""} across {projects.length - excludedProjects.size} project{projects.length - excludedProjects.size !== 1 ? "s" : ""}
        </span>

        {/* Project filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="w-3.5 h-3.5" />
              Filter
              {excludedProjects.size > 0 && (
                <span className="text-[10px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full">
                  {projects.length - excludedProjects.size}/{projects.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <p className="text-xs font-medium text-muted-foreground px-2 py-1.5">Show projects</p>
            {projects.map((project) => {
              const isIncluded = !excludedProjects.has(project.id);
              return (
                <button
                  key={project.id}
                  onClick={() => toggleProjectFilter(project.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors"
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    isIncluded
                      ? "bg-violet-500 border-violet-500"
                      : "border-muted-foreground/30"
                  }`}>
                    {isIncluded && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="truncate">{project.name}</span>
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
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
                  tasks={getAllTasksByColumn(col.id, excludedProjects)}
                  getSession={getTaskSession}
                  onTaskClick={(task) => setSelectedTaskId(task.id)}
                  onTaskSubmit={handleSubmitTask}
                  onTaskDone={handleDoneTask}
                  onViewSession={onViewSession}
                  onEditTitle={handleEditTitle}
                  getProjectName={getProjectName}
                />
              ))}

              <DragOverlay>
                {activeTask ? (
                  <div className="opacity-80">
                    <TaskCard
                      task={activeTask}
                      session={getTaskSession(activeTask.sessionId)}
                      onClick={() => {}}
                      projectName={getProjectName(activeTask.projectId)}
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>

        {/* Task detail panel */}
        {selectedTask && (
          <div className="flex-shrink-0 flex" style={{ width: detailWidth }}>
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
              <TaskDetail
                task={selectedTask}
                session={selectedSession}
                messages={selectedMessages}
                streamingText={selectedStreamingText}
                onClose={() => setSelectedTaskId(null)}
                onUpdate={(updates) => handleUpdateTask(selectedTask.id, updates)}
                onDelete={() => handleDeleteTask(selectedTask)}
                onSubmit={() => handleSubmitTask(selectedTask)}
                onDone={() => handleDoneTask(selectedTask)}
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
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
