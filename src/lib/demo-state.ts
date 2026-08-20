import seed from "../../data.seed.json";
import { buildBettingState } from "./betting";
import { hydrateFuturesMarket, type FuturesMarketSeed } from "./futures";
import type { AppState, BetOffer, Draw, Fixture, Participant, Pot, Team } from "./types";

type SeedTeam = (typeof seed.teams)[number];

const demoRanks: Record<string, { rank: number; stage: string; note: string }> = {
  France: { rank: 1, stage: "Champion", note: "Met the hype and won the pool." },
  England: { rank: 2, stage: "Runner-up", note: "Deep run, just short of the trophy." },
  Argentina: { rank: 3, stage: "Third place", note: "Still delivered elite value." },
  Spain: { rank: 4, stage: "Semi-final", note: "Strong finish, slightly under champion expectations." },
  Brazil: { rank: 8, stage: "Quarter-final", note: "Good run but below the pool's dream scenario." },
  Germany: { rank: 14, stage: "Round of 16", note: "Early exit for a heavyweight." },
  Morocco: { rank: 10, stage: "Round of 16", note: "Solid but not another miracle run." },
  Croatia: { rank: 9, stage: "Round of 16", note: "Outperformed the mid-tier brief." },
  Japan: { rank: 12, stage: "Round of 16", note: "A useful challenger pick." },
  Senegal: { rank: 15, stage: "Round of 16", note: "Beat expectations and caused trouble." },
  Scotland: { rank: 16, stage: "Round of 16", note: "Underdog bonus run." },
  Haiti: { rank: 47, stage: "Group stage", note: "Below expectation and out early." },
  Curacao: { rank: 48, stage: "Group stage", note: "Finished at the bottom of the demo table." }
};

const demoScores: Record<string, [number, number]> = {
  "Mexico-South Africa": [2, 0],
  "Korea Republic-Czechia": [1, 1],
  "Canada-Bosnia and Herzegovina": [3, 1],
  "United States-Paraguay": [2, 2],
  "Qatar-Switzerland": [0, 2],
  "Brazil-Morocco": [1, 2],
  "Haiti-Scotland": [0, 2],
  "Spain-Cape Verde": [4, 0],
  "Belgium-Egypt": [1, 2],
  "England-Ghana": [3, 1]
};

function mapTeam(team: SeedTeam): Team {
  const result = demoRanks[team.country];

  return {
    id: seed.teams.indexOf(team) + 1,
    country: team.country,
    potId: team.potId,
    potName: seed.pots.find((pot) => pot.id === team.potId)?.name ?? "",
    potLabel: seed.pots.find((pot) => pot.id === team.potId)?.label ?? "",
    flag: team.flag,
    confed: team.confed,
    starPlayer: team.star,
    playerRole: team.role,
    fifaRank: team.fifaRank,
    winRate: team.winRate,
    top10Rate: team.top10Rate,
    expectedRank: team.expectedRank,
    finalRank: result?.rank ?? null,
    eliminatedStage: result?.stage ?? null,
    resultNote: result?.note ?? null
  };
}

const participants: Participant[] = seed.participants.map((name, index) => ({
  id: index + 1,
  name,
  groupId: 1
}));

const teams = seed.teams.map(mapTeam);
const teamsByCountry = new Map(teams.map((team) => [team.country, team]));

const allDraws: Draw[] = seed.participants.flatMap((name, participantIndex) =>
  seed.pots.map((pot) => {
    const potTeams = teams.filter((team) => team.potId === pot.id);
    const team = potTeams[participantIndex % potTeams.length];

    return {
      participantName: name,
      participantId: participantIndex + 1,
      team,
      drawnAt: `2026-06-11T06:${String(participantIndex + pot.id).padStart(2, "0")}:00.000Z`
    };
  })
);

const ownerByCountry = new Map(allDraws.map((draw) => [draw.team.country, draw.participantName]));

