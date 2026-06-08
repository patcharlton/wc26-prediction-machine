// Add a late player to the sweepstake with minimal disruption: pull one random
// team from each of the largest squads until the new player reaches the even
// share. Everyone else keeps their teams. tsx src/addPlayer.ts "Paola"
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";

const NAME = process.argv[2] ?? "Paola";
const file = path.join(CONFIG.dataDir, "sweepstake.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));

if (data.people.includes(NAME)) {
  console.log(`${NAME} is already in the sweepstake.`);
  process.exit(0);
}

data.people.push(NAME);
const newcomer = { person: NAME, teams: [] as { name: string; group: string }[] };
data.assignments.push(newcomer);

const totalTeams = data.assignments.reduce((s: number, a: any) => s + a.teams.length, 0);
const target = Math.floor(totalTeams / data.people.length);
const rand = (n: number) => Math.floor(Math.random() * n);

while (newcomer.teams.length < target) {
  // donor = whoever currently has the most teams (excluding the newcomer)
  const donor = data.assignments
    .filter((a: any) => a.person !== NAME)
    .sort((x: any, y: any) => y.teams.length - x.teams.length)[0];
  const [team] = donor.teams.splice(rand(donor.teams.length), 1);
  newcomer.teams.push(team);
}
newcomer.teams.sort((a, b) => a.group.localeCompare(b.group));

fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

console.log(`Added ${NAME} (${newcomer.teams.map((t) => `${t.name} (${t.group})`).join(", ")})\n`);
console.log("Updated squads:");
for (const a of data.assignments) {
  console.log(`  ${a.person.padEnd(10)} ${a.teams.length} teams: ${a.teams.map((t: any) => t.name).join(", ")}`);
}
