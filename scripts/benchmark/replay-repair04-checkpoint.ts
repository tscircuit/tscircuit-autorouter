import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getConnectivityMapFromSimpleRouteJson } from "../../lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getColorMap } from "../../lib/solvers/colors"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
import type { HighDensityRoute } from "../../lib/types/high-density-types"

type Checkpoint = {
  datasetCommit: string
  inputSha256: string
  originalSrj: SimpleRouteJson
  srj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  pipelineSrj?: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  updatedPreloadedTraces: SimplifiedPcbTrace[]
  mutatedPreloadedTraceIds: string[]
  defaultViaDiameter: number
  defaultViaHoleDiameter: number
}

const [checkpointPath, mode, outputPath, baselineOutputPath] =
  process.argv.slice(2)
if (
  !checkpointPath ||
  (mode !== "baseline" && mode !== "candidate") ||
  !outputPath
) {
  throw new Error(
    "Usage: bun scripts/benchmark/replay-repair04-checkpoint.ts checkpoint.json baseline|candidate output.json [expected-baseline-output.json]",
  )
}
if (mode === "candidate" && baselineOutputPath)
  throw new Error("Baseline identity validation is only valid in baseline mode")
const checkpoint: Checkpoint = JSON.parse(
  await readFile(resolve(checkpointPath), "utf8"),
)
const started = performance.now()
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  checkpoint.originalSrj,
  {
    effort: 1,
    cacheProvider: null,
    enableRepair04: mode === "candidate",
  },
)
// Run the inexpensive original preprocessing stage to restore the exact board
// state. Checkpoints created before pipelineSrj was recorded need this step.
while (
  pipeline.getCurrentPhase() === "preprocessSimpleRouteJsonSolver" &&
  !pipeline.failed
)
  pipeline.step()
if (pipeline.failed)
  throw new Error(`Replay preprocessing failed: ${pipeline.error}`)
if (checkpoint.pipelineSrj) pipeline.srj = checkpoint.pipelineSrj
pipeline.srjWithPointPairs = checkpoint.srjWithPointPairs
pipeline.connMap = getConnectivityMapFromSimpleRouteJson(
  checkpoint.srjWithPointPairs,
)
pipeline.colorMap = getColorMap(checkpoint.srjWithPointPairs, pipeline.connMap)
pipeline.viaDiameter = checkpoint.defaultViaDiameter
pipeline.viaHoleDiameter = checkpoint.defaultViaHoleDiameter
const mutatedIds = new Set(checkpoint.mutatedPreloadedTraceIds)
const updates = {
  updatedPreloadedTraces: checkpoint.updatedPreloadedTraces,
  mutatedPreloadedTraces: checkpoint.updatedPreloadedTraces.filter((trace) =>
    mutatedIds.has(trace.pcb_trace_id),
  ),
}
// These are restored completed-stage outputs, not substitute routing results.
// Every downstream solver remains the real Pipeline9 implementation.
Object.assign(pipeline, {
  netToPointPairsSolver: {
    solved: true,
    newConnections: checkpoint.srjWithPointPairs.connections,
  },
  globalDrcForceImproveSolver: {
    solved: true,
    getOutput: (): HighDensityRoute[] => checkpoint.hdRoutes,
  },
  highDensityRouteSolver: { solved: true, routes: checkpoint.hdRoutes },
  getSrjWithMaterializedPreloadedTraces: (): SimpleRouteJson => checkpoint.srj,
  getPreloadedTraceUpdatesAfterHighDensity: (): typeof updates => updates,
})
const repair04Index = pipeline.pipelineDef.findIndex(
  (stage) => stage.solverName === "repair04Solver",
)
if (repair04Index < 0) throw new Error("Pipeline9 has no repair04 stage")
pipeline.currentPipelineStepIndex = repair04Index
pipeline.activeSubSolver = null
let phase = ""
while (!pipeline.solved && !pipeline.failed) {
  if (pipeline.getCurrentPhase() !== phase) {
    phase = pipeline.getCurrentPhase()
    console.log(`${mode} ${phase} ${Math.round(performance.now() - started)}ms`)
  }
  pipeline.step()
}
if (pipeline.failed)
  throw new Error(
    `Replay failed in ${pipeline.getCurrentPhase()}: ${pipeline.error}`,
  )
