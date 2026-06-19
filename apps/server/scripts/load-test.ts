// ponytail: load test harness. Spawns N concurrent requests against /v1/models
// (the cheapest authenticated route — DB + Redis cache hit) and reports RPS.
// Usage: NODE_ENV=test npx tsx scripts/load-test.ts http://localhost:8080 <API_KEY> [concurrency=500] [total=5000]
const BASE = process.argv[2] ?? "http://localhost:8080";
const API_KEY = process.argv[3] ?? "";
const CONCURRENCY = Number(process.argv[4] ?? 500);
const TOTAL = Number(process.argv[5] ?? 5000);

if (!API_KEY) {
  console.error("usage: tsx scripts/load-test.ts <base> <api-key> [concurrency=500] [total=5000]");
  process.exit(1);
}

const url = `${BASE}/v1/models`;
const headers = { Authorization: `Bearer ${API_KEY}` };

console.log(`load test → ${url}`);
console.log(`concurrency=${CONCURRENCY} total=${TOTAL} api-key=${API_KEY.slice(0, 12)}…`);

const start = Date.now();
let ok = 0;
let fail = 0;
let inflight = 0;
let issued = 0;
const latencies: number[] = [];
let minLatency = Infinity, maxLatency = 0;
const errors = new Map<string, number>();

function record(latency: number, success: boolean, status: number) {
  if (success) ok++; else fail++;
  latencies.push(latency);
  if (latency < minLatency) minLatency = latency;
  if (latency > maxLatency) maxLatency = latency;
  if (!success) errors.set(String(status), (errors.get(String(status)) ?? 0) + 1);
  inflight--;
}

async function fireOne() {
  inflight++;
  issued++;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers });
    const success = res.ok;
    record(Date.now() - t0, success, res.status);
    // drain body
    await res.text().catch(() => {});
  } catch (err) {
    record(Date.now() - t0, false, 0);
  }
}

async function main() {
  const concurrencyLimit = CONCURRENCY;
  while (issued < TOTAL) {
    if (inflight < concurrencyLimit) {
      void fireOne();
    } else {
      await new Promise((r) => setTimeout(r, 1));
    }
  }
  // wait for stragglers
  while (inflight > 0) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const total = Date.now() - start;
  const rps = (ok / total) * 1000;
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? latencies[latencies.length - 1];
  console.log("\n─ results ─");
  console.log(`  ok:        ${ok}`);
  console.log(`  fail:      ${fail}`);
  console.log(`  total ms:  ${total}`);
  console.log(`  RPS:       ${rps.toFixed(1)}`);
  console.log(`  latency:   min=${minLatency===Infinity?0:minLatency} p50=${p50} p95=${p95} p99=${p99} max=${maxLatency} (ms)`);
  if (errors.size > 0) {
    console.log(`  errors:${Array.from(errors.entries()).map(([k, v]) => ` ${k}×${v}`).join("")}`);
  }
}

main();