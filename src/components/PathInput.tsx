"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { ChevronUp, Folder, File, Check } from "lucide-react";
import type { PathListResult } from "@/hooks/useWebSocket";

interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  onConfirm?: () => void;
  machineId: string | null;
  requestPathList: (machineId: string, path: string) => Promise<PathListResult>;
  placeholder?: string;
  className?: string;
}

export function PathInput({
  value,
  onChange,
  onConfirm,
  machineId,
  requestPathList,
  placeholder = "~/projects/my-app",
  className = "",
}: PathInputProps) {
  const [entries, setEntries] = useState<Array<{ name: string; isDir: boolean }>>([]);
  const [resolvedPath, setResolvedPath] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const requestCounterRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefixRef = useRef<string>("");

  const fetchEntries = useCallback(
    async (path: string) => {
      if (!machineId) return;

      const counter = ++requestCounterRef.current;
      setLoading(true);

      const result = await requestPathList(machineId, path);

      // Ignore stale responses
      if (counter !== requestCounterRef.current) return;

      setLoading(false);
      prefixRef.current = result.prefix || "";

      if (!result.error || result.entries.length > 0) {
        setEntries(result.entries);
        setResolvedPath(result.resolvedPath);
        setIsOpen(true);
        setHighlightedIndex(-1);
      } else {
        setEntries([]);
        setResolvedPath(result.resolvedPath);
      }
    },
    [machineId, requestPathList],
  );

  const debouncedFetch = useCallback(
    (path: string) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => fetchEntries(path), 300);
    },
    [fetchEntries],
  );

  // Fetch on value change (debounced) + reset confirmed
  useEffect(() => {
    setConfirmed(false);
    if (value && machineId) {
      debouncedFetch(value);
    } else {
      setEntries([]);
      setIsOpen(false);
    }
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [value, machineId, debouncedFetch]);

  const handleSelect = useCallback(
    (entry: { name: string; isDir: boolean }) => {
      if (!entry.isDir) return; // Only navigate into directories

      let newPath: string;

      if (entry.name === "..") {
        // Go up: remove last path segment
        const parts = value.replace(/\/+$/, "").split("/");
        parts.pop();
        newPath = parts.length === 0 ? "/" : parts.join("/");
        // Keep ~ prefix if original started with it
        if (newPath === "" && value.startsWith("~")) newPath = "~";
      } else if (prefixRef.current) {
        // Prefix mode: replace the prefix portion with the full entry name
        const parentPath = value.slice(0, value.length - prefixRef.current.length);
        newPath = parentPath + entry.name;
      } else {
        // Normal mode: append directory to current path
        const base = value.replace(/\/+$/, "");
        newPath = `${base}/${entry.name}`;
      }

      onChange(newPath);
      setHighlightedIndex(-1);
      prefixRef.current = "";
      // Immediate fetch (no debounce) for click/enter selection
      fetchEntries(newPath);
    },
    [value, onChange, fetchEntries],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Enter to confirm path when dropdown is closed or empty
      if (e.key === "Enter" && (!isOpen || entries.length === 0)) {
        e.preventDefault();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        setIsOpen(false);
        setConfirmed(true);
        onConfirm?.();
        return;
      }

      if (!isOpen || entries.length === 0) {
        // Open on arrow down even when closed
        if (e.key === "ArrowDown" && value && machineId) {
          e.preventDefault();
          fetchEntries(value);
          return;
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev < entries.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : entries.length - 1,
          );
          break;
        case "Enter":
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < entries.length) {
            handleSelect(entries[highlightedIndex]);
          } else {
            // No item highlighted — confirm the current path
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            setIsOpen(false);
            setConfirmed(true);
            onConfirm?.();
          }
          break;
        case "Tab":
          // Tab completes the highlighted or first directory entry
          e.preventDefault();
          if (highlightedIndex >= 0 && entries[highlightedIndex]?.isDir) {
            handleSelect(entries[highlightedIndex]);
          } else {
            const firstDir = entries.find((e) => e.isDir && e.name !== "..");
            if (firstDir) handleSelect(firstDir);
          }
          break;
        case "Escape":
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
      }
    },
    [isOpen, entries, highlightedIndex, handleSelect, value, machineId, fetchEntries, onConfirm],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current) {
      const items = dropdownRef.current.querySelectorAll("[data-entry-item]");
      items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const showResolvedPath = resolvedPath && value.startsWith("~") && resolvedPath !== value;
  const activePrefix = prefixRef.current;

  // Render entry name with prefix highlight
  const renderEntryName = (name: string, isDir: boolean) => {
    if (activePrefix && name !== "..") {
      const prefixLen = activePrefix.length;
      const matchPart = name.slice(0, prefixLen);
      const restPart = name.slice(prefixLen);
      return (
        <span className={`font-mono text-xs truncate ${isDir ? "" : "text-muted-foreground"}`}>
          <span className="font-bold text-foreground">{matchPart}</span>
          {restPart}
        </span>
      );
    }
    return (
      <span className={`font-mono text-xs truncate ${isDir ? "" : "text-muted-foreground"}`}>
        {name}
      </span>
    );
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (value && machineId && entries.length > 0) setIsOpen(true);
          else if (value && machineId) fetchEntries(value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`font-mono text-sm ${confirmed ? "border-green-500 pr-8" : ""} ${className}`}
        autoComplete="off"
      />
      {confirmed && (
        <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
      )}

      {isOpen && (entries.length > 0 || showResolvedPath) && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
        >
          {/* Resolved path header */}
          {showResolvedPath && (
            <div className="px-3 py-1.5 bg-muted/50 border-b text-xs text-muted-foreground font-mono truncate">
              {resolvedPath}
            </div>
          )}

          {/* Entries list */}
          <div className="max-h-48 overflow-y-auto py-1">
            {entries.map((entry, idx) => {
              const isHighlighted = idx === highlightedIndex;
              const isDir = entry.isDir;
              const isDotDot = entry.name === "..";

              return (
                <button
                  key={entry.name}
                  data-entry-item
                  onClick={() => {
                    if (isDir) handleSelect(entry);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                    isHighlighted ? "bg-accent" : ""
                  } ${isDir ? "cursor-pointer hover:bg-accent" : "cursor-default opacity-50"}`}
                >
                  {isDotDot ? (
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : isDir ? (
                    <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  {renderEntryName(entry.name, isDir)}
                </button>
              );
            })}
          </div>

          {loading && (
            <div className="px-3 py-1.5 border-t text-xs text-muted-foreground text-center">
              Loading...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
