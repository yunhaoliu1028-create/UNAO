import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-10 sm:px-6 sm:py-14">
      <section className="grid w-full gap-4 sm:grid-cols-2">
        <Link
          href="/estimates/new"
          className="rounded-3xl border border-appline bg-white p-8 text-center shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
        >
          <p className="text-xl font-semibold tracking-tight text-apptext">NEW INVOICE</p>
        </Link>
        <Link
          href="/history"
          className="rounded-3xl border border-appline bg-white p-8 text-center shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
        >
          <p className="text-xl font-semibold tracking-tight text-apptext">HISTORY</p>
        </Link>
      </section>
    </main>
  );
}
