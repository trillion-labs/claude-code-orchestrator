"use client";

import { useMemo } from "react";
import { useStore } from "@/store";
import type { Task, KanbanColumn } from "@/lib/shared/types";

export function useProjectStore() {
  const {
    projects,
    activeProjectId,
    tasks,
    viewMode,
    sessions,
    setActiveProject,
    setViewMode,
  } = useStore();

  const projectsArray = useMemo(
    () => Array.from(projects.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [projects]
  );

  const activeProject = activeProjectId
    ? projects.get(activeProjectId)
    : undefined;

  const activeProjectTasks = activeProjectId
    ? tasks.get(activeProjectId) || []
    : [];

  const getTasksByColumn = useMemo(() => {
    return (projectId: string, column: KanbanColumn): Task[] => {
      const projectTasks = tasks.get(projectId) || [];
      return projectTasks
        .filter((t) => t.column === column)
        .sort((a, b) => a.order - b.order);
    };
  }, [tasks]);

  // Get the linked session for a task
  const getTaskSession = useMemo(() => {
    return (sessionId?: string) => {
      if (!sessionId) return undefined;
      return sessions.get(sessionId);
    };
  }, [sessions]);

  return {
    projects: projectsArray,
    activeProject,
    activeProjectId,
    activeProjectTasks,
    viewMode,
    setActiveProject,
    setViewMode,
    getTasksByColumn,
    getTaskSession,
  };
}
