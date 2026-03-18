"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { AppWindow, X, GripVertical, Copy, Download, Check, Loader2, Rows2 } from "lucide-react";
import html2canvas from "html2canvas";
import type { ShowUserTab } from "@/store";

const MIN_WIDTH = 320;
const MAX_WIDTH_FALLBACK = 800;

type ExportState = "idle" | "capturing" | "copied" | "error";

/** Reusable show_user content (used by both standalone and merged SidePanel) */
export function ShowUserContent({ title, html }: { title: string; html: string }) {
  return (
    <div className="flex-1 min-h-0 bg-white h-full">
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-0"
        title={title}
      />
    </div>
  );
}

interface ShowUserPanelProps {
  sessionId: string;
  tabs: ShowUserTab[];
  activeTabId: string;
  onSetActiveTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onClose: () => void;
  onMerge?: () => void;
}

export function ShowUserPanel({
  sessionId,
  tabs,
  activeTabId,
  onSetActiveTab,
  onCloseTab,
  onClose,
  onMerge,
}: ShowUserPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const [copyState, setCopyState] = useState<ExportState>("idle");
  const [downloadState, setDownloadState] = useState<ExportState>("idle");

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

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

  const captureIframe = useCallback(async (): Promise<Blob> => {
    const iframe = iframeRef.current;
    const body = iframe?.contentDocument?.body;
    if (!body) throw new Error("Iframe not ready");

    const canvas = await html2canvas(body, {
      useCORS: true,
      backgroundColor: "#ffffff",
      scale: 2,
      logging: false,
      width: body.scrollWidth,
      height: body.scrollHeight,
      windowWidth: body.scrollWidth,
      windowHeight: body.scrollHeight,
    });

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob: Blob | null) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
        "image/png"
      );
    });
  }, []);

  const handleCopy = useCallback(async () => {
    setCopyState("capturing");
    try {
      const blobPromise = captureIframe();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blobPromise }),
      ]);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch (e) {
      console.error("Copy failed:", e);
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2000);
    }
  }, [captureIframe]);

  const handleDownload = useCallback(async () => {
    setDownloadState("capturing");
    try {
      const blob = await captureIframe();
      const filename = `${(activeTab?.title || "export").replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "export"}.png`;

      if ("showSaveFilePicker" in window) {
        try {
          const handle = await (window as unknown as { showSaveFilePicker: (opts: Record<string, unknown>) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "PNG Image", accept: { "image/png": [".png"] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setDownloadState("copied");
          setTimeout(() => setDownloadState("idle"), 2000);
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            setDownloadState("idle");
            return;
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadState("copied");
      setTimeout(() => setDownloadState("idle"), 2000);
    } catch (e) {
      console.error("Download failed:", e);
      setDownloadState("error");
      setTimeout(() => setDownloadState("idle"), 2000);
    }
  }, [captureIframe, activeTab?.title]);

  const copyIcon = copyState === "capturing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
    : copyState === "copied" ? <Check className="w-3.5 h-3.5 text-green-400" />
    : copyState === "error" ? <X className="w-3.5 h-3.5 text-red-400" />
    : <Copy className="w-3.5 h-3.5" />;

  const downloadIcon = downloadState === "capturing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
    : downloadState === "copied" ? <Check className="w-3.5 h-3.5 text-green-400" />
    : downloadState === "error" ? <X className="w-3.5 h-3.5 text-red-400" />
    : <Download className="w-3.5 h-3.5" />;

  if (!activeTab) return null;

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
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <AppWindow className="w-4 h-4 text-teal-400 shrink-0" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{activeTab.title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            disabled={copyState === "capturing"}
            className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Copy as image"
          >
            {copyIcon}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloadState === "capturing"}
            className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Download as PNG"
          >
            {downloadIcon}
          </button>
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
            const isActive = tab.id === activeTab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSetActiveTab(tab.id)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 shrink-0 transition-colors ${
                  isActive
                    ? "text-teal-400 border-teal-400 bg-white/5"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:bg-white/5"
                }`}
              >
                <AppWindow className="w-3 h-3" />
                <span className="truncate max-w-[120px]">{tab.title}</span>
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

      {/* Content — sandboxed iframe */}
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          ref={iframeRef}
          srcDoc={activeTab.html}
          sandbox="allow-scripts allow-same-origin"
          className="w-full h-full border-0"
          title={activeTab.title}
        />
      </div>
    </div>
  );
}
