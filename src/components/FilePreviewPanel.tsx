"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, X, GripVertical, Loader2, AlertCircle } from "lucide-react";

const MIN_WIDTH = 320;
const MAX_WIDTH_FALLBACK = 800;
const DEFAULT_WIDTH = 480;

interface FilePreviewPanelProps {
  filePath: string;
  content: string;
  language: string;
  truncated: boolean;
  totalLines?: number;
  loading: boolean;
  error?: string;
  onClose: () => void;
}

export function FilePreviewPanel({
  filePath,
  content,
  language,
  truncated,
  totalLines,
  loading,
  error,
  onClose,
}: FilePreviewPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const basename = filePath.split("/").pop() || filePath;

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
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className="w-4 h-4 text-sky-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-200 truncate">
              {basename}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              {filePath}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-2">
            <AlertCircle className="w-5 h-5 text-destructive mx-auto" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <SyntaxHighlighter
            style={oneDark}
            language={language}
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
            {content}
          </SyntaxHighlighter>
          {truncated && (
            <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/50 border-t text-center">
              Showing first 2,000 lines{totalLines ? ` of ${totalLines.toLocaleString()} total` : ""}
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
