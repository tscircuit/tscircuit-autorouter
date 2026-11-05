import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"

test("deterministic lazy routing matches native Bun workers in complete routes, counters and work", (): void => {
  const result = spawnSync(process.execPath, ["--preserve-symlinks",
    new URL("../fixtures/lazyPortfolioNativeWorkerParity.ts", import.meta.url).pathname],
    { cwd: new URL("../../", import.meta.url), encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`Native lazy parity process failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  }
  const report = JSON.parse(result.stdout.trim())
  expect(report.actualWorkerExecution).toBe(true)
  expect(report.exactOutputAndWorkParity).toBe(true)
  expect(report.batches).toBe(2)
  expect(report.nodes).toBe(4)
  expect(report.deferredGridSetups).toBeGreaterThan(0)
  expect(report.unmaterializedGridSetups).toBeGreaterThan(0)
})
