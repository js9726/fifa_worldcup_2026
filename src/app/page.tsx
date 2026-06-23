import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell home-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Invite-only live draw</p>
          <h1>World Cup 2026 Pools</h1>
        </div>
        <img
          className="topbar-logo"
          src="/wc-logo-icon.png"
          alt="World Cup Sweepstake"
          width={124}
          height={125}
        />
      </section>
      <section className="home-panel">
        <h2>Private sweepstake dashboard</h2>
        <p>
          Open your personal invite link to view your group. Every draw is stored in Neon and each
          country can only be claimed once inside the same group.
        </p>
        <div className="home-actions">
          <Link href="/demo" className="primary-button">
            View demo
          </Link>
          <Link href="/admin" className="text-link">
            Admin overview
          </Link>
        </div>
      </section>
    </main>
  );
}
