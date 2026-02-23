"use client";

import { Badge } from "@/components/ui/badge";
import type { SessionStatus } from "@/lib/shared/types";

const statusConfig: Record<SessionStatus, { label: string; className: string }> = {
  starting: { label: "Starting", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  idle: { label: "Idle", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  busy: { label: "Busy", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  error: { label: "Error", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  terminated: { label: "Terminated", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
};

interface StatusBadgeProps {
  status: SessionStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={config.className}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
        status === "busy" ? "animate-pulse bg-yellow-400" :
        status === "idle" ? "bg-green-400" :
        status === "error" ? "bg-red-400" :
        status === "starting" ? "animate-pulse bg-blue-400" :
        "bg-gray-400"
      }`} />
      {config.label}
    </Badge>
  );
}
