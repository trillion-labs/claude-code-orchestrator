"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard } from "./TaskCard";
import type { Task, KanbanColumn as KanbanColumnType, Session } from "@/lib/shared/types";

const COLUMN_STYLES: Record<KanbanColumnType, string> = {
  "todo": "border-slate-500/25",
  "in-progress": "border-blue-500/25",
  "in-review": "border-amber-500/25",
  "done": "border-emerald-500/25",
};

const COLUMN_HEADER_STYLES: Record<KanbanColumnType, string> = {
  "todo": "text-slate-400",
  "in-progress": "text-blue-400",
  "in-review": "text-amber-400",
  "done": "text-emerald-400",
};

interface KanbanColumnProps {
  column: KanbanColumnType;
  label: string;
  tasks: Task[];
  getSession: (sessionId?: string) => Session | undefined;
  onTaskClick: (task: Task) => void;
  onTaskSubmit: (task: Task) => void;
  onTaskDone: (task: Task) => void;
  onViewSession: (sessionId: string) => void;
  onEditTitle?: (taskId: string, newTitle: string) => void;
  getProjectName?: (projectId: string) => string | undefined;
  projectWorkDir?: string;
}

export function KanbanColumn({
  column,
  label,
  tasks,
  getSession,
  onTaskClick,
  onTaskSubmit,
  onTaskDone,
  onViewSession,
  onEditTitle,
  getProjectName,
  projectWorkDir,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const taskIds = tasks.map((t) => t.id);

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col w-[260px] min-w-[260px] flex-shrink-0 rounded-lg border bg-muted/30
        ${COLUMN_STYLES[column]}
        ${isOver ? "ring-2 ring-foreground/10 bg-muted/50" : ""}
        transition-colors
      `}
    >
      {/* Column header */}
      <div className="p-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h3 className={`text-sm font-semibold ${COLUMN_HEADER_STYLES[column]}`}>
            {label}
          </h3>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Task list */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[100px]">
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50">
              No tasks
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                session={getSession(task.sessionId)}
                onClick={() => onTaskClick(task)}
                onSubmit={task.column === "todo" ? () => onTaskSubmit(task) : undefined}
                onDone={task.column === "in-review" ? () => onTaskDone(task) : undefined}
                onViewSession={
                  task.sessionId
                    ? () => onViewSession(task.sessionId!)
                    : undefined
                }
                onEditTitle={onEditTitle}
                projectName={getProjectName?.(task.projectId)}
                projectWorkDir={projectWorkDir}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
