"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle() {
  const { mode, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title={`Theme: ${mode}`}
    >
      {mode === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  );
}
