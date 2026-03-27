"use client";

import { useEffect, useRef, useState } from "react";

const menuItems = ["Profile", "Billing", "Team Settings", "Sign out"];

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-appline bg-white px-3 py-1.5 text-sm font-medium text-apptext transition hover:bg-appprimary hover:text-white"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-appprimary/10 text-xs font-bold text-apptext">
          AL
        </span>
        Account
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-appline bg-white/95 p-1.5 shadow-card backdrop-blur">
          {menuItems.map((item) => (
            <button
              key={item}
              type="button"
              role="menuitem"
              className="block w-full rounded-xl px-3 py-2 text-left text-sm text-appmuted transition hover:bg-appprimary hover:text-white"
              onClick={() => setOpen(false)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
