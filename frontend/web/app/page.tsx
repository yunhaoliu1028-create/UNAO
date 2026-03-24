import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page">
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Unao Frontend Prototype</h1>
        <p>Start from the estimate upload workflow:</p>
        <p>
          <Link href="/estimates/new">Open /estimates/new</Link>
        </p>
      </div>
    </main>
  );
}
