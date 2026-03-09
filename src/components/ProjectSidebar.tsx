"use client";

import { useProjectStore } from "@/hooks/useProjectStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { PendingPermissions } from "./PendingPermissions";
import { FolderOpen, Server, Trash2 } from "lucide-react";
import type { ClientMessage } from "@/lib/shared/protocol";

interface ProjectSidebarProps {
  send: (msg: ClientMessage) => void;
  onNavigateToSession: (sessionId: string) => void;
}

export function ProjectSidebar({ send, onNavigateToSession }: ProjectSidebarProps) {
  const { projects, activeProjectId, setActiveProject } = useProjectStore();

  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    send({ type: "project.delete", projectId });
  };

  return (
    <>
      <ScrollArea className="flex-1 min-w-0" data-sidebar-scroll>
        <div className="p-2 space-y-1">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No projects yet
            </p>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                onClick={() => {
                  setActiveProject(project.id);
                  // Load tasks for this project
                  send({ type: "task.list", projectId: project.id });
                }}
                className={`
                  group flex flex-col gap-1 p-2.5 rounded-lg cursor-pointer transition-colors
                  ${project.id === activeProjectId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                  }
                `}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-sm font-medium truncate flex-1">
                    {project.name}
                  </span>
                  <button
                    onClick={(e) => handleDeleteProject(e, project.id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-5">
                  <Server className="w-2.5 h-2.5" />
                  <span className="truncate">{project.machineId}</span>
                  <span className="truncate">{project.workDir}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <PendingPermissions onNavigate={onNavigateToSession} />

      <Separator />
      <div className="p-3 text-xs text-muted-foreground text-center">
        {projects.length} project{projects.length !== 1 ? "s" : ""}
      </div>
    </>
  );
}
