"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, X, GripVertical, Loader2, AlertCircle, Rows2 } from "lucide-react";
import type { FilePreviewTab } from "@/store";

const MIN_WIDTH = 320;
const MAX_WIDTH_FALLBACK = 800;
const DEFAULT_WIDTH = 480;

/** Reusable file preview content (used by both standalone and merged SidePanel) */
export function FilePreviewContent({ tab }: { tab: FilePreviewTab }) {
  if (tab.loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (tab.error) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 h-full">
        <div className="text-center space-y-2">
          <AlertCircle className="w-5 h-5 text-destructive mx-auto" />
          <p className="text-sm text-destructive">{tab.error}</p>
        </div>
      </div>
    );
  }
  return (
    <ScrollArea className="flex-1 min-h-0 h-full">
      <SyntaxHighlighter
        style={oneDark}
        language={tab.language}
        showLineNumbers
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: "0.75rem",
          lineHeight: "1.5",
          background: "transparent",
        }}
        wrapLongLines
      >
        {tab.content}
      </SyntaxHighlighter>
      {tab.truncated && (
        <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/50 border-t text-center">
          Showing first 2,000 lines
        </div>
      )}
    </ScrollArea>
  );
}

interface FilePreviewPanelProps {
  sessionId: string;
  tabs: FilePreviewTab[];
  activeTabId: string;
  onSetActiveTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onClose: () => void;
  onMerge?: () => void;
}

export function FilePreviewPanel({
  sessionId,
  tabs,
  activeTabId,
  onSetActiveTab,
  onCloseTab,
  onClose,
  onMerge,
}: FilePreviewPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - e.clientX;
      const maxWidth =
        typeof window !== "undefined"
          ? Math.floor(window.innerWidth * 0.7)
          : MAX_WIDTH_FALLBACK;
      const newWidth = Math.min(
        maxWidth,
        Math.max(MIN_WIDTH, startWidth.current + delta),
      );
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

  if (!activeTab) return null;

  return (
    <div
      className="border-l bg-background flex flex-col h-full overflow-hidden relative"
      style={{ width, minWidth: MIN_WIDTH, maxWidth: "70vw" }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-sky-500/30 active:bg-sky-500/50 transition-colors z-10 group flex items-center"
        onMouseDown={handleMouseDown}
      >
        <GripVertical className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors -ml-0.5" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className="w-4 h-4 text-sky-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
              {activeTab.filePath.split("/").pop() || activeTab.filePath}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              {activeTab.filePath}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {onMerge && (
            <button
              onClick={onMerge}
              className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              title="Merge into unified panel"
            >
              <Rows2 className="w-3.5 h-3.5" />
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

      {/* Tab bar (shown when multiple tabs) */}
      {tabs.length > 1 && (
        <div className="flex items-center border-b shrink-0 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const basename = tab.filePath.split("/").pop() || tab.filePath;
            const isActive = tab.id === activeTab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSetActiveTab(tab.id)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 shrink-0 transition-colors ${
                  isActive
                    ? "text-sky-400 border-sky-400 bg-white/5"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:bg-white/5"
                }`}
              >
                <FileText className="w-3 h-3" />
                <span className="truncate max-w-[100px]">{basename}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="ml-0.5 p-0.5 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <FilePreviewContent tab={activeTab} />
    </div>
  );
}
