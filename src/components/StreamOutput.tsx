"use client";

import {
  useEffect,
  useRef,
  createContext,
  useContext,
  type ComponentProps,
} from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ConversationMessage } from "@/lib/shared/types";
import {
  User,
  Bot,
  Copy,
  Check,
  MessageCircleQuestion,
  CircleDot,
  Square,
  CheckSquare,
  Terminal,
  FileText,
  Search,
  Globe,
  Cpu,
  Wrench,
  Send,
  PenLine,
  CheckCircle2,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useState, useCallback, useMemo } from "react";
import { useStore } from "@/store";

// ── Contexts ──

const SendPromptContext = createContext<
  ((prompt: string) => void) | undefined
>(undefined);

// Context for sending permission responses (Allow/Deny)
const PermissionResponseContext = createContext<
  ((requestId: string, allow: boolean) => void) | undefined
>(undefined);

// Whether the current tool blocks should be interactive
const ToolInteractiveContext = createContext(false);

// ── Content Segment Parser ──
// Extracts ```tool-xxx blocks from markdown so they can be rendered
// as interactive React components with preserved state.

type ContentSegment =
  | { type: "text"; content: string }
  | { type: "tool"; toolType: string; data: unknown; key: string };

function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const regex = /```tool-(\S+)\n([\s\S]*?)\n```/g;
  let lastIndex = 0;
  let toolIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) segments.push({ type: "text", content: text });
    }

    try {
      segments.push({
        type: "tool",
        toolType: match[1],
        data: JSON.parse(match[2]),
        key: `tool-${match[1]}-${toolIndex++}`,
      });
    } catch {
      segments.push({ type: "text", content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    if (text.trim()) segments.push({ type: "text", content: text });
  }

  return segments;
}

// ── Interactive Question Card ──

interface QuestionData {
  questions: Array<{
    header?: string;
    question: string;
    multiSelect?: boolean;
    options?: Array<{ label: string; description?: string }>;
  }>;
}

function QuestionCard({ data }: { data: QuestionData }) {
  const sendPrompt = useContext(SendPromptContext);
  const interactive = useContext(ToolInteractiveContext);
  // selections: questionIndex → selected label(s) or "__other__"
  const [selections, setSelections] = useState<
    Map<number, string | string[]>
  >(new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(
    new Map()
  );
  const [submitted, setSubmitted] = useState(false);

  // Effective read-only: not interactive or already submitted
  const readOnly = !interactive || submitted;

  const handleSelect = (
    qIdx: number,
    label: string,
    multiSelect?: boolean
  ) => {
    if (readOnly) return;
    setSelections((prev) => {
      const next = new Map(prev);
      if (multiSelect) {
        const current = (next.get(qIdx) as string[]) || [];
        if (current.includes(label)) {
          next.set(
            qIdx,
            current.filter((l) => l !== label)
          );
        } else {
          next.set(qIdx, [...current, label]);
        }
      } else {
        next.set(qIdx, label);
      }
      return next;
    });
  };

  const handleSelectOther = (qIdx: number, multiSelect?: boolean) => {
    if (readOnly) return;
    if (multiSelect) {
      // For multi-select, toggle __other__
      setSelections((prev) => {
        const next = new Map(prev);
        const current = (next.get(qIdx) as string[]) || [];
        if (current.includes("__other__")) {
          next.set(
            qIdx,
            current.filter((l) => l !== "__other__")
          );
        } else {
          next.set(qIdx, [...current, "__other__"]);
        }
        return next;
      });
    } else {
      setSelections((prev) => {
        const next = new Map(prev);
        next.set(qIdx, "__other__");
        return next;
      });
    }
  };

  const isSelected = (qIdx: number, label: string): boolean => {
    const sel = selections.get(qIdx);
    if (Array.isArray(sel)) return sel.includes(label);
    return sel === label;
  };

  const isOtherSelected = (qIdx: number): boolean => {
    const sel = selections.get(qIdx);
    if (Array.isArray(sel)) return sel.includes("__other__");
    return sel === "__other__";
  };

  const hasAnySelection = data.questions.some((_, i) => {
    const sel = selections.get(i);
    if (!sel) return false;
    if (sel === "__other__") return !!otherTexts.get(i)?.trim();
    if (Array.isArray(sel)) {
      if (sel.length === 0) return false;
      if (sel.includes("__other__") && sel.length === 1)
        return !!otherTexts.get(i)?.trim();
      return true;
    }
    return true;
  });

  const handleSubmit = () => {
    if (!sendPrompt || readOnly || !hasAnySelection) return;

    const answers: string[] = [];
    data.questions.forEach((q, i) => {
      const sel = selections.get(i);
      const other = otherTexts.get(i)?.trim();

      let answer = "";
      if (Array.isArray(sel)) {
        const parts = sel
          .map((s) => (s === "__other__" ? other || "" : s))
          .filter(Boolean);
        answer = parts.join(", ");
      } else if (sel === "__other__") {
        answer = other || "";
      } else if (sel) {
        answer = sel;
      }

      if (answer) {
        if (data.questions.length > 1) {
          answers.push(`${q.header || q.question}: ${answer}`);
        } else {
          answers.push(answer);
        }
      }
    });

    if (answers.length > 0) {
      sendPrompt(answers.join("\n"));
      setSubmitted(true);
    }
  };

  // Visual states: active (amber), submitted (green), inactive (gray)
  const colorScheme = submitted
    ? { border: "border-emerald-500/20", bg: "bg-emerald-500/[0.02]", headerBg: "bg-emerald-500/[0.06]", headerBorder: "border-emerald-500/10", accent: "text-emerald-300", icon: "text-emerald-400" }
    : readOnly
    ? { border: "border-gray-500/15", bg: "bg-gray-500/[0.02]", headerBg: "bg-gray-500/[0.04]", headerBorder: "border-gray-500/10", accent: "text-gray-400", icon: "text-gray-500" }
    : { border: "border-amber-500/20", bg: "bg-amber-500/[0.04]", headerBg: "bg-amber-500/[0.06]", headerBorder: "border-amber-500/10", accent: "text-amber-300", icon: "text-amber-400" };

  return (
    <div className="not-prose my-3 space-y-3">
      {data.questions?.map((q, qIdx) => (
        <div
          key={qIdx}
          className={`rounded-xl border overflow-hidden transition-colors ${colorScheme.border} ${colorScheme.bg}`}
        >
          {/* Header */}
          <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${colorScheme.headerBg} ${colorScheme.headerBorder}`}>
            {submitted ? (
              <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${colorScheme.icon}`} />
            ) : (
              <MessageCircleQuestion className={`w-4 h-4 flex-shrink-0 ${colorScheme.icon}`} />
            )}
            <span className={`text-xs font-semibold uppercase tracking-wide ${colorScheme.accent}`}>
              {q.header || "Question"}
            </span>
            {q.multiSelect && !readOnly && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                Multi-select
              </span>
            )}
            {submitted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                Answered
              </span>
            )}
          </div>

          {/* Question */}
          <div className="px-4 pt-3 pb-2">
            <p className={`text-sm leading-relaxed ${readOnly && !submitted ? "text-gray-400" : "text-gray-200"}`}>
              {q.question}
            </p>
          </div>

          {/* Options */}
          {q.options && q.options.length > 0 && (
            <div className="px-4 pb-3 space-y-1.5">
              {q.options.map((opt, j) => {
                const selected = isSelected(qIdx, opt.label);
                return (
                  <button
                    key={j}
                    onClick={() => handleSelect(qIdx, opt.label, q.multiSelect)}
                    disabled={readOnly}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left transition-all ${
                      submitted && selected
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : readOnly
                        ? "border-white/[0.03] bg-white/[0.01] cursor-default opacity-60"
                        : selected
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-white/[0.04] bg-white/[0.03] hover:border-amber-500/20 hover:bg-white/[0.05]"
                    }`}
                  >
                    {q.multiSelect ? (
                      selected ? (
                        <CheckSquare className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
                      )
                    ) : (
                      <CircleDot
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          selected ? "text-amber-400" : "text-gray-600"
                        }`}
                      />
                    )}
                    <div className="min-w-0">
                      <span className={`text-sm font-medium ${readOnly ? "text-gray-500" : selected ? "text-gray-100" : "text-gray-300"}`}>
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className={`text-sm ml-1.5 ${readOnly ? "text-gray-600" : "text-gray-500"}`}>
                          — {opt.description}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Other (free text) option — hidden when readOnly */}
              {!readOnly && (
                <>
                  <button
                    onClick={() => handleSelectOther(qIdx, q.multiSelect)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left transition-all ${
                      isOtherSelected(qIdx)
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-white/[0.04] bg-white/[0.03] hover:border-amber-500/20 hover:bg-white/[0.05]"
                    }`}
                  >
                    <PenLine
                      className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        isOtherSelected(qIdx) ? "text-amber-400" : "text-gray-600"
                      }`}
                    />
                    <span
                      className={`text-sm font-medium ${
                        isOtherSelected(qIdx) ? "text-gray-100" : "text-gray-400"
                      }`}
                    >
                      Other
                    </span>
                  </button>

                  {/* Text input for Other */}
                  {isOtherSelected(qIdx) && (
                    <div className="ml-6 mt-1">
                      <input
                        type="text"
                        placeholder="Type your answer..."
                        value={otherTexts.get(qIdx) || ""}
                        onChange={(e) =>
                          setOtherTexts((prev) => {
                            const next = new Map(prev);
                            next.set(qIdx, e.target.value);
                            return next;
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && hasAnySelection) handleSubmit();
                        }}
                        className="w-full px-3 py-1.5 rounded-md bg-white/[0.05] border border-amber-500/20 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/40 font-mono"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Submit button — only when interactive and not yet submitted */}
          {qIdx === data.questions.length - 1 && !readOnly && (
            <div className="px-4 pb-3 pt-1">
              <button
                onClick={handleSubmit}
                disabled={!hasAnySelection || !sendPrompt}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-sm font-medium text-amber-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" />
                Submit
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Compact Tool Cards (non-interactive) ──

function BashCard({ data }: { data: { command?: string; description?: string } }) {
  return (
    <div className="not-prose my-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/[0.06] border-b border-emerald-500/10">
        <Terminal className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-medium text-emerald-300">
          {data.description || "Running command"}
        </span>
      </div>
      {data.command && (
        <div className="px-3 py-2">
          <code className="text-xs font-mono text-gray-300 break-all">
            {data.command}
          </code>
        </div>
      )}
    </div>
  );
}

function FileCard({ data }: { data: { action?: string; file_path?: string } }) {
  return (
    <div className="not-prose my-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.04]">
      <FileText className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
      <span className="text-xs text-sky-300 font-medium">{data.action}</span>
      <code className="text-xs font-mono text-gray-400 truncate">
        {data.file_path}
      </code>
    </div>
  );
}

function SearchCard({ data }: { data: { action?: string; pattern?: string; path?: string } }) {
  return (
    <div className="not-prose my-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/20 bg-purple-500/[0.04]">
      <Search className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
      <span className="text-xs text-purple-300 font-medium">{data.action}</span>
      <code className="text-xs font-mono text-gray-400 truncate">
        {data.pattern}
      </code>
      {data.path && (
        <span className="text-xs text-gray-500">in {data.path}</span>
      )}
    </div>
  );
}

function WebCard({ data }: { data: { action?: string; query?: string; url?: string } }) {
  return (
    <div className="not-prose my-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.04]">
      <Globe className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
      <span className="text-xs text-blue-300 font-medium">{data.action}</span>
      <span className="text-xs text-gray-400 truncate">
        {data.query || data.url}
      </span>
    </div>
  );
}

function TaskCard({ data }: { data: { description?: string } }) {
  return (
    <div className="not-prose my-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-orange-500/20 bg-orange-500/[0.04]">
      <Cpu className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
      <span className="text-xs text-orange-300 font-medium">Agent</span>
      <span className="text-xs text-gray-400 truncate">
        {data.description}
      </span>
    </div>
  );
}

function GenericToolCard({ data }: { data: { name?: string } }) {
  return (
    <div className="not-prose my-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-500/20 bg-gray-500/[0.04]">
      <Wrench className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      <span className="text-xs text-gray-300 font-medium">
        {data.name || "Tool"}
      </span>
    </div>
  );
}

function PermissionRequestCard({ data }: { data: { requestId?: string; toolName?: string; input?: Record<string, unknown>; resolved?: "allow" | "deny" } }) {
  const sendPermission = useContext(PermissionResponseContext);
  const interactive = useContext(ToolInteractiveContext);

  // Read decision from Zustand store (survives re-mounts) or from resolved field in data (finalized messages)
  const storeDecision = useStore((s) => data.requestId ? s.respondedPermissions.get(data.requestId) : undefined);
  const respondPermission = useStore((s) => s.respondPermission);
  const responded = data.resolved || storeDecision || null;

  const readOnly = !interactive || responded !== null;

  const handleAllow = () => {
    if (readOnly || !sendPermission || !data.requestId) return;
    sendPermission(data.requestId, true);
    respondPermission(data.requestId, "allow");
  };

  const handleDeny = () => {
    if (readOnly || !sendPermission || !data.requestId) return;
    sendPermission(data.requestId, false);
    respondPermission(data.requestId, "deny");
  };

  // Render a summary of what the tool wants to do
  const toolSummary = data.toolName === "Bash" && data.input?.command
    ? String(data.input.command)
    : data.toolName === "Write" && data.input?.file_path
    ? `Write to ${data.input.file_path}`
    : data.toolName === "Edit" && data.input?.file_path
    ? `Edit ${data.input.file_path}`
    : data.input?.file_path
    ? String(data.input.file_path)
    : null;

  const colorScheme = responded === "allow"
    ? { border: "border-emerald-500/30", bg: "bg-emerald-500/[0.04]", headerBg: "bg-emerald-500/[0.06]", headerBorder: "border-emerald-500/15" }
    : responded === "deny"
    ? { border: "border-red-500/30", bg: "bg-red-500/[0.04]", headerBg: "bg-red-500/[0.06]", headerBorder: "border-red-500/15" }
    : { border: "border-amber-500/30", bg: "bg-amber-500/[0.04]", headerBg: "bg-amber-500/[0.06]", headerBorder: "border-amber-500/15" };

  return (
    <div className={`not-prose my-3 rounded-xl border overflow-hidden transition-colors ${colorScheme.border} ${colorScheme.bg}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${colorScheme.headerBg} ${colorScheme.headerBorder}`}>
        {responded === "allow" ? (
          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        ) : responded === "deny" ? (
          <ShieldX className="w-4 h-4 text-red-400 flex-shrink-0" />
        ) : (
          <ShieldX className="w-4 h-4 text-amber-400 flex-shrink-0 animate-pulse" />
        )}
        <span className={`text-xs font-semibold uppercase tracking-wide ${
          responded === "allow" ? "text-emerald-300" :
          responded === "deny" ? "text-red-300" :
          "text-amber-300"
        }`}>
          {responded === "allow" ? "Allowed" : responded === "deny" ? "Denied" : "Permission Request"}
        </span>
        <code className="text-xs font-mono text-gray-400 ml-auto">{data.toolName}</code>
      </div>

      {/* Tool details */}
      {toolSummary && (
        <div className="px-4 py-2.5">
          <code className="text-xs font-mono text-gray-300 break-all">{toolSummary}</code>
        </div>
      )}

      {/* Action buttons */}
      {!readOnly && (
        <div className="flex gap-2 px-4 pb-3 pt-1">
          <button
            onClick={handleAllow}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-sm font-medium text-emerald-200 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Allow
          </button>
          <button
            onClick={handleDeny}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-sm font-medium text-red-200 transition-colors"
          >
            <ShieldX className="w-3.5 h-3.5" />
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

function PermissionDeniedCard({ data }: { data: { tool?: string; error?: string } }) {
  return (
    <div className="not-prose my-3 rounded-lg border border-red-500/30 bg-red-500/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-red-500/[0.08] border-b border-red-500/15">
        <ShieldX className="w-3.5 h-3.5 text-red-400" />
        <span className="text-xs font-medium text-red-300">Permission Denied</span>
        {data.tool && (
          <code className="text-xs font-mono text-red-400/80 ml-auto">{data.tool}</code>
        )}
      </div>
      {data.error && (
        <div className="px-3 py-2">
          <p className="text-xs text-red-300/80 leading-relaxed">{data.error}</p>
        </div>
      )}
    </div>
  );
}

function ToolBlock({ toolType, data }: { toolType: string; data: unknown }) {
  switch (toolType) {
    case "ask-user-question":
      return <QuestionCard data={data as QuestionData} />;
    case "bash":
      return <BashCard data={data as { command?: string; description?: string }} />;
    case "file":
      return <FileCard data={data as { action?: string; file_path?: string }} />;
    case "search":
      return <SearchCard data={data as { action?: string; pattern?: string; path?: string }} />;
    case "web":
      return <WebCard data={data as { action?: string; query?: string; url?: string }} />;
    case "task":
      return <TaskCard data={data as { description?: string }} />;
    case "permission-request": {
      const prData = data as { requestId?: string; toolName?: string; input?: Record<string, unknown> };
      // AskUserQuestion has its own QuestionCard UI — skip the permission card
      if (prData.toolName === "AskUserQuestion") return null;
      return <PermissionRequestCard data={prData} />;
    }
    case "permission-denied":
      return <PermissionDeniedCard data={data as { tool?: string; error?: string }} />;
    default:
      return <GenericToolCard data={data as { name?: string }} />;
  }
}

// ── Copy Button ──

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-gray-400" />
      )}
    </button>
  );
}

// ── Markdown Renderer ──
// Tool blocks are pre-extracted, so this only handles regular markdown.

const markdownComponents: ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children, ...props }) {
    const match = /language-(\S+)/.exec(className || "");
    const codeString = String(children).replace(/\n$/, "");

    // Inline code
    if (!match) {
      const isInline = !codeString.includes("\n");
      if (isInline) {
        return (
          <code
            className="px-1.5 py-0.5 rounded bg-white/10 text-[0.8125rem] font-mono text-orange-300"
            {...props}
          >
            {children}
          </code>
        );
      }
    }

    const language = match ? match[1] : "text";

    return (
      <div className="relative group not-prose my-4">
        <div className="flex items-center justify-between px-4 py-1.5 bg-[#1e1e1e] rounded-t-lg border-b border-white/10">
          <span className="text-xs text-gray-400 font-mono">{language}</span>
        </div>
        <CopyButton text={codeString} />
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
            fontSize: "0.8125rem",
            lineHeight: "1.6",
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
  hr() {
    return (
      <div className="my-4 flex items-center gap-3">
        <div className="flex-1 border-t border-white/[0.06]" />
        <span className="text-[10px] text-gray-600 uppercase tracking-widest">
          continued
        </span>
        <div className="flex-1 border-t border-white/[0.06]" />
      </div>
    );
  },
};

// ── Segment-based Markdown Content ──
// Pre-parses tool blocks out of markdown so they render as
// standalone React components with preserved state.

function MarkdownContent({ content }: { content: string }) {
  const segments = useMemo(() => parseContentSegments(content), [content]);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-7 prose-li:leading-7 prose-headings:text-gray-100 prose-p:text-gray-300 prose-li:text-gray-300 prose-strong:text-gray-100 prose-a:text-blue-400">
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return (
            <ReactMarkdown key={`text-${i}`} components={markdownComponents}>
              {seg.content}
            </ReactMarkdown>
          );
        }
        return <ToolBlock key={seg.key} toolType={seg.toolType} data={seg.data} />;
      })}
    </div>
  );
}

// ── Main Components ──

interface StreamOutputProps {
  messages: ConversationMessage[];
  streamingText: string;
  onSendPrompt?: (prompt: string) => void;
  onPermissionResponse?: (requestId: string, allow: boolean) => void;
}

export function StreamOutput({
  messages,
  streamingText,
  onSendPrompt,
  onPermissionResponse,
}: StreamOutputProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Determine which message should have interactive tool blocks:
  // Only the last assistant message is interactive, and only if
  // there's no user message after it (meaning it hasn't been answered).
  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  // Interactive if it's the very last message (no user reply after it)
  // and there's no active streaming (which would be a newer response)
  const interactiveMessageIdx =
    lastAssistantIdx >= 0 &&
    lastAssistantIdx === messages.length - 1 &&
    !streamingText
      ? lastAssistantIdx
      : -1;

  return (
    <SendPromptContext.Provider value={onSendPrompt}>
      <PermissionResponseContext.Provider value={onPermissionResponse}>
        <ScrollArea className="flex-1 min-h-0 px-4 py-2">
          <div className="space-y-6 max-w-4xl mx-auto py-4">
            {messages.map((msg, idx) => (
              <ToolInteractiveContext.Provider
                key={msg.id}
                value={idx === interactiveMessageIdx}
              >
                <MessageBubble message={msg} />
              </ToolInteractiveContext.Provider>
            ))}

            {streamingText && (
              <ToolInteractiveContext.Provider value={true}>
                <div className="flex gap-4 py-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500/15 flex items-center justify-center mt-0.5">
                    <Bot className="w-4 h-4 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <MarkdownContent content={streamingText} />
                    <span className="inline-block w-2 h-5 bg-violet-400 animate-pulse ml-0.5 rounded-sm" />
                  </div>
                </div>
              </ToolInteractiveContext.Provider>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </PermissionResponseContext.Provider>
    </SendPromptContext.Provider>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-4 rounded-xl px-4 py-4 ${
        isUser ? "bg-white/[0.03]" : ""
      }`}
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${
          isUser ? "bg-blue-500/15" : "bg-violet-500/15"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-blue-400" />
        ) : (
          <Bot className="w-4 h-4 text-violet-400" />
        )}
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div
          className={`text-xs font-medium mb-1.5 ${
            isUser ? "text-blue-400" : "text-violet-400"
          }`}
        >
          {isUser ? "You" : "Claude"}
        </div>
        {isUser ? (
          <p className="text-sm leading-7 whitespace-pre-wrap text-gray-200">
            {message.content}
          </p>
        ) : (
          <MarkdownContent content={message.content} />
        )}
        {message.costUsd !== undefined && (
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span>${message.costUsd.toFixed(4)}</span>
            {message.durationMs !== undefined && (
              <span>{(message.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
