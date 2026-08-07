#!/usr/bin/env bun
/**
 * Rebuilds test-timings.json from a completed "Bun Test" CI run.
 *
 *   bun scripts/record-test-timings.ts <run-id> [<run-id> ...]
 *
 * Reads the per-file `##[group]tests/...` markers that bun test emits in the
 * Actions log and takes the wall time between consecutive markers. When several
 * runs are given, the max per file is kept so the packer stays conservative.
 *
 * Timings are stable run to run (median ratio 1.00, p90 1.05 across two runs),
 * so this only needs re-running when the suite changes materially.
 */
import { writeFileSync } from "fs"

const runIds = process.argv.slice(2)
if (runIds.length === 0) {
  console.error(
    "usage: bun scripts/record-test-timings.ts <run-id> [<run-id> ...]",
  )
  process.exit(1)
}

const REPO = "tscircuit/tscircuit-autorouter"
const GROUP = /##\[group\](tests\/\S+\.tsx?):\s*$/
const STAMP = /^(\d{4}-\d\d-\d\dT\S+Z) /

const timings: Record<string, number> = {}

for (const runId of runIds) {
  const jobsRaw =
    await Bun.$`gh api repos/${REPO}/actions/runs/${runId}/jobs --paginate --jq '.jobs[]|select(.name|startswith("test"))|.id'`.text()
  const jobIds = jobsRaw.trim().split("\n").filter(Boolean)
  if (jobIds.length === 0) throw new Error(`run ${runId} has no test jobs`)

  for (const jobId of jobIds) {
    const log =
      await Bun.$`gh api repos/${REPO}/actions/jobs/${jobId}/logs`.text()

    let current: string | null = null
    let startedAt = 0
    let lastAt = 0

    for (const rawLine of log.split("\n")) {
      // Actions logs carry ANSI colour codes inside the timestamped line.
      const line = rawLine.replace(/\x1b\[[0-9;]*m/g, "").trimEnd()
      const stamp = STAMP.exec(line)
      const at = stamp ? Date.parse(stamp[1]!) : 0
      const group = GROUP.exec(line)

      if (group) {
        if (current && at) {
          const sec = (at - startedAt) / 1000
          timings[current] = Math.max(timings[current] ?? 0, sec)
        }
        current = group[1]!
        startedAt = at
      } else if (at && current) {
        lastAt = at
      }
    }
    if (current && lastAt) {
      const sec = (lastAt - startedAt) / 1000
      timings[current] = Math.max(timings[current] ?? 0, sec)
    }
  }
}

const rounded = Object.fromEntries(
  Object.entries(timings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, sec]) => [file, Math.round(sec * 10) / 10]),
)

writeFileSync(
  "test-timings.json",
  `${JSON.stringify(
    {
      _comment:
        "Measured per-file bun test wall time in seconds. Regenerate with: bun scripts/record-test-timings.ts <run-id>",
      _generatedFrom: runIds,
      timings: rounded,
    },
    null,
    2,
  )}\n`,
  "utf8",
)

const total = Object.values(rounded).reduce((a, b) => a + b, 0)
console.log(
  `wrote test-timings.json: ${Object.keys(rounded).length} files, ${(total / 60).toFixed(1)} min total`,
)
