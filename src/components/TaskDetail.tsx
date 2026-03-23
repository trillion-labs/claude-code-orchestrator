"use client";

import { useState } from "react";
import { X, ExternalLink, Play, Pencil, Check, CheckCircle2, Link, Unplug, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "./StatusBadge";
import { StreamOutput } from "./StreamOutput";
import { PromptInput } from "./PromptInput";
import { SessionPickerDialog } from "./SessionPickerDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Task, Session, ConversationMessage } from "@/lib/shared/types";

interface TaskDetailProps {
  task: Task;
  session?: Session;
  messages: ConversationMessage[];
  streamingText: string;
  projectName?: string;
  onClose: () => void;
  onUpdate: (updates: { title?: string; description?: string }) => void;
  onSubmit: () => void;
  onDone: () => void;
  onLinkSession: (sessionId: string) => void;
  onResume: () => void;
  onViewSession: () => void;
  onSendPrompt: (prompt: string) => void;
  onCancelPrompt?: () => void;
  onDelete: () => void;
  onPermissionResponse: (requestId: string, allow: boolean, answers?: Record<string, string>, message?: string) => void;
}

export function TaskDetail({
  task,
  session,
  messages,
  streamingText,
  projectName,
  onClose,
  onUpdate,
  onSubmit,
  onDone,
  onLinkSession,
  onResume,
  onViewSession,
  onSendPrompt,
  onCancelPrompt,
  onDelete,
  onPermissionResponse,
}: TaskDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState(task.description);

  const saveTitle = () => {
    if (titleDraft.trim() && titleDraft !== task.title) {
      onUpdate({ title: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    if (descDraft !== task.description) {
      onUpdate({ description: descDraft });
    }
    setEditingDesc(false);
  };

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1">
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") {
                    setTitleDraft(task.title);
                    setEditingTitle(false);
                  }
                }}
                autoFocus
                className="h-7 text-sm"
              />
              <button onClick={saveTitle} className="p-1 text-muted-foreground hover:text-foreground">
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <h3
              className="text-sm font-semibold truncate cursor-pointer hover:text-foreground/80 flex items-center gap-1"
              onClick={() => setEditingTitle(true)}
            >
              {task.title}
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50" />
            </h3>
          )}
          {projectName && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md truncate max-w-[120px] flex-shrink-0">
              {projectName}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Description & session info (shrinkable top section) */}
      <div className="flex-shrink-0 overflow-y-auto max-h-[40%]">
        {/* Description */}
        <div className="p-4 border-b">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Description (Claude Prompt)
          </label>
          {editingDesc ? (
            <div>
              <Textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={4}
                autoFocus
                className="text-sm max-h-[40vh] overflow-y-auto resize-y"
              />
              <div className="flex justify-end gap-1 mt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDescDraft(task.description);
                    setEditingDesc(false);
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={saveDesc}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <p
              className="text-sm text-foreground/80 whitespace-pre-wrap cursor-pointer hover:bg-muted/50 rounded p-1 -m-1"
              onClick={() => setEditingDesc(true)}
            >
              {task.description || <span className="text-muted-foreground italic">No description</span>}
            </p>
          )}
        </div>

        {/* Session info & actions */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            {session ? (
              <>
                <StatusBadge status={session.status} />
                <span className="text-xs text-muted-foreground">
                  ${session.totalCostUsd.toFixed(4)}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <DeleteTaskButton onDelete={onDelete} taskTitle={task.title} />
                  {task.column === "in-review" && (
                    <Button
                      size="sm"
                      className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={onDone}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Mark Done
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={onViewSession}
                  >
                    <ExternalLink className="w-3 h-3" />
                    View Session
                  </Button>
                </div>
              </>
            ) : task.claudeSessionId && task.column !== "todo" && task.column !== "done" ? (
              <>
                <div className="flex items-center gap-1.5">
                  <Unplug className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs text-amber-400 font-medium">Session disconnected</span>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono ml-1">
                  {task.claudeSessionId.slice(0, 8)}…
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <DeleteTaskButton onDelete={onDelete} taskTitle={task.title} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    onClick={onResume}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Resume
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">No session linked</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <DeleteTaskButton onDelete={onDelete} taskTitle={task.title} />
                  <SessionPickerDialog
                    title="Link Session to Task"
                    onSelectSession={onLinkSession}
                    trigger={
                      <Button variant="outline" size="sm" className="gap-1">
                        <Link className="w-3 h-3" />
                        Link Session
                      </Button>
                    }
                  />
                  {task.column === "todo" && (
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={onSubmit}
                    >
                      <Play className="w-3 h-3" />
                      Submit
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Session output with input (takes remaining space) */}
      {session && messages.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="p-3 border-b flex-shrink-0">
            <span className="text-xs font-medium text-muted-foreground">Session Output</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <StreamOutput
              messages={messages}
              streamingText={streamingText}
              onPermissionResponse={onPermissionResponse}
            />
          </div>
          <PromptInput
            onSend={onSendPrompt}
            onCancel={onCancelPrompt}
            disabled={session.status === "busy"}
          />
        </div>
      )}
    </div>
  );
}

function DeleteTaskButton({ onDelete, taskTitle }: { onDelete: () => void; taskTitle: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Task</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &quot;{taskTitle}&quot;? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
