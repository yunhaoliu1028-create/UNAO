type Status = "Completed" | "Processing" | "Needs Review";

const statusClasses: Record<Status, string> = {
  Completed: "bg-slate-100 text-slate-700 border-slate-200",
  Processing: "bg-zinc-200/70 text-zinc-700 border-zinc-300",
  "Needs Review": "bg-neutral-200 text-neutral-700 border-neutral-300"
};

const dotClasses: Record<Status, string> = {
  Completed: "bg-slate-500",
  Processing: "bg-zinc-500",
  "Needs Review": "bg-neutral-500"
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[status]}`} />
      {status}
    </span>
  );
}
