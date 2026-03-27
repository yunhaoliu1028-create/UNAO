import Link from "next/link";
import { AccountMenu } from "@/components/layout/account-menu";

const navItems = [
  { href: "/dashboard", label: "Home" },
  { href: "/history", label: "History" }
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-appline/80 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-lg font-semibold tracking-[-0.03em] text-apptext">
            UNAO
          </Link>
          <nav className="flex items-center gap-1 rounded-full border border-appline bg-white px-1 py-1 shadow-soft">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-appmuted transition hover:bg-appprimary hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <AccountMenu />
      </div>
    </header>
  );
}
