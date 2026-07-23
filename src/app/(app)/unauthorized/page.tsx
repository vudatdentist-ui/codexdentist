import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="workspace">
      <section className="panel empty-route">
        <p className="eyebrow">Access control</p>
        <h1>Not available for this role</h1>
        <p>This account does not have permission to open that workspace.</p>
        <Link className="primary-button link-button" href="/dashboard">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
