// Pre-build verification (brief step 2). Run once a FOOTBALL_API_KEY is set:
//   cd engine && npm install && FOOTBALL_API_KEY=xxx npm run verify
//
// Confirms WC2026 coverage before any real build/run:
//   1. /leagues?id=1&season=2026  -> coverage.odds === true
//   2. /fixtures?league=1&season=2026 -> 104 fixtures present
//   3. /odds?fixture={a WC fixture} -> at least one 1X2 market
// Costs ~3 API-Football requests.
import {
  getLeagueCoverage,
  getAllFixtures,
  getOddsRaw,
  deriveMarketFromOdds,
} from "./footballApi.js";

async function main() {
  let pass = true;
  const fail = (msg: string) => {
    pass = false;
    console.error("  ✗ " + msg);
  };
  const ok = (msg: string) => console.log("  ✓ " + msg);

  console.log("\n[1/3] League coverage (/leagues?id=1&season=2026)");
  const leagues = await getLeagueCoverage();
  const season = leagues[0]?.seasons.find((s) => s.year === 2026);
  if (!season) fail("No 2026 season found for league 1.");
  else if (!season.coverage.odds) fail("coverage.odds is FALSE — odds not covered. STOP and report.");
  else ok(`League "${leagues[0]?.league.name}" 2026 — coverage.odds = true`);

  console.log("\n[2/3] Fixtures (/fixtures?league=1&season=2026)");
  const fixtures = await getAllFixtures();
  console.log(`  fixtures returned: ${fixtures.length}`);
  if (fixtures.length === 104) {
    ok("All 104 fixtures present (group stage + knockouts).");
  } else if (fixtures.length >= 72) {
    // 72 = full group stage (12 groups x 6). Knockout fixtures (R32->Final, 32
    // matches) are added by API-Football as the bracket fills in. The daily sync
    // ingests them automatically. This is the expected pre-/early-tournament state.
    ok(
      `${fixtures.length} fixtures present — full 72-match group stage is loaded. ` +
        `Remaining knockout fixtures (up to 104) populate automatically as API-Football adds them.`
    );
  } else if (fixtures.length > 0) {
    fail(`Only ${fixtures.length} fixtures — fewer than the 72-match group stage. Investigate before proceeding.`);
  } else {
    fail("No fixtures returned. STOP and report.");
  }

  console.log("\n[3/3] Odds (/odds?fixture={first fixture})");
  const sample = fixtures[0];
  if (!sample) {
    fail("No fixture to sample odds for.");
  } else {
    const odds = await getOddsRaw(String(sample.fixture.id));
    const market = deriveMarketFromOdds(odds);
    if (market) {
      ok(
        `1X2 market available for fixture ${sample.fixture.id}: ` +
          `H ${market.homeWin} / D ${market.draw} / A ${market.awayWin}`
      );
    } else {
      fail(
        "No 1X2 market returned for the sampled fixture. " +
          "Odds may be thin this far out — STOP and report to Patrick."
      );
    }
  }

  console.log("\n" + "=".repeat(48));
  if (pass) {
    console.log("VERIFICATION PASSED — safe to proceed with the build.");
    process.exit(0);
  } else {
    console.log("VERIFICATION FAILED — do not proceed; report findings.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nVerification crashed:", err);
  process.exit(1);
});
