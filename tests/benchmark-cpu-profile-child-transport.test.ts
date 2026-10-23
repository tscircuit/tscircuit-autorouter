import { expect, test } from "bun:test"
import { resolve } from "node:path"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"

test("actual benchmark child keeps CPU diagnostics on stderr and result protocol on stdout", async (): Promise<void> => {
  const task: BenchmarkTask = {
    datasetName: "test",
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenarioName: "transport",
    sampleNumber: 1,
    threads: 1,
    scenario: {
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [],
      bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
      connections: [{ name: "signal", pointsToConnect: [
        { x: -3, y: 0, layer: "top" },
        { x: 3, y: 0, layer: "top" },
      ] }],
    },
  }
  const child = Bun.spawn([process.execPath, "scripts/benchmark/benchmark.child.ts"], {
    cwd: resolve(import.meta.dir, ".."),
    stdin: new Blob([JSON.stringify({ taskId: 7, task }) + "\n"]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(exitCode).toBe(0)
  const messages = stdout.trim().split("\n").map((line): { taskId: number; result?: { didSolve: boolean } } => JSON.parse(line))
  expect(messages.every(message => message.taskId === 7)).toBe(true)
  expect(messages.at(-1)?.result?.didSolve).toBe(true)
  expect(stdout).not.toContain("P9_RESEARCH_CPU_PROFILE")
  const record = stderr.split("\n").find(line => line.startsWith("P9_RESEARCH_CPU_PROFILE "))
  expect(record).toBeDefined()
  const data = JSON.parse(record!.slice("P9_RESEARCH_CPU_PROFILE ".length))
  expect(data.sample).toBe(1)
  expect(Array.isArray(data.self)).toBe(true)
  expect(typeof data.sampleCount).toBe("number")
})
