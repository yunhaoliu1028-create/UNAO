import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { PageContainer } from "@/components/layout/page-container";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-appcard to-appbg text-apptext">
      <AppHeader />
      <PageContainer>{children}</PageContainer>
    </div>
  );
}
