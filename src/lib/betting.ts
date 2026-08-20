import type {
  BetAcceptance,
  BetLeaderboardRow,
  BetOffer,
  FuturesMarket,
  FuturesEntry,
  BettingState,
  Participant
} from "./types";

function emptyRow(participant: Participant): Omit<BetLeaderboardRow, "rank"> {
  return {
    participantId: participant.id,
    participantName: participant.name,
    settledNet: 0,
    won: 0,
    lost: 0,
    void: 0,
    settledVolume: 0,
    openExposure: 0,
    openOffers: 0,
    activeAccepts: 0,
    futuresSettledNet: 0,
    futuresVolume: 0,
    futuresOpenExposure: 0,
    futuresEntries: 0,
    futuresWins: 0,
    futuresLosses: 0,
    futuresRolloverLosses: 0
  };
}

function countOutcome(row: Omit<BetLeaderboardRow, "rank">, delta: number, acceptance: BetAcceptance) {
  if (acceptance.status === "void" || acceptance.result === "void" || delta === 0) {
    row.void += 1;
    return;
  }

  if (delta > 0) {
    row.won += 1;
  } else {
    row.lost += 1;
  }
}

function futuresEntryNet(entry: FuturesEntry) {
  return Math.round((entry.payoutAmount - entry.amount) * 100) / 100;
}

function countFuturesOutcome(row: Omit<BetLeaderboardRow, "rank">, entry: FuturesEntry, delta: number) {
  if (entry.result === "win" || entry.result === "partial_win") {
    row.won += 1;
    row.futuresWins += 1;
    return;
  }

  if (entry.result === "loss" || entry.result === "rollover" || delta < 0) {
    row.lost += 1;
    row.futuresLosses += 1;
    if (entry.result === "rollover") row.futuresRolloverLosses += 1;
    return;
  }

  row.void += 1;
}

export function buildBettingLeaderboard(
  participants: Participant[],
  offers: BetOffer[],
  futuresMarkets: FuturesMarket[] = []
): BetLeaderboardRow[] {
  const rows = new Map(participants.map((participant) => [participant.id, emptyRow(participant)]));

  for (const offer of offers) {
    const creator = rows.get(offer.creatorParticipantId);
    if (!creator) continue;

    if (offer.status === "open" || offer.status === "filled") {
      creator.openOffers += offer.status === "open" ? 1 : 0;
      const pendingAccepted = offer.acceptances
        .filter((acceptance) => acceptance.status === "pending")
        .reduce((total, acceptance) => total + acceptance.amount, 0);
      creator.openExposure += pendingAccepted;
    }

    for (const acceptance of offer.acceptances) {
      const accepter = rows.get(acceptance.participantId);
      if (!accepter) continue;

      if (acceptance.status === "pending") {
        accepter.activeAccepts += 1;
        accepter.openExposure += acceptance.amount;
        continue;
      }

      const accepterDelta = acceptance.ledgerDelta;
      const creatorDelta = -acceptance.ledgerDelta;

      accepter.settledNet += accepterDelta;
      accepter.settledVolume += acceptance.amount;
      countOutcome(accepter, accepterDelta, acceptance);

      creator.settledNet += creatorDelta;
      creator.settledVolume += acceptance.amount;
      countOutcome(creator, creatorDelta, acceptance);
    }
  }

  for (const market of futuresMarkets) {
    for (const entry of market.entries) {
      const row = rows.get(entry.participantId);
      if (!row) continue;

      row.futuresEntries += 1;

      if (entry.status !== "settled" && entry.result === "pending") {
        row.activeAccepts += 1;
        row.openExposure += entry.amount;
        row.futuresOpenExposure += entry.amount;
        continue;
      }

      const delta = futuresEntryNet(entry);
      row.settledNet += delta;
      row.settledVolume += entry.amount;
      row.futuresSettledNet += delta;
      row.futuresVolume += entry.amount;
      countFuturesOutcome(row, entry, delta);
    }
  }

  return [...rows.values()]
    .sort(
      (a, b) =>
        b.settledNet - a.settledNet ||
        b.settledVolume - a.settledVolume ||
        a.participantName.localeCompare(b.participantName)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildBettingState(
  participants: Participant[],
  participant: Participant | null,
  offers: BetOffer[],
  futuresMarkets: FuturesMarket[] = []
): BettingState {
  return {
    offers,
    openOffers: offers.filter((offer) => offer.status === "open" || offer.status === "filled"),
    myOffers: participant ? offers.filter((offer) => offer.creatorParticipantId === participant.id) : [],
    myAcceptances: participant
      ? offers.flatMap((offer) =>
          offer.acceptances.filter((acceptance) => acceptance.participantId === participant.id)
        )
      : [],
    futuresMarkets,
    leaderboard: buildBettingLeaderboard(participants, offers, futuresMarkets)
  };
}