const fixtures: Fixture[] = seed.fixtures.map((fixture, index) => {
  const score = demoScores[`${fixture.home}-${fixture.away}`] ?? [null, null];

  return {
    id: index + 1,
    kickoff: fixture.kickoff,
    stage: fixture.stage,
    homeCountry: fixture.home,
    awayCountry: fixture.away,
    venue: fixture.venue,
    homeScore: score[0],
    awayScore: score[1],
    regularHomeScore: score[0],
    regularAwayScore: score[1],
    extraHomeScore: null,
    extraAwayScore: null,
    scoreDuration: score[0] !== null && score[1] !== null ? "REGULAR" : null,
    homeOwner: ownerByCountry.get(fixture.home) ?? null,
    awayOwner: ownerByCountry.get(fixture.away) ?? null,
    oddsProvider: null,
    oddsBookmaker: null,
    oddsMarket: null,
    oddsFavourite: null,
    oddsHandicapLine: null,
    oddsHomePrice: null,
    oddsAwayPrice: null,
    oddsLastUpdated: null
  };
});

const argentinaFinalFixtureId = fixtures.length + 1;

fixtures.push({
  id: argentinaFinalFixtureId,
  kickoff: "2026-07-19T15:00:00-04:00",
  stage: "Final",
  homeCountry: "Argentina",
  awayCountry: "France",
  venue: "New Jersey",
  homeScore: 3,
  awayScore: 2,
  regularHomeScore: 2,
  regularAwayScore: 2,
  extraHomeScore: 1,
  extraAwayScore: 0,
  scoreDuration: "EXTRA_TIME",
  homeOwner: ownerByCountry.get("Argentina") ?? null,
  awayOwner: ownerByCountry.get("France") ?? null,
  oddsProvider: "Demo",
  oddsBookmaker: "To qualify example",
  oddsMarket: "Asian Handicap -0.25",
  oddsFavourite: "Argentina",
  oddsHandicapLine: -0.25,
  oddsHomePrice: 1.92,
  oddsAwayPrice: 1.96,
  oddsLastUpdated: "2026-07-19T20:00:00.000Z"
});

const participantByName = new Map(participants.map((participant) => [participant.name, participant]));
const fixtureByTeams = new Map(fixtures.map((fixture) => [`${fixture.homeCountry}-${fixture.awayCountry}`, fixture]));

function participant(name: string) {
  const row = participantByName.get(name);
  if (!row) throw new Error(`Unknown demo participant: ${name}`);
  return row;
}

function fixture(home: string, away: string) {
  const row = fixtureByTeams.get(`${home}-${away}`);
  if (!row) throw new Error(`Unknown demo fixture: ${home}-${away}`);
  return row;
}

