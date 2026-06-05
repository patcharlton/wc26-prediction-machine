// Official FIFA WC2026 knockout bracket structure.
//
// Source: FIFA 2026 knockout-stage match schedule (matches 73-104), cross-checked
// against the Wikipedia "2026 FIFA World Cup knockout stage" bracket. The slot
// definitions below (group winners / runners-up and the per-slot eligible groups
// for third-placed teams) are the OFFICIAL published structure — not invented.
//
// The ONE thing that cannot be hardcoded honestly is FIFA's "Annex C" table: the
// 495-combination lookup that maps *which 8 of the 12 groups* produced qualifying
// third-placed teams to *which* third-place slot each fills. That table is not
// reproduced here. Instead:
//   - we encode the official per-slot eligibility (each 3rd-place slot may only be
//     filled by a third from one of 5 named groups), and
//   - resolve thirds with a constraint-respecting bipartite matching as a fallback.
// In normal operation API-Football provides the real team names for knockout
// fixtures once the draw resolves, and those ALWAYS override our fallback. The
// fallback only fills gaps before API-Football publishes them.
//
// To use the exact official assignment, drop FIFA's Annex C table into
// data/thirds-allocation.json (see THIRDS_TABLE_NOTE) and the resolver will prefer it.

import type { Stage, Standings, StandingRow } from "./types.js";

export const THIRDS_TABLE_NOTE =
  "Optional: data/thirds-allocation.json maps a sorted 8-group key " +
  '(e.g. "ABCDEFGH") to { matchNumber: groupLetter }. If absent, a ' +
  "constraint-respecting matching is used and API-Football team names override.";

export interface SlotMatch {
  match: number;
  stage: Stage;
  home: string; // slot token
  away: string; // slot token
}

// Slot tokens:
//   "W:A"  winner of group A
//   "RU:A" runner-up of group A
//   "3:A/B/C/D/F" a third-placed team from one of these groups
//   "WM:73" winner of match 73   "LM:101" loser of match 101
export const R32: SlotMatch[] = [
  { match: 73, stage: "R32", home: "RU:A", away: "RU:B" },
  { match: 74, stage: "R32", home: "W:E", away: "3:A/B/C/D/F" },
  { match: 75, stage: "R32", home: "W:F", away: "RU:C" },
  { match: 76, stage: "R32", home: "W:C", away: "RU:F" },
  { match: 77, stage: "R32", home: "W:I", away: "3:C/D/F/G/H" },
  { match: 78, stage: "R32", home: "RU:E", away: "RU:I" },
  { match: 79, stage: "R32", home: "W:A", away: "3:C/E/F/H/I" },
  { match: 80, stage: "R32", home: "W:L", away: "3:E/H/I/J/K" },
  { match: 81, stage: "R32", home: "W:D", away: "3:B/E/F/I/J" },
  { match: 82, stage: "R32", home: "W:G", away: "3:A/E/H/I/J" },
  { match: 83, stage: "R32", home: "RU:K", away: "RU:L" },
  { match: 84, stage: "R32", home: "W:H", away: "RU:J" },
  { match: 85, stage: "R32", home: "W:B", away: "3:E/F/G/I/J" },
  { match: 86, stage: "R32", home: "W:J", away: "RU:H" },
  { match: 87, stage: "R32", home: "W:K", away: "3:D/E/I/J/L" },
  { match: 88, stage: "R32", home: "RU:D", away: "RU:G" },
];

export const KO_FEED: SlotMatch[] = [
  // Round of 16 (89-96)
  { match: 89, stage: "R16", home: "WM:74", away: "WM:77" },
  { match: 90, stage: "R16", home: "WM:73", away: "WM:75" },
  { match: 91, stage: "R16", home: "WM:76", away: "WM:78" },
  { match: 92, stage: "R16", home: "WM:79", away: "WM:80" },
  { match: 93, stage: "R16", home: "WM:83", away: "WM:84" },
  { match: 94, stage: "R16", home: "WM:81", away: "WM:82" },
  { match: 95, stage: "R16", home: "WM:86", away: "WM:88" },
  { match: 96, stage: "R16", home: "WM:85", away: "WM:87" },
  // Quarter-finals (97-100)
  { match: 97, stage: "QF", home: "WM:89", away: "WM:90" },
  { match: 98, stage: "QF", home: "WM:93", away: "WM:94" },
  { match: 99, stage: "QF", home: "WM:91", away: "WM:92" },
  { match: 100, stage: "QF", home: "WM:95", away: "WM:96" },
  // Semi-finals (101-102)
  { match: 101, stage: "SF", home: "WM:97", away: "WM:98" },
  { match: 102, stage: "SF", home: "WM:99", away: "WM:100" },
  // 3rd-place play-off (103) and Final (104). Stored under "Final" stage.
  { match: 103, stage: "Final", home: "LM:101", away: "LM:102" },
  { match: 104, stage: "Final", home: "WM:101", away: "WM:102" },
];

export const ALL_KO: SlotMatch[] = [...R32, ...KO_FEED];

const GROUPS = ["A","B","C","D","E","F","G","H","I","J","K","L"];

