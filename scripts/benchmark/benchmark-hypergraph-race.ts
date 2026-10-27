import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createAutorouterSolverRuntime } from "../../lib/runtime/bun"

// Bun >=1.4.2. Pass sample numbers as positional arguments (default: all 16).
// Optional TINY_HYPERGRAPH_BASELINE_DIR points to a dependency-installed baseline
// checkout. Baseline, serial race, and four-worker race run sequentially.
// This isolates port-point phase cost; the PR benchmark must still verify
// end-to-end routing completion and DRC.
const samples = process.argv.length > 2
  ? process.argv.slice(2).map(Number)
  : Array.from({ length: 16 }, (_, index) => index + 1)
if (samples.some((sample) => !Number.isInteger(sample) || sample < 1 || sample > 16)) {
  throw new Error("Sample numbers must be integers from 1 to 16")
}
const baselineDirectory = process.env.TINY_HYPERGRAPH_BASELINE_DIR
const Baseline: typeof TinyHypergraphPortPointPathingSolver | undefined =
  baselineDirectory
    ? (await import(pathToFileURL(resolve(
        baselineDirectory,
        "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts",
      )).href)).TinyHypergraphPortPointPathingSolver
    : undefined

for (const sample of samples) {
  const samplePath = resolve(
    import.meta.dir,
    "../../node_modules/dataset-srj18/samples/sample" +
      String(sample).padStart(3, "0") + ".json",
  )
  const pipeline = new Pipeline9(JSON.parse(readFileSync(samplePath, "utf8")), {
    cacheProvider: null,
  })
  while (!pipeline.portPointPathingSolver && !pipeline.failed && !pipeline.solved) {
    pipeline.step()
  }
  if (!pipeline.portPointPathingSolver) {
    throw new Error("Could not initialize port-point pathing: " + pipeline.error)
  }
  const params = pipeline.portPointPathingSolver.getConstructorParams()[0]
  let serialHash: string | undefined
  const modes = Baseline
    ? ["baseline", "serial", "parallel"] as const
    : ["serial", "parallel"] as const
  for (const mode of modes) {
    const runtime = mode === "parallel"
      ? createAutorouterSolverRuntime({
          workerCount: 4,
          requireWorker: true,
          startupFailure: "throw",
        })
      : undefined
    try {
      const start = performance.now()
      const Solver = mode === "baseline" ? Baseline! : TinyHypergraphPortPointPathingSolver
      const solver = new Solver(params)
      if (runtime) await solver.solveAsync(runtime)
      else solver.solve()
      const timeMs = performance.now() - start
      if (!solver.solved || solver.failed) {
        throw new Error(mode + " failed on sample " + sample + ": " + solver.error)
      }
      const outputHash = createHash("sha256")
        .update(JSON.stringify(solver.getOutput()))
        .digest("hex")
      if (mode === "serial") serialHash = outputHash
      const parity = mode === "parallel" ? outputHash === serialHash : undefined
      console.log(JSON.stringify({
        sample,
        mode,
        timeMs,
        iterations: solver.iterations,
        outputHash,
        parity,
        metrics: solver.getSolveGraphBenchmarkMetrics(),
      }))
      if (parity === false) throw new Error("Serial/parallel routing mismatch")
    } finally {
      await runtime?.dispose()
    }
  }
}
