#!/usr/bin/env node
/**
 * Lightweight smoke load check against public listing endpoints.
 * Usage:
 *   node scripts/load-smoke.mjs [baseUrl] [concurrency] [durationSec]
 * Example:
 *   node scripts/load-smoke.mjs http://localhost:3000/api/v1 20 15
 *
 * Target (from performance plan): sustain ~100 RPS with p95 < 500ms on hot GETs.
 */
const base = (process.argv[2] || 'http://localhost:3000/api/v1').replace(/\/$/, '');
const concurrency = Math.max(1, Number(process.argv[3] || 20));
const durationSec = Math.max(1, Number(process.argv[4] || 15));
const paths = ['/listings?page=1&pageSize=20', '/listings/home-feed?limit=10', '/common/categories'];

const latencies = [];
let ok = 0;
let fail = 0;
const endAt = Date.now() + durationSec * 1000;

async function one() {
  const path = paths[Math.floor(Math.random() * paths.length)];
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: 'application/json' },
    });
    const ms = Date.now() - t0;
    latencies.push(ms);
    if (res.ok) ok += 1;
    else fail += 1;
  } catch {
    latencies.push(Date.now() - t0);
    fail += 1;
  }
}

async function worker() {
  while (Date.now() < endAt) {
    await one();
  }
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

(async () => {
  console.log(`Load smoke → ${base} | c=${concurrency} | ${durationSec}s`);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const total = ok + fail;
  const rps = total / durationSec;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  console.log(
    JSON.stringify(
      { total, ok, fail, rps: Number(rps.toFixed(1)), p50, p95, p99, target: { rps: 100, p95ms: 500 } },
      null,
      2,
    ),
  );
  if (p95 > 500) process.exitCode = 2;
})();
