import { useState } from "react";
import type { WinnerPrediction } from "../types";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function WinnerBanner({ winner }: { winner: WinnerPrediction | null }) {
  const [open, setOpen] = useState(false);
  if (!winner || !winner.champion || winner.champion === "TBD") return null;

  const max = Math.max(...winner.contenders.map((c) => c.prob), 0.0001);
  const updated = new Date(winner.updatedAt);

  return (
    <div className="winner">
      <div className="winner-head">
        <span className="winner-label">🏆 Predicted champion</span>
        <span className="winner-basis">{winner.basis}</span>
      </div>

      <div className="winner-pick">
        <span className="winner-team">{winner.champion}</span>
        <span className={`conf ${winner.confidence}`}>{winner.confidence} conf</span>
      </div>

      <div className="winner-sub">
        {winner.runnerUp && <span>Runner-up: <b>{winner.runnerUp}</b></span>}
        {winner.darkHorse && <span>Dark horse: <b>{winner.darkHorse}</b></span>}
      </div>

      {winner.contenders.length > 0 && (
        <div className="winner-bars">
          {winner.contenders.map((c) => (
            <div className="wb-row" key={c.team}>
              <span className="wb-team">{c.team}</span>
              <div className="wb-track">
                <div
                  className={`wb-fill ${c.team === winner.champion ? "lead" : ""}`}
                  style={{ width: `${(c.prob / max) * 100}%` }}
                />
              </div>
              <span className="wb-pct num">{pct(c.prob)}</span>
            </div>
          ))}
        </div>
      )}

      <button className="reason-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾ Hide reasoning" : "▸ Why the machine backs them"}
      </button>
      {open && (
        <div className="reason">
          {winner.reasoning}
          <div className="meta">
            <span>model: {winner.modelVersion}</span>
            <span>updated: {updated.toUTCString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
