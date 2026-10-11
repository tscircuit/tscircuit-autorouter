// Functional full-state oracle only: no wall-time or speed comparison.
// Run from the repository: bun scripts/diagnostics/verify-pathing-region-scoring-state.ts
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import assert from "node:assert/strict"
import { ParallelPortPointPathingSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
let activeChildren: any[] = []
await initializeReferenceDrcRuntime()
function hash(value: unknown): string {
  const serialized = JSON.stringify(value)
  return createHash("sha256").update(serialized === undefined ? "undefined" : serialized).digest("hex")
}
function clean(value: any): any {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(clean)
  const result: any = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === "timeMs" || key === "elapsedMs" || key === "durationMs") continue
    result[key] = clean(item)
  }
  return result
}
function captureCore(solver: any): any {
  const { candidateQueue, ...state } = solver.state
  return { class: solver.constructor.name, iterations: solver.iterations, cap: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed, error: solver.error,
    stats: JSON.parse(JSON.stringify(clean(solver.stats))), stateHash: hash(state), queueLength: candidateQueue.length,
    selectiveStats: solver.getSelectiveReripStats?.(), bestSummary: solver.bestSolvedStateSummary,
    bestSnapshotHash: hash(solver.bestSolvedStateSnapshot), routeAttemptCount: [...solver.routeAttemptCountByRouteId],
    routeSuccessCount: [...solver.routeSuccessCountByRouteId] }
}
const reports: any[] = JSON.parse(readFileSync(new URL("../../docs/benchmarks/parallel-pathing-scope-native-state-proof.json", import.meta.url), "utf8")).reports
const destination = process.argv[2] ?? "/tmp/pathing-region-scoring-native-state-proof.json"
for (const sample of [1, 6, 16]) {
  let params: any
  {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, { effort: 1, cacheProvider: null })
    pipeline.solveUntilPhase("portPointPathingSolver")
    if (pipeline.failed) throw new Error(pipeline.error ?? "Fixture preparation failed")
    const stage = pipeline.pipelineDef.find((stage) => stage.solverName === "portPointPathingSolver")!
    params = stage.getConstructorParams(pipeline)[0]
  }
  const results: any[] = []
  for (const [role, Solver] of [["memo", ParallelPortPointPathingSolver]] as const) {
    activeChildren = []
    const pathing = new Solver(params, { strategy: "indexed" })
    pathing.solve()
    assert(pathing.solved && !pathing.failed, pathing.error ?? "Unsolved pathing")
    const core = (pathing as any).tinyPipelineSolver.getSolver("solveGraph")
    const scope = core.wasmNeighborKernel?.validatedScope
    assert(scope && scope.finished && !scope.open && !scope.active, "Native synchronous scope not positively admitted/reset")
    activeChildren = scope.children.map((reference:any)=>reference.deref()).filter((child:any)=>child && child !== core)
    assert.equal(scope.diagnostics.childChecks, sample === 6 ? 2 : 1)
    assert.equal(scope.diagnostics.trustedBatches, sample === 6 ? 5683414 : sample === 1 ? 153496 : 420017)
    const metrics = JSON.parse(JSON.stringify(clean(pathing.getSolveGraphBenchmarkMetrics())))
    const result = { outputHash: hash(pathing.getOutput()), metrics,
      outerIterations: pathing.iterations, outerCap: pathing.MAX_ITERATIONS,
      core: captureCore(core), children: activeChildren.map(captureCore) }
    results.push(result)
    console.log(JSON.stringify({ sample, role, outputHash: result.outputHash, parentIterations: core.iterations,
      children: result.children.map(({ iterations, cap, solved }: any): any => ({ iterations, cap, solved })) }))
    if (role === "memo") {
      const expected = reports.find((report): boolean => report.sample === sample)
      const { sample: _sample, diagnostics: _diagnostics, ...control } = expected
      assert.deepStrictEqual(result, control)
      const diagnostics = [core, ...activeChildren].map((solver: any) => ({
        solverClass: solver.constructor.name, iterations: solver.iterations,
        kernel: solver.wasmNeighborKernel?.diagnostics,
      }))
      for (const diagnostic of diagnostics) {
        assert(diagnostic.kernel && diagnostic.kernel.batches > 0, JSON.stringify(diagnostic))
        assert.equal(diagnostic.kernel.disabledReason, "", JSON.stringify(diagnostic))
        assert.equal(diagnostic.kernel.scoringBatches, diagnostic.kernel.batches)
        assert(diagnostic.kernel.scoredCandidates > 0)
      }
      const existing = reports.findIndex((report): boolean => report.sample === sample)
      reports[existing] = { sample, ...result, diagnostics }
      writeFileSync(destination, JSON.stringify({ controlRevision: "f573c8deb", reports }, null, 2))
      console.log(JSON.stringify({ sample, exact: true, diagnostics, scope:scope.diagnostics }))
    }
  }
}
