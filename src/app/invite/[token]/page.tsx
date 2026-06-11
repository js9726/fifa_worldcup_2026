import SweepstakeClient from "@/app/sweepstake-client";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SweepstakeClient token={token} />;
}
