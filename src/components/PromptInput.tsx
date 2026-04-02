"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizontal, Square } from "lucide-react";

interface PromptInputProps {
  onSend: (prompt: string) => void;
  onCancel?: () => void;
  isBusy?: boolean;
}

export function PromptInput({ onSend, onCancel, isBusy }: PromptInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    textareaRef.current?.focus();
  }, [value, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const placeholder = "Enter to send, Shift+Enter for newline";

  return (
    <div className="border-t bg-background p-4">
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-h-[60px] max-h-[200px] resize-none font-mono text-sm"
          rows={2}
        />
        <div className="flex flex-col gap-1">
          {isBusy && onCancel && (
            <Button
              onClick={onCancel}
              variant="outline"
              size="icon"
              className="h-auto min-w-10 flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              title="Interrupt"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </Button>
          )}
          <Button
            onClick={handleSend}
            disabled={!value.trim()}
            size="icon"
            className="h-auto min-w-10 flex-1"
            title="Send"
          >
            <SendHorizontal className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
