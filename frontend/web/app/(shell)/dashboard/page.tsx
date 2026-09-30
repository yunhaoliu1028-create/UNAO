"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

const DASHBOARD_INTAKE_STORAGE_KEY = "unao.dashboard.intake";
const DASHBOARD_INTAKE_DB_NAME = "unao-dashboard-intake";
const DASHBOARD_INTAKE_STORE_NAME = "files";
const DASHBOARD_INTAKE_RECORD_KEY = "latest";

function openDashboardIntakeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DASHBOARD_INTAKE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DASHBOARD_INTAKE_STORE_NAME)) {
        db.createObjectStore(DASHBOARD_INTAKE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open intake database."));
  });
}

async function saveDashboardIntakeFile(file: File): Promise<void> {
  const db = await openDashboardIntakeDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DASHBOARD_INTAKE_STORE_NAME, "readwrite");
    tx.objectStore(DASHBOARD_INTAKE_STORE_NAME).put(
      {
        blob: file,
        name: file.name,
        type: file.type || "application/pdf",
        savedAt: Date.now()
      },
      DASHBOARD_INTAKE_RECORD_KEY
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to persist intake file."));
    tx.onabort = () => reject(tx.error ?? new Error("Intake file save aborted."));
  });
  db.close();
}

type HistoryRow = {
  id: string;
  date: string;
  roVin: string;
  total: number;
  status: "Completed" | "Processing" | "Needs Review";
};

export default function DashboardPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [recentRows, setRecentRows] = useState<HistoryRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Drop estimate PDF to start parsing.");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadRecentRows() {
      try {
        const response = await fetch("/v1/invoices");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { invoices?: HistoryRow[] };
        if (mounted && Array.isArray(data.invoices)) {
          setRecentRows(data.invoices.slice(0, 4));
        }
      } catch {
        // Keep UI functional even if history API is unavailable.
      }
    }
    void loadRecentRows();
    return () => {
      mounted = false;
    };
  }, []);

  async function onSelectFile(file: File | null) {
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
    setProgress(100);
    setMessage(`Opening NEW with ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const intakeResponse = await fetch("/v1/estimates/intake", {
        method: "POST",
        body: formData
      });
      if (!intakeResponse.ok) {
        const text = await intakeResponse.text();
        throw new Error(text.slice(0, 200) || `intake upload failed (${intakeResponse.status})`);
      }
      const intakeData = (await intakeResponse.json()) as { token?: string };
      const intakeToken = String(intakeData.token || "").trim();
      if (!intakeToken) {
        throw new Error("Missing intake token from server.");
      }

      await saveDashboardIntakeFile(file);
      const intakePayload = {
        blobUrl: URL.createObjectURL(file),
        name: file.name,
        type: file.type || "application/pdf"
      };
      sessionStorage.setItem(DASHBOARD_INTAKE_STORAGE_KEY, JSON.stringify(intakePayload));
      router.push(`/estimates/new?source=dashboard&intakeToken=${encodeURIComponent(intakeToken)}`);
    } catch (error) {
      setLoading(false);
      setProgress(0);
      const detail = error instanceof Error ? ` (${error.message})` : "";
      setMessage(`Failed to hand off file to NEW. Please try again.${detail}`);
      setHasError(true);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-appline bg-white p-7 shadow-card sm:p-8">
        <div className="mb-4">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-apptext">Main Dashboard</h1>
          <p className="mt-2 text-sm text-appmuted">Upload an estimate PDF and generate consumables invoice in one flow.</p>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Link
            href="/estimates/new"
            className="rounded-full border border-appprimary bg-appprimary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            New Invoice
          </Link>
          <Link
            href="/history"
            className="rounded-full border border-appline bg-white px-4 py-2 text-sm font-semibold text-apptext transition hover:bg-appprimary/10"
          >
            History
          </Link>
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
              void onSelectFile(event.dataTransfer.files?.[0] ?? null);
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
            onChange={(event) => {
              void onSelectFile(event.target.files?.[0] ?? null);
            }}
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
          {recentRows.map((item) => (
            <Link
              key={item.id}
              href={`/estimates/new?invoiceId=${encodeURIComponent(item.id)}`}
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
          {recentRows.length === 0 ? (
            <p className="rounded-2xl border border-appline px-4 py-3 text-sm text-appmuted">No saved invoices yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
