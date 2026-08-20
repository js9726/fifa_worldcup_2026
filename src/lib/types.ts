export type Pot = {
  id: number;
  name: string;
  label: string;
  colour: string;
  available: number;
  total: number;
};

export type Team = {
  id: number;
  country: string;
  potId: number;
  potName: string;
  potLabel: string;
  flag: string;
  confed: string;
  starPlayer: string;
  playerRole: string;
  fifaRank: number;
  winRate: number;
  top10Rate: number;
  expectedRank: number;
  finalRank: number | null;
  eliminatedStage: string | null;
  resultNote: string | null;
};

export type Draw = {
  participantName: string;
  participantId: number;
  team: Team;
  drawnAt: string;
};

export type Fixture = {
  id: number;
  kickoff: string;
  stage: string;
  homeCountry: string;
  awayCountry: string;
  venue: string;
  homeScore: number | null;
  awayScore: number | null;
  regularHomeScore: number | null;
  regularAwayScore: number | null;
  extraHomeScore: number | null;
  extraAwayScore: number | null;
  scoreDuration: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT" | null;
  homeOwner: string | null;
  awayOwner: string | null;
  oddsProvider: string | null;
  oddsBookmaker: string | null;
  oddsMarket: string | null;
  oddsFavourite: string | null;
  oddsHandicapLine: number | null;
  oddsHomePrice: number | null;
  oddsAwayPrice: number | null;
  oddsLastUpdated: string | null;
};

export type Participant = {
  id: number;
  name: string;
  groupId: number;
};

export type SweepstakeGroup = {
  id: number;
  slug: string;
  name: string;
  allowDraws: boolean;
  teamsPerParticipant: number | null;
  prizePoolAmount: number;
  championPrizeAmount: number;
  runnerUpPrizeAmount: number;
  woodenSpoonPrizeAmount: number;
  createdAt: string;
};

export type SweepstakeGroupSummary = SweepstakeGroup & {
  participantCount: number;
  drawCount: number;
  offerCount: number;
};

export type BetMarket = "winner" | "asian_handicap";

export type BetSettlementBasis = "advance_winner" | "ninety_minutes" | "after_extra_time" | "extra_time";

export type BetOfferStatus = "open" | "filled" | "closed" | "settled" | "void";

export type BetAcceptanceStatus = "pending" | "settled" | "void";

export type BetAcceptanceResult = "win" | "loss" | "half_win" | "half_loss" | "void" | "pending";

export type FuturesMarketStatus = "open" | "closed" | "settled" | "rolled_over" | "void";

export type FuturesEntryStatus = "active" | "settled";

export type FuturesEntryResult = "pending" | "win" | "partial_win" | "loss" | "rollover";

export type FuturesSettlementBasis = "ninety_minutes" | "advance_winner" | "full_match" | "manual";

export type BetAcceptance = {
  id: number;
  offerId: number;
  participantId: number;
  participantName: string;
  amount: number;
  status: BetAcceptanceStatus;
  result: BetAcceptanceResult;
  ledgerDelta: number;
  acceptedAt: string;
};

export type BetOffer = {
  id: number;
  groupId: number;
  fixtureId: number;
  creatorParticipantId: number;
  creatorName: string;
  market: BetMarket;
  creatorSide: string;
  opponentSide: string;
  settlementBasis: BetSettlementBasis;
  handicapTeam: string | null;
  handicapLine: number | null;
  maxAmount: number;
  acceptedAmount: number;
  remainingAmount: number;
  status: BetOfferStatus;
  createdAt: string;
  note: string | null;
  acceptances: BetAcceptance[];
};

export type FuturesOption = {
  id: number;
  marketId: number;
  label: string;
  sortOrder: number;
  totalStake: number;
  entryCount: number;
  poolShare: number;
  estimatedReturnFor10: number;
  estimatedReturnFor50: number;
};

export type FuturesEntry = {
  id: number;
  marketId: number;
  optionId: number;
  participantId: number;
  participantName: string;
  amount: number;
  status: FuturesEntryStatus;
  result: FuturesEntryResult;
  payoutAmount: number;
  placedAt: string;
};

export type FuturesMarket = {
  id: number;
  groupId: number;
  title: string;
  marketType: string;
  creatorParticipantId?: number | null;
  creatorName?: string | null;
  fixtureId?: number | null;
  settlementBasis?: FuturesSettlementBasis;
  rolloverTarget?: string | null;
  autoCreated?: boolean;
  closeDescription?: string | null;
  lossRule?: string | null;
  status: FuturesMarketStatus;
  opensAt?: string | null;
  closesAt: string;
  settledOptionId: number | null;
  rolloverAmount: number;
  createdAt: string;
  totalStake: number;
  totalPot: number;
  winningStake: number;
  entryCount: number;
  uniqueParticipantCount: number;
  options: FuturesOption[];
  entries: FuturesEntry[];
  myEntries: FuturesEntry[];
};

export type BetLeaderboardRow = {
  rank: number;
  participantId: number;
  participantName: string;
  settledNet: number;
  won: number;
  lost: number;
  void: number;
  settledVolume: number;
  openExposure: number;
  openOffers: number;
  activeAccepts: number;
  futuresSettledNet: number;
  futuresVolume: number;
  futuresOpenExposure: number;
  futuresEntries: number;
  futuresWins: number;
  futuresLosses: number;
  futuresRolloverLosses: number;
};

export type BettingState = {
  offers: BetOffer[];
  openOffers: BetOffer[];
  myOffers: BetOffer[];
  myAcceptances: BetAcceptance[];
  futuresMarkets: FuturesMarket[];
  leaderboard: BetLeaderboardRow[];
};

export type AppState = {
  group: SweepstakeGroup | null;
  participant: Participant | null;
  participants: Participant[];
  pots: Pot[];
  myDraws: Draw[];
  allDraws: Draw[];
  fixtures: Fixture[];
  teams: Team[];
  betting: BettingState;
};
