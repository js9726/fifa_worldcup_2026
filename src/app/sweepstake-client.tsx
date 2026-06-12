"use client";

import clsx from "clsx";
import {
  CalendarDays,
  CheckCircle2,
  CircleDotDashed,
  Crown,
  Moon,
  RefreshCw,
  Shield,
  Sparkles,
  Sun,
  Trophy,
  Users
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AppState, Draw, Fixture, Pot, Team } from "@/lib/types";

type Tab = "draw" | "pools" | "fixtures" | "results";
type Theme = "night" | "light";
type SweepstakeClientProps = {
  token?: string;
  initialState?: AppState;
  demoMode?: boolean;
  adminOverview?: boolean;
  initialTab?: Tab;
};

const PRIZE_POOL = 600;
const PAYOUTS = {
  champion: { label: "1st Place", percent: 60, amount: PRIZE_POOL * 0.6 },
  runnerUp: { label: "2nd Place", percent: 30, amount: PRIZE_POOL * 0.3 },
  woodenSpoon: { label: "Wooden Spoon", percent: 10, amount: PRIZE_POOL * 0.1 }
};

type TeamWatch = {
  draw: Draw;
  todayFixture: Fixture | null;
  nextFixture: Fixture | null;
};

type MatchupStats = {
  homePct: number;
  awayPct: number;
  asianHandicap: string;
  asianResult: string | null;
  asianSource: "trusted" | "model";
  asianSourceLabel: string;
};

type OutcomeBadge = {
  label: string;
  detail: string;
  tone: "win" | "loss" | "draw";
};

const FLAG_CODES: Record<string, string> = {
  Spain: "es",
  France: "fr",
  Argentina: "ar",
  Brazil: "br",
  England: "gb-eng",
  Portugal: "pt",
  Germany: "de",
  Netherlands: "nl",
  Belgium: "be",
  Uruguay: "uy",
  Morocco: "ma",
  Colombia: "co",
  Croatia: "hr",
  Switzerland: "ch",
  Norway: "no",
  Japan: "jp",
  Mexico: "mx",
  "United States": "us",
  Sweden: "se",
  "Türkiye": "tr",
  Senegal: "sn",
  Egypt: "eg",
  Ecuador: "ec",
  Paraguay: "py",
  Austria: "at",
  Czechia: "cz",
  "Korea Republic": "kr",
  Iran: "ir",
  Australia: "au",
  "Cote d'Ivoire": "ci",
  "Côte d'Ivoire": "ci",
  Ghana: "gh",
  Tunisia: "tn",
  Algeria: "dz",
  Canada: "ca",
  Qatar: "qa",
  "Saudi Arabia": "sa",
  "Bosnia and Herzegovina": "ba",
  Scotland: "gb-sct",
  "South Africa": "za",
  "DR Congo": "cd",
  Panama: "pa",
  "New Zealand": "nz",
  Iraq: "iq",
  Jordan: "jo",
  Uzbekistan: "uz",
  "Cape Verde": "cv",
  Haiti: "ht",
  Curacao: "cw",
  "Curaçao": "cw"
};

function statusFor(team: Team) {
  if (!team.finalRank) return "Active";
  if (team.finalRank === 1) return "Champion";
  if (team.finalRank <= team.expectedRank) return "Above expectation";
  return "Below expectation";
}

function ratingLabel(winRate: number) {
  if (winRate >= 10) return "Favourite";
  if (winRate >= 4) return "Outsider";
  if (winRate >= 2) return "Long shot";
  return "Very long shot";
}

function groupByDate(fixtures: Fixture[]) {
  return fixtures.reduce<Record<string, Fixture[]>>((acc, fixture) => {
    const date = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short"
    }).format(new Date(fixture.kickoff));
    acc[date] = [...(acc[date] ?? []), fixture];
    return acc;
  }, {});
}

function formatPrize(amount: number) {
  return `RM${amount.toLocaleString("en-MY")}`;
}

function getPrizeWinners(draws: Draw[]) {
  const champion = draws.find((draw) => draw.team.finalRank === 1) ?? null;
  const runnerUp = draws.find((draw) => draw.team.finalRank === 2) ?? null;
  const finishedDraws = draws.filter((draw) => typeof draw.team.finalRank === "number");
  const worstRank = finishedDraws.length
    ? Math.max(...finishedDraws.map((draw) => draw.team.finalRank ?? 0))
    : null;
  const woodenSpoons = worstRank
    ? finishedDraws.filter((draw) => draw.team.finalRank === worstRank)
    : [];

  return { champion, runnerUp, woodenSpoons, worstRank };
}

