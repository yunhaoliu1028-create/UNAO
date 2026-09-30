"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme/theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const isDark = theme === "dark";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <button
      type="button"
      onClick={mounted ? toggleTheme : undefined}
      aria-label={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Theme toggle"}
      title={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Theme toggle"}
      className="inline-flex items-center gap-2 rounded-full border border-appline bg-white px-3 py-1.5 text-sm font-medium text-apptext transition hover:bg-appprimary hover:text-white"
    >
      <span className="text-xs uppercase tracking-wide">Dark Mode</span>
      <span className="text-[11px] text-appmuted">{mounted && isDark ? "On" : "Off"}</span>
    </button>
  );
}
