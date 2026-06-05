// API-Football (v3, direct api-sports.io host) wrapper.
// FREE TIER — 100 req/day hard cap. Every call goes through `request()` which
// counts against a persisted daily budget and refuses to exceed the soft cap.
import { CONFIG, FOOTBALL_BASE, requireSecret } from "./config.js";
import { store } from "./store.js";
import type { MarketTriple } from "./types.js";

interface ApiResponse<T> {
  get: string;
  parameters: Record<string, unknown>;
  errors: unknown;
  results: number;
  paging?: { current: number; total: number };
  response: T;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Read + roll over the persisted daily request counter.
function bumpRequestCount(): number {
  const meta = store.meta();
  const today = todayUtc();
  if (meta.apiFootball.dayUtc !== today) {
    meta.apiFootball.dayUtc = today;
    meta.apiFootball.requestsToday = 0;
    meta.apiFootball.lastResetAt = new Date().toISOString();
  }
  meta.apiFootball.requestsToday += 1;
  store.saveMeta(meta);
  return meta.apiFootball.requestsToday;
}

export class RequestBudgetError extends Error {}

async function request<T>(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const key = requireSecret("footballApiKey");
  const count = bumpRequestCount();
  if (count > CONFIG.dailyRequestSoftCap) {
    throw new RequestBudgetError(
      `API-Football soft cap reached (${count}/${CONFIG.dailyRequestSoftCap} today). ` +
        `Aborting to protect the 100/day free-tier limit.`
    );
  }

  const url = new URL(FOOTBALL_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, { headers: { "x-apisports-key": key } });
  const remaining = res.headers.get("x-ratelimit-requests-remaining");
  if (remaining !== null) {
    console.log(`[api-football] ${endpoint} — daily remaining (provider): ${remaining}`);
  }
  if (!res.ok) {
    throw new Error(`API-Football ${endpoint} HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as ApiResponse<T>;
  const errs = body.errors;
  const hasErrors =
    (Array.isArray(errs) && errs.length > 0) ||
    (errs && typeof errs === "object" && Object.keys(errs).length > 0);
  if (hasErrors) {
    throw new Error(`API-Football ${endpoint} returned errors: ${JSON.stringify(errs)}`);
  }
  return body.response;
}

// ---------- raw endpoints (each = 1 request) ----------

export interface RawLeague {
  league: { id: number; name: string };
  seasons: Array<{
    year: number;
    coverage: { odds: boolean; fixtures: Record<string, boolean>; standings: boolean };
  }>;
}

export function getLeagueCoverage() {
  return request<RawLeague[]>("/leagues", {
    id: CONFIG.leagueId,
    season: CONFIG.season,
  });
}

export interface RawFixture {
  fixture: {
    id: number;
    date: string; // ISO with tz
    status: { short: string; long: string; elapsed: number | null };
    venue: { name: string | null; city: string | null };
  };
  league: { round: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

export function getAllFixtures() {
  return request<RawFixture[]>("/fixtures", {
    league: CONFIG.leagueId,
    season: CONFIG.season,
  });
}

// Live fixtures for this league only (API-Football v3 uses ?live=all then filter,
// but league+season+live is supported and cheaper).
export function getLiveFixtures() {
  return request<RawFixture[]>("/fixtures", { live: "all" });
}

export interface RawStandingsGroup {
  league: {
    standings: Array<
      Array<{
        rank: number;
        team: { id: number; name: string };
        points: number;
        group: string;
        all: {
          played: number;
          win: number;
          draw: number;
          lose: number;
          goals: { for: number; against: number };
        };
        goalsDiff: number;
      }>
    >;
  };
}

export function getStandings() {
  return request<RawStandingsGroup[]>("/standings", {
    league: CONFIG.leagueId,
    season: CONFIG.season,
  });
}

interface RawOdds {
  bookmakers: Array<{
    id: number;
    name: string;
    bets: Array<{ id: number; name: string; values: Array<{ value: string; odd: string }> }>;
  }>;
}

export function getOddsRaw(fixtureId: string) {
  return request<RawOdds[]>("/odds", {
    fixture: fixtureId,
    league: CONFIG.leagueId,
    season: CONFIG.season,
  });
}

// ---------- helpers ----------

// Map API-Football status.short codes to our coarse status.
// https://www.api-football.com/documentation-v3#operation/get-fixtures
const LIVE = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT"]);
const FINISHED = new Set(["FT", "AET", "PEN", "WO", "AWD"]);

export function normalizeStatus(short: string): "scheduled" | "live" | "finished" {
  if (FINISHED.has(short)) return "finished";
  if (LIVE.has(short)) return "live";
  return "scheduled";
}

// Parse "Group Stage - 2" / "2nd Round" / "Round of 32" etc into matchday number.
export function parseMatchday(round: string): "MD1" | "MD2" | "MD3" | null {
  const m = round.match(/-\s*(\d)\s*$/);
  if (m) {
    const n = Number(m[1]);
    if (n === 1) return "MD1";
    if (n === 2) return "MD2";
    if (n === 3) return "MD3";
  }
  return null;
}

export function isGroupStageRound(round: string): boolean {
  return /group/i.test(round);
}

// De-vig a 1X2 bookmaker market into a normalised probability triple.
// Picks the first bookmaker that offers the "Match Winner" (1X2) bet.
export function deriveMarketFromOdds(raw: RawOdds[]): MarketTriple | null {
  for (const book of raw[0]?.bookmakers ?? raw.flatMap((r) => r.bookmakers ?? [])) {
    const bet = book.bets.find(
      (b) => b.id === 1 || /match winner|1x2|full time result/i.test(b.name)
    );
    if (!bet) continue;
    const find = (labels: RegExp) =>
      bet.values.find((v) => labels.test(v.value))?.odd;
    const home = find(/^home$|^1$/i);
    const draw = find(/^draw$|^x$/i);
    const away = find(/^away$|^2$/i);
    if (!home || !draw || !away) continue;
    const ih = 1 / Number(home);
    const id = 1 / Number(draw);
    const ia = 1 / Number(away);
    const sum = ih + id + ia;
    if (!isFinite(sum) || sum <= 0) continue;
    return {
      homeWin: round3(ih / sum),
      draw: round3(id / sum),
      awayWin: round3(ia / sum),
      source: "book",
    };
  }
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