const demoBetOffers: BetOffer[] = [
  {
    id: 1,
    groupId: 1,
    fixtureId: argentinaFinalFixtureId,
    creatorParticipantId: participant("SK").id,
    creatorName: "SK",
    market: "winner",
    creatorSide: "Argentina",
    opponentSide: "France",
    settlementBasis: "advance_winner",
    handicapTeam: null,
    handicapLine: null,
    maxAmount: 50,
    acceptedAmount: 50,
    remainingAmount: 0,
    status: "settled",
    createdAt: "2026-07-18T10:12:00.000Z",
    note: "Argentina qualified after a 2-2 normal-time score. To Qualify includes extra time and penalties.",
    acceptances: [
      {
        id: 101,
        offerId: 1,
        participantId: participant("LK").id,
        participantName: "LK",
        amount: 50,
        status: "settled",
        result: "loss",
        ledgerDelta: -50,
        acceptedAt: "2026-07-18T10:16:00.000Z"
      }
    ]
  },
  {
    id: 2,
    groupId: 1,
    fixtureId: fixture("Brazil", "Haiti").id,
    creatorParticipantId: participant("HY").id,
    creatorName: "HY",
    market: "winner",
    creatorSide: "Brazil",
    opponentSide: "Haiti",
    settlementBasis: "advance_winner",
    handicapTeam: null,
    handicapLine: null,
    maxAmount: 50,
    acceptedAmount: 30,
    remainingAmount: 20,
    status: "open",
    createdAt: "2026-06-18T09:30:00.000Z",
    note: "Partly filled; no minimum acceptance amount, so the final RM20 can still be taken.",
    acceptances: [
      {
        id: 102,
        offerId: 2,
        participantId: participant("BS").id,
        participantName: "BS",
        amount: 30,
        status: "pending",
        result: "pending",
        ledgerDelta: 0,
        acceptedAt: "2026-06-18T09:36:00.000Z"
      }
    ]
  },
  {
    id: 3,
    groupId: 1,
    fixtureId: fixture("Sweden", "Tunisia").id,
    creatorParticipantId: participant("CY").id,
    creatorName: "CY",
    market: "asian_handicap",
    creatorSide: "Sweden -0.75",
    opponentSide: "Tunisia +0.75",
    settlementBasis: "ninety_minutes",
    handicapTeam: "Sweden",
    handicapLine: -0.75,
    maxAmount: 70,
    acceptedAmount: 35,
    remainingAmount: 35,
    status: "open",
    createdAt: "2026-06-14T23:30:00.000Z",
    note: "AH offer uses the 90-minute score basis.",
    acceptances: [
      {
        id: 103,
        offerId: 3,
        participantId: participant("KL").id,
        participantName: "KL",
        amount: 35,
        status: "pending",
        result: "pending",
        ledgerDelta: 0,
        acceptedAt: "2026-06-14T23:45:00.000Z"
      }
    ]
  },
  {
    id: 4,
    groupId: 1,
    fixtureId: fixture("Spain", "Cape Verde").id,
    creatorParticipantId: participant("YK").id,
    creatorName: "YK",
    market: "asian_handicap",
    creatorSide: "Spain -1.5",
    opponentSide: "Cape Verde +1.5",
    settlementBasis: "ninety_minutes",
    handicapTeam: "Spain",
    handicapLine: -1.5,
    maxAmount: 50,
    acceptedAmount: 50,
    remainingAmount: 0,
    status: "settled",
    createdAt: "2026-06-15T08:10:00.000Z",
    note: "Spain won 4-0, so Spain -1.5 covered.",
    acceptances: [
      {
        id: 104,
        offerId: 4,
        participantId: participant("SL").id,
        participantName: "SL",
        amount: 50,
        status: "settled",
        result: "loss",
        ledgerDelta: -50,
        acceptedAt: "2026-06-15T08:18:00.000Z"
      }
    ]
  },
  {
    id: 5,
    groupId: 1,
    fixtureId: fixture("United States", "Paraguay").id,
    creatorParticipantId: participant("CC").id,
    creatorName: "CC",
    market: "asian_handicap",
    creatorSide: "United States 0",
    opponentSide: "Paraguay 0",
    settlementBasis: "ninety_minutes",
    handicapTeam: "United States",
    handicapLine: 0,
    maxAmount: 50,
    acceptedAmount: 50,
    remainingAmount: 0,
    status: "void",
    createdAt: "2026-06-12T13:00:00.000Z",
    note: "Level ball ended 2-2, so the accepted bet was void/refunded.",
    acceptances: [
      {
        id: 105,
        offerId: 5,
        participantId: participant("SY").id,
        participantName: "SY",
        amount: 50,
        status: "void",
        result: "void",
        ledgerDelta: 0,
        acceptedAt: "2026-06-12T13:04:00.000Z"
      }
    ]
  }
];

