import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export const metadata: Metadata = {
  title: "Unao - Estimate to Invoice",
  description: "Upload estimate PDF and generate consumable invoice."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("unao-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`
          }}
        />
        <ThemeProvider>
          <div className="fixed right-4 top-4 z-50">
            <ThemeToggle />
          </div>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
