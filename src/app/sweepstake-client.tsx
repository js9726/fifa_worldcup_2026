"use client";

import clsx from "clsx";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDotDashed,
  Crown,
  DollarSign,
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
import type {
  AppState,
  BetAcceptance,
  BetLeaderboardRow,
  BetOffer,
  BettingState,
  Draw,
  Fixture,
  Participant,
  Pot,
  SweepstakeGroup,
  Team
} from "@/lib/types";

type Tab = "draw" | "pools" | "bet-pool" | "fixtures" | "results";
type Theme = "daylight" | "night";

const THEME_ORDER: Theme[] = ["daylight", "night"];
const THEME_META: Record<Theme, { icon: typeof Sun; label: string }> = {
  daylight: { icon: Sun, label: "Daylight" },
  night: { icon: Moon, label: "Night" }
};
type SweepstakeClientProps = {
  token?: string;
  initialState?: AppState;
  demoMode?: boolean;
  adminOverview?: boolean;
  adminKey?: string;
  adminStateUrl?: string;
  initialTab?: Tab;
};

const BET_OFFER_DEFAULT_STAKE = 50;
const BET_CANCEL_LOCK_HOURS = 1;

type PrizePayouts = {
  total: number;
  champion: { label: string; percent: number; amount: number };
  runnerUp: { label: string; percent: number; amount: number };
  woodenSpoon: { label: string; percent: number; amount: number };
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
  if (team.finalRank === 2) return "Runner-up";
  return `Eliminated${team.eliminatedStage ? ` - ${team.eliminatedStage}` : ""}`;
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

function formatPrizePercent(percent: number) {
  return Number.isInteger(percent) ? `${percent}` : percent.toFixed(1).replace(/\.0$/, "");
}

function buildPrizePayouts(group: SweepstakeGroup | null | undefined): PrizePayouts {
  const total = group?.prizePoolAmount ?? 600;
  const championAmount = group?.championPrizeAmount ?? 360;
  const runnerUpAmount = group?.runnerUpPrizeAmount ?? 180;
  const woodenSpoonAmount = group?.woodenSpoonPrizeAmount ?? 60;
  const percentFor = (amount: number) => (total > 0 ? (amount / total) * 100 : 0);

  return {
    total,
    champion: { label: "1st Place", percent: percentFor(championAmount), amount: championAmount },
    runnerUp: { label: "2nd Place", percent: percentFor(runnerUpAmount), amount: runnerUpAmount },
    woodenSpoon: { label: "Wooden Spoon", percent: percentFor(woodenSpoonAmount), amount: woodenSpoonAmount }
  };
}

function formatBetAmount(amount: number) {
  return `RM${Math.abs(amount).toLocaleString("en-MY")}`;
}

function formatSignedBetAmount(amount: number) {
  if (amount === 0) return "RM0";
  return `${amount > 0 ? "+" : "-"}${formatBetAmount(amount)}`;
}

function marketLabel(offer: BetOffer) {
  return offer.market === "winner" ? "Match winner" : "Asian Handicap";
}

function settlementBasisLabel(offer: BetOffer) {
  return offer.settlementBasis === "advance_winner" ? "Advance Winner" : "90-Min Result";
}

function settlementBasisDetail(offer: BetOffer) {
  return offer.settlementBasis === "advance_winner"
    ? "Includes extra time and penalties"
    : "Normal time plus stoppage only";
}

function resultLabel(acceptance: BetAcceptance) {
  if (acceptance.status === "pending") return "Pending";
  if (acceptance.result === "half_win") return "Half win";
  if (acceptance.result === "half_loss") return "Half loss";
  return acceptance.result[0].toUpperCase() + acceptance.result.slice(1);
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

function payoutLabelsForParticipant(name: string, winners: ReturnType<typeof getPrizeWinners>, payouts: PrizePayouts) {
  const labels: string[] = [];

  if (winners.champion?.participantName === name) {
    labels.push(`${payouts.champion.label} ${formatPrize(payouts.champion.amount)}`);
  }

  if (winners.runnerUp?.participantName === name) {
    labels.push(`${payouts.runnerUp.label} ${formatPrize(payouts.runnerUp.amount)}`);
  }

  if (winners.woodenSpoons.some((draw) => draw.participantName === name)) {
    const splitAmount = payouts.woodenSpoon.amount / winners.woodenSpoons.length;
    labels.push(`${payouts.woodenSpoon.label} ${formatPrize(splitAmount)}`);
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
  adminKey = "",
  adminStateUrl = "",
  initialTab = "draw"
}: SweepstakeClientProps) {
  const [state, setState] = useState<AppState | null>(initialState ?? null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [drawingPot, setDrawingPot] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState<Theme>("daylight");

  async function loadState() {
    if (demoMode) return;
    if (adminOverview && (!adminStateUrl || !adminKey)) return;
    if (!adminOverview && !token) return;

    const url = adminOverview ? adminStateUrl : `/api/state?token=${encodeURIComponent(token)}`;
    const response = await fetch(url, {
      cache: "no-store",
      headers: adminOverview ? { "x-admin-key": adminKey } : undefined
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Unable to load invite");
      return;
    }
    setState(payload);
  }

  useEffect(() => {
    if (demoMode) return;
    if (adminOverview && (!adminStateUrl || !adminKey)) return;
    if (!adminOverview && !token) return;

    loadState();
    const interval = window.setInterval(loadState, 12000);
    return () => window.clearInterval(interval);
  }, [demoMode, token, adminOverview, adminKey, adminStateUrl]);

  useEffect(() => {
    if (initialState) setState(initialState);
  }, [initialState]);

  useEffect(() => {
    const saved = window.localStorage.getItem("sweepstake-theme");
    if (saved === "daylight" || saved === "light") {
      setTheme("daylight"); // "light" is the legacy value
      return;
    }
    if (saved === "night" || saved === "floodlit") {
      setTheme("night"); // floodlit retired — fold back to night
      return;
    }

    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("night");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("sweepstake-theme", theme);
  }, [theme]);

  async function drawPot(pot: Pot) {
    if (state?.group?.allowDraws === false) {
      setMessage("This group already has assigned teams. Draws are locked.");
      return;
    }
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
  const payouts = useMemo(() => buildPrizePayouts(state?.group), [state?.group]);
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
  const canShowDrawTab = !adminOverview;
  const isAssignedGroup = state?.group?.allowDraws === false;
  const drawTabLabel = isAssignedGroup ? "My Teams" : "Draw";
  const drawPageTitle = isAssignedGroup ? `${state?.participant?.name}'s teams` : `${state?.participant?.name}'s live draw`;

  useEffect(() => {
    if (state && tab === "draw" && !canShowDrawTab) setTab("pools");
  }, [canShowDrawTab, state, tab]);

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
                ? state.group?.name ?? "Group overview"
                : drawPageTitle}
          </h1>
          <p className="subcopy">
            {demoMode
              ? "Pre-filled example with live board, fixtures, rankings and result logic."
              : adminOverview
                ? `${state.allDraws.length}/${state.teams.length} countries claimed across ${state.participants.length} players.`
                : `${state.group?.name ?? "Private group"} - ${state.allDraws.length}/${state.teams.length} countries claimed.`}
          </p>
        </div>
        <img
          className="topbar-logo topbar-logo--icon"
          src="/wc-logo-icon.png"
          alt="World Cup Sweepstake"
          width={124}
          height={125}
        />
        <img
          className="topbar-logo topbar-logo--full"
          src="/wc-logo-icon.png"
          alt="World Cup Sweepstake"
          width={260}
          height={260}
        />
        {(() => {
          const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
          const NextIcon = THEME_META[nextTheme].icon;
          return (
            <button
              className="theme-toggle"
              type="button"
              title={`Switch to ${THEME_META[nextTheme].label}`}
              onClick={() => setTheme(nextTheme)}
            >
              <NextIcon aria-hidden="true" />
              <span>{THEME_META[nextTheme].label}</span>
            </button>
          );
        })()}
      </section>

      <nav className="tabs" aria-label="Sweepstake views">
        {[
          ...(canShowDrawTab ? [["draw", Sparkles, drawTabLabel]] : []),
          ["pools", Users, "Pools"],
          ["bet-pool", DollarSign, "Bet Pool"],
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

      {tab === "draw" && canShowDrawTab && (
        <>
          <section className="watch-panel">
            <header>
              <div>
                <p className="eyebrow">{isAssignedGroup ? "My assigned teams" : "My teams today"}</p>
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

          <section className={clsx("draw-grid", isAssignedGroup && "assigned-draw-grid")}>
            <div className="rules-panel">
              <h2>Winner Logic</h2>
              <p>
                {formatPrize(payouts.total)} prize pool: the participant holding the World Cup champion
                wins {formatPrizePercent(payouts.champion.percent)}% ({formatPrize(payouts.champion.amount)}),
                the participant holding the runner-up wins {formatPrizePercent(payouts.runnerUp.percent)}% (
                {formatPrize(payouts.runnerUp.amount)}), and the participant holding the worst overall team
                wins {formatPrizePercent(payouts.woodenSpoon.percent)}% ({formatPrize(payouts.woodenSpoon.amount)}).
              </p>
              <p>
                {demoMode
                  ? "This preview uses sample draws and results only. It does not reserve any country."
                  : isAssignedGroup
                    ? `This ${state.myDraws.length}-team group was imported from assigned teams. Draws are locked for every invite link.`
                    : `This group has ${state.teams.length} countries for ${state.participants.length} participants. Neon locks every country once within this group.`}
              </p>
            </div>
            {isAssignedGroup ? (
              <div className="assigned-team-grid">
                {state.myDraws.map((draw) => {
                  const pot = state.pots.find((row) => row.id === draw.team.potId);
                  return (
                    <article className={clsx("draw-card", "assigned-card", pot?.colour)} key={draw.team.id}>
                      <div>
                        <p className="eyebrow">{draw.team.potName}</p>
                        <h2>{draw.team.potLabel}</h2>
                      </div>
                      <TeamTile team={draw.team} compact />
                    </article>
                  );
                })}
              </div>
            ) : (
              state.pots.map((pot) => {
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
              })
            )}
          </section>
        </>
      )}

      {tab === "pools" && (
        <section className="pool-grid">
          {groupedDraws.map((pool) => (
            <article className="pool-card" key={pool.name}>
              <header>
                <h2>{pool.name}&apos;s Pool</h2>
                <span>{payoutLabelsForParticipant(pool.name, prizeWinners, payouts)[0] ?? `${pool.draws.length} teams`}</span>
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

      {tab === "bet-pool" && (
        <BetPoolPanel
          betting={state.betting}
          fixtures={state.fixtures}
          participant={state.participant}
          demoMode={demoMode}
          token={token}
          refresh={loadState}
          notify={setMessage}
        />
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
              amount={formatPrize(payouts.champion.amount)}
              percent={`${formatPrizePercent(payouts.champion.percent)}%`}
              draw={prizeWinners.champion}
            />
            <PrizeCard
              icon={<Trophy aria-hidden="true" />}
              title="2nd Place"
              subtitle="Runner-up"
              amount={formatPrize(payouts.runnerUp.amount)}
              percent={`${formatPrizePercent(payouts.runnerUp.percent)}%`}
              draw={prizeWinners.runnerUp}
            />
            <PrizeCard
              icon={<Shield aria-hidden="true" />}
              title="Wooden Spoon"
              subtitle="Worst team overall"
              amount={formatPrize(payouts.woodenSpoon.amount)}
              percent={`${formatPrizePercent(payouts.woodenSpoon.percent)}%`}
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
                const labels = payoutLabelsForParticipant(pool.name, prizeWinners, payouts);

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

const HANDICAP_LINES: number[] = (() => {
  const lines: number[] = [];
  for (let value = -3; value <= 3 + 1e-9; value += 0.25) {
    lines.push(Math.round(value * 100) / 100);
  }
  return lines;
})();

async function postBet(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: response.ok, error: data.error };
}

function BetPoolPanel({
  betting,
  fixtures,
  participant,
  demoMode,
  token,
  refresh,
  notify
}: {
  betting: BettingState;
  fixtures: Fixture[];
  participant: Participant | null;
  demoMode: boolean;
  token: string;
  refresh: () => Promise<void> | void;
  notify: (message: string) => void;
}) {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const myRow = participant
    ? betting.leaderboard.find((row) => row.participantId === participant.id) ?? null
    : null;
  const settledAcceptances = betting.offers.flatMap((offer) =>
    offer.acceptances.filter((acceptance) => acceptance.status !== "pending")
  );
  const settledOffers = betting.offers
    .filter((offer) => offer.acceptances.some((acceptance) => acceptance.status !== "pending"))
    .sort((a, b) => {
      const ak = fixtureById.get(a.fixtureId)?.kickoff ?? a.createdAt;
      const bk = fixtureById.get(b.fixtureId)?.kickoff ?? b.createdAt;
      return new Date(bk).getTime() - new Date(ak).getTime();
    });
  const historyRows = settledOffers.flatMap((offer) => {
    const fixture = fixtureById.get(offer.fixtureId) ?? null;
    return offer.acceptances
      .filter((acceptance) => acceptance.status !== "pending")
      .map((acceptance) => ({ offer, fixture, acceptance }));
  });
  const activeOffers = betting.openOffers.filter((offer) => {
    const fixture = fixtureById.get(offer.fixtureId);
    const hasPendingStake = offer.acceptances.some((acceptance) => acceptance.status === "pending");
    return fixture ? !fixtureHasStarted(fixture) || hasPendingStake : true;
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const canBet = !demoMode && Boolean(participant) && Boolean(token);

  return (
    <section className="bet-pool-board">
      <div className="bet-pool-header">
        <div>
          <p className="eyebrow">Bet Pool</p>
          <h2>Private ledger leaderboard</h2>
          <p>
            Ranked by settled net profit only. Open exposure is shown separately and does not
            change the table order.
          </p>
        </div>
        <div className="bet-summary-card">
          <span>Settled volume</span>
          <strong>{formatBetAmount(betting.leaderboard.reduce((total, row) => total + row.settledVolume, 0) / 2)}</strong>
          <em>{settledAcceptances.length} settled slips</em>
        </div>
      </div>

      <CreateOfferForm
        fixtures={fixtures}
        canBet={canBet}
        demoMode={demoMode}
        token={token}
        refresh={refresh}
        notify={notify}
      />

      <BetLeaderboard rows={betting.leaderboard} />

      <div className="bet-section-heading">
        <div>
          <p className="eyebrow">Betting board</p>
          <h2>Active offers</h2>
        </div>
        <span>{activeOffers.length} active</span>
      </div>
      <div className="bet-offer-grid">
        {activeOffers.length ? (
          activeOffers.map((offer) => (
            <BetOfferCard
              key={offer.id}
              offer={offer}
              fixture={fixtureById.get(offer.fixtureId) ?? null}
              demoMode={demoMode}
              canBet={canBet}
              isOwn={Boolean(participant) && offer.creatorParticipantId === participant!.id}
              token={token}
              refresh={refresh}
              notify={notify}
            />
          ))
        ) : (
          <p className="empty">No active betting offers right now.</p>
        )}
      </div>

      <div className="bet-section-heading">
        <div>
          <p className="eyebrow">My betting slip</p>
          <h2>{participant ? `${participant.name}'s ledger` : "Invite users only"}</h2>
        </div>
        {myRow && <span>{formatSignedBetAmount(myRow.settledNet)} settled</span>}
      </div>
      <div className="bet-slip-grid">
        {myRow ? <BetSlipSummary row={myRow} /> : <p className="empty">Open a personal invite link to see your slip.</p>}
      </div>

      <div className="bet-section-heading">
        <div>
          <p className="eyebrow">History</p>
          <h2>Settled bets &amp; results</h2>
        </div>
        <button
          className="bet-toggle"
          type="button"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          <span>{historyRows.length} done</span>
          {historyOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      </div>
      {historyOpen &&
        (historyRows.length ? (
          <div className="bet-history">
            <div className="bet-history-row head">
              <span>Match</span>
              <span>Pick</span>
              <span>Taker</span>
              <span>Stake</span>
              <span>Result</span>
            </div>
            {historyRows.map(({ offer, fixture, acceptance }) => {
              const scoreKnown = fixture && fixture.homeScore !== null && fixture.awayScore !== null;
              return (
                <div className="bet-history-row" key={acceptance.id}>
                  <span className="bet-history-match">
                    {fixture ? `${fixture.homeCountry} v ${fixture.awayCountry}` : "Unknown"}
                    {scoreKnown && (
                      <strong className="bet-score">
                        {" "}
                        {fixture!.homeScore}–{fixture!.awayScore}
                      </strong>
                    )}
                  </span>
                  <span>
                    {offer.creatorName} · {offer.creatorSide}
                  </span>
                  <span>{acceptance.participantName}</span>
                  <span>{formatBetAmount(acceptance.amount)}</span>
                  <em
                    className={clsx(
                      acceptance.ledgerDelta > 0 && "positive",
                      acceptance.ledgerDelta < 0 && "negative"
                    )}
                  >
                    {resultLabel(acceptance)} {formatSignedBetAmount(acceptance.ledgerDelta)}
                  </em>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty">No settled bets yet. Results show here once matches finish.</p>
        ))}
    </section>
  );
}

function BetLeaderboard({ rows }: { rows: BetLeaderboardRow[] }) {
  return (
    <div className="bet-leaderboard">
      <div className="bet-table-header">
        <span>Rank</span>
        <span>Participant</span>
        <span>Settled net</span>
        <span>W / L / V</span>
        <span>Volume</span>
        <span>Open exposure</span>
        <span>Open</span>
      </div>
      {rows.map((row) => (
        <div className={clsx("bet-table-row", row.rank <= 3 && "podium")} key={row.participantId}>
          <strong>#{row.rank}</strong>
          <span>{row.participantName}</span>
          <em className={clsx(row.settledNet > 0 && "positive", row.settledNet < 0 && "negative")}>
            {formatSignedBetAmount(row.settledNet)}
          </em>
          <span>
            {row.won} / {row.lost} / {row.void}
          </span>
          <span>{formatBetAmount(row.settledVolume)}</span>
          <span>{formatBetAmount(row.openExposure)}</span>
          <span>
            {row.openOffers} / {row.activeAccepts}
          </span>
        </div>
      ))}
    </div>
  );
}

function CreateOfferForm({
  fixtures,
  canBet,
  demoMode,
  token,
  refresh,
  notify
}: {
  fixtures: Fixture[];
  canBet: boolean;
  demoMode: boolean;
  token: string;
  refresh: () => Promise<void> | void;
  notify: (message: string) => void;
}) {
  const openFixtures = useMemo(
    () =>
      fixtures
        .filter(
          (fixture) =>
            fixture.homeScore === null && fixture.awayScore === null && !fixtureHasStarted(fixture)
        )
        .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()),
    [fixtures]
  );

  const [open, setOpen] = useState(false);
  const [fixtureId, setFixtureId] = useState<number | null>(null);
  const [market, setMarket] = useState<BetOffer["market"]>("winner");
  const [backedCountry, setBackedCountry] = useState("");
  const [settlementBasis, setSettlementBasis] = useState<BetOffer["settlementBasis"]>("advance_winner");
  const [handicapLine, setHandicapLine] = useState(-0.5);
  const [maxAmount, setMaxAmount] = useState(BET_OFFER_DEFAULT_STAKE);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedFixture = openFixtures.find((fixture) => fixture.id === fixtureId) ?? null;

  useEffect(() => {
    if (!selectedFixture && openFixtures.length) {
      setFixtureId(openFixtures[0].id);
    }
  }, [openFixtures, selectedFixture]);

  useEffect(() => {
    if (selectedFixture) {
      setBackedCountry((current) =>
        current === selectedFixture.homeCountry || current === selectedFixture.awayCountry
          ? current
          : selectedFixture.homeCountry
      );
    }
  }, [selectedFixture]);

  function changeMarket(next: BetOffer["market"]) {
    setMarket(next);
    setSettlementBasis(next === "winner" ? "advance_winner" : "ninety_minutes");
  }

  async function submit() {
    if (!selectedFixture || !backedCountry) {
      notify("Pick a fixture and the team you are backing.");
      return;
    }
    if (!(maxAmount > 0)) {
      notify("Enter a max stake greater than zero.");
      return;
    }

    setSubmitting(true);
    notify("Posting your offer...");
    const { ok, error } = await postBet("/api/bet/offer", {
      token,
      fixtureId: selectedFixture.id,
      market,
      backedCountry,
      settlementBasis,
      handicapLine: market === "asian_handicap" ? handicapLine : null,
      maxAmount,
      note: note.trim() || null
    });
    setSubmitting(false);

    if (!ok) {
      notify(error ?? "Could not create offer.");
      return;
    }

    notify("Offer posted. Other players can accept it now.");
    setNote("");
    setMaxAmount(BET_OFFER_DEFAULT_STAKE);
    setOpen(false);
    await refresh();
  }

  if (!canBet) {
    return (
      <div className="bet-create">
        <div className="bet-create-head">
          <div>
            <p className="eyebrow">Create offer</p>
            <h2>Post a bet to the pool</h2>
          </div>
        </div>
        <p className="empty">
          {demoMode
            ? "Open your personal invite link to create and accept real offers."
            : "Open your personal invite link to create and accept offers."}
        </p>
      </div>
    );
  }

  return (
    <div className="bet-create">
      <div className="bet-create-head">
        <div>
          <p className="eyebrow">Create offer</p>
          <h2>Post a bet to the pool</h2>
        </div>
        <button className="bet-action gold" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "New offer"}
        </button>
      </div>

      {open &&
        (openFixtures.length ? (
          <div className="bet-create-form">
            <label>
              <span>Fixture</span>
              <select
                value={fixtureId ?? ""}
                onChange={(event) => setFixtureId(Number(event.target.value))}
              >
                {openFixtures.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.homeCountry} vs {fixture.awayCountry} -{" "}
                    {new Intl.DateTimeFormat("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    }).format(new Date(fixture.kickoff))}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Market</span>
              <select value={market} onChange={(event) => changeMarket(event.target.value as BetOffer["market"])}>
                <option value="winner">Match winner</option>
                <option value="asian_handicap">Asian Handicap</option>
              </select>
            </label>

            <label>
              <span>You back</span>
              <select value={backedCountry} onChange={(event) => setBackedCountry(event.target.value)}>
                {selectedFixture && (
                  <>
                    <option value={selectedFixture.homeCountry}>{selectedFixture.homeCountry}</option>
                    <option value={selectedFixture.awayCountry}>{selectedFixture.awayCountry}</option>
                  </>
                )}
              </select>
            </label>

            {market === "asian_handicap" && (
              <label>
                <span>Handicap line</span>
                <select value={handicapLine} onChange={(event) => setHandicapLine(Number(event.target.value))}>
                  {HANDICAP_LINES.map((line) => (
                    <option key={line} value={line}>
                      {backedCountry || "Your team"} {formatHandicapLine(line)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              <span>Settlement basis</span>
              <select
                value={settlementBasis}
                onChange={(event) => setSettlementBasis(event.target.value as BetOffer["settlementBasis"])}
              >
                <option value="advance_winner">Advance Winner (incl. ET/pens)</option>
                <option value="ninety_minutes">90-Min Result</option>
              </select>
            </label>

            <label>
              <span>Max stake (RM)</span>
              <input
                type="number"
                min={1}
                step={10}
                value={maxAmount}
                onChange={(event) => setMaxAmount(Number(event.target.value))}
              />
            </label>

            <label className="bet-create-note">
              <span>Note (optional)</span>
              <input
                type="text"
                maxLength={280}
                value={note}
                placeholder="Add context for the other players"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>

            <button className="bet-action gold" type="button" onClick={submit} disabled={submitting}>
              {submitting ? "Posting..." : "Post offer"}
            </button>
          </div>
        ) : (
          <p className="empty">No upcoming fixtures are open for new offers right now.</p>
        ))}
    </div>
  );
}

function BetOfferCard({
  offer,
  fixture,
  demoMode,
  canBet,
  isOwn,
  token,
  refresh,
  notify
}: {
  offer: BetOffer;
  fixture: Fixture | null;
  demoMode: boolean;
  canBet: boolean;
  isOwn: boolean;
  token: string;
  refresh: () => Promise<void> | void;
  notify: (message: string) => void;
}) {
  const [stake, setStake] = useState<number>(0);
  const [accepting, setAccepting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const matchStarted = fixture ? new Date(fixture.kickoff).getTime() <= Date.now() : false;
  const acceptable =
    canBet && !isOwn && offer.status === "open" && offer.remainingAmount > 0 && !matchStarted;
  const beforeCancelLock = fixture
    ? new Date(fixture.kickoff).getTime() - BET_CANCEL_LOCK_HOURS * 60 * 60 * 1000 > Date.now()
    : false;
  const hasActiveBets = offer.acceptances.some((acceptance) => acceptance.status === "pending");
  const cancellable =
    canBet &&
    isOwn &&
    (offer.status === "open" || offer.status === "filled") &&
    !matchStarted &&
    // Unmatched offers can be pulled before kickoff; matched ones only before the cut-off.
    (!hasActiveBets || beforeCancelLock);

  async function cancel() {
    setCancelling(true);
    notify("Cancelling your offer...");
    const { ok, error } = await postBet("/api/bet/cancel", { token, offerId: offer.id });
    setCancelling(false);

    if (!ok) {
      notify(error ?? "Could not cancel offer.");
      return;
    }

    notify(
      hasActiveBets
        ? "Offer cancelled. Matched stakes were voided and refunded."
        : "Offer cancelled."
    );
    await refresh();
  }

  async function accept() {
    const amount = stake > 0 ? stake : offer.remainingAmount;
    if (amount <= 0) {
      notify("Enter a stake to accept.");
      return;
    }
    if (amount > offer.remainingAmount + 1e-9) {
      notify(`Only ${formatBetAmount(offer.remainingAmount)} remaining on this offer.`);
      return;
    }

    setAccepting(true);
    notify(`Accepting ${formatBetAmount(amount)}...`);
    const { ok, error } = await postBet("/api/bet/accept", {
      token,
      offerId: offer.id,
      amount
    });
    setAccepting(false);

    if (!ok) {
      notify(error ?? "Could not accept offer.");
      return;
    }

    notify(`You took ${formatBetAmount(amount)} of ${offer.creatorName}'s offer.`);
    setStake(0);
    await refresh();
  }

  const kickoff = fixture
    ? new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(fixture.kickoff))
    : "Fixture pending";

  return (
    <article className="bet-offer-card">
      <header>
        <div>
          <p className="eyebrow">{marketLabel(offer)}</p>
          <h3>
            {offer.creatorName} backs {offer.creatorSide}
          </h3>
        </div>
        <span className={clsx("bet-status", offer.status)}>{offer.status}</span>
      </header>
      <p className="bet-fixture">
        {fixture ? `${fixture.homeCountry} vs ${fixture.awayCountry}` : "Unknown fixture"} - {kickoff}
      </p>
      <div className="bet-badges">
        <span>{settlementBasisLabel(offer)}</span>
        <span>{settlementBasisDetail(offer)}</span>
        <span>No minimum stake</span>
        <span>Against {offer.opponentSide}</span>
      </div>
      <div className="bet-progress">
        <div>
          <span>Accepted</span>
          <strong>
            {formatBetAmount(offer.acceptedAmount)} / {formatBetAmount(offer.maxAmount)}
          </strong>
        </div>
        <div>
          <span>Remaining</span>
          <strong>{formatBetAmount(offer.remainingAmount)}</strong>
        </div>
      </div>
      {offer.note && <p className="bet-note">{offer.note}</p>}
      <div className="bet-acceptances">
        {offer.acceptances.map((acceptance) => (
          <span key={acceptance.id}>
            {acceptance.participantName} {formatBetAmount(acceptance.amount)} {resultLabel(acceptance)}
          </span>
        ))}
      </div>
      {acceptable ? (
        <div className="bet-accept-row">
          <input
            type="number"
            min={1}
            step={10}
            max={offer.remainingAmount}
            value={stake || ""}
            placeholder={`Up to ${formatBetAmount(offer.remainingAmount)}`}
            onChange={(event) => setStake(Number(event.target.value))}
          />
          <button className="bet-action gold" type="button" onClick={accept} disabled={accepting}>
            {accepting ? "Accepting..." : "Accept"}
          </button>
        </div>
      ) : cancellable ? (
        <button className="bet-action danger" type="button" onClick={cancel} disabled={cancelling}>
          {cancelling ? "Cancelling..." : "Cancel offer"}
        </button>
      ) : (
        <button className="bet-action" type="button" disabled>
          {demoMode
            ? "Demo preview"
            : isOwn
              ? offer.status === "open" || offer.status === "filled"
                ? "Cancel window closed"
                : "Your offer"
              : !canBet
                ? "Invite link required"
                : offer.remainingAmount <= 0
                  ? "Fully matched"
                  : matchStarted
                    ? "Betting closed"
                    : "Closed"}
        </button>
      )}
    </article>
  );
}

function BetSlipSummary({ row }: { row: BetLeaderboardRow }) {
  return (
    <div className="bet-slip-summary">
      <div>
        <span>Settled net</span>
        <strong className={clsx(row.settledNet > 0 && "positive", row.settledNet < 0 && "negative")}>
          {formatSignedBetAmount(row.settledNet)}
        </strong>
      </div>
      <div>
        <span>Open exposure</span>
        <strong>{formatBetAmount(row.openExposure)}</strong>
      </div>
      <div>
        <span>Record</span>
        <strong>
          {row.won} / {row.lost} / {row.void}
        </strong>
      </div>
    </div>
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
  const eliminated = Boolean(team.finalRank && team.finalRank > 2);
  const beatExpectation = Boolean(team.finalRank && team.finalRank <= team.expectedRank);

  return (
    <article className={clsx("team-tile", compact && "compact", eliminated && "dimmed")}>
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
          {beatExpectation ? <CheckCircle2 /> : <Shield />}
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
