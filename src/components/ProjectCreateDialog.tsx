"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { PathInput } from "./PathInput";
import type { MachineConfig, PermissionMode } from "@/lib/shared/types";
import type { PathListResult, MkdirResult } from "@/hooks/useWebSocket";

interface ProjectCreateDialogProps {
  machines: MachineConfig[];
  requestPathList: (machineId: string, path: string) => Promise<PathListResult>;
  requestMkdir: (machineId: string, path: string) => Promise<MkdirResult>;
  onCreateProject: (name: string, machineId: string, workDir: string, permissionMode: PermissionMode) => void;
}

export function ProjectCreateDialog({ machines, requestPathList, requestMkdir, onCreateProject }: ProjectCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState(machines[0]?.id || "");
  const [workDir, setWorkDir] = useState("~");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");

  const handleSubmit = () => {
    if (!name.trim() || !machineId || !workDir.trim()) return;
    onCreateProject(name.trim(), machineId, workDir.trim(), permissionMode);
    setName("");
    setWorkDir("~");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="w-full">
          <Plus className="w-4 h-4 mr-1" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Project Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Web App"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Machine</label>
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Working Directory</label>
            <PathInput
              value={workDir}
              onChange={setWorkDir}
              machineId={machineId}
              requestPathList={requestPathList}
              requestMkdir={requestMkdir}
              placeholder="/path/to/project"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Permission Mode</label>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="default">Default (Ask for every tool)</option>
              <option value="plan">Plan (Read-only)</option>
              <option value="accept-edits">Accept Edits (Auto-approve edits)</option>
              <option value="bypass-permissions">No Restrictions</option>
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!name.trim() || !workDir.trim()}>
              Create Project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
