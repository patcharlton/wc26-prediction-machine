// One-off: run the Buzz Radar office sweepstake draw. Randomly deals all 48 teams
// across the 11 staff (4 people get 5 teams, 7 get 4) and writes data/sweepstake.json.
// The draw is FIXED once committed — re-running re-rolls it, so only run once.
//   tsx src/drawSweepstake.ts
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";
import { store } from "./store.js";

const PEOPLE = [
  "Marc B", "Marc C", "Patrick", "Olga", "Lynsey", "Theodora",
  "Jamie", "Vito", "Immo", "Marius", "Juan",
];

// Scoring (shown in the UI). Points per match + cumulative knockout-reach bonuses.
const SCORING = {
  win: 3,
  draw: 1,
  stageBonus: { R32: 1, R16: 3, QF: 6, SF: 10, Final: 15, Champion: 25 } as Record<string, number>,
};

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const standings = store.standings();
const teamGroup = new Map<string, string>();
for (const key of Object.keys(standings)) {
  const letter = key.slice(5);
  for (const row of standings[key]!) teamGroup.set(row.team, letter);
}
const teams = [...teamGroup.keys()];
if (teams.length !== 48) {
  console.warn(`⚠️ Expected 48 teams, found ${teams.length}. Draw will still proceed.`);
}

const shuffledTeams = shuffle(teams);
const order = shuffle(PEOPLE); // randomise who gets the extra team
const assignments = order.map((person) => ({ person, teams: [] as { name: string; group: string }[] }));
shuffledTeams.forEach((t, i) => {
  assignments[i % order.length]!.teams.push({ name: t, group: teamGroup.get(t) ?? "?" });
});

// store in original staff order for stable display; UI sorts by points
const byName = new Map(assignments.map((a) => [a.person, a]));
const ordered = PEOPLE.map((p) => byName.get(p)!);

const out = {
  title: "Buzz Radar Office Sweepstake",
  createdAt: new Date().toISOString(),
  stakes: "Bragging rights",
  people: PEOPLE,
  scoring: SCORING,
  assignments: ordered.map((a) => ({
    person: a.person,
    teams: a.teams.sort((x, y) => x.group.localeCompare(y.group)),
  })),
};

fs.writeFileSync(path.join(CONFIG.dataDir, "sweepstake.json"), JSON.stringify(out, null, 2) + "\n");

console.log("Sweepstake draw complete:\n");
for (const a of out.assignments) {
  console.log(`  ${a.person.padEnd(10)} ${a.teams.map((t) => `${t.name} (${t.group})`).join(", ")}`);
}
console.log(`\nWrote data/sweepstake.json (${teams.length} teams across ${PEOPLE.length} people).`);
