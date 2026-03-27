"use client";

import type { KeyboardEvent } from "react";

type TabItem = {
  id: string;
  label: string;
};

type TabsProps = {
  items: TabItem[];
  activeId: string;
  onChange: (next: string) => void;
};

export function Tabs({ items, activeId, onChange }: TabsProps) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    const currentIndex = items.findIndex((item) => item.id === activeId);
    if (currentIndex < 0) {
      return;
    }
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + delta + items.length) % items.length;
    onChange(items[nextIndex].id);
  }

  return (
    <div className="mb-6 border-b border-appline">
      <div role="tablist" aria-label="Workspace sections" className="flex flex-wrap gap-2" onKeyDown={onKeyDown}>
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${item.id}`}
              id={`tab-${item.id}`}
              tabIndex={active ? 0 : -1}
              className={[
                "rounded-t-xl border border-b-0 px-4 py-2 text-sm font-semibold tracking-tight transition",
                active
                  ? "border-appline bg-white text-apptext"
                  : "border-transparent bg-transparent text-appmuted hover:bg-appprimary/5 hover:text-apptext"
              ].join(" ")}
              onClick={() => onChange(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
