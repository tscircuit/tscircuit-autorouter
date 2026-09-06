import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcResult,
} from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type DrcError = EvaluateRelaxedDrcResult["errors"][number]

test("Pipeline9 avoids accidental plated-hole contact in SRJ23 sample 26", async (): Promise<void> => {
  const { scenario }: { scenario: SimpleRouteJson } =
    await loadScenarioBySampleNumber("srj23", 26)
  const solver: AutoroutingPipelineSolver9_PreloadedTraceGraph =
    new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      { cacheProvider: null, effort: 1 },
    )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const routedTraces: SimplifiedPcbTrace[] =
    solver.getOutputSimplifiedPcbTraces()
  const result: EvaluateRelaxedDrcResult = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  // Match the benchmark's trace_plated_hole_accidental_contact category.
  // The sample's existing pad/trace clearance issue is not relaxed or hidden.
  const platedHoleContacts: DrcError[] = result.errors.filter(
    (error: DrcError): boolean =>
      error.message.includes("overlaps with pcb_plated_hole") &&
      error.message.includes("accidental contact"),
  )
  let diagnostic: string | undefined
  if (platedHoleContacts.length > 0) {
    const affectedTraceIds: Set<string> = new Set(
      platedHoleContacts.flatMap((error: DrcError): string[] =>
        "pcb_trace_id" in error && typeof error.pcb_trace_id === "string"
          ? [error.pcb_trace_id]
          : [],
      ),
    )
    const affectedTraces: SimplifiedPcbTrace[] =
      combinePreloadedAndRoutedTraces(
        scenario.traces ?? [],
        routedTraces,
      ).filter((trace: SimplifiedPcbTrace): boolean =>
        affectedTraceIds.has(trace.pcb_trace_id),
      )
    const affectedNetNames: Set<string> = new Set(
      affectedTraces.map(
        (trace: SimplifiedPcbTrace): string => trace.connection_name,
      ),
    )
    const selectRelevantRoutes = (
      routes: HighDensityRoute[],
    ): HighDensityRoute[] =>
      routes.filter((route: HighDensityRoute): boolean =>
        [...affectedNetNames].some(
          (netName: string): boolean =>
            route.connectionName === netName ||
            route.rootConnectionName === netName ||
            solver.connMap.areIdsConnected(route.connectionName, netName),
        ),
      )
    const joint: typeof solver.pipeline9JointDrcRepairSolver =
      solver.pipeline9JointDrcRepairSolver
    const postRepair: typeof solver.postRepairTraceSimplificationSolver =
      solver.postRepairTraceSimplificationSolver
    if (!joint || !postRepair) {
      throw new Error("Completed Pipeline9 output is missing repair stages")
    }
    diagnostic = JSON.stringify(
      {
        errors: result.errors,
        affectedTraceIds: [...affectedTraceIds],
        affectedNetNames: [...affectedNetNames],
        preJoint: selectRelevantRoutes(joint.params.newHdRoutes),
        joint: selectRelevantRoutes(joint.getOutput()),
        postRepair: selectRelevantRoutes(postRepair.simplifiedHdRoutes),
        final: selectRelevantRoutes(solver._getOutputHdRoutes()),
        finalTraces: affectedTraces,
        jointStats: joint.stats,
      },
      null,
      2,
    )
  }
  expect(platedHoleContacts, diagnostic).toHaveLength(0)
})
