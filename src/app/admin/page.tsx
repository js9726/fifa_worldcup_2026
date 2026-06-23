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

const DEFAULT_ASSIGNMENTS = WALPLUS_GROUP_ASSIGNMENTS.map(
  (assignment) => `${assignment.name}: ${assignment.teams.join(", ")}`
).join("\n");

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [groups, setGroups] = useState<SweepstakeGroupSummary[]>([]);
  const [selectedGroupSlug, setSelectedGroupSlug] = useState("");
  const [state, setState] = useState<AppState | null>(null);
  const [country, setCountry] = useState("");
  const [finalRank, setFinalRank] = useState("");
  const [stage, setStage] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [groupName, setGroupName] = useState(WALPLUS_GROUP_NAME);
  const [groupSlug, setGroupSlug] = useState(WALPLUS_GROUP_SLUG);
  const [teamsPerParticipant, setTeamsPerParticipant] = useState(5);
  const [assignmentText, setAssignmentText] = useState(DEFAULT_ASSIGNMENTS);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);

  const selected = useMemo(
    () => state?.teams.find((team) => team.country === country) ?? null,
    [country, state]
  );

  useEffect(() => {
    if (!selected) return;
    setFinalRank(selected.finalRank?.toString() ?? "");
    setStage(selected.eliminatedStage ?? "");
    setNote(selected.resultNote ?? "");
  }, [selected]);

  useEffect(() => {
    if (!unlocked) return;
    void loadGroups();
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked || !selectedGroupSlug) return;
    void loadSelectedState(selectedGroupSlug);
  }, [unlocked, selectedGroupSlug]);

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

  async function saveResult() {
    setMessage("Saving...");
    const response = await fetch("/api/admin/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key,
        country,
        finalRank: finalRank ? Number(finalRank) : null,
        eliminatedStage: stage,
        resultNote: note
      })
    });

    setMessage(response.ok ? "Saved" : "Save failed");

    if (response.ok && selectedGroupSlug) {
      await loadSelectedState(selectedGroupSlug);
    }
  }

  async function createGroup() {
    let participants;
    try {
      participants = parseAssignments(assignmentText, teamsPerParticipant);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not parse assignments");
      return;
    }

    setCreatingGroup(true);
    setMessage("Creating group...");
    const response = await fetch("/api/admin/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({
        name: groupName,
        slug: groupSlug,
        teamsPerParticipant,
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
          <button className="primary-button" onClick={() => loadGroups()} type="button">
            Refresh groups
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
            Team format
            <select
              value={teamsPerParticipant}
              onChange={(event) => setTeamsPerParticipant(Number(event.target.value))}
            >
              <option value={5}>5 teams per participant</option>
              <option value={4}>4 teams per participant</option>
            </select>
          </label>
          <label className="wide">
            Assigned teams
            <textarea value={assignmentText} onChange={(event) => setAssignmentText(event.target.value)} rows={10} />
          </label>
          <button className="primary-button" onClick={createGroup} disabled={creatingGroup} type="button">
            {creatingGroup ? "Creating..." : "Create / update group"}
          </button>
          <p className="muted">{message}</p>
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

      <section className="shell admin-results">
        <div className="topbar compact">
          <div>
            <p className="eyebrow">Result control</p>
            <h1>Update results</h1>
          </div>
        </div>
        <div className="admin-grid">
          <label>
            Country
            <select value={country} onChange={(event) => setCountry(event.target.value)}>
              <option value="">Select country</option>
              {state?.teams.map((team) => (
                <option key={team.country} value={team.country}>
                  {team.country}
                </option>
              ))}
            </select>
          </label>
          <label>
            FIFA finish rank
            <input
              value={finalRank}
              onChange={(event) => setFinalRank(event.target.value)}
              inputMode="numeric"
              placeholder="1 for champion, 48 for last"
            />
          </label>
          <label>
            Stage
            <input
              value={stage}
              onChange={(event) => setStage(event.target.value)}
              placeholder="Champion, Runner-up, Group stage..."
            />
          </label>
          <label className="wide">
            Result note
            <textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button className="primary-button" onClick={saveResult} disabled={!country}>
            Save result
          </button>
          <p className="muted">{message}</p>
        </div>
      </section>
    </>
  );
}

function parseAssignments(value: string, teamsPerParticipant: number) {
  const rows = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!rows.length) throw new Error("Add at least one assignment line");

  return rows.map((line) => {
    const [name, teamsText] = line.split(":");
    if (!name || !teamsText) throw new Error(`Use "Name: Team, Team" format for: ${line}`);
    const teams = teamsText
      .split(",")
      .map((team) => team.trim())
      .filter(Boolean);
    if (!teams.length) throw new Error(`${name.trim()} needs at least one team`);
    if (teams.length !== teamsPerParticipant) {
      throw new Error(`${name.trim()} needs exactly ${teamsPerParticipant} assigned teams`);
    }
    return { name: name.trim(), teams };
  });
}
