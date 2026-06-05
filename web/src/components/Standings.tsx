import type { StandingRow } from "../types";

// Top 2 of each group qualify directly; 3rd may qualify as a best-third.
function rowClass(rank: number): string {
  return rank <= 2 ? "qualify" : "";
}

export function GroupStandings({ letter, rows }: { letter: string; rows: StandingRow[] }) {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  return (
    <div className="standings">
      <h3>Group {letter}</h3>
      <table className="tbl">
        <thead>
          <tr>
            <th className="team">Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.team} className={rowClass(r.rank)}>
              <td className="team">{r.team}</td>
              <td>{r.played}</td>
              <td>{r.win}</td>
              <td>{r.draw}</td>
              <td>{r.lose}</td>
              <td>{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
              <td className="pts">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
