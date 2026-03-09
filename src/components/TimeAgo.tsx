"use client";

import { useState, useEffect } from "react";

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface TimeAgoProps {
  timestamp: number;
  className?: string;
}

/**
 * Hydration-safe relative time display.
 * Renders empty on server, fills in on client to avoid SSR mismatch.
 */
export function TimeAgo({ timestamp, className }: TimeAgoProps) {
  const [text, setText] = useState("");

  useEffect(() => {
    setText(formatTimeAgo(timestamp));

    // Update every 30s for live-ish feel
    const interval = setInterval(() => {
      setText(formatTimeAgo(timestamp));
    }, 30_000);

    return () => clearInterval(interval);
  }, [timestamp]);

  return <span className={className}>{text}</span>;
}
