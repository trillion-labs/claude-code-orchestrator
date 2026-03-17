"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { AppWindow, X, GripVertical, Copy, Download, Check, Loader2 } from "lucide-react";

const MIN_WIDTH = 320;
const MAX_WIDTH_FALLBACK = 800;

const CAPTURE_SCRIPT = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script>
(function() {
  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "capture") {
      var target = document.body;
      // Wait for html2canvas to be available (CDN might still be loading)
      function tryCapture(retries) {
        if (typeof html2canvas === "undefined") {
          if (retries > 0) {
            setTimeout(function() { tryCapture(retries - 1); }, 200);
          } else {
            parent.postMessage({ type: "capture-error", error: "html2canvas failed to load" }, "*");
          }
          return;
        }
        // Capture with high quality settings
        html2canvas(target, {
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
          scale: e.data.scale || 2,
          logging: false,
          width: target.scrollWidth,
          height: target.scrollHeight,
          windowWidth: target.scrollWidth,
          windowHeight: target.scrollHeight,
        }).then(function(canvas) {
          parent.postMessage({ type: "capture-result", dataUrl: canvas.toDataURL("image/png") }, "*");
        }).catch(function(err) {
          parent.postMessage({ type: "capture-error", error: err.message || "Capture failed" }, "*");
        });
      }
      tryCapture(15);
    }
  });
})();
</script>`;

function injectCaptureScript(html: string): string {
  // Insert before </body> if present, otherwise append
  const bodyCloseIdx = html.lastIndexOf("</body>");
  if (bodyCloseIdx !== -1) {
    return html.slice(0, bodyCloseIdx) + CAPTURE_SCRIPT + html.slice(bodyCloseIdx);
  }
  return html + CAPTURE_SCRIPT;
}

interface ShowUserPanelProps {
  title: string;
  html: string;
  onClose: () => void;
}

type ExportState = "idle" | "capturing" | "copied" | "error";

export function ShowUserPanel({ title, html, onClose }: ShowUserPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const [copyState, setCopyState] = useState<ExportState>("idle");
  const [downloadState, setDownloadState] = useState<ExportState>("idle");
  const captureCallbackRef = useRef<((dataUrl: string) => void) | null>(null);
  const captureErrorRef = useRef<((error: string) => void) | null>(null);

  const injectedHtml = injectCaptureScript(html);

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

  // Listen for capture results from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "capture-result" && captureCallbackRef.current) {
        captureCallbackRef.current(e.data.dataUrl);
        captureCallbackRef.current = null;
        captureErrorRef.current = null;
      } else if (e.data?.type === "capture-error" && captureErrorRef.current) {
        captureErrorRef.current(e.data.error);
        captureCallbackRef.current = null;
        captureErrorRef.current = null;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const requestCapture = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) {
        reject(new Error("Iframe not ready"));
        return;
      }
      captureCallbackRef.current = resolve;
      captureErrorRef.current = reject;
      iframe.contentWindow.postMessage({ type: "capture", scale: 2 }, "*");
      // Timeout after 15s
      setTimeout(() => {
        if (captureCallbackRef.current) {
          captureCallbackRef.current = null;
          captureErrorRef.current = null;
          reject(new Error("Capture timed out"));
        }
      }, 15000);
    });
  }, []);

  const handleCopy = useCallback(async () => {
    setCopyState("capturing");
    try {
      const dataUrl = await requestCapture();
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2000);
    }
  }, [requestCapture]);

  const handleDownload = useCallback(async () => {
    setDownloadState("capturing");
    try {
      const dataUrl = await requestCapture();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "export"}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadState("copied");
      setTimeout(() => setDownloadState("idle"), 2000);
    } catch {
      setDownloadState("error");
      setTimeout(() => setDownloadState("idle"), 2000);
    }
  }, [requestCapture, title]);

  const copyIcon = copyState === "capturing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
    : copyState === "copied" ? <Check className="w-3.5 h-3.5 text-green-400" />
    : <Copy className="w-3.5 h-3.5" />;

  const downloadIcon = downloadState === "capturing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
    : downloadState === "copied" ? <Check className="w-3.5 h-3.5 text-green-400" />
    : <Download className="w-3.5 h-3.5" />;

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
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content — sandboxed iframe */}
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          ref={iframeRef}
          srcDoc={injectedHtml}
          sandbox="allow-scripts"
          className="w-full h-full border-0"
          title={title}
        />
      </div>
    </div>
  );
}
