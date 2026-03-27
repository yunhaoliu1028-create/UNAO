"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { recentHistory } from "@/lib/mock-data";

export default function DashboardPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Drop estimate PDF to start parsing.");
  const [hasError, setHasError] = useState(false);

  function onSelectFile(file: File | null) {
    if (!file) {
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Only PDF files are supported.");
      setHasError(true);
      return;
    }

    setHasError(false);
    setLoading(true);
    setProgress(0);
    setMessage(`Parsing ${file.name}...`);
    let value = 0;
    const timer = window.setInterval(() => {
      value = Math.min(value + 10, 100);
      setProgress(value);
      if (value >= 100) {
        window.clearInterval(timer);
        setMessage("Parse complete. Opening workspace...");
        const workspaceId = `ws-${Date.now()}`;
        window.setTimeout(() => router.push(`/workspace/${workspaceId}`), 250);
      }
    }, 120);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-appline bg-white p-7 shadow-card sm:p-8">
        <div className="mb-4">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-apptext">Main Dashboard</h1>
          <p className="mt-2 text-sm text-appmuted">Upload an estimate PDF and generate consumables invoice in one flow.</p>
        </div>

        <button
          type="button"
          className={[
            "w-full rounded-xl border-2 border-dashed p-10 text-center transition",
            hasError ? "border-red-400 bg-red-50" : "",
            dragging ? "border-apptext bg-appprimary/5" : "border-appline bg-appprimary/5 hover:bg-appprimary/10",
            loading ? "cursor-default opacity-80" : ""
          ].join(" ")}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!loading) {
              setDragging(true);
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!loading) {
              setDragging(true);
            }
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (!loading) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!loading) {
              onSelectFile(event.dataTransfer.files?.[0] ?? null);
            }
          }}
          onClick={() => {
            if (!loading) {
              inputRef.current?.click();
            }
          }}
        >
          <p className="text-base font-semibold text-apptext">Drag estimate PDF here</p>
          <p className="mt-2 text-sm text-appmuted">or click to browse from your computer</p>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => onSelectFile(event.target.files?.[0] ?? null)}
          />
        </button>

        <div className="mt-4">
          <p className={`mb-2 text-sm ${hasError ? "font-medium text-red-700" : "text-appmuted"}`}>{message}</p>
          {loading ? (
            <div
              role="progressbar"
              aria-label="Estimate parsing progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-2 w-full overflow-hidden rounded-full bg-zinc-200"
            >
              <div className="h-full rounded-full bg-apptext transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-appline bg-white p-7 shadow-card sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-apptext">Recent History</h2>
          <Link href="/history" className="text-sm font-medium text-appmuted transition hover:text-apptext hover:underline">
            View all
          </Link>
        </div>
        <div className="space-y-2">
          {recentHistory.slice(0, 4).map((item) => (
            <Link
              key={item.id}
              href={`/workspace/${item.id}`}
              className="flex items-center justify-between rounded-2xl border border-appline px-4 py-3 transition hover:bg-appprimary/5"
            >
              <div>
                <p className="text-sm font-semibold text-apptext">{item.roVin}</p>
                <p className="text-xs text-appmuted">
                  {item.date} - {item.id}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-apptext">${item.total.toFixed(2)}</span>
                <StatusBadge status={item.status} />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
