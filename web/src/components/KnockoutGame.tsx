import { useState } from "react";
import type { AppData, KnockoutEntry, KoScore } from "../types";
import { STAGE_LABEL, kickoffLabel } from "../format";

const sc = (s: { home: number; away: number }) => `${s.home}–${s.away}`;
const isExample = (e: KnockoutEntry) => e.modelVersion === "illustrative-example" || e.fixtureId.startsWith("example-");

function ActualLine({ ko, home, away }: { ko: KoScore; home: string; away: string }) {
  const adv = ko.advanced === "home" ? home : ko.advanced === "away" ? away : "—";
  return (
    <div className="kg-actual num">
      RT {ko.rt ? sc(ko.rt) : "—"}
      {ko.et && <> · ET {sc(ko.et)}</>}
      {ko.pens && <> · pens {sc(ko.pens)}</>}
      {" · "}<b>{adv}</b> through
    </div>
  );
}

function Pick({ n, label, value, sub }: { n: string; label: string; value: string; sub?: string }) {
  return (
    <div className="kg-pick">
      <span className="kg-pick-n">{n}</span>
      <div className="kg-pick-body">
        <div className="kg-pick-label">{label}</div>
        <div className="kg-pick-value num">{value}</div>
        {sub && <div className="kg-pick-sub">{sub}</div>}
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: KnockoutEntry }) {
  const [open, setOpen] = useState(false);
  const example = isExample(entry);
  const scored = entry.scored;

  return (
    <div className="card kg-card">
      <div className="top">
        <span className="status">
          {example ? "EXAMPLE" : STAGE_LABEL[entry.stage] ?? entry.stage} · {kickoffLabel(entry.kickoff)}
        </span>
        <span className="conf">E[pts] {entry.ev.total} / 7</span>
      </div>

      <div className="kg-teams">
        <span className="name">{entry.homeTeam}</span>
        <span className="kg-vs">v</span>
        <span className="name" style={{ textAlign: "right" }}>{entry.awayTeam}</span>
      </div>

      <div className="kg-picks">
        <Pick n="1" label="Advance" value={entry.pred1Team} sub={`E ${entry.ev.p1}`} />
        <Pick n="2" label="After 90′" value={sc(entry.pred2Reg)} sub={`E ${entry.ev.p2}`} />
        <Pick n="3" label="After ET" value={sc(entry.pred3Et)} sub={`P(ET) ${Math.round(entry.pEtUsed * 100)}% · E ${entry.ev.p3}`} />
      </div>

      {scored && entry.actual && (
        <>
          <ActualLine ko={entry.actual} home={entry.homeTeam} away={entry.awayTeam} />
          <div className="badges">
            <span className={`badge ${scored.p1 ? "hit" : "miss"}`}>Advance {scored.p1 ? "✓ +1" : "✗"}</span>
            <span className={`badge ${scored.p2 ? "hit" : "miss"}`}>90′ +{scored.p2}</span>
            <span className={`badge ${scored.p3 ? "hit" : "miss"}`}>ET +{scored.p3}</span>
            <span className="badge neutral">Total {scored.total}/7</span>
          </div>
        </>
      )}

      <button className="reason-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾ Hide reasoning" : "▸ Why these picks"}
      </button>
      {open && (
        <div className="reason">
          {entry.reasoning}
          <div className="meta">
            <span>model: {entry.modelVersion}</span>
            {entry.locked && entry.lockedAt && <span>locked</span>}
            {entry.webSearchUsed && <span>web search ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function KnockoutGame({ data }: { data: AppData }) {
  const game = data.knockoutGame;
  const entries = (game?.entries ?? []).slice().sort((a, b) => {
    // real entries first (by kickoff), examples last
    if (isExample(a) !== isExample(b)) return isExample(a) ? 1 : -1;
    return a.kickoff.localeCompare(b.kickoff);
  });

  return (
    <div>
      <header className="masthead">
        <h1>Beat the <span className="lime">Game</span></h1>
        <div className="sub">
          A private edge for the knockout-stage prediction game. Each match has <b>3 predictions</b> worth
          up to <b>7 points</b>; the machine EV-optimises each one separately.
        </div>
      </header>

      <div className="kg-rules">
        <div className="kg-rules-grid">
          <div><span className="kg-r-n">1</span> Who advances (after ET/pens) — <b>1 pt</b></div>
          <div><span className="kg-r-n">2</span> Score after 90′ — <b>3</b> exact / <b>1</b> outcome</div>
          <div><span className="kg-r-n">3</span> Score after extra time — <b>3</b>/<b>1</b>, only if ET is played</div>
        </div>
        <p className="kg-strategy">
          <b>The trick:</b> prediction 3 only scores when the match reaches extra time — which only happens
          when 90′ is a draw. So copying one scoreline into all three wastes a pick in every branch. Pred 2
          targets the most likely 90′ result; pred 3 targets the most likely 120′ result <i>given</i> it went
          to extra time. They’re allowed to contradict — and usually should.
        </p>
      </div>

      {game && game.summary.matchesScored > 0 && (
        <div className="board kg-summary">
          <div className="verdict">
            Machine’s haul
            <span className="tag machine">{game.summary.machinePoints} / {game.summary.maxPoints} pts</span>
          </div>
          <div className="strip">
            <span className="stat">Matches scored <b className="num">{game.summary.matchesScored}</b></span>
            <span className="stat">Avg <b className="num">{(game.summary.machinePoints / game.summary.matchesScored).toFixed(1)}</b>/7</span>
            <span className="stat">Expected total <b className="num">{game.summary.expectedTotal}</b></span>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="empty">Knockout entries appear here once the bracket is drawn (from 28 Jun).</div>
      ) : (
        <section>
          <div className="section-h">
            <h2>Recommended entries</h2>
            <span className="count">{entries.length}</span>
          </div>
          {entries.map((e) => <EntryCard key={e.fixtureId} entry={e} />)}
        </section>
      )}
    </div>
  );
}
