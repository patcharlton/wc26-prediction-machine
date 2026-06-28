// Copy the repo's /data/*.json into web/public/data so the static build (and the
// dev server) can fetch them. Runs before dev/build. The data files are the
// single source of truth, written by the engine and committed to the repo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../data");
const dest = path.resolve(here, "../public/data");

fs.mkdirSync(dest, { recursive: true });

const files = [
  "fixtures.json",
  "predictions.json",
  "results.json",
  "ledger.json",
  "standings.json",
  "meta.json",
  "winner.json",
  "sweepstake.json",
  "knockout-game.json",
];

let copied = 0;
for (const f of files) {
  const from = path.join(src, f);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(dest, f));
    copied++;
  } else {
    // write an empty placeholder so fetches don't 404 before the first cron run
    const objFiles = ["ledger.json", "meta.json", "standings.json", "winner.json", "sweepstake.json", "knockout-game.json"];
    const fallback = objFiles.includes(f) ? "{}" : "[]";
    fs.writeFileSync(path.join(dest, f), fallback);
  }
}
console.log(`[copy-data] copied ${copied}/${files.length} data files into web/public/data`);
