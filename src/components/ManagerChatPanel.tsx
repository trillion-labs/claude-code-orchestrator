"use client";

import { X, ExternalLink, Wand2, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { StatusBadge } from "./StatusBadge";
import { StreamOutput } from "./StreamOutput";
import { PromptInput } from "./PromptInput";
import type { Session, ConversationMessage } from "@/lib/shared/types";

interface ManagerChatPanelProps {
  session?: Session;
  messages: ConversationMessage[];
  streamingText: string;
  hasResumableSession: boolean;
  onClose: () => void;
  onViewSession: () => void;
  onCreateOrResume: () => void;
  onReset: () => void;
  onSendPrompt: (prompt: string) => void;
  onCancelPrompt: () => void;
  onPermissionResponse: (requestId: string, allow: boolean, answers?: Record<string, string>, message?: string) => void;
}

export function ManagerChatPanel({
  session,
  messages,
  streamingText,
  hasResumableSession,
  onClose,
  onViewSession,
  onCreateOrResume,
  onReset,
  onSendPrompt,
  onCancelPrompt,
  onPermissionResponse,
}: ManagerChatPanelProps) {
  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b">
        <Wand2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <h3 className="text-sm font-semibold flex-1 min-w-0">Manager</h3>
        {session && (
          <>
            <StatusBadge status={session.status} />
            <span className="text-xs text-muted-foreground">
              ${session.totalCostUsd.toFixed(4)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={onViewSession}
            >
              <ExternalLink className="w-3 h-3" />
              View Session
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-muted-foreground hover:text-foreground"
                  title="Reset manager session"
                >
                  <RotateCcw className="w-3 h-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Manager</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will terminate the current manager session and start a fresh one. Conversation history will not be carried over.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onReset}>Reset</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      {session ? (
        <div className="flex flex-col flex-1 min-h-0">
          {messages.length > 0 ? (
            <div className="flex-1 overflow-y-auto min-h-0">
              <StreamOutput
                messages={messages}
                streamingText={streamingText}
                onPermissionResponse={onPermissionResponse}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Send a message to start orchestrating tasks.
            </div>
          )}
          <PromptInput
            onSend={onSendPrompt}
            onCancel={onCancelPrompt}
            isBusy={session.status === "busy"}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Wand2 className="w-8 h-8 text-violet-400/50" />
          <p className="text-sm">
            {hasResumableSession ? "Manager session ended." : "No manager session yet."}
          </p>
          <Button onClick={onCreateOrResume} className="gap-1.5">
            <Play className="w-3.5 h-3.5" />
            {hasResumableSession ? "Resume Manager" : "Start Manager"}
          </Button>
          {hasResumableSession && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <RotateCcw className="w-3 h-3" />
                  Start Fresh
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Manager</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will discard the previous manager session and start a fresh one. Conversation history will not be carried over.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onReset}>Start Fresh</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </div>
  );
}
