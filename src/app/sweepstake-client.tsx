"use client";

import clsx from "clsx";
import {
  CalendarDays,
  CheckCircle2,
  CircleDotDashed,
  Crown,
  RefreshCw,
  Shield,
  Sparkles,
  Trophy,
  Users
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AppState, Draw, Fixture, Pot, Team } from "@/lib/types";

type Tab = "draw" | "pools" | "fixtures" | "results";
type SweepstakeClientProps = {
  token?: string;
  initialState?: AppState;
  demoMode?: boolean;
  initialTab?: Tab;
};

function pointsFor(team: Team) {
  if (!team.finalRank) return 0;
  if (team.finalRank === 1) return 100;
  if (team.finalRank === 2) return 75;
  if (team.finalRank === 3) return 60;
  if (team.finalRank === 4) return 50;
  if (team.finalRank <= 8) return 35;
  if (team.finalRank <= 16) return 20;
  if (team.finalRank <= 32) return 10;
  return 0;
}

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

export default function SweepstakeClient({
  token = "",
  initialState = undefined,
  demoMode = false,
  initialTab = "draw"
}: SweepstakeClientProps) {
  const [state, setState] = useState<AppState | null>(initialState ?? null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [drawingPot, setDrawingPot] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  async function loadState() {
    if (demoMode || !token) return;

    const response = await fetch(`/api/state?token=${encodeURIComponent(token)}`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Unable to load invite");
      return;
    }
    setState(payload);
  }

  useEffect(() => {
    if (demoMode || !token) return;

    loadState();
    const interval = window.setInterval(loadState, 12000);
    return () => window.clearInterval(interval);
  }, [demoMode, token]);

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

    setMessage(`${payload.draw.team.flag} ${payload.draw.team.country} is yours.`);
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
      score: draws.reduce((sum, draw) => sum + pointsFor(draw.team), 0),
      bestRank: Math.min(...draws.map((draw) => draw.team.finalRank ?? 99))
    }));
  }, [state]);

  const championDraw = state?.allDraws.find((draw) => draw.team.finalRank === 1) ?? null;
  const fixtureGroups = useMemo(() => groupByDate(state?.fixtures ?? []), [state]);

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
            {demoMode ? "Demo preview" : "Our World Cup 2026 Pools"}
          </p>
          <h1>{demoMode ? "Sweepstake demo" : `${state.participant?.name}'s live draw`}</h1>
          <p className="subcopy">
            {demoMode
              ? "Pre-filled example with live board, fixtures, rankings and result logic."
              : `${state.allDraws.length}/48 countries claimed. Neon locks every country once.`}
          </p>
        </div>
        <div className="trophy-mark">
          <Trophy aria-hidden="true" />
        </div>
      </section>

      <nav className="tabs" aria-label="Sweepstake views">
        {[
          ["draw", Sparkles, "Draw"],
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
        <section className="draw-grid">
          <div className="rules-panel">
            <h2>Winner Logic</h2>
            <p>
              The office sweepstake winner is the participant who owns the World Cup champion.
              The leaderboard is for bragging rights: champion 100, runner-up 75, third 60,
              fourth 50, quarter-finalist 35, round-of-16 20, round-of-32 10.
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
      )}

      {tab === "pools" && (
        <section className="pool-grid">
          {groupedDraws.map((pool) => (
            <article className="pool-card" key={pool.name}>
              <header>
                <h2>{pool.name}&apos;s Pool</h2>
                <span>{pool.score} pts</span>
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
        <section className="fixture-board">
          {Object.entries(fixtureGroups).map(([date, fixtures]) => (
            <article className="fixture-day" key={date}>
              <h2>{date}</h2>
              {fixtures.map((fixture) => (
                <FixtureRow key={fixture.id} fixture={fixture} />
              ))}
            </article>
          ))}
        </section>
      )}

      {tab === "results" && (
        <section className="results-board">
          <article className="winner-panel">
            <Crown aria-hidden="true" />
            <div>
              <p className="eyebrow">Sweepstake winner</p>
              <h2>
                {championDraw
                  ? `${championDraw.participantName} wins with ${championDraw.team.country}`
                  : "Pending World Cup champion"}
              </h2>
            </div>
          </article>
          <div className="standings">
            {groupedDraws
              .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || a.name.localeCompare(b.name))
              .map((pool, index) => (
                <article className="standing-row" key={pool.name}>
                  <span>{index + 1}</span>
                  <strong>{pool.name}</strong>
                  <p>{pool.score} pts</p>
                </article>
              ))}
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

function TeamTile({ team, compact = false }: { team: Team; compact?: boolean }) {
  const status = statusFor(team);
  const below = status === "Below expectation";

  return (
    <article className={clsx("team-tile", compact && "compact", below && "dimmed")}>
      <div className="flag">{team.flag}</div>
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

function FixtureRow({ fixture }: { fixture: Fixture }) {
  const kickoff = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(fixture.kickoff));

  return (
    <div className="fixture-row">
      <span>{kickoff}</span>
      <strong>
        {fixture.homeCountry} {fixture.homeScore ?? ""} vs {fixture.awayScore ?? ""}{" "}
        {fixture.awayCountry}
      </strong>
      <p>
        {fixture.homeOwner ?? "Unclaimed"} vs {fixture.awayOwner ?? "Unclaimed"} - {fixture.venue}
      </p>
    </div>
  );
}
