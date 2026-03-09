"use client";

import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "./StatusBadge";
import { useStore } from "@/store";
import { DollarSign } from "lucide-react";
import { TimeAgo } from "./TimeAgo";
import type { Session } from "@/lib/shared/types";

interface SessionPickerDialogProps {
  trigger: React.ReactNode;
  title: string;
  onSelectSession: (sessionId: string) => void;
}

export function SessionPickerDialog({ trigger, title, onSelectSession }: SessionPickerDialogProps) {
  const [open, setOpen] = useState(false);
  const { sessions, sessionNames } = useStore();

  const unlinkedSessions = useMemo(() => {
    const result: Session[] = [];
    for (const session of sessions.values()) {
      if (!session.projectId && session.status !== "terminated") {
        result.push(session);
      }
    }
    return result.sort((a, b) => b.lastActivity - a.lastActivity);
  }, [sessions]);

  const handleSelect = (sessionId: string) => {
    onSelectSession(sessionId);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="pt-2">
          {unlinkedSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No unlinked sessions available
            </p>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {unlinkedSessions.map((session) => {
                const name = sessionNames.get(session.id);
                return (
                  <button
                    key={session.id}
                    className="w-full text-left p-3 rounded-md hover:bg-accent transition-colors flex items-start gap-3"
                    onClick={() => handleSelect(session.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium truncate">
                          {name || session.id.slice(0, 8)}
                        </span>
                        <StatusBadge status={session.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="truncate max-w-[200px]">{session.machineName}</span>
                        <span className="truncate max-w-[200px]">{session.workDir}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-end gap-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        {session.totalCostUsd.toFixed(4)}
                      </span>
                      <TimeAgo timestamp={session.lastActivity} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
