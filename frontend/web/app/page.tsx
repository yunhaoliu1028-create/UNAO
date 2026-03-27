import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <section className="relative overflow-hidden rounded-[2rem] border border-appline bg-white p-8 shadow-card sm:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-black/5 blur-3xl" />
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-appmuted">Unao Platform</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-apptext sm:text-6xl">
          Built with clarity.
          <br />
          Designed in black and white.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-appmuted sm:text-lg">
          Go to dashboard or history with a calmer, Apple-inspired interface system focused on spacing, typography, and contrast.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-full border border-appprimary bg-appprimary px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-85"
          >
            Open Dashboard
          </Link>
          <Link
            href="/history"
            className="rounded-full border border-appline bg-white px-5 py-2.5 text-sm font-semibold text-apptext transition hover:bg-appprimary/5"
          >
            Open History
          </Link>
        </div>
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <Link href="/dashboard" className="rounded-3xl border border-appline bg-white p-6 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card">
          <p className="text-lg font-semibold tracking-tight text-apptext">Main Dashboard</p>
          <p className="mt-2 text-sm text-appmuted">Upload estimate PDF and jump into workspace.</p>
        </Link>
        <Link href="/history" className="rounded-3xl border border-appline bg-white p-6 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card">
          <p className="text-lg font-semibold tracking-tight text-apptext">History</p>
          <p className="mt-2 text-sm text-appmuted">Review previous invoices with search and pagination.</p>
        </Link>
        <Link
          href="/estimates/new"
          className="rounded-3xl border border-dashed border-appline bg-appprimary/5 p-6 text-sm font-medium text-appmuted transition hover:bg-appprimary/10 sm:col-span-2"
        >
          Legacy page: open `/estimates/new`
        </Link>
      </section>
    </main>
  );
}
