import { useEffect, useMemo, useState } from "react";
import type { AppData, Fixture, Matchday } from "./types";
import { loadAppData } from "./data";
import { Scoreboard } from "./components/Scoreboard";
import { WinnerBanner } from "./components/WinnerBanner";
import { MatchCard } from "./components/MatchCard";
import { GroupStandings } from "./components/Standings";
import { Sweepstake } from "./components/Sweepstake";
import { KnockoutGame } from "./components/KnockoutGame";
import { STAGE_LABEL, KO_ORDER, groupLetter } from "./format";

type View = "predictions" | "sweepstake" | "knockout-game";
function viewFromHash(): View {
  const h = window.location.hash.replace("#", "");
  if (h === "sweepstake") return "sweepstake";
  if (h === "knockout-game") return "knockout-game";
  return "predictions";
}

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
  const [view, setView] = useState<View>(viewFromHash());

  useEffect(() => {
    let alive = true;
    const load = () => loadAppData().then((d) => alive && setData(d));
    load();
    // Re-fetch periodically so the page reflects fresh data without a manual reload.
    const id = setInterval(load, 60_000);
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // Buzz Radar brand theme applies only on the sweepstake page.
  useEffect(() => {
    document.body.classList.toggle("brand-buzz", view === "sweepstake");
    return () => document.body.classList.remove("brand-buzz");
  }, [view]);

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
      {view === "predictions" && (
        <header className="masthead">
          <h1>
            WC2026<br />Prediction <span className="lime">Machine</span>
          </h1>
          <div className="sub">
            A self-updating machine that predicts every match and scores itself against the{" "}
            <b>betting market</b>. No manual input.
          </div>
        </header>
      )}

      {/* Sweepstake and knockout-game are unlisted on the main page — reachable only
          via their hash URLs. A back link is shown only while viewing them. */}
      {view !== "predictions" && (
        <nav className="tabs">
          <a className="tab" href="#predictions">← Back to Predictions</a>
        </nav>
      )}

      {view === "knockout-game" ? (
        <KnockoutGame data={data} />
      ) : view === "sweepstake" ? (
        <Sweepstake data={data} />
      ) : (
      <>
      {data.meta.notes && <div className="mocknote">{data.meta.notes}</div>}

      <Scoreboard ledger={data.ledger} />

      <WinnerBanner winner={data.winner} />

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
      </>
      )}

      {view === "predictions" && (
        <footer className="footer">
          <div>
            {lastUpdated ? <>Data last recomputed <code>{new Date(lastUpdated).toUTCString()}</code></> : "Awaiting first data run."}
          </div>
          <div>Machine = <span style={{ color: "var(--machine)" }}>lime</span> · Market = <span style={{ color: "var(--market)" }}>pink</span> · predictions locked ~2h before kickoff.</div>
        </footer>
      )}
    </div>
  );
}
