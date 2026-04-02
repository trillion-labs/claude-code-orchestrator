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
import { KANBAN_COLUMNS, REVIEW_MODES } from "@/lib/shared/types";
import type { Task, KanbanColumn as KanbanColumnType, Project, ReviewMode } from "@/lib/shared/types";
import type { ClientMessage } from "@/lib/shared/protocol";
import { Button } from "@/components/ui/button";
import { NotesList } from "./NotesList";
import { NoteDetail } from "./NoteDetail";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Server, FolderOpen, Link, GripVertical, Wand2, Columns2, Layers, X, FileText, Plus, ChevronDown, Check, Eye } from "lucide-react";

interface ProjectBoardProps {
  project: Project;
  send: (msg: ClientMessage) => void;
  onViewSession: (sessionId: string) => void;
}

// Module-level cache: survives unmount (e.g. projects ↔ sessions view switch)
interface PanelState {
  openTaskIds: string[];
  openNoteIds: string[];
  managerPanelOpen: boolean;
  managerSplit: boolean; // true = manager in separate panel, false = manager as tab
  activeTabId: string | null; // "manager" | task id | note id
  noteSidebarOpen: boolean;
}
const panelStateCache = new Map<string, PanelState>();

// Global (not per-project) — persists across project switches and unmounts
let globalProjectTab: "kanban" | "notes" = "kanban";

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

  // Restore per-project panel state from cache (or use defaults)
  const cached = panelStateCache.get(project.id);
  const [openTaskIds, setOpenTaskIds] = useState<string[]>(cached?.openTaskIds ?? []);
  const [openNoteIds, setOpenNoteIds] = useState<string[]>(cached?.openNoteIds ?? []);
  const [managerPanelOpen, setManagerPanelOpen] = useState(cached?.managerPanelOpen ?? false);
  const [managerSplit, setManagerSplit] = useState(cached?.managerSplit ?? false);
  const [activeTabId, setActiveTabId] = useState<string | null>(cached?.activeTabId ?? null);
  const [noteSidebarOpen, setNoteSidebarOpen] = useState(cached?.noteSidebarOpen ?? false);
  const [projectTab, _setProjectTab] = useState<"kanban" | "notes">(globalProjectTab);
  const setProjectTab = (v: "kanban" | "notes") => { globalProjectTab = v; _setProjectTab(v); };
  const [contentPanelWidth, setContentPanelWidth] = useState(580);
  const [managerPanelWidth, setManagerPanelWidth] = useState(480);
  const [reviewModeOpen, setReviewModeOpen] = useState(false);

  // Save panel state to cache on every state change (keyed by current project)
  const prevProjectId = useRef<string>(project.id);
  const currentProjectId = useRef<string>(project.id);
  currentProjectId.current = project.id;

  useEffect(() => {
    panelStateCache.set(currentProjectId.current, {
      openTaskIds, openNoteIds, managerPanelOpen, managerSplit, activeTabId, noteSidebarOpen,
    });
  }, [openTaskIds, openNoteIds, managerPanelOpen, managerSplit, activeTabId, noteSidebarOpen]);

  useEffect(() => {
    // Project switch: restore cached state for the new project
    if (prevProjectId.current !== project.id) {
      const next = panelStateCache.get(project.id);
      if (next) {
        setOpenTaskIds(next.openTaskIds);
        setOpenNoteIds(next.openNoteIds);
        setManagerPanelOpen(next.managerPanelOpen);
        setManagerSplit(next.managerSplit);
        setActiveTabId(next.activeTabId);
        setNoteSidebarOpen(next.noteSidebarOpen);
      } else {
        setOpenTaskIds([]);
        setOpenNoteIds([]);
        setManagerPanelOpen(false);
        setManagerSplit(false);
        setActiveTabId(null);
        setNoteSidebarOpen(false);
      }
      prevProjectId.current = project.id;
    }
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const projectTasks = useMemo(() => tasks.get(project.id) || [], [tasks, project.id]);

  // Resolve open tasks for tab rendering
  const openTasks = useMemo(() => {
    return openTaskIds
      .map((id) => projectTasks.find((t) => t.id === id))
      .filter(Boolean) as Task[];
  }, [openTaskIds, projectTasks]);

  // Whether there's any content to show in the content panel (tasks, notes, or non-split manager)
  const hasContentPanel = openTasks.length > 0 || openNoteIds.length > 0 || (managerPanelOpen && !managerSplit);

  const resizeRef = useRef<{ startX: number; startWidth: number; target: "content" | "manager" } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - e.clientX;
      const maxWidth = Math.floor(window.innerWidth * 0.7);
      const newWidth = Math.min(maxWidth, Math.max(300, resizeRef.current.startWidth + delta));
      if (resizeRef.current.target === "content") setContentPanelWidth(newWidth);
      else setManagerPanelWidth(newWidth);
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
      // If active tab was manager, switch to something else
      if (activeTabId === "manager") {
        setActiveTabId(openTaskIds[0] ?? openNoteIds[0] ?? null);
      }
    } else {
      setManagerPanelOpen(true);
      if (!managerSplit) setActiveTabId("manager");
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
      if (activeTabId === taskId) {
        // Pick next tab: adjacent task, or any open note, or manager, or null
        const idx = prev.indexOf(taskId);
        const nextTaskId = next[Math.min(idx, next.length - 1)];
        setActiveTabId(nextTaskId ?? openNoteIds[0] ?? (managerPanelOpen && !managerSplit ? "manager" : null));
      }
      return next;
    });
  }, [activeTabId, openNoteIds, managerPanelOpen, managerSplit]);

  const handleOpenTask = useCallback((taskId: string) => {
    setOpenTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
    setActiveTabId(taskId);
  }, []);

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

  const handleRetryTask = (task: Task) => {
    if (task.sessionId) {
      send({ type: "session.refresh", sessionId: task.sessionId });
    }
  };

  // ── Notes data & handlers (for kanban sidebar + side panel) ──
  const notesMap = useStore((s) => s.notes);
  const noteContentMap = useStore((s) => s.noteContent);
  const setNoteContent = useStore((s) => s.setNoteContent);
  const projectNotes = useMemo(() => notesMap.get(project.id) || [], [notesMap, project.id]);
  const sortedNotes = useMemo(() => [...projectNotes].sort((a, b) => b.updatedAt - a.updatedAt), [projectNotes]);

  const prevNoteCountRef = useRef(projectNotes.length);

  // Fetch note list when sidebar opens
  useEffect(() => {
    if (noteSidebarOpen) {
      send({ type: "note.list", projectId: project.id });
    }
  }, [noteSidebarOpen, project.id, send]);

  // Auto-open newly created notes in the side panel
  useEffect(() => {
    if (projectNotes.length > prevNoteCountRef.current) {
      const newest = [...projectNotes].sort((a, b) => b.createdAt - a.createdAt)[0];
      if (newest) {
        handleOpenNote(newest.id);
      }
    }
    prevNoteCountRef.current = projectNotes.length;
  }, [projectNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNotes = useMemo(
    () => openNoteIds.map((id) => projectNotes.find((n) => n.id === id)).filter(Boolean) as typeof projectNotes,
    [openNoteIds, projectNotes]
  );
  const activeNote = useMemo(
    () => (activeTabId ? projectNotes.find((n) => n.id === activeTabId) ?? null : null),
    [activeTabId, projectNotes]
  );

  const handleOpenNote = useCallback((noteId: string) => {
    setOpenNoteIds((prev) => (prev.includes(noteId) ? prev : [...prev, noteId]));
    setActiveTabId(noteId);
    if (!noteContentMap.has(noteId)) {
      send({ type: "note.get", projectId: project.id, noteId });
    }
  }, [noteContentMap, project.id, send]);

  const handleCloseNoteTab = useCallback((noteId: string) => {
    setOpenNoteIds((prev) => {
      const next = prev.filter((id) => id !== noteId);
      if (activeTabId === noteId) {
        const idx = prev.indexOf(noteId);
        const nextNoteId = next[Math.min(idx, next.length - 1)];
        setActiveTabId(nextNoteId ?? openTaskIds[0] ?? (managerPanelOpen && !managerSplit ? "manager" : null));
      }
      return next;
    });
  }, [activeTabId, openTaskIds, managerPanelOpen, managerSplit]);

  const handleUpdateNote = useCallback((noteId: string, updates: { title?: string; content?: string }) => {
    send({ type: "note.update", projectId: project.id, noteId, updates });
    if (updates.content !== undefined) {
      setNoteContent(noteId, updates.content);
    }
  }, [project.id, send, setNoteContent]);

  const handleDeleteNote = useCallback((noteId: string) => {
    send({ type: "note.delete", projectId: project.id, noteId });
    handleCloseNoteTab(noteId);
  }, [project.id, send, handleCloseNoteTab]);

  const handleCreateNote = () => {
    send({ type: "note.create", projectId: project.id, title: "Untitled Note", content: "" });
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
      <div className="flex items-center gap-3 px-4 py-2 border-b min-w-0 h-12">
        <h2 className="text-sm font-semibold truncate min-w-0">{project.name}</h2>
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
          <button
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${projectTab === "kanban" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setProjectTab("kanban")}
          >
            Kanban
          </button>
          <button
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${projectTab === "notes" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setProjectTab("notes")}
          >
            Notes
          </button>
        </div>
        <div className="flex-1" />
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
          {/* Split manager toggle — only when manager + other content is open */}
          {projectTab === "kanban" && managerPanelOpen && (openTasks.length > 0 || openNoteIds.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => {
                if (!managerSplit) {
                  // Splitting: manager leaves tabs → activate first content tab
                  if (activeTabId === "manager") {
                    setActiveTabId(openTaskIds[0] ?? openNoteIds[0] ?? null);
                  }
                } else {
                  // Merging: manager joins tabs → activate manager if nothing active
                  if (!activeTabId) setActiveTabId("manager");
                }
                setManagerSplit(!managerSplit);
              }}
              title={managerSplit ? "Merge manager into tabs" : "Split manager to separate panel"}
            >
              {managerSplit ? <Layers className="w-3.5 h-3.5" /> : <Columns2 className="w-3.5 h-3.5" />}
              {managerSplit ? "Merge" : "Split"}
            </Button>
          )}
          {projectTab === "kanban" && (
            <>
              <Button
                variant={managerPanelOpen || orchestratorSessionId ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={handleManagerClick}
              >
                <Wand2 className="w-3.5 h-3.5" />
                Manager
              </Button>
              {(managerPanelOpen || orchestratorSessionId) && (
                <Popover open={reviewModeOpen} onOpenChange={setReviewModeOpen}>
                  <PopoverTrigger asChild>
                    <button className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md font-medium cursor-pointer transition-colors whitespace-nowrap bg-muted text-muted-foreground border border-border hover:bg-accent">
                      <Eye className="w-3 h-3" />
                      {REVIEW_MODES.find((m) => m.id === (project.reviewMode ?? "manager-tasks"))?.label ?? "Manager Tasks"}
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-1" align="start">
                    {REVIEW_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => {
                          send({ type: "project.update", projectId: project.id, updates: { reviewMode: mode.id } });
                          setReviewModeOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                          (project.reviewMode ?? "manager-tasks") === mode.id
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="w-4 flex justify-center">
                          {(project.reviewMode ?? "manager-tasks") === mode.id && <Check className="w-3 h-3" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{mode.label}</div>
                          <div className="text-[10px] opacity-60">{mode.description}</div>
                        </div>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
              <Button
                variant={noteSidebarOpen ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => setNoteSidebarOpen(!noteSidebarOpen)}
              >
                <FileText className="w-3.5 h-3.5" />
                Notes
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
            </>
          )}
        </div>
      </div>

      {/* Board body */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Main content area — Kanban or Notes */}
        {projectTab === "notes" ? (
          <NotesList
            project={project}
            send={send}
            openNoteIds={openNoteIds}
            setOpenNoteIds={setOpenNoteIds}
            activeNoteId={activeTabId}
            setActiveNoteId={setActiveTabId}
          />
        ) : (
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
                  onTaskRetry={handleRetryTask}
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
        )}

        {/* ── Side panels (Kanban mode only) ── */}
        {/* Layout: Kanban | [Manager split panel] | [Content panel (tabs)] | [Note sidebar] */}
        {projectTab === "kanban" && (() => {
          // Helper: render a task detail for a given task
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

          // Helper: manager chat element
          const managerChatEl = (
            <ManagerChatPanel
              session={managerSession}
              messages={managerMessages}
              streamingText={managerStreamingText}
              hasResumableSession={hasResumableManager}
              onClose={() => setManagerPanelOpen(false)}
              onViewSession={() => orchestratorSessionId && onViewSession(orchestratorSessionId)}
              onCreateOrResume={() => send({ type: "orchestrator.create", projectId: project.id })}
              onReset={() => send({ type: "orchestrator.create", projectId: project.id, reset: true })}
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

          // Helper: resize handle
          const resizeHandle = (target: "content" | "manager", width: number) => (
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

          // Determine what the active tab should render
          const renderActiveContent = () => {
            if (activeTabId === "manager" && managerPanelOpen && !managerSplit) {
              return managerChatEl;
            }
            // Check if it's a task
            const task = openTasks.find((t) => t.id === activeTabId);
            if (task) return renderTaskDetail(task);
            // Check if it's a note
            const note = openNotes.find((n) => n.id === activeTabId);
            if (note) {
              const content = noteContentMap.get(note.id);
              return (
                <NoteDetail
                  key={note.id}
                  note={note}
                  content={content ?? ""}
                  onClose={() => handleCloseNoteTab(note.id)}
                  onUpdate={(updates) => handleUpdateNote(note.id, updates)}
                  onDelete={() => handleDeleteNote(note.id)}
                />
              );
            }
            return null;
          };

          // Build tab list: [Manager?] [Tasks...] [Notes...]
          const showManagerTab = managerPanelOpen && !managerSplit;
          const tabCount = (showManagerTab ? 1 : 0) + openTasks.length + openNotes.length;

          return (
            <>
              {/* Manager split panel (separate, left of content) */}
              {managerPanelOpen && managerSplit && (
                <div className="flex-shrink-0 flex" style={{ width: managerPanelWidth }}>
                  {resizeHandle("manager", managerPanelWidth)}
                  <div className="flex-1 min-w-0">{managerChatEl}</div>
                </div>
              )}

              {/* Content panel (unified tabs: manager + tasks + notes) */}
              {hasContentPanel && (
                <div className="flex-shrink-0 flex" style={{ width: contentPanelWidth }}>
                  {resizeHandle("content", contentPanelWidth)}
                  <div className="flex-1 min-w-0 flex flex-col h-full">
                    {/* Tab bar — show when 2+ tabs */}
                    {tabCount > 1 && (
                      <div className="flex items-center border-b border-l bg-muted/30 overflow-x-auto">
                        {showManagerTab && (
                          <button
                            className={`flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0 ${activeTabId === "manager" ? "bg-background border-b-2 border-violet-500 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                            onClick={() => setActiveTabId("manager")}
                          >
                            <Wand2 className="w-3 h-3" />
                            Manager
                          </button>
                        )}
                        {openTasks.map((task) => (
                          <button
                            key={task.id}
                            className={`group/tab flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0 max-w-[180px] ${activeTabId === task.id ? "bg-background border-b-2 border-violet-500 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                            onClick={() => setActiveTabId(task.id)}
                          >
                            <span className="truncate">{task.title}</span>
                            <span
                              className="p-0.5 rounded opacity-0 group-hover/tab:opacity-100 hover:bg-accent"
                              onClick={(e) => { e.stopPropagation(); handleCloseTaskTab(task.id); }}
                            >
                              <X className="w-3 h-3" />
                            </span>
                          </button>
                        ))}
                        {openNotes.map((note) => (
                          <button
                            key={note.id}
                            className={`group/tab flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0 max-w-[180px] ${activeTabId === note.id ? "bg-background border-b-2 border-violet-500 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                            onClick={() => setActiveTabId(note.id)}
                          >
                            <FileText className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{note.title}</span>
                            <span
                              className="p-0.5 rounded opacity-0 group-hover/tab:opacity-100 hover:bg-accent"
                              onClick={(e) => { e.stopPropagation(); handleCloseNoteTab(note.id); }}
                            >
                              <X className="w-3 h-3" />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex-1 min-h-0">
                      {renderActiveContent()}
                    </div>
                  </div>
                </div>
              )}

              {/* Note sidebar (rightmost) */}
              {noteSidebarOpen && (
                <div className="flex-shrink-0 w-56 border-l bg-muted/20 flex flex-col h-full">
                  <div className="flex items-center justify-between px-3 py-2 border-b">
                    <span className="text-xs font-medium text-muted-foreground">Notes</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCreateNote}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {sortedNotes.length === 0 ? (
                      <div className="flex flex-col items-center py-8 text-muted-foreground">
                        <FileText className="w-6 h-6 mb-2 opacity-40" />
                        <p className="text-xs">No notes yet</p>
                      </div>
                    ) : (
                      sortedNotes.map((note) => (
                        <button
                          key={note.id}
                          className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors ${
                            openNoteIds.includes(note.id)
                              ? "bg-accent border border-violet-500/30"
                              : "hover:bg-accent/50 border border-transparent"
                          }`}
                          onClick={() => handleOpenNote(note.id)}
                        >
                          <p className="font-medium truncate">{note.title}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
