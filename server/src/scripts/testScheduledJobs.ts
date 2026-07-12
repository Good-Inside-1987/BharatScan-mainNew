/**
 * Manual test: trigger all three new scheduled jobs and verify cleanup works.
 * Run with: pnpm --filter @workspace/server exec tsx src/scripts/testScheduledJobs.ts
 */

import { marketDb } from "../db.js";
import { runFoBanListJob } from "../services/foBanListService.js";
import { runSupplementaryJob, runMfHoldingsJob } from "../services/supplementaryJobs.js";
import { runCleanupJob } from "../services/cleanupJob.js";

function section(title: string) {
  console.log(`\n${"─".repeat(60)}\n  ${title}\n${"─".repeat(60)}`);
}

async function main() {
  // ── 1. F&O Ban List ──────────────────────────────────────────────
  section("1. F&O Ban List Job");
  try {
    const result = await runFoBanListJob();
    console.log("Result:", result);
    const count = (marketDb
      .prepare(`SELECT COUNT(*) as n FROM fo_ban_list WHERE date = ?`)
      .get(result.date) as { n: number }).n;
    console.log(`✓ fo_ban_list rows for ${result.date}: ${count}`);
  } catch (err) {
    console.error("✗ F&O ban list job threw:", err instanceof Error ? err.message : err);
  }

  // ── 2. Supplementary (FII/DII + PE) ──────────────────────────────
  section("2. Supplementary Job (FII/DII + PE ratios)");
  try {
    const result = await runSupplementaryJob();
    console.log("Result:", result);
    const fiiCount = (marketDb
      .prepare(`SELECT COUNT(*) as n FROM fii_dii WHERE date = ?`)
      .get(result.date) as { n: number }).n;
    const peCount = (marketDb
      .prepare(`SELECT COUNT(*) as n FROM pe_ratio WHERE date = ?`)
      .get(result.date) as { n: number }).n;
    console.log(`✓ fii_dii rows for ${result.date}: ${fiiCount}`);
    console.log(`✓ pe_ratio rows for ${result.date}: ${peCount}`);
  } catch (err) {
    console.error("✗ Supplementary job threw:", err instanceof Error ? err.message : err);
  }

  // ── 3. MF Holdings ───────────────────────────────────────────────
  section("3. MF Holdings Job");
  try {
    const result = await runMfHoldingsJob();
    console.log("Result:", result);
    const count = (marketDb
      .prepare(`SELECT COUNT(*) as n FROM mf_holdings WHERE month_year = ?`)
      .get(result.monthYear) as { n: number }).n;
    console.log(`✓ mf_holdings rows for ${result.monthYear}: ${count}`);
  } catch (err) {
    console.error("✗ MF holdings job threw:", err instanceof Error ? err.message : err);
  }

  // ── 4. Cleanup retention test ────────────────────────────────────
  section("4. Cleanup Job — retention test");

  // Insert a clearly ancient row into ohlcv_daily (50 years ago)
  const ancientDate = "1975-01-15";
  const recentDate  = new Date().toISOString().slice(0, 10); // today
  try {
    marketDb.prepare(
      `INSERT OR IGNORE INTO ohlcv_daily (symbol, date, open, high, low, close, volume)
       VALUES ('TEST_CLEANUP_ROW', ?, 100, 110, 90, 105, 1000)`
    ).run(ancientDate);

    // Also insert a recent row that must survive
    marketDb.prepare(
      `INSERT OR IGNORE INTO ohlcv_daily (symbol, date, open, high, low, close, volume)
       VALUES ('TEST_CLEANUP_ROW', ?, 100, 110, 90, 105, 1000)`
    ).run(recentDate);

    const beforeOld = (marketDb
      .prepare(`SELECT COUNT(*) as n FROM ohlcv_daily WHERE symbol = ? AND date = ?`)
      .get("TEST_CLEANUP_ROW", ancientDate) as { n: number }).n;
    console.log(`Before cleanup — ancient row present: ${beforeOld === 1 ? "YES ✓" : "NO ✗"}`);

    const cleanupResult = await runCleanupJob();
    console.log("Cleanup result:", cleanupResult);

    const afterOld = (marketDb
      .prepare(`SELECT COUNT(*) as n FROM ohlcv_daily WHERE symbol = ? AND date = ?`)
      .get("TEST_CLEANUP_ROW", ancientDate) as { n: number }).n;
    const afterRecent = (marketDb
      .prepare(`SELECT COUNT(*) as n FROM ohlcv_daily WHERE symbol = ? AND date = ?`)
      .get("TEST_CLEANUP_ROW", recentDate) as { n: number }).n;

    console.log(`After cleanup  — ancient row removed: ${afterOld === 0 ? "YES ✓" : "NO ✗"}`);
    console.log(`After cleanup  — recent row survived: ${afterRecent === 1 ? "YES ✓" : "NO ✗"}`);

    // Clean up test rows
    marketDb.prepare(`DELETE FROM ohlcv_daily WHERE symbol = 'TEST_CLEANUP_ROW'`).run();
    console.log("(test rows cleaned up)");
  } catch (err) {
    console.error("✗ Cleanup test threw:", err instanceof Error ? err.message : err);
  }

  section("All tests complete");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