// Per-slot eligible groups for third-placed teams, parsed from R32 above.
export function thirdsEligibility(): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const m of R32) {
    for (const slot of [m.home, m.away]) {
      if (slot.startsWith("3:")) out[m.match] = slot.slice(2).split("/");
    }
  }
  return out;
}

// ---- standings -> qualifiers ----
function groupKey(letter: string): string {
  return "group" + letter;
}

export interface Qualifiers {
  winners: Record<string, string>; // "A" -> team name
  runnersUp: Record<string, string>;
  // The 8 best third-placed teams, ranked best-first, each tagged with its group.
  bestThirds: Array<{ group: string; team: string; row: StandingRow }>;
}

// Rank third-placed teams across groups: points, then goal difference, then goals
// for (FIFA tie-breaker order; head-to-head between different groups is N/A).
export function computeQualifiers(standings: Standings): Qualifiers | null {
  const winners: Record<string, string> = {};
  const runnersUp: Record<string, string> = {};
  const thirds: Array<{ group: string; team: string; row: StandingRow }> = [];

  for (const letter of GROUPS) {
    const rows = standings[groupKey(letter)];
    if (!rows || rows.length < 3) return null; // groups not fully resolved yet
    const sorted = [...rows].sort((a, b) => a.rank - b.rank);
    winners[letter] = sorted[0]!.team;
    runnersUp[letter] = sorted[1]!.team;
    thirds.push({ group: letter, team: sorted[2]!.team, row: sorted[2]! });
  }

  thirds.sort(
    (a, b) =>
      b.row.points - a.row.points ||
      b.row.goalDiff - a.row.goalDiff ||
      b.row.goalsFor - a.row.goalsFor
  );
  return { winners, runnersUp, bestThirds: thirds.slice(0, 8) };
}

// Assign the 8 qualifying thirds to the 8 third-place slots, respecting each
// slot's official eligibility. Prefers FIFA's Annex C table when provided.
function assignThirds(
  qualifiers: Qualifiers,
  annexC: Record<string, Record<string, string>> | null
): Record<number, string> {
  const elig = thirdsEligibility();
  const slots = Object.keys(elig).map(Number).sort((a, b) => a - b);
  const qualifyingGroups = qualifiers.bestThirds.map((t) => t.group).sort();
  const key = qualifyingGroups.join("");

  // Official table path.
  const official = annexC?.[key];
  if (official) {
    const out: Record<number, string> = {};
    for (const m of slots) {
      const g = official[String(m)];
      const t = qualifiers.bestThirds.find((x) => x.group === g);
      if (t) out[m] = t.team;
    }
    if (Object.keys(out).length === slots.length) return out;
    // fall through to matching if the table row was malformed
  }

  // Fallback: backtracking assignment that respects eligibility. Process the most
  // constrained slots first (fewest eligible groups) to find a valid matching fast.
  const available = new Set(qualifyingGroups);
  const result: Record<number, string> = {};
  const groupToTeam = new Map(qualifiers.bestThirds.map((t) => [t.group, t.team]));
  const ordered = [...slots].sort((a, b) => elig[a]!.length - elig[b]!.length);

  function backtrack(i: number): boolean {
    if (i === ordered.length) return true;
    const slot = ordered[i]!;
    for (const g of elig[slot]!) {
      if (!available.has(g)) continue;
      available.delete(g);
      result[slot] = groupToTeam.get(g)!;
      if (backtrack(i + 1)) return true;
      available.add(g);
      delete result[slot];
    }
    return false;
  }
  backtrack(0);
  return result;
}

// Resolve every knockout slot token to a concrete team name (where determinable).
// `winnersByMatch` carries actual results once knockout matches finish.
export function resolveSlots(
  standings: Standings,
  winnersByMatch: Record<number, { winner: string; loser: string }>,
  annexC: Record<string, Record<string, string>> | null = null
): Record<string, string> {
  const out: Record<string, string> = {};
  const q = computeQualifiers(standings);
  if (q) {
    for (const [letter, team] of Object.entries(q.winners)) out["W:" + letter] = team;
    for (const [letter, team] of Object.entries(q.runnersUp)) out["RU:" + letter] = team;
    const thirds = assignThirds(q, annexC);
    for (const m of R32) {
      if (m.away.startsWith("3:")) out[m.away] = thirds[m.match] ?? out[m.away] ?? m.away;
      if (m.home.startsWith("3:")) out[m.home] = thirds[m.match] ?? out[m.home] ?? m.home;
    }
  }
  for (const [match, r] of Object.entries(winnersByMatch)) {
    out["WM:" + match] = r.winner;
    out["LM:" + match] = r.loser;
  }
  return out;
}

export function resolveTeam(slot: string, resolved: Record<string, string>): string {
  return resolved[slot] ?? slotLabel(slot);
}

// Human-readable label for an unresolved slot (shown in the UI as a placeholder).
export function slotLabel(slot: string): string {
  if (slot.startsWith("W:")) return `Winner Group ${slot.slice(2)}`;
  if (slot.startsWith("RU:")) return `Runner-up Group ${slot.slice(3)}`;
  if (slot.startsWith("3:")) return `3rd Group ${slot.slice(2)}`;
  if (slot.startsWith("WM:")) return `Winner Match ${slot.slice(3)}`;
  if (slot.startsWith("LM:")) return `Loser Match ${slot.slice(3)}`;
  return slot;
}
