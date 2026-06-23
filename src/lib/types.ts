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
  createdAt: string;
};

export type SweepstakeGroupSummary = SweepstakeGroup & {
  participantCount: number;
  drawCount: number;
  offerCount: number;
};

export type BetMarket = "winner" | "asian_handicap";

export type BetSettlementBasis = "advance_winner" | "ninety_minutes";

export type BetOfferStatus = "open" | "filled" | "closed" | "settled" | "void";

export type BetAcceptanceStatus = "pending" | "settled" | "void";

export type BetAcceptanceResult = "win" | "loss" | "half_win" | "half_loss" | "void" | "pending";

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
};

export type BettingState = {
  offers: BetOffer[];
  openOffers: BetOffer[];
  myOffers: BetOffer[];
  myAcceptances: BetAcceptance[];
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
