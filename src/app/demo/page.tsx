import SweepstakeClient from "@/app/sweepstake-client";
import { demoState } from "@/lib/demo-state";

export default function DemoPage() {
  return <SweepstakeClient initialState={demoState} demoMode initialTab="bet-pool" />;
}
