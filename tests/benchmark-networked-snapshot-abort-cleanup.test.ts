import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"
import { runBenchmarkTasks } from "../scripts/benchmark/index"

test("a failed lane waits for an outstanding snapshot before final child cleanup", async (): Promise<void> => {
  const ranges = readFileSync("/proc/self/status", "utf8").match(/^Cpus_allowed_list:\s*(.*)$/m)![1].split(",")
  const cpuIds = ranges.flatMap((range): number[] => {
    const [first, last = first] = range.split("-").map(Number)
    return Array.from({ length: last - first + 1 }, (_, index): number => first + index)
  }).slice(0, 2)
  expect(cpuIds).toHaveLength(2)
  const originalCwd = process.cwd()
  const originalHeartbeat = process.env.BENCHMARK_HEARTBEAT_INTERVAL_MS
  const directory = await mkdtemp(join(tmpdir(), "benchmark-snapshot-cleanup-"))
  let releaseSnapshot!: () => void
  let snapshotEntered!: () => void
  const snapshotGate = new Promise<void>((resolve): void => { releaseSnapshot = resolve })
  const snapshotReady = new Promise<void>((resolve): void => { snapshotEntered = resolve })
  const childSource = `
import { existsSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of input) {
  const { taskId, task } = JSON.parse(line)
  writeFileSync("pid-" + task.sampleNumber, String(process.pid))
  if (task.sampleNumber === 1) {
    while (!existsSync("fail.release")) await new Promise((resolve) => setTimeout(resolve, 1))
    process.exit(23)
  }
  process.stdout.write(JSON.stringify({ taskId, result: {
    solverName: task.solverName, scenarioName: task.scenarioName,
    sampleNumber: task.sampleNumber, elapsedTimeMs: 0,
    didSolve: true, didTimeout: false, relaxedDrcPassed: true,
    benchmarkSnapshot: {
      datasetName: task.datasetName, solverName: task.solverName,
      scenarioName: task.scenarioName, sampleNumber: task.sampleNumber,
      label: String(process.pid), elapsedTimeMs: 0,
      traceCount: 0, viaCount: 0, relaxedDrcPassed: true, imageSvg: "<svg/>",
    },
  } }) + "\\n")
}
`
  let pendingRun: Promise<{ error: unknown }> | undefined
  try {
    await mkdir(join(directory, "scripts/benchmark"), { recursive: true })
    await writeFile(join(directory, "scripts/benchmark/benchmark.child.ts"), childSource)
    process.chdir(directory)
    process.env.BENCHMARK_HEARTBEAT_INTERVAL_MS = "0"
    const tasks: BenchmarkTask[] = Array.from({ length: 4 }, (_, index): BenchmarkTask => ({
      datasetName: "srj18", solverName: "Pipeline9_Networked Cold",
      networkedCachePass: "cold", scenarioName: `sample-${index + 1}`, sampleNumber: index + 1,
      networkedServer: { url: `http://lane-${index % 2}`, cacheVersion: `run-sample-${index + 1}` },
      scenario: { layerCount: 2, minTraceWidth: 0.15, obstacles: [], connections: [],
        bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } },
    }))
    let settled = false
    pendingRun = runBenchmarkTasks(tasks, 2, undefined, {
      cpuLanes: cpuIds.map((cpu): number[] => [cpu]),
      onBenchmarkSnapshot: async (): Promise<void> => {
        snapshotEntered()
        await snapshotGate
      },
    }).then(() => ({ error: null }), (error: unknown) => ({ error }))
    void pendingRun.then((): void => { settled = true })
    await snapshotReady
    while (!existsSync("pid-1")) await Bun.sleep(1)
    const firstPid = Number(await readFile("pid-1", "utf8"))
    const snapshotPid = Number(await readFile("pid-2", "utf8"))
    await writeFile("fail.release", "release")
    while (true) {
      try { process.kill(firstPid, 0) } catch { break }
      await Bun.sleep(1)
    }
    // Let the exit event and filesystem cleanup reach the parent event loop.
    await Bun.sleep(25)
    expect(settled).toBe(false)
    expect(() => process.kill(snapshotPid, 0)).not.toThrow()
    releaseSnapshot()
    const outcome = await pendingRun
    expect(outcome.error).toBeInstanceOf(Error)
    expect(String(outcome.error)).toContain("did not finish safely")
    expect(() => process.kill(snapshotPid, 0)).toThrow()
    expect(existsSync("pid-3")).toBe(false)
    expect(existsSync("pid-4")).toBe(false)
    const diagnostic = JSON.parse(await readFile("benchmark-interrupted.json", "utf8"))
    expect(diagnostic.completedResults.map((result: { sampleNumber: number }) => result.sampleNumber)).toEqual([1])
  } finally {
    releaseSnapshot()
    await pendingRun
    process.chdir(originalCwd)
    if (originalHeartbeat === undefined) delete process.env.BENCHMARK_HEARTBEAT_INTERVAL_MS
    else process.env.BENCHMARK_HEARTBEAT_INTERVAL_MS = originalHeartbeat
    await rm(directory, { recursive: true, force: true })
  }
})
