import type { FuturesEntry, FuturesMarket, FuturesOption } from "./types";

export type FuturesOptionSeed = Pick<FuturesOption, "id" | "marketId" | "label" | "sortOrder">;

export type FuturesEntrySeed = Omit<FuturesEntry, "status" | "result" | "payoutAmount"> & {
  status?: FuturesEntry["status"];
  result?: FuturesEntry["result"];
  payoutAmount?: number;
};

export type FuturesMarketSeed = Omit<
  FuturesMarket,
  | "totalStake"
  | "totalPot"
  | "winningStake"
  | "entryCount"
  | "uniqueParticipantCount"
  | "options"
  | "entries"
  | "myEntries"
> & {
  options: FuturesOptionSeed[];
  entries: FuturesEntrySeed[];
};

export function hydrateFuturesMarket(
  seed: FuturesMarketSeed,
  currentParticipantId: number | null = null
): FuturesMarket {
  const normalizedEntries = seed.entries.map((entry) => ({
    ...entry,
    status: entry.status ?? "active",
    result: entry.result ?? "pending",
    payoutAmount: entry.payoutAmount ?? 0
  }));
  const totalStake = roundMoney(normalizedEntries.reduce((total, entry) => total + entry.amount, 0));
  const totalPot = roundMoney(totalStake + seed.rolloverAmount);
  const optionTotals = new Map<number, { totalStake: number; entryCount: number }>();

  for (const entry of normalizedEntries) {
    const current = optionTotals.get(entry.optionId) ?? { totalStake: 0, entryCount: 0 };
    current.totalStake = roundMoney(current.totalStake + entry.amount);
    current.entryCount += 1;
    optionTotals.set(entry.optionId, current);
  }

  const winningStake =
    seed.settledOptionId == null ? 0 : roundMoney(optionTotals.get(seed.settledOptionId)?.totalStake ?? 0);
  const hasPersistedSettlement =
    seed.status === "settled" &&
    normalizedEntries.some(
      (entry) => entry.status === "settled" || entry.result !== "pending" || entry.payoutAmount > 0
    );
  const payoutByEntryId =
    seed.status === "settled" && !hasPersistedSettlement && seed.settledOptionId != null && winningStake > 0
      ? allocateWinningPayouts(normalizedEntries, seed.settledOptionId, totalPot)
      : new Map<number, number>();
  const noWinnerRollover =
    seed.status === "rolled_over" || (seed.status === "settled" && seed.settledOptionId != null && winningStake <= 0);

  const entries = normalizedEntries.map((entry): FuturesEntry => {
    if (hasPersistedSettlement) {
      if (entry.result !== "pending") return { ...entry, status: "settled" };
      if (entry.payoutAmount > 0 && entry.payoutAmount < entry.amount) {
        return { ...entry, status: "settled", result: "partial_win" };
      }
      if (entry.payoutAmount > 0) return { ...entry, status: "settled", result: "win" };
      return { ...entry, status: "settled", result: "loss" };
    }
    if (seed.status === "settled" && payoutByEntryId.has(entry.id)) {
      return {
        ...entry,
        status: "settled",
        result: "win",
        payoutAmount: payoutByEntryId.get(entry.id) ?? 0
      };
    }
    if (seed.status === "settled") {
      return { ...entry, status: "settled", result: "loss", payoutAmount: 0 };
    }
    if (noWinnerRollover) {
      return { ...entry, status: "settled", result: "rollover", payoutAmount: 0 };
    }
    return entry;
  });

  const options = seed.options
    .map((option): FuturesOption => {
      const totals = optionTotals.get(option.id) ?? { totalStake: 0, entryCount: 0 };
      return {
        ...option,
        totalStake: totals.totalStake,
        entryCount: totals.entryCount,
        poolShare: totalPot > 0 ? totals.totalStake / totalPot : 0,
        estimatedReturnFor10: estimateFuturesReturn({
          stake: 10,
          optionStake: totals.totalStake,
          totalPot
        }),
        estimatedReturnFor50: estimateFuturesReturn({
          stake: 50,
          optionStake: totals.totalStake,
          totalPot
        })
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

  return {
    ...seed,
    status: noWinnerRollover ? "rolled_over" : seed.status,
    totalStake,
    totalPot,
    winningStake,
    entryCount: entries.length,
    uniqueParticipantCount: new Set(entries.map((entry) => entry.participantId)).size,
    options,
    entries,
    myEntries: currentParticipantId
      ? entries.filter((entry) => entry.participantId === currentParticipantId)
      : []
  };
}

export function estimateFuturesReturn({
  stake,
  optionStake,
  totalPot
}: {
  stake: number;
  optionStake: number;
  totalPot: number;
}) {
  const cleanStake = Math.max(0, Number(stake) || 0);
  if (cleanStake <= 0) return 0;
  const nextOptionStake = optionStake + cleanStake;
  const nextPot = totalPot + cleanStake;
  if (nextOptionStake <= 0) return 0;
  return roundMoney((cleanStake / nextOptionStake) * nextPot);
}

export function allocateWinningPayouts(
  entries: Array<Pick<FuturesEntry, "id" | "optionId" | "amount">>,
  winningOptionId: number,
  totalPot: number
) {
  const winners = entries
    .filter((entry) => entry.optionId === winningOptionId)
    .sort((a, b) => a.id - b.id);
  const payouts = new Map<number, number>();
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

export function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toCents(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

function fromCents(value: number) {
  return value / 100;
}
