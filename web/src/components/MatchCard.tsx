import { useState } from "react";
import type { Fixture, Prediction, ResultRecord, ProbTriple } from "../types";
import { pct, kickoffLabel } from "../format";

function ProbBar({ kind, probs }: { kind: "machine" | "market"; probs: ProbTriple }) {
  const segs = [
    { k: "h", v: probs.homeWin },
    { k: "d", v: probs.draw },
    { k: "a", v: probs.awayWin },
  ];
  return (
    <div className={`barrow ${kind}`}>
      <span className="who">{kind}</span>
      <div className="bar">
        {segs.map((s) => (
          <div
            key={s.k}
            className={`seg ${s.k}`}
            style={{ width: `${Math.max(s.v * 100, 0)}%` }}
            title={`${s.k === "h" ? "Home" : s.k === "d" ? "Draw" : "Away"} ${pct(s.v)}`}
          >
            {s.v >= 0.12 ? pct(s.v) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ fixture }: { fixture: Fixture }) {
  if (fixture.status === "live") {
    return (
      <span className="status live">
        <span className="dot" /> LIVE {fixture.elapsed != null ? `${fixture.elapsed}'` : ""}
      </span>
    );
  }
  if (fixture.status === "finished") return <span className="status">Full time</span>;
  return <span className="status">{kickoffLabel(fixture.kickoff)}</span>;
}

function HitBadges({ result }: { result: ResultRecord }) {
  const items: { cls: string; label: string }[] = [];
  if (result.machineOutcomeHit != null)
    items.push({
      cls: result.machineOutcomeHit ? "hit" : "miss",
      label: `Machine ${result.machineOutcomeHit ? "✓" : "✗"}`,
    });
  if (result.marketOutcomeHit != null)
    items.push({
      cls: result.marketOutcomeHit ? "hit" : "miss",
      label: `Market ${result.marketOutcomeHit ? "✓" : "✗"}`,
    });
  if (result.exactScoreHit)
    items.push({ cls: "hit", label: "Exact score ✓" });
  if (!items.length) return null;
  return (
    <div className="badges">
      {items.map((b, i) => (
        <span key={i} className={`badge ${b.cls}`}>{b.label}</span>
      ))}
    </div>
  );
}

export function MatchCard({
  fixture,
  prediction,
  result,
}: {
  fixture: Fixture;
  prediction: Prediction | undefined;
  result: ResultRecord | undefined;
}) {
  const [open, setOpen] = useState(false);
  const finished = fixture.status === "finished";
  const live = fixture.status === "live";
  const showLiveScore = (live || finished) && fixture.homeScore != null;

  const homePlaceholder = !fixture.homeTeamId && /winner|runner|3rd|loser|group/i.test(fixture.homeTeam);
  const awayPlaceholder = !fixture.awayTeamId && /winner|runner|3rd|loser|group/i.test(fixture.awayTeam);

  return (
    <div className={`card ${live ? "live" : ""}`}>
      <div className="top">
        <StatusPill fixture={fixture} />
        {prediction && <span className={`conf ${prediction.confidence}`}>{prediction.confidence} conf</span>}
      </div>

      <div className="matchup">
        <div className="team home">
          <span className={`name ${homePlaceholder ? "placeholder" : ""}`}>{fixture.homeTeam}</span>
        </div>

        <div className="scorebox">
          {showLiveScore ? (
            <>
              <div className="live-score num">
                {fixture.homeScore}–{fixture.awayScore}
              </div>
              <div className="label">{finished ? "Result" : "Live"}</div>
              {prediction && (
                <div className="pred-after">
                  predicted {prediction.scoreline.home}–{prediction.scoreline.away}
                </div>
              )}
            </>
          ) : prediction ? (
            <>
              <div className="pred-score">
                <b>{prediction.scoreline.home}</b>–<b>{prediction.scoreline.away}</b>
              </div>
              <div className="label">Predicted</div>
            </>
          ) : (
            <div className="label">vs</div>
          )}
        </div>

        <div className="team away">
          <span className={`name ${awayPlaceholder ? "placeholder" : ""}`}>{fixture.awayTeam}</span>
        </div>
      </div>

      {prediction && (
        <div className="bars">
          <ProbBar kind="machine" probs={prediction.probs} />
          <ProbBar kind="market" probs={prediction.market} />
        </div>
      )}

      {result && finished && <HitBadges result={result} />}

      {prediction && (
        <>
          <button className="reason-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "▾ Hide reasoning" : "▸ Why the machine thinks this"}
          </button>
          {open && (
            <div className="reason">
              {prediction.reasoning}
              <div className="meta">
                <span>model: {prediction.modelVersion}</span>
                {prediction.market.source === "book" ? <span>market: book odds</span> : <span>market: derived</span>}
                {prediction.locked && prediction.lockedAt && (
                  <span>locked: {kickoffLabel(prediction.lockedAt)}</span>
                )}
                {prediction.webSearchUsed && <span>web search ✓</span>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
