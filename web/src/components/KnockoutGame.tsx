import { useEffect, useState } from "react";
import type { AppData, Fixture, KnockoutEntry, KoScore } from "../types";
import { STAGE_LABEL, kickoffLabel } from "../format";

const sc = (s: { home: number; away: number }) => `${s.home}–${s.away}`;
const isExample = (e: KnockoutEntry) => e.modelVersion === "illustrative-example" || e.fixtureId.startsWith("example-");

const HOUR = 3600_000;
const WINDOW_H = 48; // predictions generate once a match is within 48h of kickoff

// Live countdown string, e.g. "2d 06h 14m" or "47m 09s".
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p: string[] = [];
  if (d) p.push(`${d}d`);
  if (d || h) p.push(`${String(h).padStart(2, "0")}h`);
  p.push(`${String(m).padStart(2, "0")}m`);
  if (!d) p.push(`${String(sec).padStart(2, "0")}s`);
  return p.join(" ");
}

function isPlaceholder(name: string): boolean {
  return /winner|runner|loser|^3rd|tbd|to be determined|\//i.test(name);
}

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

function CountdownCard({ fixture, now }: { fixture: Fixture; now: number }) {
  const kickoffMs = Date.parse(fixture.kickoff);
  const availableAt = kickoffMs - WINDOW_H * HOUR;
  const within = now >= availableAt;
  return (
    <div className="card kg-pending">
      <div className="top">
        <span className="status">{STAGE_LABEL[fixture.stage] ?? fixture.stage} · {kickoffLabel(fixture.kickoff)}</span>
      </div>
      <div className="kg-teams">
        <span className={`name ${isPlaceholder(fixture.homeTeam) ? "placeholder" : ""}`}>{fixture.homeTeam}</span>
        <span className="kg-vs">v</span>
        <span className={`name ${isPlaceholder(fixture.awayTeam) ? "placeholder" : ""}`} style={{ textAlign: "right" }}>{fixture.awayTeam}</span>
      </div>
      <div className="kg-countdown">
        {within ? (
          <><span className="kg-cd-label">Unlocking now</span> — picks generate at the next 6-hourly update.</>
        ) : (
          <>
            <span className="kg-cd-label">Pick unlocks in</span>
            <span className="kg-cd-time num">{fmtCountdown(availableAt - now)}</span>
            <span className="kg-cd-sub">(48 h before kickoff)</span>
          </>
        )}
      </div>
    </div>
  );
}

export function KnockoutGame({ data }: { data: AppData }) {
  // Tick once a second so the countdowns are live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const game = data.knockoutGame;
  const entries = (game?.entries ?? []).slice().sort((a, b) => {
    // real entries first (by kickoff), examples last
    if (isExample(a) !== isExample(b)) return isExample(a) ? 1 : -1;
    return a.kickoff.localeCompare(b.kickoff);
  });
  const entryIds = new Set(entries.map((e) => e.fixtureId));

  // Knockout fixtures still awaiting a pick (with a live countdown to when it unlocks).
  const upcoming = data.fixtures
    .filter((f) => !f.stage.startsWith("group") && f.status === "scheduled" && !entryIds.has(f.fixtureId))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

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
        <p className="kg-update">
          <b>When picks update:</b> the machine generates a match’s three predictions once it’s within
          <b> 48 hours</b> of kickoff (checked every 6 hours), <b>locks</b> them ~2 hours before kickoff with
          the market frozen, then <b>self-scores</b> them within ~15 minutes of full time. No manual input —
          the page refreshes itself.
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

          {game.summary.calibration && (
            <div className="kg-calib">
              <table className="tbl">
                <thead>
                  <tr><th className="team">Calibration</th><th>Expected</th><th>Realised</th><th>Δ</th></tr>
                </thead>
                <tbody>
                  {([
                    ["① Advance", game.summary.calibration.expected.p1, game.summary.calibration.realised.p1],
                    ["② After 90′", game.summary.calibration.expected.p2, game.summary.calibration.realised.p2],
                    ["③ After ET", game.summary.calibration.expected.p3, game.summary.calibration.realised.p3],
                    ["Total", game.summary.calibration.expected.total, game.summary.calibration.realised.total],
                  ] as [string, number, number][]).map(([label, exp, real]) => {
                    const d = Math.round((real - exp) * 100) / 100;
                    return (
                      <tr key={label}>
                        <td className="team">{label}</td>
                        <td>{exp.toFixed(2)}</td>
                        <td>{real}</td>
                        <td className={d > 0 ? "kg-cal-up" : d < 0 ? "kg-cal-down" : ""}>
                          {d > 0 ? `+${d}` : d}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="kg-cal-note">
                Realised persistently above expected = model too cautious; below = overconfident.
                Watch the <b>③ ET row</b> — it tracks whether the draw probabilities are honest.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upcoming knockout fixtures with no pick yet — live countdown to unlock */}
      {upcoming.length > 0 && (
        <section>
          <div className="section-h">
            <h2>Coming up</h2>
            <span className="count">{upcoming.length} awaiting picks</span>
          </div>
          {upcoming.map((f) => <CountdownCard key={f.fixtureId} fixture={f} now={now} />)}
        </section>
      )}

      {entries.length === 0 ? (
        upcoming.length === 0 && (
          <div className="empty">Knockout entries appear here once the bracket is drawn (from 28 Jun).</div>
        )
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
