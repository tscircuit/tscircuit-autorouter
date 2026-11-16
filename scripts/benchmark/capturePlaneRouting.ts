import { writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getTinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"

function serializeSnapshot(_key: string, entry: unknown): unknown {
  if (
    entry instanceof Int8Array || entry instanceof Uint8Array ||
    entry instanceof Int16Array || entry instanceof Uint16Array ||
    entry instanceof Int32Array || entry instanceof Uint32Array ||
    entry instanceof Float32Array || entry instanceof Float64Array
  ) return { kind: entry.constructor.name, entries: Array.from(entry) }
  if (entry instanceof Map) return { kind: "Map", entries: [...entry] }
  if (entry instanceof Set) return { kind: "Set", entries: [...entry] }
  if (typeof entry === "number" && !Number.isFinite(entry)) return String(entry)
  return entry
}

const input: SimpleRouteJson = await Bun.file(process.argv[2]!).json()
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
const started = performance.now()
let entered = false
let thrown: string | undefined
try {
  while (!pipeline.failed && !pipeline.solved) {
    if (performance.now() - started > 600_000) throw new Error("Capture routing budget exhausted")
    pipeline.step()
    if (pipeline.getCurrentPhase() === "portPointPathingSolver") entered = true
    else if (entered) break
  }
} catch (error) {
  thrown = error instanceof Error ? error.message : String(error)
}
const native = pipeline.portPointPathingSolver?.activeSubSolver
const summary = {
  entered,
  stage: pipeline.getCurrentPhase(),
  failed: pipeline.failed,
  error: thrown ?? pipeline.error,
  seconds: (performance.now() - started) / 1000,
  phaseTimes: pipeline.timeSpentOnPhase,
  native: native && {
    name: native.constructor.name,
    iterations: native.iterations,
    maxIterations: native.MAX_ITERATIONS,
    stats: native.stats,
  },
}
if (native instanceof PreparedPortPointRoutingSolver) {
  const snapshot = {
    topology: native.topology,
    problem: native.problem,
    options: getTinyHyperGraphSolverOptions(native),
    statistics: native.getSelectiveReripStats(),
    currentRouteId: native.state.currentRouteId,
    pendingRouteIds: native.state.unroutedRoutes,
    routeMetadata: native.problem.routeMetadata,
    state: {
      ripCount: native.state.ripCount,
      committedSegments: native.state.regionSegments.flat().length,
      queueLength: native.state.candidateQueue.length,
    },
  }
  await Bun.write("prepared-input.json.gz", Bun.gzipSync(new TextEncoder().encode(JSON.stringify(snapshot, serializeSnapshot))))
  console.log("PREPARED_FAILURE_STATS", JSON.stringify({
    state: snapshot.state,
    statistics: snapshot.statistics,
    pending: snapshot.pendingRouteIds.length,
    routeCount: native.problem.routeCount,
    portCount: native.topology.portCount,
    regionCount: native.topology.regionCount,
    currentRoute: native.problem.routeMetadata?.[snapshot.currentRouteId!],
  }))
}
writeFileSync("capture-summary.json", JSON.stringify(summary, null, 2))
console.log("CAPTURE_SUMMARY", JSON.stringify(summary))
