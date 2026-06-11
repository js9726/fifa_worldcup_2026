import Link from "next/link";
import { Trophy } from "lucide-react";

export default function HomePage() {
  return (
    <main className="shell home-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Invite-only live draw</p>
          <h1>World Cup 2026 Pools</h1>
        </div>
        <div className="trophy-mark">
          <Trophy aria-hidden="true" />
        </div>
      </section>
      <section className="home-panel">
        <h2>Private sweepstake dashboard</h2>
        <p>
          Open your personal invite link to draw your countries. Every draw is stored in Neon and
          each country can only be claimed once.
        </p>
        <div className="home-actions">
          <Link href="/demo" className="primary-button">
            View demo
          </Link>
          <Link href="/admin" className="text-link">
            Admin results
          </Link>
        </div>
      </section>
    </main>
  );
}