const demoFuturesMarkets = [
  hydrateFuturesMarket(
    {
      id: 1,
      groupId: 1,
      title: "England v DR Congo: who advances?",
      marketType: "match_advance",
      settlementBasis: "advance_winner",
      rolloverTarget: "World Cup Winner Jackpot",
      autoCreated: true,
      closeDescription: "Betting opens for 1 day and closes 5 hours before kickoff.",
      lossRule: "Wrong picks lose. If nobody picks the advancing team, every stake rolls into World Cup Winner Jackpot.",
      status: "open",
      opensAt: "2026-07-03T00:00:00.000Z",
      closesAt: "2026-07-04T10:00:00.000Z",
      settledOptionId: null,
      rolloverAmount: 0,
      createdAt: "2026-07-03T08:00:00.000Z",
      options: [
        { id: 1, marketId: 1, label: "England advances", sortOrder: 0 },
        { id: 2, marketId: 1, label: "DR Congo advances", sortOrder: 1 }
      ],
      entries: [
        {
          id: 1,
          marketId: 1,
          optionId: 1,
          participantId: participant("SK").id,
          participantName: "SK",
          amount: 50,
          placedAt: "2026-07-03T08:30:00.000Z"
        },
        {
          id: 2,
          marketId: 1,
          optionId: 2,
          participantId: participant("LK").id,
          participantName: "LK",
          amount: 20,
          placedAt: "2026-07-03T08:36:00.000Z"
        },
        {
          id: 3,
          marketId: 1,
          optionId: 1,
          participantId: participant("YK").id,
          participantName: "YK",
          amount: 30,
          placedAt: "2026-07-03T08:42:00.000Z"
        }
      ]
    } satisfies FuturesMarketSeed,
    participants[0].id
  ),
  hydrateFuturesMarket(
    {
      id: 2,
      groupId: 1,
      title: "Brazil v Morocco: who advances?",
      marketType: "match_advance",
      settlementBasis: "advance_winner",
      rolloverTarget: "World Cup Winner Jackpot",
      autoCreated: true,
      closeDescription: "Popular knockout game only. Betting opens for 1 day and closes 5 hours before kickoff.",
      lossRule: "Wrong picks lose. If nobody picks the advancing team, every stake rolls into World Cup Winner Jackpot.",
      status: "open",
      opensAt: "2026-07-03T00:00:00.000Z",
      closesAt: "2026-07-04T12:00:00.000Z",
      settledOptionId: null,
      rolloverAmount: 0,
      createdAt: "2026-07-03T08:05:00.000Z",
      options: [
        { id: 4, marketId: 2, label: "Brazil advances", sortOrder: 0 },
        { id: 5, marketId: 2, label: "Morocco advances", sortOrder: 1 }
      ],
      entries: [
        {
          id: 4,
          marketId: 2,
          optionId: 4,
          participantId: participant("HY").id,
          participantName: "HY",
          amount: 30,
          placedAt: "2026-07-03T08:45:00.000Z"
        },
        {
          id: 5,
          marketId: 2,
          optionId: 5,
          participantId: participant("CY").id,
          participantName: "CY",
          amount: 50,
          placedAt: "2026-07-03T08:51:00.000Z"
        },
        {
          id: 6,
          marketId: 2,
          optionId: 5,
          participantId: participant("KL").id,
          participantName: "KL",
          amount: 20,
          placedAt: "2026-07-03T08:58:00.000Z"
        }
      ]
    } satisfies FuturesMarketSeed,
    participants[0].id
  ),
  hydrateFuturesMarket(
    {
      id: 3,
      groupId: 1,
      title: "Next country to reach Round of 16",
      marketType: "stage_qualifier",
      settlementBasis: "advance_winner",
      rolloverTarget: "World Cup Winner Jackpot",
      autoCreated: true,
      closeDescription: "Stage market opens for 1 day and closes before the first relevant kickoff.",
      lossRule: "Wrong picks lose. If none of these countries qualify, the pot rolls into World Cup Winner Jackpot.",
      status: "open",
      opensAt: "2026-07-04T00:00:00.000Z",
      closesAt: "2026-07-05T07:00:00.000Z",
      settledOptionId: null,
      rolloverAmount: 0,
      createdAt: "2026-07-03T08:05:00.000Z",
      options: [
        { id: 6, marketId: 3, label: "Switzerland", sortOrder: 0 },
        { id: 7, marketId: 3, label: "Algeria", sortOrder: 1 },
        { id: 8, marketId: 3, label: "Australia", sortOrder: 2 },
        { id: 9, marketId: 3, label: "Egypt", sortOrder: 3 }
      ],
      entries: [
        {
          id: 7,
          marketId: 3,
          optionId: 6,
          participantId: participant("CC").id,
          participantName: "CC",
          amount: 15,
          placedAt: "2026-07-03T08:40:00.000Z"
        },
        {
          id: 8,
          marketId: 3,
          optionId: 8,
          participantId: participant("SY").id,
          participantName: "SY",
          amount: 25,
          placedAt: "2026-07-03T08:44:00.000Z"
        },
        {
          id: 9,
          marketId: 3,
          optionId: 9,
          participantId: participant("JL").id,
          participantName: "JL",
          amount: 20,
          placedAt: "2026-07-03T08:51:00.000Z"
        }
      ]
    } satisfies FuturesMarketSeed,
    participants[0].id
  ),
  hydrateFuturesMarket(
    {
      id: 4,
      groupId: 1,
      title: "Belgium v Senegal: who advances?",
      marketType: "match_advance",
      settlementBasis: "advance_winner",
      rolloverTarget: "World Cup Winner Jackpot",
      autoCreated: true,
      closeDescription: "Closed 5 hours before kickoff, settled from full-match advancement.",
      lossRule: "Wrong picks lose and pay the correct side.",
      status: "settled",
      opensAt: "2026-07-01T09:00:00.000Z",
      closesAt: "2026-07-02T14:00:00.000Z",
      settledOptionId: 10,
      rolloverAmount: 0,
      createdAt: "2026-07-01T08:00:00.000Z",
      options: [
        { id: 10, marketId: 4, label: "Belgium advances", sortOrder: 0 },
        { id: 11, marketId: 4, label: "Senegal advances", sortOrder: 1 }
      ],
      entries: [
        {
          id: 10,
          marketId: 4,
          optionId: 10,
          participantId: participant("CC").id,
          participantName: "CC",
          amount: 50,
          placedAt: "2026-07-01T09:10:00.000Z"
        },
        {
          id: 11,
          marketId: 4,
          optionId: 11,
          participantId: participant("SY").id,
          participantName: "SY",
          amount: 30,
          placedAt: "2026-07-01T09:12:00.000Z"
        },
        {
          id: 12,
          marketId: 4,
          optionId: 10,
          participantId: participant("KL").id,
          participantName: "KL",
          amount: 20,
          placedAt: "2026-07-01T09:22:00.000Z"
        }
      ]
    } satisfies FuturesMarketSeed,
    participants[0].id
  ),
  hydrateFuturesMarket(
    {
      id: 5,
      groupId: 1,
      title: "Underdog to reach quarter-final",
      marketType: "stage_qualifier",
      settlementBasis: "advance_winner",
      rolloverTarget: "World Cup Winner Jackpot",
      autoCreated: true,
      closeDescription: "Closed before the stage started. No one picked the correct underdog.",
      lossRule: "Nobody picked Scotland, so every entry lost and the whole pot feeds the jackpot.",
      status: "rolled_over",
      opensAt: "2026-06-30T09:00:00.000Z",
      closesAt: "2026-07-01T14:00:00.000Z",
      settledOptionId: 13,
      rolloverAmount: 0,
      createdAt: "2026-06-30T08:00:00.000Z",
      options: [
        { id: 12, marketId: 5, label: "Haiti", sortOrder: 0 },
        { id: 13, marketId: 5, label: "Scotland", sortOrder: 1 },
        { id: 14, marketId: 5, label: "Cape Verde", sortOrder: 2 }
      ],
      entries: [
        {
          id: 13,
          marketId: 5,
          optionId: 12,
          participantId: participant("HY").id,
          participantName: "HY",
          amount: 30,
          placedAt: "2026-06-30T09:00:00.000Z"
        },
        {
          id: 14,
          marketId: 5,
          optionId: 14,
          participantId: participant("CY").id,
          participantName: "CY",
          amount: 50,
          placedAt: "2026-06-30T09:08:00.000Z"
        }
      ]
    } satisfies FuturesMarketSeed,
    participants[0].id
  ),
  hydrateFuturesMarket(
    {
      id: 6,
      groupId: 1,
      title: "World Cup Winner Jackpot",
      marketType: "world_cup_winner",
      settlementBasis: "manual",
      rolloverTarget: null,
      autoCreated: false,
      closeDescription: "Final jackpot opens for 1 day and closes 5 hours before the final.",
      lossRule: "Wrong picks lose. Rollover money from failed event pools boosts this group jackpot.",
      status: "open",
      opensAt: "2026-07-18T00:00:00.000Z",
      closesAt: "2026-07-19T10:00:00.000Z",
      settledOptionId: null,
      rolloverAmount: 230,
      createdAt: "2026-06-18T09:00:00.000Z",
      options: [
        { id: 15, marketId: 6, label: "France", sortOrder: 0 },
        { id: 16, marketId: 6, label: "Argentina", sortOrder: 1 },
        { id: 17, marketId: 6, label: "Brazil", sortOrder: 2 },
        { id: 18, marketId: 6, label: "England", sortOrder: 3 },
        { id: 19, marketId: 6, label: "Morocco", sortOrder: 4 }
      ],
      entries: []
    } satisfies FuturesMarketSeed,
    participants[0].id
  ),
  hydrateFuturesMarket(
    {
      id: 7,
      groupId: 1,
      title: "SK event: Portugal v Netherlands 90-min result",
      marketType: "match_1x2",
      creatorParticipantId: participant("SK").id,
      creatorName: "SK",
      fixtureId: fixtures[0]?.id ?? null,
      settlementBasis: "ninety_minutes",
      rolloverTarget: "World Cup Winner Jackpot",
      autoCreated: false,
      closeDescription: "Created by SK. Opens immediately and closes 1 hour before kickoff. Settled on the 90-minute score only.",
      lossRule: "Wrong picks lose. If nobody wins, or if only part is paid, the rest rolls into World Cup Winner Jackpot.",
      status: "open",
      opensAt: "2026-07-03T09:00:00.000Z",
      closesAt: "2026-07-04T16:00:00.000Z",
      settledOptionId: null,
      rolloverAmount: 0,
      createdAt: "2026-07-03T09:00:00.000Z",
      options: [
        { id: 20, marketId: 7, label: "Portugal win", sortOrder: 0 },
        { id: 21, marketId: 7, label: "Draw", sortOrder: 1 },
        { id: 22, marketId: 7, label: "Netherlands win", sortOrder: 2 }
      ],
      entries: [
        {
          id: 15,
          marketId: 7,
          optionId: 20,
          participantId: participant("SK").id,
          participantName: "SK",
          amount: 20,
          placedAt: "2026-07-03T09:12:00.000Z"
        },
        {
          id: 16,
          marketId: 7,
          optionId: 21,
          participantId: participant("LK").id,
          participantName: "LK",
          amount: 30,
          placedAt: "2026-07-03T09:16:00.000Z"
        }
      ]
    } satisfies FuturesMarketSeed,
    participants[0].id
  ),
  hydrateFuturesMarket(
    {
      id: 8,
      groupId: 1,
      title: "CC event: Round of 16 cold option example",
      marketType: "stage_qualifier",
      creatorParticipantId: participant("CC").id,
      creatorName: "CC",
      fixtureId: fixtures[1]?.id ?? null,
      settlementBasis: "manual",
      rolloverTarget: "World Cup Winner Jackpot",
      autoCreated: false,
      closeDescription: "Settled as a half-winner example. The unpaid half feeds the jackpot.",
      lossRule: "Only half the pool paid the correct option; the remaining RM50 rolls into World Cup Winner Jackpot.",
      status: "settled",
      opensAt: "2026-07-01T09:00:00.000Z",
      closesAt: "2026-07-02T09:00:00.000Z",
      settledOptionId: 25,
      rolloverAmount: 0,
      createdAt: "2026-07-01T09:00:00.000Z",
      options: [
        { id: 23, marketId: 8, label: "Portugal reaches Round of 16", sortOrder: 0 },
        { id: 24, marketId: 8, label: "Netherlands reaches Round of 16", sortOrder: 1 },
        { id: 25, marketId: 8, label: "Haiti reaches Round of 16", sortOrder: 2 }
      ],
      entries: [
        {
          id: 17,
          marketId: 8,
          optionId: 25,
          participantId: participant("CC").id,
          participantName: "CC",
          amount: 50,
          status: "settled",
          result: "partial_win",
          payoutAmount: 50,
          placedAt: "2026-07-01T09:12:00.000Z"
        },
        {
          id: 18,
          marketId: 8,
          optionId: 23,
          participantId: participant("SY").id,
          participantName: "SY",
          amount: 50,
          status: "settled",
          result: "loss",
          payoutAmount: 0,
          placedAt: "2026-07-01T09:14:00.000Z"
        }
      ]
    } satisfies FuturesMarketSeed,
    participants[0].id
  )
];

export const demoState: AppState = {
  group: {
    id: 1,
    slug: "demo",
    name: "Demo Pool",
    allowDraws: false,
    teamsPerParticipant: 4,
    prizePoolAmount: 600,
    championPrizeAmount: 360,
    runnerUpPrizeAmount: 180,
    woodenSpoonPrizeAmount: 60,
    createdAt: "2026-06-11T00:00:00.000Z"
  },
  participant: participants[0],
  participants,
  pots: seed.pots.map(
    (pot): Pot => ({
      id: pot.id,
      name: pot.name,
      label: pot.label,
      colour: pot.colour,
      available: 0,
      total: teams.filter((team) => team.potId === pot.id).length
    })
  ),
  myDraws: allDraws.filter((draw) => draw.participantId === participants[0].id),
  allDraws,
  fixtures,
  teams: teams.sort((a, b) => a.potId - b.potId || a.country.localeCompare(b.country)),
  betting: buildBettingState(participants, participants[0], demoBetOffers, demoFuturesMarkets)
};
