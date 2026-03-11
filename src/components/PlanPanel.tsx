"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ClipboardList, X, GripVertical } from "lucide-react";
import type { ComponentProps } from "react";

const MIN_WIDTH = 320;
const MAX_WIDTH_FALLBACK = 800;
const DEFAULT_WIDTH = 480;

const planMarkdownComponents: ComponentProps<typeof ReactMarkdown>["components"] = {
  a({ href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  code({ className, children }) {
    const match = /language-(\S+)/.exec(className || "");
    const codeString = String(children).replace(/\n$/, "");

    // Inline code
    if (!match) {
      const isInline = !codeString.includes("\n");
      if (isInline) {
        return (
          <code className="px-1.5 py-0.5 rounded bg-white/10 text-[0.8125rem] font-mono text-orange-300">
            {children}
          </code>
        );
      }
    }

    const language = match ? match[1] : "text";

    return (
      <div className="relative group not-prose my-3 max-w-full overflow-hidden">
        <div className="flex items-center px-3 py-1 bg-[#1e1e1e] rounded-t-lg border-b border-white/10">
          <span className="text-xs text-gray-400 font-mono">{language}</span>
        </div>
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomLeftRadius: "0.5rem",
            borderBottomRightRadius: "0.5rem",
            fontSize: "0.75rem",
            lineHeight: "1.5",
            overflowX: "auto",
          }}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-white/10">{children}</thead>;
  },
  th({ children }) {
    return <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-300 uppercase tracking-wider">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-1.5 text-gray-300 border-t border-white/[0.04]">{children}</td>;
  },
};

interface PlanPanelProps {
  content: string;
  onClose: () => void;
}

export function PlanPanel({ content, onClose }: PlanPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
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
      // Drag left → increase width (panel is on right side)
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
      className="border-l bg-background flex flex-col h-full overflow-hidden relative"
      style={{ width, minWidth: MIN_WIDTH, maxWidth: "70vw" }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-violet-500/30 active:bg-violet-500/50 transition-colors z-10 group flex items-center"
        onMouseDown={handleMouseDown}
      >
        <GripVertical className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors -ml-0.5" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium text-gray-200">Plan</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Plan Content — ScrollArea provides independent y-scroll */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-4 overflow-x-hidden prose prose-sm dark:prose-invert max-w-none prose-p:leading-7 prose-li:leading-7 prose-headings:text-gray-100 prose-p:text-gray-300 prose-li:text-gray-300 prose-strong:text-gray-100 prose-a:text-blue-400">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={planMarkdownComponents}>
            {content}
          </ReactMarkdown>
        </div>
      </ScrollArea>
    </div>
  );
}
