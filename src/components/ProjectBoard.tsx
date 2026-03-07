"use client";

import { useState, useCallback } from "react";
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
import { KANBAN_COLUMNS } from "@/lib/shared/types";
import type { Task, KanbanColumn as KanbanColumnType, Project } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";
import { Server, FolderOpen } from "lucide-react";

interface ProjectBoardProps {
  project: Project;
  send: (msg: ClientMessage) => void;
  onViewSession: (sessionId: string) => void;
}

export function ProjectBoard({ project, send, onViewSession }: ProjectBoardProps) {
  const { getTasksByColumn, getTaskSession } = useProjectStore();
  const { messages, streamingText, sessions } = useStore();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

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

  const handleSubmitTask = (task: Task) => {
    send({ type: "task.submit", projectId: project.id, taskId: task.id });
  };

  const handleUpdateTask = (taskId: string, updates: { title?: string; description?: string }) => {
    send({ type: "task.update", projectId: project.id, taskId, updates });
  };

  const handleDeleteTask = (task: Task) => {
    send({ type: "task.delete", projectId: project.id, taskId: task.id });
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
        <div className="flex-shrink-0">
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
                  onTaskClick={(task) => setSelectedTask(task)}
                  onTaskSubmit={handleSubmitTask}
                  onTaskDelete={handleDeleteTask}
                  onViewSession={onViewSession}
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

        {/* Task detail panel */}
        {selectedTask && (
          <div className="w-[380px] flex-shrink-0">
            <TaskDetail
              task={selectedTask}
              session={selectedSession}
              messages={selectedMessages}
              streamingText={selectedStreamingText}
              onClose={() => setSelectedTask(null)}
              onUpdate={(updates) => handleUpdateTask(selectedTask.id, updates)}
              onSubmit={() => handleSubmitTask(selectedTask)}
              onViewSession={onViewSession.bind(null, selectedTask.sessionId!)}
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
        )}
      </div>
    </div>
  );
}
