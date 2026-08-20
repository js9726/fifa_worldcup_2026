// Pure futures-pool payout checks. The app implementation lives in src/lib/futures.ts;
// this script mirrors the cents-based pari-mutuel maths so it can run directly in Node.

const SELFTEST = process.argv.includes("--selftest");

export function allocateWinningPayouts(entries, winningOptionId, totalPot) {
  const winners = entries
    .filter((entry) => entry.optionId === winningOptionId)
    .sort((a, b) => a.id - b.id);
  const payouts = new Map();
  if (!winners.length) return payouts;

  const totalPotCents = toCents(totalPot);
  const winningStakeCents = winners.reduce((total, entry) => total + toCents(entry.amount), 0);
  let allocatedCents = 0;

  winners.forEach((entry, index) => {
    const payoutCents =
      index === winners.length - 1
        ? totalPotCents - allocatedCents
        : Math.floor((toCents(entry.amount) * totalPotCents) / winningStakeCents);
    allocatedCents += payoutCents;
    payouts.set(entry.id, fromCents(payoutCents));
  });

  return payouts;
}

export function settleFuturesPool({ entries, winningOptionId, rolloverAmount = 0, payoutRate = 1 }) {
  const totalStake = roundMoney(entries.reduce((total, entry) => total + entry.amount, 0));
  const totalPot = roundMoney(totalStake + rolloverAmount);
  const payoutPool = roundMoney(totalPot * payoutRate);
  const payouts = winningOptionId == null || payoutPool <= 0 ? new Map() : allocateWinningPayouts(entries, winningOptionId, payoutPool);
  const paidOut = roundMoney([...payouts.values()].reduce((total, payout) => total + payout, 0));
  return {
    totalPot,
    status: payouts.size ? "settled" : "rolled_over",
    rolloverAmount: payouts.size ? roundMoney(totalPot - paidOut) : totalPot,
    payouts
  };
}

export function canEnterFuturesPool({ status, closesAt, now }) {
  return status === "open" && new Date(closesAt).getTime() > new Date(now).getTime();
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function fromCents(value) {
  return value / 100;
}

if (SELFTEST) {
  const checks = [];
  const expect = (label, condition) => checks.push({ label, ok: Boolean(condition) });

  const onlyWinners = settleFuturesPool({
    winningOptionId: 1,
    entries: [
      { id: 1, participantId: 1, optionId: 1, amount: 50 },
      { id: 2, participantId: 2, optionId: 1, amount: 20 }
    ]
  });
  expect("single winning side returns stake only", onlyWinners.payouts.get(1) === 50 && onlyWinners.payouts.get(2) === 20);

  const mixed = settleFuturesPool({
    winningOptionId: 1,
    entries: [
      { id: 1, participantId: 1, optionId: 1, amount: 50 },
      { id: 2, participantId: 2, optionId: 1, amount: 20 },
      { id: 3, participantId: 3, optionId: 2, amount: 50 }
    ]
  });
  expect("mixed pool pays RM85.71 to RM50 winner", mixed.payouts.get(1) === 85.71);
  expect("mixed pool pays RM34.29 to RM20 winner", mixed.payouts.get(2) === 34.29);

  const partial = settleFuturesPool({
    winningOptionId: 1,
    payoutRate: 0.5,
    entries: [
      { id: 1, participantId: 1, optionId: 1, amount: 50 },
      { id: 2, participantId: 2, optionId: 2, amount: 50 }
    ]
  });
  expect("partial winner pays half the pot", partial.payouts.get(1) === 50);
  expect("partial winner rolls the unpaid half", partial.rolloverAmount === 50);

  const multipleEntriesSamePlayer = settleFuturesPool({
    winningOptionId: 1,
    entries: [
      { id: 1, participantId: 1, optionId: 1, amount: 20 },
      { id: 2, participantId: 1, optionId: 1, amount: 30 },
      { id: 3, participantId: 2, optionId: 2, amount: 50 }
    ]
  });
  expect(
    "same participant can add more stake before deadline",
    multipleEntriesSamePlayer.payouts.get(1) + multipleEntriesSamePlayer.payouts.get(2) === 100
  );

  const noWinner = settleFuturesPool({
    winningOptionId: 3,
    entries: [
      { id: 1, participantId: 1, optionId: 1, amount: 50 },
      { id: 2, participantId: 2, optionId: 2, amount: 50 }
    ]
  });
  expect("no correct entries rolls the whole pot", noWinner.status === "rolled_over" && noWinner.rolloverAmount === 100);

  expect(
    "entry before deadline is accepted",
    canEnterFuturesPool({ status: "open", closesAt: "2026-07-10T12:00:00Z", now: "2026-07-10T11:59:00Z" })
  );
  expect(
    "entry after deadline is rejected",
    !canEnterFuturesPool({ status: "open", closesAt: "2026-07-10T12:00:00Z", now: "2026-07-10T12:00:00Z" })
  );
  expect(
    "closed market rejects entries",
    !canEnterFuturesPool({ status: "closed", closesAt: "2026-07-10T12:00:00Z", now: "2026-07-10T11:00:00Z" })
  );

  let failed = 0;
  for (const { label, ok } of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
  if (failed) process.exit(1);
}
