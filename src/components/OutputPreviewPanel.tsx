"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Image, X, GripVertical, Trash2 } from "lucide-react";
import type { OutputPreviewItem } from "@/lib/shared/protocol";

const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 480;

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function fileName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

interface OutputPreviewPanelProps {
  items: OutputPreviewItem[];
  onClose: () => void;
  onClear: () => void;
}

export function OutputPreviewPanel({ items, onClose, onClear }: OutputPreviewPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
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

  // Auto-scroll to latest item
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items.length]);

  return (
    <div
      className="border-l bg-background flex flex-col h-full overflow-hidden relative"
      style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/30 active:bg-cyan-500/50 transition-colors z-10 group flex items-center"
        onMouseDown={handleMouseDown}
      >
        <GripVertical className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors -ml-0.5" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Image className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-gray-200">Output Preview</span>
          <span className="text-xs text-muted-foreground">({items.length})</span>
        </div>
        <div className="flex items-center gap-1">
          {items.length > 0 && (
            <button
              onClick={onClear}
              className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              title="Clear all previews"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4" ref={scrollRef}>
          {items.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No output previews yet
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="space-y-1.5">
                {/* File label */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-cyan-300/80 font-mono truncate" title={item.filePath}>
                    {fileName(item.filePath)}
                  </span>
                  <span className="text-muted-foreground shrink-0 ml-2">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </div>

                {/* Preview content */}
                {item.type === "image" ? (
                  <div
                    className={`rounded-lg border border-white/10 overflow-hidden bg-black/20 cursor-pointer transition-all ${
                      expandedId === item.id ? "max-h-none" : "max-h-80"
                    }`}
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  >
                    <img
                      src={`data:${item.mimeType};base64,${item.data}`}
                      alt={fileName(item.filePath)}
                      className="w-full h-auto object-contain"
                      style={expandedId !== item.id ? { maxHeight: "320px" } : undefined}
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/10 overflow-hidden bg-white">
                    <iframe
                      srcDoc={item.data}
                      sandbox="allow-scripts"
                      className="w-full border-0"
                      style={{ height: expandedId === item.id ? "600px" : "300px" }}
                      title={fileName(item.filePath)}
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Expanded overlay - for image fullscreen view */}
      {expandedId && items.find(i => i.id === expandedId)?.type === "image" && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setExpandedId(null)}
        >
          <img
            src={`data:${items.find(i => i.id === expandedId)!.mimeType};base64,${items.find(i => i.id === expandedId)!.data}`}
            alt="Expanded preview"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={() => setExpandedId(null)}
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
