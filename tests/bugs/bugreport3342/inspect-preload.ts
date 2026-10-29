import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import { loadMotherboardPowerPhase } from "./repro"

// Run this same script on the reproduction and fix revisions. The hash covers
// all boundary geometry, ports, and fixed-copper assignments, in their order.
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  loadMotherboardPowerPhase(),
  { effort: 1, cacheProvider: null },
)
type PreloadStage = {
  getConstructorParams: (
    solver: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ) => ConstructorParameters<typeof PreloadedTraceGraphSolver>
  onSolved?: (solver: AutoroutingPipelineSolver9_PreloadedTraceGraph) => void
}
const stage: PreloadStage = pipeline.pipelineDef.find(
  (entry) => entry.solverName === "preloadedTraceGraphSolver",
)! as PreloadStage
const getParams = stage.getConstructorParams
const onSolved = stage.onSolved
let elapsedMs: number | undefined
let inputHash: string | undefined
let started: number | undefined
stage.getConstructorParams = (solver): ReturnType<typeof getParams> => {
  const params = getParams(solver)
  inputHash = createHash("sha256").update(JSON.stringify(params)).digest("hex")
  started = performance.now()
  return params
}
stage.onSolved = (solver): void => {
  if (started === undefined) {
    throw new Error("Missing preload start time")
  }
  elapsedMs = performance.now() - started
  onSolved?.(solver)
}
while (
  !pipeline.preloadedTraceGraphSolver?.solved &&
  !pipeline.failed &&
  !pipeline.solved
) {
  pipeline.step()
}
const preload = pipeline.preloadedTraceGraphSolver
if (!preload?.solved || elapsedMs === undefined) {
  throw new Error(`Preload did not complete: ${pipeline.error}`)
}
const outputHash: string = createHash("sha256")
  .update(JSON.stringify(preload.getOutput()))
  .digest("hex")
console.log(
  JSON.stringify(
    {
      elapsedMs,
      inputHash,
      outputHash,
      stats: preload.stats,
    },
    null,
    2,
  ),
)
