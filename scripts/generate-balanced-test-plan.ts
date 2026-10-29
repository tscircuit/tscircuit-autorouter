#!/usr/bin/env bun
/**
 * Generates balanced bun test plans using recorded per-file timings.
 *
 * Replaces the round-robin distribution in @tscircuit/bun-test-plan, which
 * splits alphabetically and ignores runtime. Test cost in this repo is
 * extremely skewed (10 of 354 files are 55% of total runtime), so alphabetical
 * round-robin reliably lands the heavy files on the same shard.
 *
 * Strategy: longest-processing-time-first (LPT) greedy bin packing. Sort files
 * by descending recorded cost, repeatedly assign the next file to whichever
 * shard is currently least loaded. LPT is guaranteed within 4/3 of optimal and
 * lands within a few seconds of optimal on this distribution.
 */
import { Glob } from "bun"
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs"

const NODE_COUNT = Number(process.env.NODE_COUNT ?? 9)
const TIMINGS_FILE = "test-timings.json"
const GLOB = "tests/**/*.test.{ts,tsx}"

// Cost assumed for a test file with no recorded timing (i.e. newly added).
//
// The cost distribution is very skewed -- median is 0.3s, p90 is 12s, max is
// 187s -- so no default fully protects balance: a new file that really takes
// 187s pushes its shard from 4.6 to ~7.5 min whatever we guess here. The
// default only bounds the damage (still better than the 12 min this replaces)
// and stops a batch of new files from clustering. Refreshing test-timings.json
// is the actual fix. p90 reserves real headroom without letting twenty trivial
// new tests invent minutes of phantom load.
const UNKNOWN_COST_PERCENTILE = 0.9

const timings: Record<string, number> = existsSync(TIMINGS_FILE)
  ? JSON.parse(readFileSync(TIMINGS_FILE, "utf8")).timings
  : {}

const files = Array.from(new Glob(GLOB).scanSync({ cwd: process.cwd() })).sort()
if (files.length === 0) throw new Error(`No test files matched ${GLOB}`)

const known = Object.values(timings).sort((a, b) => a - b)
const defaultCost = known.length
  ? known[Math.floor(known.length * UNKNOWN_COST_PERCENTILE)]!
  : 1

const unmeasured = files.filter((f) => !(f in timings))
if (unmeasured.length > 0) {
  console.log(
    `${unmeasured.length} file(s) have no recorded timing, assuming ${defaultCost.toFixed(1)}s each:`,
  )
  for (const f of unmeasured) console.log(`  - ${f}`)
}

const weighted = files
  .map((file) => ({ file, cost: timings[file] ?? defaultCost }))
  .sort((a, b) => b.cost - a.cost)

const shards = Array.from({ length: NODE_COUNT }, () => ({
  total: 0,
  files: [] as string[],
}))

for (const { file, cost } of weighted) {
  let lightest = shards[0]!
  for (const shard of shards) if (shard.total < lightest.total) lightest = shard
  lightest.total += cost
  lightest.files.push(file)
}

const dir = ".bun-test-plan/testplans"
// Wipe first: a stale testplan from a previous, larger NODE_COUNT would
// otherwise linger and re-run files that are already covered elsewhere.
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

for (const [i, shard] of shards.entries()) {
  // Keep each shard's own order alphabetical so failures are easy to locate.
  shard.files.sort()
  writeFileSync(`${dir}/testplan${i + 1}.txt`, shard.files.join("\n"), "utf8")
}

const totals = shards.map((s) => s.total)
const total = totals.reduce((a, b) => a + b, 0)
console.log(
  `\nBalanced ${files.length} test files across ${NODE_COUNT} shards:`,
)
for (const [i, shard] of shards.entries()) {
  console.log(
    `  testplan${i + 1}: ${String(shard.files.length).padStart(3)} files, ${(shard.total / 60).toFixed(2)} min`,
  )
}
console.log(
  `\ntotal ${(total / 60).toFixed(1)} min | critical path ${(Math.max(...totals) / 60).toFixed(2)} min | spread ${((Math.max(...totals) - Math.min(...totals)) / 60).toFixed(2)} min`,
)
