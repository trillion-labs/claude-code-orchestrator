"use client";

import { useCallback, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { useProjectStore } from "@/hooks/useProjectStore";
import { useStore } from "@/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { PendingPermissions } from "./PendingPermissions";
import { FolderOpen, Server, Trash2, LayoutGrid, GripVertical, RotateCcw, X, ChevronDown, ChevronRight } from "lucide-react";
import { ALL_TASKS_ID } from "@/lib/shared/types";
import type { Project, TrashedProject } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";

interface ProjectSidebarProps {
  send: (msg: ClientMessage) => void;
  onNavigateToSession: (sessionId: string) => void;
}

interface SortableProjectItemProps {
  project: Project;
  isActive: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function SortableProjectItem({ project, isActive, onClick, onDelete }: SortableProjectItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={`
        group flex flex-col gap-1 p-2.5 rounded-lg cursor-pointer transition-colors
        ${isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
        }
      `}
    >
      <div className="flex items-center gap-2">
        <button
          className="cursor-grab active:cursor-grabbing p-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none shrink-0"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-sm font-medium truncate flex-1">
          {project.name}
        </span>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-red-400 transition-all"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-[1.625rem]">
        <Server className="w-2.5 h-2.5" />
        <span className="truncate">{project.machineId}</span>
        <span className="truncate">{project.workDir}</span>
      </div>
    </div>
  );
}

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs}초 전`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}분 전`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}일 전`;
}

export function ProjectSidebar({ send, onNavigateToSession }: ProjectSidebarProps) {
  const { projects, activeProjectId, setActiveProject, reorderProjects } = useProjectStore();
  const trashedProjects = useStore((state) => state.trashedProjects);
  const [trashOpen, setTrashOpen] = useState(false);

  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    send({ type: "project.delete", projectId });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = projects.findIndex((p) => p.id === active.id);
      const newIndex = projects.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = projects.map((p) => p.id);
      const [moved] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, moved);
      reorderProjects(newOrder);
    },
    [projects, reorderProjects],
  );

  const projectIds = projects.map((p) => p.id);

  return (
    <>
      <ScrollArea className="flex-1 min-w-0" data-sidebar-scroll>
        <div className="p-2 space-y-1">
          {/* All Tasks entry */}
          {projects.length > 0 && (
            <>
              <div
                onClick={() => {
                  setActiveProject(ALL_TASKS_ID);
                  for (const p of projects) {
                    send({ type: "task.list", projectId: p.id });
                  }
                }}
                className={`
                  group flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-colors
                  ${activeProjectId === ALL_TASKS_ID
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                  }
                `}
              >
                <LayoutGrid className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-sm font-medium truncate flex-1">All Tasks</span>
              </div>
              <div className="border-b my-1" />
            </>
          )}

          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No projects yet
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
                {projects.map((project) => (
                  <SortableProjectItem
                    key={project.id}
                    project={project}
                    isActive={project.id === activeProjectId}
                    onClick={() => {
                      setActiveProject(project.id);
                      send({ type: "task.list", projectId: project.id });
                    }}
                    onDelete={(e) => handleDeleteProject(e, project.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </ScrollArea>

      {/* Trash bin section */}
      <Separator />
      <div className="px-2 py-1">
        <button
          onClick={() => setTrashOpen((v) => !v)}
          className="w-full flex items-center gap-2 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-sm"
        >
          {trashOpen ? (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          <Trash2 className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="font-medium flex-1 text-left">Trash</span>
          {trashedProjects.length > 0 && (
            <span className="text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
              {trashedProjects.length}
            </span>
          )}
        </button>
        {trashOpen && (
          <div className="mt-1 space-y-0.5">
            {trashedProjects.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                Empty
              </p>
            ) : (
              trashedProjects.map((item: TrashedProject) => (
                <div
                  key={item.project.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg group hover:bg-accent/30"
                >
                  <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{item.project.name}</div>
                    <div className="text-[10px] text-muted-foreground">{relativeTime(item.deletedAt)}</div>
                  </div>
                  <button
                    title="복원"
                    onClick={() => send({ type: "project.restore", projectId: item.project.id })}
                    className="p-0.5 rounded text-muted-foreground hover:text-green-500 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <button
                    title="Delete permanently"
                    onClick={() => {
                      if (confirm(`Permanently delete "${item.project.name}"? This cannot be undone.`)) {
                        send({ type: "project.purge", projectId: item.project.id });
                      }
                    }}
                    className="p-0.5 rounded text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <PendingPermissions onNavigate={onNavigateToSession} />

      <Separator />
      <div className="p-3 text-xs text-muted-foreground text-center">
        {projects.length} project{projects.length !== 1 ? "s" : ""}
      </div>
    </>
  );
}
