// Mock API-Football v3 responses, shaped to the documented schema, so we can test
// the normalisation + accuracy + bracket code paths offline (no live calls, no key).
import type { RawFixture, RawStandingsGroup } from "../src/footballApi.js";

// /odds?fixture=... -> response[]. Bet id 1 = "Match Winner" (1X2).
export const oddsResponse = [
  {
    bookmakers: [
      {
        id: 8,
        name: "Bet365",
        bets: [
          {
            id: 1,
            name: "Match Winner",
            values: [
              { value: "Home", odd: "1.80" },
              { value: "Draw", odd: "3.50" },
              { value: "Away", odd: "4.50" },
            ],
          },
        ],
      },
    ],
  },
];

// /standings?league=1&season=2026 -> response[0].league.standings is an array of groups.
export const standingsResponse: RawStandingsGroup[] = [
  {
    league: {
      standings: [
        [
          row(1, 16, "Mexico", "Group A", 3, 3, 0, 0, 6, 1, 9),
          row(2, 3, "Croatia", "Group A", 3, 2, 0, 1, 4, 3, 6),
          row(3, 2382, "Ecuador", "Group A", 3, 1, 0, 2, 2, 4, 3),
          row(4, 1530, "South Africa", "Group A", 3, 0, 0, 3, 1, 5, 0),
        ],
        [
          row(1, 1, "Belgium", "Group B", 3, 2, 1, 0, 5, 2, 7),
          row(2, 31, "Morocco", "Group B", 3, 2, 0, 1, 4, 2, 6),
          row(3, 1569, "Canada", "Group B", 3, 1, 0, 2, 3, 4, 3),
          row(4, 1568, "Uzbekistan", "Group B", 3, 0, 1, 2, 1, 5, 1),
        ],
      ],
    },
  },
];

function row(
  rank: number, id: number, name: string, group: string,
  played: number, win: number, draw: number, lose: number,
  gf: number, ga: number, points: number
) {
  return {
    rank, team: { id, name }, points, group,
    all: { played, win, draw, lose, goals: { for: gf, against: ga } },
    goalsDiff: gf - ga,
  };
}

export function fixture(
  id: number, round: string, homeId: number, homeName: string,
  awayId: number, awayName: string, date: string,
  short = "NS", gh: number | null = null, ga: number | null = null,
  elapsed: number | null = null
): RawFixture {
  return {
    fixture: {
      id, date,
      status: { short, long: short, elapsed },
      venue: { name: "Estadio Azteca", city: "Mexico City" },
    },
    league: { round },
    teams: { home: { id: homeId, name: homeName }, away: { id: awayId, name: awayName } },
    goals: { home: gh, away: ga },
  };
}

export const fixturesResponse: RawFixture[] = [
  // group stage, finished
  fixture(2000, "Group Stage - 1", 16, "Mexico", 3, "Croatia", "2026-06-11T18:00:00+00:00", "FT", 2, 0),
  // group stage, live
  fixture(2001, "Group Stage - 2", 16, "Mexico", 2382, "Ecuador", "2026-06-16T18:00:00+00:00", "2H", 1, 0, 67),
  // group stage, scheduled
  fixture(2002, "Group Stage - 3", 1530, "South Africa", 16, "Mexico", "2026-06-21T18:00:00+00:00", "NS"),
  // knockout placeholder (teams TBD)
  fixture(2073, "Round of 32", 0, "Runner-up Group A", 0, "Runner-up Group B", "2026-06-28T20:00:00+00:00", "NS"),
];
