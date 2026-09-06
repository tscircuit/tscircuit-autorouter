import { expect, test } from "bun:test"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { preparePipeline9DrcRoutedTracesWithMetadata } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9DrcRoutedTraces"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 keeps the current SRJ23 regional repair residue bounded", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 21)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  while (
    !solver.pipeline9JointDrcRepairSolver &&
    !solver.solved &&
    !solver.failed
  ) {
    solver.step()
  }
  const jointRepair = solver.pipeline9JointDrcRepairSolver
  if (!jointRepair) {
    throw new Error("Expected Pipeline9 joint repair before publication")
  }
  const publicationDiagnostics: Array<{
    candidateErrors: ReturnType<typeof evaluateRelaxedDrc>["errors"]
    accepted: boolean
  }> = []
  let diagnosticTimeMs = 0
  const originalPublish =
    jointRepair["publishValidatedOutput"].bind(jointRepair)
  const convertNewRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
      connections: jointRepair.params.newConnections,
      originalConnections: jointRepair.params.originalSrj.connections,
      layerCount: jointRepair.params.layerCount,
      obstacles: jointRepair.params.obstacles,
      defaultViaHoleDiameter: jointRepair.params.defaultViaHoleDiameter,
      connMap: jointRepair.params.connMap,
    })
  const traceClearance =
    jointRepair.params.originalSrj.minTraceToPadEdgeClearance ??
    RELAXED_DRC_OPTIONS.traceClearance ??
    0.1
  // Observe this one real proposal without changing candidate generation or
  // acceptance. Rebuild every fixed span before the diagnostic official check.
  jointRepair["publishValidatedOutput"] = (
    routes: HighDensityRoute[],
  ): void => {
    originalPublish(routes)
    const diagnosticStartedAt = performance.now()
    const changedPreloadedTraceIds = new Set([
      ...jointRepair.params.mutatedPreloadedTraceIds,
      ...jointRepair.movablePreloadedSections.map(
        (section) => section.originalTrace.pcb_trace_id,
      ),
    ])
    const preparedCandidate = preparePipeline9DrcRoutedTracesWithMetadata({
      originalPreloadedTraces: jointRepair.params.originalSrj.traces ?? [],
      mutatedPreloadedTraces: jointRepair["rebuildUpdatedPreloadedTraces"](
        routes,
      ).filter((trace) => changedPreloadedTraceIds.has(trace.pcb_trace_id)),
      newTraces: convertNewRoutes(
        routes.filter(
          (route) =>
            !jointRepair.syntheticConnectionNames.has(route.connectionName),
        ),
      ),
    })
    const candidateDrc = evaluateRelaxedDrc({
      inputSrj: jointRepair.params.originalSrj,
      srjWithPointPairs: jointRepair.params.srjWithPointPairs,
      routedTraces: preparedCandidate.routedTraces,
      drcOptions: { traceClearance },
    })
    publicationDiagnostics.push({
      candidateErrors: candidateDrc.errors,
      accepted: jointRepair.stats.jointOutputAccepted === true,
    })
    diagnosticTimeMs += performance.now() - diagnosticStartedAt
  }

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  console.log(
    JSON.stringify({
      dataset: "srj23",
      sample: 21,
      finalErrors: errors,
      publicationDiagnostics,
      diagnosticTimeMs,
      pipelineTimingIncludesDiagnosticOverhead: true,
      jointRepairStats: solver.pipeline9JointDrcRepairSolver?.stats,
    }),
  )
  expect(publicationDiagnostics).toHaveLength(1)
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .regionalB01RepairPreloadEligibleDrcIssueCount,
  ).toBe(1)
  expect(errors.length).toBeLessThanOrEqual(1)
  expect(errors.every((error) => error.type === "pcb_trace_error")).toBeTrue()
})
