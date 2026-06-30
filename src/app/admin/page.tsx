"use client";

import { useEffect, useMemo, useState } from "react";
import SweepstakeClient from "@/app/sweepstake-client";
import type { AppState, SweepstakeGroupSummary } from "@/lib/types";
import { WALPLUS_GROUP_ASSIGNMENTS, WALPLUS_GROUP_NAME, WALPLUS_GROUP_SLUG } from "@/lib/group-presets";

type InviteLink = {
  participantId: number;
  participantName: string;
  inviteUrl: string;
};

type AssignmentEditorRow = {
  name: string;
  teams: string;
};

const TOTAL_TEAMS = 48;
const TEAM_FORMAT_OPTIONS = [5, 4, 3];

const DEFAULT_ASSIGNMENT_ROWS: AssignmentEditorRow[] = WALPLUS_GROUP_ASSIGNMENTS.map((assignment) => ({
  name: assignment.name,
  teams: assignment.teams.join(", ")
}));

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [refreshingGroups, setRefreshingGroups] = useState(false);
  const [groups, setGroups] = useState<SweepstakeGroupSummary[]>([]);
  const [selectedGroupSlug, setSelectedGroupSlug] = useState("");
  const [state, setState] = useState<AppState | null>(null);
  const [message, setMessage] = useState("");
  const [groupName, setGroupName] = useState(WALPLUS_GROUP_NAME);
  const [groupSlug, setGroupSlug] = useState(WALPLUS_GROUP_SLUG);
  const [groupCreateMode, setGroupCreateMode] = useState<"assign" | "draw">("assign");
  const [teamsPerParticipant, setTeamsPerParticipant] = useState(5);
  const [createPrizePoolAmount, setCreatePrizePoolAmount] = useState("400");
  const [createChampionPrizeAmount, setCreateChampionPrizeAmount] = useState("240");
  const [createRunnerUpPrizeAmount, setCreateRunnerUpPrizeAmount] = useState("120");
  const [createWoodenSpoonPrizeAmount, setCreateWoodenSpoonPrizeAmount] = useState("40");
  const [memberCount, setMemberCount] = useState(DEFAULT_ASSIGNMENT_ROWS.length);
  const [assignmentRows, setAssignmentRows] = useState(DEFAULT_ASSIGNMENT_ROWS);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [prizePoolAmount, setPrizePoolAmount] = useState("600");
  const [championPrizeAmount, setChampionPrizeAmount] = useState("360");
  const [runnerUpPrizeAmount, setRunnerUpPrizeAmount] = useState("180");
  const [woodenSpoonPrizeAmount, setWoodenSpoonPrizeAmount] = useState("60");
  const [savingPrizeSettings, setSavingPrizeSettings] = useState(false);

  const activeTeamCount = useMemo(
    () => state?.teams.filter((team) => team.finalRank === null).length ?? TOTAL_TEAMS,
    [state]
  );
  const teamLimit = groupCreateMode === "draw" ? activeTeamCount : TOTAL_TEAMS;
  const maxMemberCount = Math.max(1, Math.floor(teamLimit / teamsPerParticipant));
  const drawTeamRequirement = memberCount * teamsPerParticipant;
  const drawHasEnoughTeams = groupCreateMode !== "draw" || drawTeamRequirement <= activeTeamCount;
  const visibleAssignmentRows = useMemo(
    () => ensureAssignmentRowCount(assignmentRows, memberCount).slice(0, memberCount),
    [assignmentRows, memberCount]
  );

  useEffect(() => {
    if (!unlocked) return;
    void loadGroups();
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked || !selectedGroupSlug) return;
    void loadSelectedState(selectedGroupSlug);
  }, [unlocked, selectedGroupSlug]);

  useEffect(() => {
    if (!state?.group) return;
    setPrizePoolAmount(String(state.group.prizePoolAmount));
    setChampionPrizeAmount(String(state.group.championPrizeAmount));
    setRunnerUpPrizeAmount(String(state.group.runnerUpPrizeAmount));
    setWoodenSpoonPrizeAmount(String(state.group.woodenSpoonPrizeAmount));
  }, [state?.group]);

  useEffect(() => {
    setMemberCount((current) => normalizeMemberCount(current, teamsPerParticipant, teamLimit));
  }, [teamsPerParticipant, teamLimit]);

  async function unlock() {
    setUnlocking(true);
    setMessage("");
    const response = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key })
    });
    setUnlocking(false);

    if (!response.ok) {
      setMessage("Invalid admin key");
      return;
    }

    setMessage("");
    setUnlocked(true);
  }

  async function loadGroups(preferredSlug = selectedGroupSlug) {
    setRefreshingGroups(true);
    try {
      const response = await fetch("/api/admin/groups", {
        cache: "no-store",
        headers: { "x-admin-key": key }
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "Unable to load groups");
        return;
      }

      setGroups(payload.groups ?? []);
      const nextSlug = preferredSlug || payload.groups?.[0]?.slug || "";
      if (nextSlug) setSelectedGroupSlug(nextSlug);
    } finally {
      setRefreshingGroups(false);
    }
  }

  async function loadSelectedState(slug: string) {
    const response = await fetch(`/api/admin/state?group=${encodeURIComponent(slug)}`, {
      cache: "no-store",
      headers: { "x-admin-key": key }
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Unable to load selected group");
      return;
    }
    setState(payload);
  }

  async function createGroup() {
    let participants;
    try {
      participants =
        groupCreateMode === "draw"
          ? buildDrawParticipants(assignmentRows, memberCount)
          : buildAssignments(assignmentRows, memberCount, teamsPerParticipant);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not parse assignments");
      return;
    }

    if (!drawHasEnoughTeams) {
      setMessage(`Only ${activeTeamCount} active countries left; this draw needs ${drawTeamRequirement}`);
      return;
    }

    setCreatingGroup(true);
    setMessage(groupCreateMode === "draw" ? "Creating draw group..." : "Creating group...");
    const response = await fetch("/api/admin/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({
        mode: groupCreateMode,
        name: groupName,
        slug: groupSlug,
        teamsPerParticipant,
        prizeSettings: buildPrizeSettings({
          prizePoolAmount: createPrizePoolAmount,
          championPrizeAmount: createChampionPrizeAmount,
          runnerUpPrizeAmount: createRunnerUpPrizeAmount,
          woodenSpoonPrizeAmount: createWoodenSpoonPrizeAmount
        }),
        participants
      })
    });
    const payload = await response.json();
    setCreatingGroup(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Could not create group");
      return;
    }

    setInviteLinks(payload.inviteLinks ?? []);
    setMessage(`Created ${payload.group.name}`);
    await loadGroups(payload.group.slug);
    await loadSelectedState(payload.group.slug);
  }

  function updateTeamsPerParticipant(value: number) {
    setTeamsPerParticipant(value);
    setMemberCount((current) => normalizeMemberCount(current, value, teamLimit));
  }

  function updateMemberCount(value: number) {
    const nextCount = normalizeMemberCount(value, teamsPerParticipant, teamLimit);
    setMemberCount(nextCount);
    setAssignmentRows((rows) => ensureAssignmentRowCount(rows, nextCount));
  }

  function updateAssignmentRow(index: number, field: keyof AssignmentEditorRow, value: string) {
    setAssignmentRows((rows) => {
      const next = ensureAssignmentRowCount(rows, memberCount);
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  async function savePrizeSettings() {
    if (!selectedGroupSlug) return;

    setSavingPrizeSettings(true);
    setMessage("Saving prize settings...");
    const response = await fetch("/api/admin/groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({
        slug: selectedGroupSlug,
        prizeSettings: buildPrizeSettings({
          prizePoolAmount,
          championPrizeAmount,
          runnerUpPrizeAmount,
          woodenSpoonPrizeAmount
        })
      })
    });
    const payload = await response.json();
    setSavingPrizeSettings(false);

    if (!response.ok) {
      setMessage(payload.error ?? "Could not update prize settings");
      return;
    }

    setMessage(`Saved prizes for ${payload.group.name}`);
    await loadGroups(payload.group.slug);
    await loadSelectedState(payload.group.slug);
  }

  if (!unlocked) {
    return (
      <main className="shell">
        <section className="topbar compact">
          <div>
            <p className="eyebrow">Organiser access</p>
            <h1>Admin</h1>
          </div>
        </section>
        <section className="admin-gate">
          <label>
            Admin key
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") unlock();
              }}
              type="password"
              autoFocus
            />
          </label>
          <button className="primary-button" onClick={unlock} disabled={!key || unlocking}>
            {unlocking ? "Checking..." : "Unlock overview"}
          </button>
          {message && <p className="muted">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <>
      <section className="shell admin-results">
        <div className="topbar compact">
          <div>
            <p className="eyebrow">Group control</p>
            <h1>Sweepstake groups</h1>
          </div>
        </div>
        <div className="admin-grid">
          <label>
            View group
            <select value={selectedGroupSlug} onChange={(event) => setSelectedGroupSlug(event.target.value)}>
              {groups.map((group) => (
                <option key={group.slug} value={group.slug}>
                  {group.name} - {group.participantCount} players / {group.drawCount} teams
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button admin-grid-action"
            onClick={() => void loadGroups()}
            disabled={refreshingGroups}
            type="button"
          >
            {refreshingGroups ? "Refreshing..." : "Refresh groups"}
          </button>
        </div>

        <div className="admin-grid admin-grid--prizes">
          <label>
            Total prize
            <input value={prizePoolAmount} onChange={(event) => setPrizePoolAmount(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            1st place
            <input value={championPrizeAmount} onChange={(event) => setChampionPrizeAmount(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            2nd place
            <input value={runnerUpPrizeAmount} onChange={(event) => setRunnerUpPrizeAmount(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            Wooden spoon
            <input value={woodenSpoonPrizeAmount} onChange={(event) => setWoodenSpoonPrizeAmount(event.target.value)} inputMode="decimal" />
          </label>
          <button className="primary-button" onClick={savePrizeSettings} disabled={savingPrizeSettings || !selectedGroupSlug} type="button">
            {savingPrizeSettings ? "Saving..." : "Save prize settings"}
          </button>
        </div>

        <div className="admin-grid admin-grid--import">
          <label>
            New group name
            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} />
          </label>
          <label>
            URL slug
            <input value={groupSlug} onChange={(event) => setGroupSlug(event.target.value)} />
          </label>
          <label>
            Setup mode
            <select value={groupCreateMode} onChange={(event) => setGroupCreateMode(event.target.value as "assign" | "draw")}>
              <option value="assign">Assign teams now</option>
              <option value="draw">Invite players to draw</option>
            </select>
          </label>
          <label>
            Team format
            <select
              value={teamsPerParticipant}
              onChange={(event) => updateTeamsPerParticipant(Number(event.target.value))}
            >
              {TEAM_FORMAT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} teams per participant
                </option>
              ))}
            </select>
          </label>
          <label>
            Member count
            <input
              value={memberCount}
              onChange={(event) => updateMemberCount(Number(event.target.value))}
              inputMode="numeric"
              min={1}
              max={maxMemberCount}
              type="number"
            />
          </label>
          <label>
            Total prize
            <input value={createPrizePoolAmount} onChange={(event) => setCreatePrizePoolAmount(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            1st place
            <input value={createChampionPrizeAmount} onChange={(event) => setCreateChampionPrizeAmount(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            2nd place
            <input value={createRunnerUpPrizeAmount} onChange={(event) => setCreateRunnerUpPrizeAmount(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            Wooden spoon
            <input value={createWoodenSpoonPrizeAmount} onChange={(event) => setCreateWoodenSpoonPrizeAmount(event.target.value)} inputMode="decimal" />
          </label>
          <div className="wide assignment-editor">
            <div className="assignment-editor-head">
              <strong>Member aliases</strong>
              <span>
                {memberCount} players / {memberCount * teamsPerParticipant} teams
                {groupCreateMode === "draw" ? ` from ${activeTeamCount} active countries` : ""}
              </span>
            </div>
            {groupCreateMode === "draw" && (
              <p className="muted admin-form-note">
                Invite links will let each player draw {teamsPerParticipant} active teams. Eliminated countries are excluded.
              </p>
            )}
            {visibleAssignmentRows.map((row, index) => (
              <div className={groupCreateMode === "draw" ? "assignment-row assignment-row--aliases" : "assignment-row"} key={index}>
                <label>
                  Alias {index + 1}
                  <input
                    value={row.name}
                    onChange={(event) => updateAssignmentRow(index, "name", event.target.value)}
                  />
                </label>
                {groupCreateMode === "assign" && (
                  <label>
                    Assigned teams
                    <input
                      value={row.teams}
                      onChange={(event) => updateAssignmentRow(index, "teams", event.target.value)}
                      placeholder={teamPlaceholder(teamsPerParticipant)}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <button className="primary-button" onClick={createGroup} disabled={creatingGroup || !drawHasEnoughTeams} type="button">
            {creatingGroup ? "Creating..." : groupCreateMode === "draw" ? "Create draw group" : "Create / update group"}
          </button>
          <p className="muted">
            {!drawHasEnoughTeams
              ? `Only ${activeTeamCount} active countries left; this draw needs ${drawTeamRequirement}.`
              : message}
          </p>
        </div>

        {inviteLinks.length > 0 && (
          <div className="admin-invites">
            <p className="eyebrow">Generated invite links</p>
            {inviteLinks.map((invite) => (
              <p key={invite.participantId}>
                <strong>{invite.participantName}</strong>: <a href={invite.inviteUrl}>{invite.inviteUrl}</a>
              </p>
            ))}
          </div>
        )}
      </section>

      {state ? (
        <SweepstakeClient
          key={selectedGroupSlug}
          adminOverview
          initialTab="pools"
          initialState={state}
          adminKey={key}
          adminStateUrl={`/api/admin/state?group=${encodeURIComponent(selectedGroupSlug)}`}
        />
      ) : (
        <main className="shell">
          <section className="loading-panel">
            <p>Loading selected group...</p>
          </section>
        </main>
      )}

    </>
  );
}

function buildPrizeSettings(values: {
  prizePoolAmount: string;
  championPrizeAmount: string;
  runnerUpPrizeAmount: string;
  woodenSpoonPrizeAmount: string;
}) {
  return {
    prizePoolAmount: Number(values.prizePoolAmount),
    championPrizeAmount: Number(values.championPrizeAmount),
    runnerUpPrizeAmount: Number(values.runnerUpPrizeAmount),
    woodenSpoonPrizeAmount: Number(values.woodenSpoonPrizeAmount)
  };
}

function normalizeMemberCount(value: number, teamsPerParticipant: number, teamLimit: number) {
  const maxMemberCount = Math.max(1, Math.floor(teamLimit / teamsPerParticipant));
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), maxMemberCount);
}

function ensureAssignmentRowCount(rows: AssignmentEditorRow[], count: number) {
  const next = rows.map((row) => ({ ...row }));
  while (next.length < count) {
    next.push({ name: `Member ${next.length + 1}`, teams: "" });
  }
  return next;
}

function buildAssignments(rows: AssignmentEditorRow[], memberCount: number, teamsPerParticipant: number) {
  const visibleRows = ensureAssignmentRowCount(rows, memberCount).slice(0, memberCount);
  const seenNames = new Set<string>();

  return visibleRows.map((row, index) => {
    const name = row.name.trim();
    if (!name) throw new Error(`Alias ${index + 1} is required`);
    if (seenNames.has(name)) throw new Error(`Duplicate alias: ${name}`);
    seenNames.add(name);

    const teams = row.teams
      .split(",")
      .map((team) => team.trim())
      .filter(Boolean);
    if (teams.length !== teamsPerParticipant) {
      throw new Error(`${name} needs exactly ${teamsPerParticipant} assigned teams`);
    }
    return { name, teams };
  });
}

function buildDrawParticipants(rows: AssignmentEditorRow[], memberCount: number) {
  const visibleRows = ensureAssignmentRowCount(rows, memberCount).slice(0, memberCount);
  const seenNames = new Set<string>();

  return visibleRows.map((row, index) => {
    const name = row.name.trim();
    if (!name) throw new Error(`Alias ${index + 1} is required`);
    if (seenNames.has(name)) throw new Error(`Duplicate alias: ${name}`);
    seenNames.add(name);
    return { name };
  });
}

function teamPlaceholder(teamsPerParticipant: number) {
  return Array.from({ length: teamsPerParticipant }, (_, index) => `Team ${index + 1}`).join(", ");
}
