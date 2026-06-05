import type { Ledger } from "../types";
import { pct } from "../format";

const VERDICT_TAG: Record<string, { cls: string; label: string }> = {
  "machine leading": { cls: "machine", label: "Machine leading" },
  "market leading": { cls: "market", label: "Market leading" },
  level: { cls: "level", label: "Level" },
};

export function Scoreboard({ ledger }: { ledger: Ledger | null }) {
  if (!ledger || ledger.totals.completed === 0) {
    return (
      <div className="scoreboard">
        <div className="board">
          <div className="verdict">Machine vs Market</div>
          <p className="empty" style={{ padding: "10px 0" }}>
            No completed matches yet — the scoreboard fills itself as results come in.
          </p>
        </div>
      </div>
    );
  }

  const v = VERDICT_TAG[ledger.headToHead.verdict] ?? VERDICT_TAG.level!;
  const m = ledger.rates.machineOutcomeAccuracy;
  const k = ledger.rates.marketOutcomeAccuracy;

  return (
    <div className="scoreboard">
      <div className="board">
        <div className="verdict">
          Machine vs Market
          <span className={`tag ${v.cls}`}>{v.label}</span>
        </div>

        <div className="h2h">
          <div className="side machine">
            <div className="who">Machine</div>
            <div className="pct num">{pct(m)}</div>
            <div className="meta">outcome accuracy</div>
          </div>
          <div className="mid">
            <div className="vs">vs</div>
            <div className="num" style={{ fontSize: 11 }}>
              {ledger.totals.completed} played
            </div>
          </div>
          <div className="side market">
            <div className="who">Market</div>
            <div className="pct num">{pct(k)}</div>
            <div className="meta">outcome accuracy</div>
          </div>
        </div>

        <div className="strip">
          <span className="stat">
            H2H <b>{ledger.headToHead.machineLead}</b>–<b>{ledger.headToHead.marketLead}</b>{" "}
            ({ledger.headToHead.level} level)
          </span>
          <span className="stat">
            Exact scores <b>{ledger.totals.exactScoreHits}</b>/{ledger.totals.completed}
          </span>
          {ledger.brier.machineAvg != null && (
            <span className="stat">
              Brier <b>{ledger.brier.machineAvg}</b> vs <b>{ledger.brier.marketAvg ?? "—"}</b>{" "}
              (lower = better)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
