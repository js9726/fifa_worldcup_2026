"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppState } from "@/lib/types";

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [state, setState] = useState<AppState | null>(null);
  const [country, setCountry] = useState("");
  const [finalRank, setFinalRank] = useState("");
  const [stage, setStage] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/state", { cache: "no-store" })
      .then((response) => response.json())
      .then(setState)
      .catch(() => setMessage("Unable to load admin data"));
  }, []);

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
  }

  return (
    <main className="shell">
      <section className="topbar compact">
        <div>
          <p className="eyebrow">Result control</p>
          <h1>Admin</h1>
        </div>
      </section>
      <section className="admin-grid">
        <label>
          Admin key
          <input value={key} onChange={(event) => setKey(event.target.value)} type="password" />
        </label>
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
        <button className="primary-button" onClick={saveResult} disabled={!country || !key}>
          Save result
        </button>
        <p className="muted">{message}</p>
      </section>
    </main>
  );
}