function payoutLabelsForParticipant(name: string, winners: ReturnType<typeof getPrizeWinners>) {
  const labels: string[] = [];

  if (winners.champion?.participantName === name) {
    labels.push(`${PAYOUTS.champion.label} ${formatPrize(PAYOUTS.champion.amount)}`);
  }

  if (winners.runnerUp?.participantName === name) {
    labels.push(`${PAYOUTS.runnerUp.label} ${formatPrize(PAYOUTS.runnerUp.amount)}`);
  }

  if (winners.woodenSpoons.some((draw) => draw.participantName === name)) {
    const splitAmount = PAYOUTS.woodenSpoon.amount / winners.woodenSpoons.length;
    labels.push(`${PAYOUTS.woodenSpoon.label} ${formatPrize(splitAmount)}`);
  }

  return labels;
}

function flagUrlFor(country: string) {
  const code = FLAG_CODES[country];
  return code ? `https://flagcdn.com/${code}.svg` : null;
}

function countryFallback(country: string) {
  return country
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function localDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fixtureHasCountry(fixture: Fixture, country: string) {
  return fixture.homeCountry === country || fixture.awayCountry === country;
}

function fixtureOpponent(fixture: Fixture, country: string) {
  const isHome = fixture.homeCountry === country;
  return {
    opponentCountry: isHome ? fixture.awayCountry : fixture.homeCountry,
    opponentOwner: isHome ? fixture.awayOwner : fixture.homeOwner,
    myScore: isHome ? fixture.homeScore : fixture.awayScore,
    opponentScore: isHome ? fixture.awayScore : fixture.homeScore
  };
}

function fixtureHasScore(fixture: Fixture) {
  return fixture.homeScore !== null && fixture.awayScore !== null;
}

function fixtureHasStarted(fixture: Fixture) {
  return new Date(fixture.kickoff).getTime() <= Date.now();
}

function fixtureLabel(fixture: Fixture, isToday: boolean) {
  if (fixtureHasScore(fixture)) return "Result";
  if (fixtureHasStarted(fixture)) return "Awaiting score";
  if (isToday) return "Today";
  return "Next match";
}

function formatVenue(venue: string) {
  return venue && venue !== "TBD" ? venue : "Venue TBC";
}

function scoreText(fixture: Fixture) {
  return fixtureHasScore(fixture) ? `${fixture.homeScore}-${fixture.awayScore}` : "vs";
}

function fixtureResultSummary(fixture: Fixture) {
  if (!fixtureHasScore(fixture)) return null;

  const homeScore = fixture.homeScore ?? 0;
  const awayScore = fixture.awayScore ?? 0;
  if (homeScore === awayScore) return `Draw: ${homeScore}-${awayScore}`;

  const winner = homeScore > awayScore ? fixture.homeCountry : fixture.awayCountry;
  return `Winner: ${winner} ${homeScore}-${awayScore}`;
}

function fixtureWinnerBadge(fixture: Fixture): OutcomeBadge | null {
  if (!fixtureHasScore(fixture)) return null;

  const homeScore = fixture.homeScore ?? 0;
  const awayScore = fixture.awayScore ?? 0;
  if (homeScore === awayScore) return { label: "DRAW", detail: "DRAW", tone: "draw" };

  const winner = homeScore > awayScore ? fixture.homeCountry : fixture.awayCountry;
  return { label: "WIN", detail: `${winner} WIN`, tone: "win" };
}

function teamResultSummary(fixture: Fixture, country: string) {
  if (!fixtureHasScore(fixture)) return null;

  const { opponentCountry, myScore, opponentScore } = fixtureOpponent(fixture, country);
  if (myScore === null || opponentScore === null) return null;

  if (myScore === opponentScore) return `${country} drew ${myScore}-${opponentScore} vs ${opponentCountry}`;

  const outcome = myScore > opponentScore ? "won" : "lost";
  return `${country} ${outcome} ${myScore}-${opponentScore} vs ${opponentCountry}`;
}

function teamOutcomeBadge(fixture: Fixture, country: string): OutcomeBadge | null {
  if (!fixtureHasScore(fixture)) return null;

  const { myScore, opponentScore } = fixtureOpponent(fixture, country);
  if (myScore === null || opponentScore === null) return null;
  if (myScore === opponentScore) return { label: "DRAW", detail: "Match draw", tone: "draw" };

  const won = myScore > opponentScore;
  return {
    label: won ? "WIN" : "LOSS",
    detail: won ? "Match won" : "Match lost",
    tone: won ? "win" : "loss"
  };
}

function formatHandicapLine(line: number) {
  return line.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

function getMatchupStats(
  fixture: Fixture,
  teamByCountry: Map<string, Team>
): MatchupStats | null {
  const home = teamByCountry.get(fixture.homeCountry);
  const away = teamByCountry.get(fixture.awayCountry);
  if (!home || !away) return null;

  const homePower = Math.max(home.winRate, 0.5);
  const awayPower = Math.max(away.winRate, 0.5);
  const homePct = Math.round((homePower / (homePower + awayPower)) * 100);
  const awayPct = 100 - homePct;
  const diff = Math.abs(homePct - awayPct);
  const modelLine = diff < 8 ? 0 : diff < 18 ? 0.25 : diff < 30 ? 0.5 : diff < 42 ? 0.75 : diff < 55 ? 1 : 1.5;
  const trustedFavourite =
    fixture.oddsProvider &&
    fixture.oddsFavourite &&
    fixture.oddsHandicapLine !== null &&
    [home.country, away.country].includes(fixture.oddsFavourite)
      ? fixture.oddsFavourite
      : null;
  const line = trustedFavourite ? Math.abs(fixture.oddsHandicapLine ?? 0) : modelLine;
  const homeFavourite = trustedFavourite ? trustedFavourite === home.country : homePct >= awayPct;
  const favourite = trustedFavourite ?? (homeFavourite ? home.country : away.country);
  const asianSource = trustedFavourite ? "trusted" : "model";
  const asianSourceLabel = trustedFavourite
    ? [fixture.oddsProvider, fixture.oddsBookmaker].filter(Boolean).join(" / ")
    : "model fallback";
  const asianHandicap = line === 0 ? "Level ball 0" : `${favourite} -${formatHandicapLine(line)}`;

  let asianResult: string | null = null;
  if (fixtureHasScore(fixture)) {
    const margin = homeFavourite
      ? (fixture.homeScore ?? 0) - (fixture.awayScore ?? 0)
      : (fixture.awayScore ?? 0) - (fixture.homeScore ?? 0);
    asianResult = margin > line ? "covered" : margin === line ? "push" : "missed";
  }

  return { homePct, awayPct, asianHandicap, asianResult, asianSource, asianSourceLabel };
}

function buildTeamWatch(draws: Draw[], fixtures: Fixture[]) {
  const today = localDateKey(new Date());
  const now = Date.now();

  return draws.map((draw): TeamWatch => {
    const teamFixtures = fixtures
      .filter((fixture) => fixtureHasCountry(fixture, draw.team.country))
      .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
    const todayFixture =
      teamFixtures.find((fixture) => localDateKey(fixture.kickoff) === today) ?? null;
    const nextFixture =
      teamFixtures.find((fixture) => new Date(fixture.kickoff).getTime() >= now) ?? null;

    return { draw, todayFixture, nextFixture };
  });
}

function teamTournamentStatus(team: Team) {
  if (!team.finalRank) {
    return { label: "Active", tone: "active" };
  }

  if (team.finalRank === 1) {
    return { label: "Champion", tone: "winner" };
  }

  if (team.finalRank === 2) {
    return { label: "Runner-up", tone: "winner" };
  }

  return {
    label: `Eliminated${team.eliminatedStage ? ` - ${team.eliminatedStage}` : ""}`,
    tone: "out"
  };
}

function getTournamentStats(state: AppState) {
  const finished = state.fixtures.filter(fixtureHasScore).length;
  const awaitingScore = state.fixtures.filter(
    (fixture) => fixtureHasStarted(fixture) && !fixtureHasScore(fixture)
  ).length;
  const eliminated = state.teams.filter((team) => team.finalRank && team.finalRank > 2).length;

  return {
    finished,
    awaitingScore,
    eliminated,
    active: state.teams.length - eliminated
  };
}

export default function SweepstakeClient({
  token = "",
  initialState = undefined,
  demoMode = false,
  adminOverview = false,
  initialTab = "draw"
}: SweepstakeClientProps) {
  const [state, setState] = useState<AppState | null>(initialState ?? null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [drawingPot, setDrawingPot] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState<Theme>("night");

  async function loadState() {
    if (demoMode) return;
    if (!adminOverview && !token) return;

    const url = adminOverview ? "/api/state" : `/api/state?token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Unable to load invite");
      return;
    }
    setState(payload);
  }

  useEffect(() => {
    if (demoMode) return;
    if (!adminOverview && !token) return;

    loadState();
    const interval = window.setInterval(loadState, 12000);
    return () => window.clearInterval(interval);
  }, [demoMode, token, adminOverview]);

  useEffect(() => {
    const saved = window.localStorage.getItem("sweepstake-theme");
    if (saved === "light" || saved === "night") {
      setTheme(saved);
      return;
    }

    if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("sweepstake-theme", theme);
  }, [theme]);

  async function drawPot(pot: Pot) {
    if (demoMode) {
      setMessage("Demo mode is pre-filled. Use a private invite link for the real live draw.");
      return;
    }

    setDrawingPot(pot.id);
    setMessage(`Drawing ${pot.label}...`);
    const response = await fetch("/api/draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, potId: pot.id })
    });
    const payload = await response.json();
    setDrawingPot(null);

    if (!response.ok) {
      setMessage(payload.error ?? "Draw failed");
      return;
    }

    setMessage(`${payload.draw.team.country} is yours.`);
    await loadState();
  }

  const groupedDraws = useMemo(() => {
    const rows = new Map<string, Draw[]>();
    for (const participant of state?.participants ?? []) rows.set(participant.name, []);
    for (const draw of state?.allDraws ?? []) {
      rows.set(draw.participantName, [...(rows.get(draw.participantName) ?? []), draw]);
    }
    return Array.from(rows.entries()).map(([name, draws]) => ({
      name,
      draws: draws.sort((a, b) => a.team.potId - b.team.potId),
      bestRank: Math.min(...draws.map((draw) => draw.team.finalRank ?? 99))
    }));
  }, [state]);

  const prizeWinners = useMemo(() => getPrizeWinners(state?.allDraws ?? []), [state]);
  const fixtureGroups = useMemo(() => groupByDate(state?.fixtures ?? []), [state]);
  const myTeamWatch = useMemo(
    () => buildTeamWatch(state?.myDraws ?? [], state?.fixtures ?? []),
    [state]
  );
  const teamByCountry = useMemo(
    () => new Map((state?.teams ?? []).map((team) => [team.country, team])),
    [state]
  );
  const tournamentStats = useMemo(() => (state ? getTournamentStats(state) : null), [state]);

  if (!state) {
    return (
      <main className="shell">
        <section className="loading-panel">
          <CircleDotDashed className="spin" />
          <p>{message || "Loading live draw..."}</p>
        </section>
      </main>
    );
  }

  const drawnPotIds = new Set(state.myDraws.map((draw) => draw.team.potId));

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">
            {demoMode ? "Demo preview" : adminOverview ? "Organiser overview" : "Our World Cup 2026 Pools"}
          </p>
          <h1>
            {demoMode
              ? "Sweepstake demo"
              : adminOverview
                ? "All pools overview"
                : `${state.participant?.name}'s live draw`}
          </h1>
          <p className="subcopy">
            {demoMode
              ? "Pre-filled example with live board, fixtures, rankings and result logic."
              : adminOverview
                ? `${state.allDraws.length}/${state.teams.length} countries claimed across ${state.participants.length} players.`
                : `${state.allDraws.length}/48 countries claimed. Neon locks every country once.`}
          </p>
        </div>
        <div className="trophy-mark">
          <Trophy aria-hidden="true" />
        </div>
        <button
          className="theme-toggle"
          type="button"
          aria-pressed={theme === "light"}
          onClick={() => setTheme((current) => (current === "night" ? "light" : "night"))}
        >
          {theme === "night" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          <span>{theme === "night" ? "Light" : "Night"}</span>
        </button>
      </section>

      <nav className="tabs" aria-label="Sweepstake views">
        {[
          ...(adminOverview ? [] : [["draw", Sparkles, "Draw"]]),
          ["pools", Users, "Pools"],
          ["fixtures", CalendarDays, "Fixtures"],
          ["results", Trophy, "Results"]
        ].map(([id, Icon, label]) => (
          <button
            key={id as string}
            className={clsx(tab === id && "active")}
            onClick={() => setTab(id as Tab)}
          >
            <Icon aria-hidden="true" />
            <span>{label as string}</span>
          </button>
        ))}
      </nav>

      {message && <p className="notice">{message}</p>}

      {tab === "draw" && (
        <>
          <section className="watch-panel">
            <header>
              <div>
                <p className="eyebrow">My teams today</p>
                <h2>Fixture and elimination watch</h2>
              </div>
              <span>{localDateKey(new Date())}</span>
            </header>
            {tournamentStats && <StatsStrip stats={tournamentStats} />}
            <div className="watch-grid">
              {myTeamWatch.length ? (
                myTeamWatch.map((item) => (
                  <WatchCard key={item.draw.team.id} item={item} teamByCountry={teamByCountry} />
                ))
              ) : (
                <p className="empty">Your teams will appear here after your draw.</p>
              )}
            </div>
          </section>

          <section className="draw-grid">
            <div className="rules-panel">
              <h2>Winner Logic</h2>
              <p>
                RM600 prize pool: the participant holding the World Cup champion wins 60% (
                {formatPrize(PAYOUTS.champion.amount)}), the participant holding the runner-up wins
                30% ({formatPrize(PAYOUTS.runnerUp.amount)}), and the participant holding the worst
                overall team wins 10% ({formatPrize(PAYOUTS.woodenSpoon.amount)}).
              </p>
              <p>
                {demoMode
                  ? "This preview uses sample draws and results only. It does not reserve any country."
                  : "The current list has 48 countries for 12 participants, so each person draws four teams. A five-team version needs 60 unique countries."}
              </p>
            </div>
            {state.pots.map((pot) => {
              const existing = state.myDraws.find((draw) => draw.team.potId === pot.id);
              return (
                <article className={clsx("draw-card", pot.colour)} key={pot.id}>
                  <div>
                    <p className="eyebrow">{pot.name}</p>
                    <h2>{pot.label}</h2>
                    <p className="muted">
                      {pot.available}/{pot.total} left
                    </p>
                  </div>
                  {existing ? (
                    <TeamTile team={existing.team} compact />
                  ) : (
                    <button
                      className="primary-button"
                      onClick={() => drawPot(pot)}
                      disabled={drawingPot === pot.id || drawnPotIds.has(pot.id) || pot.available === 0}
                    >
                      {drawingPot === pot.id ? <RefreshCw className="spin" /> : <Sparkles />}
                      <span>Draw</span>
                    </button>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}

      {tab === "pools" && (
        <section className="pool-grid">
          {groupedDraws.map((pool) => (
            <article className="pool-card" key={pool.name}>
              <header>
                <h2>{pool.name}&apos;s Pool</h2>
                <span>{payoutLabelsForParticipant(pool.name, prizeWinners)[0] ?? `${pool.draws.length} teams`}</span>
              </header>
              <div className="team-list">
                {pool.draws.length ? (
                  pool.draws.map((draw) => <TeamTile key={draw.team.id} team={draw.team} />)
                ) : (
                  <p className="empty">Waiting for first draw</p>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === "fixtures" && (
        <>
          {tournamentStats && <StatsStrip stats={tournamentStats} />}
          <section className="fixture-board">
            {Object.entries(fixtureGroups).map(([date, fixtures]) => (
              <article className="fixture-day" key={date}>
                <h2>{date}</h2>
                {fixtures.map((fixture) => (
                  <FixtureRow key={fixture.id} fixture={fixture} teamByCountry={teamByCountry} />
                ))}
              </article>
            ))}
          </section>
        </>
      )}

      {tab === "results" && (
        <section className="results-board">
          <div className="prize-board">
            <PrizeCard
              icon={<Crown aria-hidden="true" />}
              title="1st Place"
              subtitle="Tournament Winner"
              amount={formatPrize(PAYOUTS.champion.amount)}
              percent={`${PAYOUTS.champion.percent}%`}
              draw={prizeWinners.champion}
            />
            <PrizeCard
              icon={<Trophy aria-hidden="true" />}
              title="2nd Place"
              subtitle="Runner-up"
              amount={formatPrize(PAYOUTS.runnerUp.amount)}
              percent={`${PAYOUTS.runnerUp.percent}%`}
              draw={prizeWinners.runnerUp}
            />
            <PrizeCard
              icon={<Shield aria-hidden="true" />}
              title="Wooden Spoon"
              subtitle="Worst team overall"
              amount={formatPrize(PAYOUTS.woodenSpoon.amount)}
              percent={`${PAYOUTS.woodenSpoon.percent}%`}
              draw={prizeWinners.woodenSpoons[0] ?? null}
              note={
                prizeWinners.woodenSpoons.length > 1
                  ? `${prizeWinners.woodenSpoons.length} teams tied - prize split`
                  : undefined
              }
            />
          </div>
          <div className="standings">
            {groupedDraws
              .sort((a, b) => a.bestRank - b.bestRank || a.name.localeCompare(b.name))
              .map((pool) => {
                const labels = payoutLabelsForParticipant(pool.name, prizeWinners);

                return (
                  <article className={clsx("standing-row", labels.length && "has-prize")} key={pool.name}>
                    <strong>{pool.name}</strong>
                    <span>{labels.join(" + ") || "No prize yet"}</span>
                    <p>Best finish #{pool.bestRank === 99 ? "-" : pool.bestRank}</p>
                  </article>
                );
              })}
          </div>
          <div className="result-teams">
            {state.teams.map((team) => (
              <TeamTile key={team.id} team={team} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function PrizeCard({
  icon,
  title,
  subtitle,
  amount,
  percent,
  draw,
  note
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  amount: string;
  percent: string;
  draw: Draw | null;
  note?: string;
}) {
  return (
    <article className={clsx("prize-card", !draw && "pending")}>
      <div className="prize-icon">{icon}</div>
      <div>
        <p className="eyebrow">{title}</p>
        <h2>{amount}</h2>
        <strong>
          {draw ? `${draw.participantName} - ${draw.team.country}` : "Pending result"}
        </strong>
        <span>
          {percent} - {subtitle}
          {note ? ` - ${note}` : ""}
        </span>
      </div>
    </article>
  );
}

function StatsStrip({
  stats
}: {
  stats: ReturnType<typeof getTournamentStats>;
}) {
  return (
    <div className="stats-strip">
      <div>
        <strong>{stats.finished}</strong>
        <span>results in</span>
      </div>
      <div>
        <strong>{stats.awaitingScore}</strong>
        <span>awaiting score</span>
      </div>
      <div>
        <strong>{stats.eliminated}</strong>
        <span>{stats.eliminated ? "eliminated" : "no teams eliminated yet"}</span>
      </div>
      <div>
        <strong>{stats.active}</strong>
        <span>still alive</span>
      </div>
    </div>
  );
}

function WatchCard({
  item,
  teamByCountry
}: {
  item: TeamWatch;
  teamByCountry: Map<string, Team>;
}) {
  const status = teamTournamentStatus(item.draw.team);
  const fixture = item.todayFixture ?? item.nextFixture;
  const fixtureLabel = fixture ? fixtureLabelForWatch(fixture, Boolean(item.todayFixture)) : "No fixture";
  const opponent = fixture ? fixtureOpponent(fixture, item.draw.team.country) : null;
  const stats = fixture ? getMatchupStats(fixture, teamByCountry) : null;
  const resultSummary = fixture ? teamResultSummary(fixture, item.draw.team.country) : null;
  const outcomeBadge = fixture ? teamOutcomeBadge(fixture, item.draw.team.country) : null;
  const isHomeTeam = fixture?.homeCountry === item.draw.team.country;
  const kickoff = fixture
    ? new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(fixture.kickoff))
    : null;

  return (
    <article className="watch-card">
      <div className="watch-team">
        <FlagBadge team={item.draw.team} />
        <div>
          <strong>{item.draw.team.country}</strong>
          <span>{item.draw.team.potLabel}</span>
        </div>
      </div>
      <div className="watch-badges">
        <span className={clsx("status-pill", status.tone)}>{status.label}</span>
        {outcomeBadge && (
          <span className={clsx("match-outcome", outcomeBadge.tone)} title={outcomeBadge.detail}>
            {outcomeBadge.label}
          </span>
        )}
      </div>
      {fixture && opponent ? (
        <div className="watch-fixture">
          <p className="eyebrow">{fixtureLabel}</p>
          <strong>
            vs {opponent.opponentCountry} ({opponent.opponentOwner ?? "Unclaimed"})
          </strong>
          <span>
            {kickoff} - {formatVenue(fixture.venue)}
          </span>
          {resultSummary && <span className="result-summary">{resultSummary}</span>}
          {stats && (
            <span>
              Pre-match model: {item.draw.team.country} {isHomeTeam ? stats.homePct : stats.awayPct}% vs{" "}
              {isHomeTeam ? stats.awayPct : stats.homePct}% {opponent.opponentCountry}
            </span>
          )}
          {stats && (
            <span>
              AH 放球: {stats.asianHandicap}
              {stats.asianResult
                ? ` (${stats.asianResult}, ${stats.asianSourceLabel})`
                : ` (${stats.asianSourceLabel})`}
            </span>
          )}
        </div>
      ) : (
        <div className="watch-fixture muted">
          <p className="eyebrow">Today</p>
          <strong>No match today</strong>
          <span>Check Fixtures for the full schedule.</span>
        </div>
      )}
    </article>
  );
}

function fixtureLabelForWatch(fixture: Fixture, isToday: boolean) {
  return fixtureLabel(fixture, isToday);
}

function CountryFlag({
  country,
  fallback
}: {
  country: string;
  fallback: string;
}) {
  const [failed, setFailed] = useState(false);
  const flagUrl = flagUrlFor(country);

  return (
    <div className="flag" aria-label={`${country} flag`}>
      {flagUrl && !failed ? (
        <img src={flagUrl} alt="" onError={() => setFailed(true)} loading="lazy" />
      ) : (
        <span className="flag-fallback">{fallback}</span>
      )}
    </div>
  );
}

function FlagBadge({ team }: { team: Team }) {
  return <CountryFlag country={team.country} fallback={team.flag} />;
}

function TeamTile({ team, compact = false }: { team: Team; compact?: boolean }) {
  const status = statusFor(team);
  const below = status === "Below expectation";

  return (
    <article className={clsx("team-tile", compact && "compact", below && "dimmed")}>
      <FlagBadge team={team} />
      <div className="team-main">
        <strong>{team.country}</strong>
        <span>{team.potLabel}</span>
      </div>
      <div className="player-block">
        <strong>{team.starPlayer}</strong>
        <span>{team.playerRole}</span>
      </div>
      <div className="chance-ring" style={{ "--pct": `${Math.max(team.winRate, 1) * 3.2}deg` } as CSSProperties}>
        <span>{team.winRate}%</span>
      </div>
      <div className="rank-block">
        <span>FIFA #{team.fifaRank}</span>
        <strong>{team.finalRank ? `Finish #${team.finalRank}` : ratingLabel(team.winRate)}</strong>
        <em>{status}</em>
      </div>
      {team.finalRank && (
        <div className="expectation">
          {below ? <Shield /> : <CheckCircle2 />}
          <span>vs exp #{team.expectedRank}</span>
        </div>
      )}
    </article>
  );
}

function FixtureRow({
  fixture,
  teamByCountry
}: {
  fixture: Fixture;
  teamByCountry: Map<string, Team>;
}) {
  const stats = getMatchupStats(fixture, teamByCountry);
  const resultSummary = fixtureResultSummary(fixture);
  const winnerBadge = fixtureWinnerBadge(fixture);
  const label = fixtureLabel(fixture, localDateKey(fixture.kickoff) === localDateKey(new Date()));
  const kickoff = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(fixture.kickoff));

  return (
    <div className="fixture-row">
      <span className="fixture-time">
        {kickoff}
        <small>{label}</small>
      </span>
      <div className="fixture-main">
        <strong>
          <CountryFlag country={fixture.homeCountry} fallback={countryFallback(fixture.homeCountry)} />
          {fixture.homeCountry} {scoreText(fixture)} {fixture.awayCountry}
          <CountryFlag country={fixture.awayCountry} fallback={countryFallback(fixture.awayCountry)} />
          {winnerBadge && (
            <span className={clsx("match-outcome", winnerBadge.tone)} title={winnerBadge.detail}>
              {winnerBadge.detail}
            </span>
          )}
        </strong>
        <p>
          {fixture.homeOwner ?? "Unclaimed"} vs {fixture.awayOwner ?? "Unclaimed"} - {formatVenue(fixture.venue)}
        </p>
        {stats && (
          <div className="match-stats">
            {resultSummary && <span className="result-summary">{resultSummary}</span>}
            <span>
              Pre-match model: {fixture.homeCountry} {stats.homePct}% vs {stats.awayPct}% {fixture.awayCountry}
            </span>
            <span>
              AH 放球: {stats.asianHandicap}
              {stats.asianResult
                ? ` (${stats.asianResult}, ${stats.asianSourceLabel})`
                : ` (${stats.asianSourceLabel})`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