const output = pipeline.getOutputSimpleRouteJson()
const encodedOutput = JSON.stringify(output)
const outputSha256 = createHash("sha256").update(encodedOutput).digest("hex")
let baselineMatches: boolean | null = null
let baselineGeometryMatches: boolean | null = null
let maximumNumericDifference = 0
if (baselineOutputPath) {
  const expected = JSON.parse(
    await readFile(resolve(baselineOutputPath), "utf8"),
  )
  baselineMatches = JSON.stringify(expected) === encodedOutput
  // ARM64 Linux/Bun 1.4 and macOS/Bun 1.3 occasionally differ at ~1e-16 mm.
  // Keep exact metadata/structure and permit only 1e-12 numeric roundoff.
  const matches = (before: unknown, after: unknown): boolean => {
    if (typeof before === "number" && typeof after === "number") {
      maximumNumericDifference = Math.max(
        maximumNumericDifference,
        Math.abs(before - after),
      )
      return (
        Number.isFinite(before) &&
        Number.isFinite(after) &&
        Math.abs(before - after) <= 1e-12
      )
    }
    if (before === after) return true
    if (Array.isArray(before) && Array.isArray(after)) {
      return (
        before.length === after.length &&
        before.every((value, index) => matches(value, after[index]))
      )
    }
    if (
      before &&
      after &&
      typeof before === "object" &&
      typeof after === "object" &&
      !Array.isArray(before) &&
      !Array.isArray(after)
    ) {
      const keys = Object.keys(before)
      return (
        keys.length === Object.keys(after).length &&
        keys.every(
          (key) =>
            key in after &&
            matches(
              (before as Record<string, unknown>)[key],
              (after as Record<string, unknown>)[key],
            ),
        )
      )
    }
    return false
  }
  baselineGeometryMatches = matches(expected, JSON.parse(encodedOutput))
  if (!baselineGeometryMatches)
    throw new Error(
      "Disabled checkpoint replay differs from the full baseline structure or geometry by more than 1e-12; do not use its candidate measurements",
    )
}
const relaxed = evaluateRelaxedDrc({
  inputSrj: checkpoint.originalSrj,
  srjWithPointPairs: checkpoint.srjWithPointPairs,
  routedTraces: pipeline.getOutputSimplifiedPcbTraces(),
  drcOptions: { includeViaPadChecks: true },
})
const strict = getDrcErrors(relaxed.circuitJson, { includeViaPadChecks: true })
await writeFile(resolve(outputPath), encodedOutput)
const result = {
  mode,
  validationSuite: "repair04-via-pad-v1",
  datasetCommit: checkpoint.datasetCommit,
  inputSha256: checkpoint.inputSha256,
  outputSha256,
  baselineMatches,
  baselineGeometryMatches,
  maximumNumericDifference,
  elapsedTimeMs: performance.now() - started,
  relaxedErrors: relaxed.errorsWithCenters,
  strictErrors: strict.errorsWithCenters,
  repair04Stats: pipeline.repair04Solver?.stats,
  repair04AdvancedStats: pipeline.repair04AdvancedSolver?.stats,
  jointRepairStats: pipeline.pipeline9JointDrcRepairSolver?.stats,
  stageTiming: pipeline.timeSpentOnPhase,
}
await writeFile(
  resolve(`${outputPath}.result.json`),
  JSON.stringify(result, null, 2),
)
console.log(
  JSON.stringify({
    ...result,
    relaxedErrors: result.relaxedErrors.length,
    strictErrors: result.strictErrors.length,
  }),
)
