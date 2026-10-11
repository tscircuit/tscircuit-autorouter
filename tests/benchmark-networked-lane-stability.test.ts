import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"
import { runBenchmarkTasks } from "../scripts/benchmark/index"

type ChildAssignment = { url: string; cpu: number; pid: number }

test("out-of-order samples keep the same CPU and server lane across cold and hot passes", async (): Promise<void> => {
  const cpuRanges = readFileSync("/proc/self/status", "utf8").match(/^Cpus_allowed_list:\s*(.*)$/m)![1].split(",")
  const cpuIds = cpuRanges.flatMap((range): number[] => {
    const [first, last = first] = range.split("-").map(Number)
    return Array.from({ length: last - first + 1 }, (_, index): number => first + index)
  }).slice(0, 2)
  expect(cpuIds).toHaveLength(2)
  const originalCwd = process.cwd()
  const originalHeartbeat = process.env.BENCHMARK_HEARTBEAT_INTERVAL_MS
  const directory = await mkdtemp(join(tmpdir(), "benchmark-fixed-lanes-"))
  const childSource = `
import { existsSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of input) {
  const { taskId, task } = JSON.parse(line)
  if (task.sampleNumber === 1) {
    while (!existsSync(task.networkedCachePass + ".release")) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }
  const cpu = Number(readFileSync("/proc/self/status", "utf8").match(/^Cpus_allowed_list:\\s*(.*)$/m)[1])
  const snapshot = {
    datasetName: task.datasetName, solverName: task.solverName,
    scenarioName: task.scenarioName, sampleNumber: task.sampleNumber,
    label: JSON.stringify({ url: task.networkedServer.url, cpu, pid: process.pid }),
    elapsedTimeMs: 0, traceCount: 0, viaCount: 0, relaxedDrcPassed: true,
    imageSvg: "<svg/>",
  }
  process.stdout.write(JSON.stringify({ taskId, result: {
    solverName: task.solverName, scenarioName: task.scenarioName,
    sampleNumber: task.sampleNumber, elapsedTimeMs: 0,
    didSolve: true, didTimeout: false, relaxedDrcPassed: true,
    benchmarkSnapshot: snapshot,
  } }) + "\\n")
}
`
  const childPids = new Set<number>()
  try {
    await mkdir(join(directory, "scripts/benchmark"), { recursive: true })
    await writeFile(join(directory, "scripts/benchmark/benchmark.child.ts"), childSource)
    process.chdir(directory)
    process.env.BENCHMARK_HEARTBEAT_INTERVAL_MS = "0"
    for (const pass of ["cold", "hot"] as const) {
      const completed: number[] = []
      const tasks: BenchmarkTask[] = Array.from({ length: 4 }, (_, index): BenchmarkTask => ({
        datasetName: "srj18",
        solverName: `Pipeline9_Networked ${pass === "cold" ? "Cold" : "Hot"}`,
        networkedCachePass: pass,
        networkedServer: { url: `http://lane-${index % 2}`, cacheVersion: `run-sample-${index + 1}` },
        scenarioName: `sample-${index + 1}`,
        sampleNumber: index + 1,
        scenario: { layerCount: 2, minTraceWidth: 0.15, obstacles: [], connections: [],
          bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } },
      }))
      const results = await runBenchmarkTasks(tasks, 2, undefined, {
        cpuLanes: cpuIds.map((cpu): number[] => [cpu]),
        onBenchmarkSnapshot: async (snapshot): Promise<void> => {
          completed.push(snapshot.sampleNumber)
          if (snapshot.sampleNumber === 4) await writeFile(`${pass}.release`, "released")
        },
      })
      expect(completed).toEqual([2, 4, 1, 3])
      expect(results.map((result) => result.sampleNumber)).toEqual([1, 2, 3, 4])
      for (const [index, result] of results.entries()) {
        expect(result.didSolve).toBe(true)
        const assignment = JSON.parse(result.benchmarkSnapshot!.label) as ChildAssignment
        expect(assignment.url).toBe(`http://lane-${index % 2}`)
        expect(assignment.cpu).toBe(cpuIds[index % 2])
        childPids.add(assignment.pid)
        expect(() => process.kill(assignment.pid, 0)).toThrow()
      }
    }
    expect(childPids.size).toBe(8)
  } finally {
    process.chdir(originalCwd)
    if (originalHeartbeat === undefined) delete process.env.BENCHMARK_HEARTBEAT_INTERVAL_MS
    else process.env.BENCHMARK_HEARTBEAT_INTERVAL_MS = originalHeartbeat
    await rm(directory, { recursive: true, force: true })
  }
})
