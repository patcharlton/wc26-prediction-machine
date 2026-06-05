import { useEffect, useMemo, useState } from "react";
import type { AppData, Fixture, Matchday } from "./types";
import { loadAppData } from "./data";
import { Scoreboard } from "./components/Scoreboard";
import { MatchCard } from "./components/MatchCard";
import { GroupStandings } from "./components/Standings";
import { STAGE_LABEL, KO_ORDER, groupLetter } from "./format";

const MD_LABEL: Record<Matchday, string> = {
  MD1: "Matchday 1",
  MD2: "Matchday 2",
  MD3: "Matchday 3",
};

function byKickoff(a: Fixture, b: Fixture) {
  return a.kickoff.localeCompare(b.kickoff);
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => loadAppData().then((d) => alive && setData(d));
    load();
    // Re-fetch periodically so the page reflects fresh data without a manual reload.
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const sections = useMemo(() => {
    if (!data) return null;
    const group = data.fixtures.filter((f) => f.stage.startsWith("group"));
    const byMatchday: Record<Matchday, Fixture[]> = { MD1: [], MD2: [], MD3: [] };
    for (const f of group) {
      const md = (f.matchday ?? "MD1") as Matchday;
      byMatchday[md].push(f);
    }
    const ko: Record<string, Fixture[]> = {};
    for (const f of data.fixtures.filter((x) => !x.stage.startsWith("group"))) {
      (ko[f.stage] ??= []).push(f);
    }
    return { byMatchday, ko };
  }, [data]);

  if (!data) return <div className="wrap"><div className="loading">Loading the machine…</div></div>;
  if (!sections) return null;

  const card = (f: Fixture) => (
    <MatchCard
      key={f.fixtureId}
      fixture={f}
      prediction={data.predictions[f.fixtureId]}
      result={data.results[f.fixtureId]}
    />
  );

  const groupKeys = Object.keys(data.standings).sort();
  const lastUpdated = data.ledger?.lastUpdatedAt;

  return (
    <div className="wrap">
      <header className="masthead">
        <h1>
          WC2026<br />Prediction <span className="lime">Machine</span>
        </h1>
        <div className="sub">
          A self-updating machine that predicts every match and scores itself against the{" "}
          <b>betting market</b>. No manual input.
        </div>
      </header>

      {data.meta.notes && <div className="mocknote">{data.meta.notes}</div>}

      <Scoreboard ledger={data.ledger} />

      {/* Group stage by matchday */}
      {(Object.keys(MD_LABEL) as Matchday[]).map((md) => {
        const fixtures = sections.byMatchday[md].sort(byKickoff);
        if (!fixtures.length) return null;
        return (
          <section key={md}>
            <div className="section-h">
              <h2>{MD_LABEL[md]}</h2>
              <span className="count">{fixtures.length} matches</span>
            </div>
            {fixtures.map(card)}
          </section>
        );
      })}

      {/* Knockout rounds */}
      {KO_ORDER.map((stage) => {
        const fixtures = (sections.ko[stage] ?? []).sort(byKickoff);
        if (!fixtures.length) return null;
        return (
          <section key={stage}>
            <div className="section-h">
              <h2>{STAGE_LABEL[stage] ?? stage}</h2>
              <span className="count">{fixtures.length} matches</span>
            </div>
            {fixtures.map(card)}
          </section>
        );
      })}

      {/* Standings */}
      {groupKeys.length > 0 && (
        <section>
          <div className="section-h">
            <h2>Group Standings</h2>
            <span className="count">{groupKeys.length} groups</span>
          </div>
          {groupKeys.map((key) => {
            const letter = groupLetter(key as Fixture["stage"]) ?? key.slice(5);
            return <GroupStandings key={key} letter={letter} rows={data.standings[key]!} />;
          })}
        </section>
      )}

      <footer className="footer">
        <div>
          {lastUpdated ? <>Data last recomputed <code>{new Date(lastUpdated).toUTCString()}</code></> : "Awaiting first data run."}
        </div>
        <div>Machine = <span style={{ color: "var(--machine)" }}>lime</span> · Market = <span style={{ color: "var(--market)" }}>pink</span> · predictions locked ~2h before kickoff.</div>
      </footer>
    </div>
  );
}
