import seed from "../../data.seed.json";
import type { AppState, Draw, Fixture, Participant, Pot, Team } from "./types";

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
  name
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

export const demoState: AppState = {
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
  teams: teams.sort((a, b) => a.potId - b.potId || a.country.localeCompare(b.country))
};
