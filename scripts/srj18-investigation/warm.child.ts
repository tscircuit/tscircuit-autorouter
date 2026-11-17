import * as readline from "node:readline"
import { createHash } from "node:crypto"
import * as jsc from "bun:jsc"
import { createSolverForTask, solveWithProgress } from "../benchmark/benchmark-run-task"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { getGlobalInMemoryCache } from "../../lib/cache/setupGlobalCaches"

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  if (!line.trim()) continue
  const { taskId, task } = JSON.parse(line)
  if (typeof jsc.totalCompileTime !== "function") throw new Error("JIT compile-time counters unavailable")
  let firstHash: string | undefined
  let firstIterations: number | undefined
  for (const temperature of ["cold", "warm"]) {
    const cache = getGlobalInMemoryCache()
    cache.clearCache()
    const input = { ...task, scenario: structuredClone(task.scenario) }
    const solver: any = createSolverForTask(input)
    const before = { wall: performance.now(), cpu: process.cpuUsage(), compile: jsc.totalCompileTime() }
    await solveWithProgress(input, solver, before.wall, { onProgress(progress): void { process.stdout.write(JSON.stringify({ taskId, progress }) + "\n") } })
    const after = { wall: performance.now(), cpu: process.cpuUsage(), compile: jsc.totalCompileTime() }
    if (!solver.solved || solver.failed) throw new Error(`Warmup diagnostic failed: ${solver.error}`)
    const traces = solver.getOutputSimplifiedPcbTraces()
    const { errors } = evaluateRelaxedDrc({ inputSrj: input.scenario, srjWithPointPairs: solver.srjWithPointPairs, routedTraces: traces })
    const hash = createHash("sha256").update(JSON.stringify(traces)).digest("hex")
    if (temperature === "cold") firstHash = hash
    if (hash !== firstHash || errors.length) throw new Error("Cold and warm routes differ or have DRC errors")
    const iterations = solver.highDensityRouteSolver?.iterations
    if (temperature === "cold") firstIterations = iterations
    const result = { temperature, wallMs: after.wall - before.wall, cpuMs: (after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system) / 1000, compileMs: after.compile - before.compile, stages: solver.timeSpentOnPhase, hash, drc: errors.length, highDensityIterations: iterations, sameWorkAsCold: iterations === firstIterations, cacheHits: cache.cacheHits, cacheMisses: cache.cacheMisses, pathing: solver.portPointPathingSolver?.getSolveGraphBenchmarkMetrics() }
    process.stdout.write("WARM_MEASUREMENT " + JSON.stringify(result) + "\n")
  }
}
