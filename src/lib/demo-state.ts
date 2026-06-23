import seed from "../../data.seed.json";
import { buildBettingState } from "./betting";
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
  homeScore: 2,
  awayScore: 2,
  homeOwner: ownerByCountry.get("Argentina") ?? null,
  awayOwner: ownerByCountry.get("France") ?? null,
  oddsProvider: "Demo",
  oddsBookmaker: "Advance winner example",
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
    note: "Argentina advanced after a 2-2 normal-time score. Advance Winner includes extra time and penalties.",
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
    note: "AH offer uses the 90-minute score basis unless the creator selects otherwise.",
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

export const demoState: AppState = {
  group: {
    id: 1,
    slug: "demo",
    name: "Demo Pool",
    allowDraws: false,
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
  betting: buildBettingState(participants, participants[0], demoBetOffers)
};
