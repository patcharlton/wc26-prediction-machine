import { useMemo, useState } from "react";
import type { AppData } from "../types";
import { computeSweepstake, type TeamStatus } from "../sweepstake";

const MEDALS = ["🥇", "🥈", "🥉"];

function statusDot(s: TeamStatus): string {
  return s === "champion" ? "champ" : s === "eliminated" ? "out" : s === "active" ? "live" : "pending";
}

export function Sweepstake({ data }: { data: AppData }) {
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const sweep = data.sweepstake;

  const result = useMemo(() => {
    if (!sweep) return null;
    return computeSweepstake(sweep, Object.values(data.results), data.fixtures);
  }, [sweep, data.results, data.fixtures]);

  if (!sweep || !result) {
    return <div className="empty">The sweepstake draw hasn't been published yet.</div>;
  }

  const sb = sweep.scoring.stageBonus;

  return (
    <div className="br-brand">
      <div className="br-masthead">
        <img className="br-logo" src={`${import.meta.env.BASE_URL}buzz-logo.svg`} alt="Buzz Radar" />
        <div className="br-tagline">World Cup 2026 · Office Sweepstake</div>
      </div>

      <div className="section-h">
        <h2>The Draw</h2>
        <span className="count">{sweep.people.length} players · {sweep.stakes}</span>
      </div>

      {/* Cup prize tracker — neutral until the final is actually played */}
      <div className="winner">
        <div className="winner-head">
          <span className="winner-label">🏆 Cup prize</span>
          <span className="winner-basis">{result.champion ? "decided" : "to be won"}</span>
        </div>
        {result.champion ? (
          <>
            <div className="winner-pick">
              <span className="winner-team">{result.championOwner ?? "—"}</span>
            </div>
            <div className="winner-sub">
              <span>won the cup with <b>{result.champion}</b> 🎉</span>
            </div>
          </>
        ) : (
          <div className="winner-sub">
            <span>Goes to whoever drew the team that lifts the trophy. To be decided once the final is played.</span>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      {result.rows.map((row, i) => {
        const open = openPerson === row.person;
        return (
          <div className={`card sweep-row ${result.started && i === 0 ? "leader" : ""}`} key={row.person}>
            <div className="sweep-top" onClick={() => setOpenPerson(open ? null : row.person)}>
              <span className="sweep-rank">{result.started ? (MEDALS[i] ?? `${i + 1}`) : "•"}</span>
              <span className="sweep-name">{row.person}</span>
              {result.started && (
                <span className="sweep-meta num">{row.teamsAlive} alive · {row.goalsFor} GF</span>
              )}
              <span className="sweep-points num">{row.points}<small>pts</small></span>
            </div>
            <div className="sweep-chips">
              {row.teams.map((t) => (
                <span className={`chip ${statusDot(t.status)}`} key={t.name} title={`${t.played} played · ${t.points} pts`}>
                  {t.name} <b>{t.points}</b>
                </span>
              ))}
            </div>
            {open && (
              <div className="reason">
                <table className="tbl">
                  <thead>
                    <tr><th className="team">Team</th><th>Grp</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>Pts</th></tr>
                  </thead>
                  <tbody>
                    {row.teams.map((t) => (
                      <tr key={t.name} className={t.status === "eliminated" ? "" : "qualify"}>
                        <td className="team">{t.name}{t.status === "champion" ? " 🏆" : t.status === "eliminated" ? " ✗" : ""}</td>
                        <td>{t.group}</td><td>{t.played}</td><td>{t.w}</td><td>{t.d}</td><td>{t.l}</td><td>{t.goalsFor}</td>
                        <td className="pts">{t.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* How points work */}
      <div className="standings" style={{ marginTop: 16 }}>
        <h3>How points work</h3>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.7, margin: 0 }}>
          Each of your teams earns <b>{sweep.scoring.win} pts</b> per win and <b>{sweep.scoring.draw}</b> per draw,
          in the group stage and knockouts. Knockout-reach bonuses stack up:
          R32 +{sb.R32}, R16 +{sb.R16}, QF +{sb.QF}, SF +{sb.SF}, Final +{sb.Final},
          and <b>lifting the cup +{sb.Champion}</b>. Ties broken by total goals scored, then teams still alive.
          The draw was random — chips turn <span style={{ color: "var(--machine)" }}>green</span> as teams win,
          grey when knocked out. Updates automatically as results come in.
        </p>
      </div>
    </div>
  );
}
