import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "World Cup 2026 Pools",
  description: "Invite-only FIFA World Cup 2026 sweepstake live draw"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
