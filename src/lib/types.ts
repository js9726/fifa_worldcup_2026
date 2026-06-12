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
};

export type AppState = {
  participant: Participant | null;
  participants: Participant[];
  pots: Pot[];
  myDraws: Draw[];
  allDraws: Draw[];
  fixtures: Fixture[];
  teams: Team[];
};
