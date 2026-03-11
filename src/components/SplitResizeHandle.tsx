"use client";

import { useRef, useCallback, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { useStore } from "@/store";

const MIN_PANEL_WIDTH = 400;

interface SplitResizeHandleProps {
  leftPanelId: string;
}

export function SplitResizeHandle({ leftPanelId }: SplitResizeHandleProps) {
  const setSplitPanelWidth = useStore((s) => s.setSplitPanelWidth);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const leftPanelEl = useRef<HTMLElement | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      startX.current = e.clientX;
      // Find the left panel element by data attribute
      const handle = e.currentTarget;
      const prev = handle.previousElementSibling as HTMLElement | null;
      leftPanelEl.current = prev;
      startWidth.current = prev?.offsetWidth ?? 500;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    []
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = e.clientX - startX.current;
      const maxWidth = typeof window !== "undefined"
        ? Math.floor(window.innerWidth * 0.7)
        : 1200;
      const newWidth = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, startWidth.current + delta));
      setSplitPanelWidth(leftPanelId, newWidth);
    };

    const handleMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      leftPanelEl.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [leftPanelId, setSplitPanelWidth]);

  return (
    <div
      className="relative flex-shrink-0 w-1.5 cursor-col-resize hover:bg-violet-500/30 active:bg-violet-500/50 transition-colors group flex items-center justify-center"
      onMouseDown={handleMouseDown}
    >
      <GripVertical className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
    </div>
  );
}
