"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { AppWindow, X, GripVertical } from "lucide-react";

const MIN_WIDTH = 320;
const MAX_WIDTH_FALLBACK = 800;

interface ShowUserPanelProps {
  title: string;
  html: string;
  onClose: () => void;
}

export function ShowUserPanel({ title, html, onClose }: ShowUserPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Initialize width to 50% of parent container
  useEffect(() => {
    if (width !== null) return;
    const parent = panelRef.current?.parentElement;
    if (parent) {
      const half = Math.floor(parent.clientWidth / 2);
      setWidth(Math.max(MIN_WIDTH, half));
    }
  }, [width]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startX.current = e.clientX;
      startWidth.current = width ?? panelRef.current?.clientWidth ?? MIN_WIDTH;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - e.clientX;
      const maxWidth = typeof window !== "undefined" ? Math.floor(window.innerWidth * 0.7) : MAX_WIDTH_FALLBACK;
      const newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth.current + delta));
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
      ref={panelRef}
      className="border-l bg-background flex flex-col h-full overflow-hidden relative"
      style={{ width: width ?? "50%", minWidth: MIN_WIDTH, maxWidth: "70vw" }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/30 active:bg-teal-500/50 transition-colors z-10 group flex items-center"
        onMouseDown={handleMouseDown}
      >
        <GripVertical className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors -ml-0.5" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <AppWindow className="w-4 h-4 text-teal-400 shrink-0" />
          <span className="text-sm font-medium text-gray-200 truncate">{title}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content — sandboxed iframe */}
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          className="w-full h-full border-0"
          title={title}
        />
      </div>
    </div>
  );
}
