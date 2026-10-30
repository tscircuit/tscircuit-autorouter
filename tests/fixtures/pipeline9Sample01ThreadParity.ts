import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  SolverConstructor,
  SolverRuntimeExecutor,
} from "@tscircuit/solver-utils"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { stackSvgsHorizontally, stackSvgsVertically } from "stack-svgs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib"
import { getBugReportSnapshotSvg } from "../../lib/testing/getBugReportSnapshotSvg"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

// Run outside bun:test's SVG preload, which replaces global Worker with Node's
// adapter. This exercises four native Bun workers, with no inline fallback.
const outputDirectory = process.argv[2]
assert.ok(outputDirectory, "Provide the temporary output directory")
const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
assert.ok(scenario.connections.length >= 100)
assert.ok(scenario.obstacles.length >= 200)
const inputBefore = JSON.stringify(scenario)
const serial = new Pipeline9(structuredClone(scenario), {
  effort: 1,
  cacheProvider: null,
})
serial.solve()
assert.equal(
  serial.solved,
  true,
  serial.error ?? "Serial routing did not solve",
)
assert.equal(serial.failed, false)

const parallel = new Pipeline9(structuredClone(scenario), {
  effort: 1,
  cacheProvider: null,
})
const runtime = new SolverRuntime({
  workerCount: 4,
  workerUrl: new URL("../../lib/runtime/bun.worker.ts", import.meta.url),
  requireWorker: true,
})
let dispatchCount = 0
const executor: SolverRuntimeExecutor & { persistentWorkerCount: number } = {
  persistentWorkerCount: 4,
  executeAsync(
    Solver: string | SolverConstructor<any, any>,
    input: unknown,
  ): ReturnType<SolverRuntimeExecutor["executeAsync"]> {
    dispatchCount++
    if (typeof Solver === "string") {
      return runtime.executeAsync(Solver, input)
    }
    return runtime.executeAsync(Solver, input)
  },
}
try {
  await parallel.solveAsync(executor)
} finally {
  await runtime.dispose()
}
assert.equal(
  parallel.solved,
  true,
  parallel.error ?? "Threaded routing did not solve",
)
assert.equal(parallel.failed, false)
assert.ok(
  dispatchCount >= 4,
  "The board must dispatch enough work for four workers",
)
assert.ok(serial.highDensityRouteSolver)
assert.ok(parallel.highDensityRouteSolver)

// Compare serialized outputs without rounding, sorting, ID replacement, or
// tolerances: trace order, coordinates, vias, ports and metadata must all match.
const serialJson = JSON.stringify(serial.getOutputSimpleRouteJson())
const parallelJson = JSON.stringify(parallel.getOutputSimpleRouteJson())
assert.equal(parallelJson, serialJson, "Complete routed SRJ must match exactly")
assert.equal(
  JSON.stringify(parallel.highDensityRouteSolver.routes),
  JSON.stringify(serial.highDensityRouteSolver.routes),
  "High-density routes must match exactly before later phases can mask a difference",
)
assert.deepEqual(
  parallel.highDensityRouteSolver.stats,
  serial.highDensityRouteSolver.stats,
)
assert.equal(
  parallel.highDensityRouteSolver.iterations,
  serial.highDensityRouteSolver.iterations,
)
assert.equal(parallel.iterations, serial.iterations)
assert.equal(JSON.stringify(scenario), inputBefore)
assert.ok(serial.getOutputSimplifiedPcbTraces().length >= 100)

const panels = [
  { title: "UNTHREADED", solver: serial },
  { title: "4 THREADS", solver: parallel },
].map(({ title, solver }): string => {
  assert.ok(solver.srjWithPointPairs)
  const board = getBugReportSnapshotSvg({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  const heading = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="64"><rect width="1000" height="64" fill="white"/><text x="500" y="44" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#111827">${title}</text></svg>`
  return stackSvgsVertically([heading, board], {
    gap: 8,
    normalizeSize: false,
  })
})
const svg = stackSvgsHorizontally(panels, {
  gap: 24,
  normalizeSize: false,
  rootAttributes: {
    role: "img",
    "aria-label": "Dataset18 sample01: UNTHREADED versus 4 THREADS",
    style: "background:white",
  },
})
await writeFile(
  join(outputDirectory, "comparison.svg"),
  svg
    .replace(
      /(<svg\b[^>]*>)/,
      '$1<rect width="100%" height="100%" fill="white"/>',
    )
    .replace(/[ \t]+$/gm, ""),
)
const report = {
  connections: scenario.connections.length,
  obstacles: scenario.obstacles.length,
  threads: 4,
  dispatchCount,
  routedTraces: serial.getOutputSimplifiedPcbTraces().length,
  serialHash: createHash("sha256").update(serialJson).digest("hex"),
  threadedHash: createHash("sha256").update(parallelJson).digest("hex"),
}
await writeFile(join(outputDirectory, "parity.json"), JSON.stringify(report))
console.log(JSON.stringify(report))
