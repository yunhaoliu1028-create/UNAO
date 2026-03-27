import type { ReactNode } from "react";

export function DataTableShell({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-appline bg-white shadow-card">{children}</div>;
}
