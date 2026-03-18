"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ClipboardList, FileText, AppWindow, X, GripVertical, Columns2, Rows2 } from "lucide-react";
import { useStore } from "@/store";
import type { FilePreviewTab, ShowUserTab } from "@/store";
import { PlanPanelContent } from "./PlanPanel";
import { FilePreviewContent } from "./FilePreviewPanel";
import { ShowUserContent } from "./ShowUserPanel";

const MIN_WIDTH = 320;
const MAX_WIDTH_FALLBACK = 800;

interface SidePanelProps {
  sessionId: string;
  onClose: () => void;
}

interface TabItem {
  id: string;
  type: "plan" | "file" | "show";
  label: string;
  icon: typeof ClipboardList;
  color: string;
}

export function SidePanel({ sessionId, onClose }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const planContent = useStore((s) => s.planContent.get(sessionId));
  const filePreviewTabs = useStore((s) => s.filePreviewTabs.get(sessionId) || []);
  const showUserTabs = useStore((s) => s.showUserTabs.get(sessionId) || []);
  const activeMergedTabId = useStore((s) => s.activeMergedTabId.get(sessionId) || "");
  const setActiveMergedTab = useStore((s) => s.setActiveMergedTab);
  const closeFilePreviewTab = useStore((s) => s.closeFilePreviewTab);
  const closeShowUserTab = useStore((s) => s.closeShowUserTab);
  const setSidePanelMerged = useStore((s) => s.setSidePanelMerged);

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

  // Build tab list
  const tabs: TabItem[] = [];
  if (planContent) {
    tabs.push({ id: "plan", type: "plan", label: "Plan", icon: ClipboardList, color: "text-violet-400" });
  }
  for (const tab of filePreviewTabs) {
    const basename = tab.filePath.split("/").pop() || tab.filePath;
    tabs.push({ id: `file:${tab.id}`, type: "file", label: basename, icon: FileText, color: "text-sky-400" });
  }
  for (const tab of showUserTabs) {
    tabs.push({ id: `show:${tab.id}`, type: "show", label: tab.title, icon: AppWindow, color: "text-teal-400" });
  }

  // Auto-select first tab if current is invalid
  const activeTab = tabs.find((t) => t.id === activeMergedTabId) ? activeMergedTabId : tabs[0]?.id || "";

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabId === "plan") {
      // Don't close plan, just switch to another tab
      const next = tabs.find((t) => t.id !== "plan");
      if (next) setActiveMergedTab(sessionId, next.id);
      return;
    }
    if (tabId.startsWith("file:")) {
      const fileTabId = tabId.slice(5);
      closeFilePreviewTab(sessionId, fileTabId);
    } else if (tabId.startsWith("show:")) {
      const showTabId = tabId.slice(5);
      closeShowUserTab(sessionId, showTabId);
    }
    // Switch to another tab if closing active
    if (tabId === activeTab) {
      const remaining = tabs.filter((t) => t.id !== tabId);
      if (remaining.length > 0) {
        setActiveMergedTab(sessionId, remaining[remaining.length - 1].id);
      }
    }
  };

  // Render active content
  const renderContent = () => {
    if (activeTab === "plan" && planContent) {
      return <PlanPanelContent content={planContent} />;
    }
    if (activeTab.startsWith("file:")) {
      const fileTabId = activeTab.slice(5);
      const tab = filePreviewTabs.find((t) => t.id === fileTabId);
      if (tab) return <FilePreviewContent tab={tab} />;
    }
    if (activeTab.startsWith("show:")) {
      const showTabId = activeTab.slice(5);
      const tab = showUserTabs.find((t) => t.id === showTabId);
      if (tab) return <ShowUserContent title={tab.title} html={tab.html} />;
    }
    return null;
  };

  if (tabs.length === 0) return null;

  return (
    <div
      ref={panelRef}
      className="border-l bg-background flex flex-col h-full overflow-hidden relative"
      style={{ width: width ?? "50%", minWidth: MIN_WIDTH, maxWidth: "70vw" }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-violet-500/30 active:bg-violet-500/50 transition-colors z-10 group flex items-center"
        onMouseDown={handleMouseDown}
      >
        <GripVertical className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors -ml-0.5" />
      </div>

      {/* Header with merge/split toggle */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-xs font-medium text-muted-foreground">Side Panel</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSidePanelMerged(sessionId, false)}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Split into separate panels"
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b shrink-0 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveMergedTab(sessionId, tab.id)}
              className={`group flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 shrink-0 transition-colors ${
                isActive
                  ? `${tab.color} border-current bg-white/5`
                  : "text-muted-foreground border-transparent hover:text-foreground hover:bg-white/5"
              }`}
            >
              <Icon className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{tab.label}</span>
              {tab.id !== "plan" && (
                <span
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="ml-0.5 p-0.5 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}
