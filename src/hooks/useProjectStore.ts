"use client";

import { useMemo } from "react";
import { useStore } from "@/store";
import { ALL_TASKS_ID } from "@/lib/shared/types";
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

  const isAllTasksView = activeProjectId === ALL_TASKS_ID;

  const activeProject = activeProjectId && activeProjectId !== ALL_TASKS_ID
    ? projects.get(activeProjectId)
    : undefined;

  const activeProjectTasks = activeProjectId && activeProjectId !== ALL_TASKS_ID
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

  // Get tasks across all projects for a given column
  const getAllTasksByColumn = useMemo(() => {
    return (column: KanbanColumn, excludedProjectIds?: Set<string>): Task[] => {
      const result: Task[] = [];
      for (const [projectId, projectTasks] of tasks) {
        if (excludedProjectIds?.has(projectId)) continue;
        for (const t of projectTasks) {
          if (t.column === column) result.push(t);
        }
      }
      return result.sort((a, b) => b.updatedAt - a.updatedAt);
    };
  }, [tasks]);

  // Get the linked session for a task
  const getTaskSession = useMemo(() => {
    return (sessionId?: string) => {
      if (!sessionId) return undefined;
      return sessions.get(sessionId);
    };
  }, [sessions]);

  // Get project name by id
  const getProjectName = useMemo(() => {
    return (projectId: string) => {
      return projects.get(projectId)?.name;
    };
  }, [projects]);

  return {
    projects: projectsArray,
    activeProject,
    activeProjectId,
    activeProjectTasks,
    isAllTasksView,
    viewMode,
    setActiveProject,
    setViewMode,
    getTasksByColumn,
    getAllTasksByColumn,
    getTaskSession,
    getProjectName,
  };
}
