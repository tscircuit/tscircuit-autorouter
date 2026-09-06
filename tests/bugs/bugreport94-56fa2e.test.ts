import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { getCurrentCircuitJson } from "lib/testing/autorouting-pipeline-debugger/getCurrentCircuitJson"
import { combinePreloadedAndRoutedTraces } from "lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"
import bugReport from "../../fixtures/bug-reports/bugreport94-56fa2e/bugreport94-56fa2e.json" with {
  type: "json",
}
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

type DiagnosticRoute = HighDensityRoute | SimplifiedPcbTrace

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport94-56fa2e.json with Pipeline 9", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
  )
  solver.solve()

  const circuitJson = getCurrentCircuitJson(solver)
  expect(circuitJson).not.toBeNull()
  const { errors } = getDrcErrors(circuitJson!)
  const diagnostic: string = JSON.stringify(errors)
  if (errors.length > 5) {
    const affectedTraces: SimplifiedPcbTrace[] =
      combinePreloadedAndRoutedTraces(
        srj.traces ?? [],
        solver.getOutputSimplifiedPcbTraces(),
      ).filter((trace: SimplifiedPcbTrace): boolean =>
        diagnostic.includes(trace.pcb_trace_id),
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
    const joint: NonNullable<typeof solver.pipeline9JointDrcRepairSolver> =
      solver.pipeline9JointDrcRepairSolver!
    const postRepair: NonNullable<
      typeof solver.postRepairTraceSimplificationSolver
    > = solver.postRepairTraceSimplificationSolver!
    if (!joint || !postRepair) {
      throw new Error("Completed Pipeline9 output is missing repair stages")
    }
    const stages: Record<string, DiagnosticRoute[]> = {
      finalTraces: affectedTraces,
      final: selectRelevantRoutes(solver._getOutputHdRoutes()),
      postRepair: selectRelevantRoutes(postRepair.simplifiedHdRoutes),
      jointPreloads: joint
        .getUpdatedPreloadedTraces()
        .filter((trace: SimplifiedPcbTrace): boolean =>
          affectedNetNames.has(trace.connection_name),
        ),
      joint: selectRelevantRoutes(joint.getOutput()),
      preJointPreloads: joint.params.updatedPreloadedTraces.filter(
        (trace: SimplifiedPcbTrace): boolean =>
          affectedNetNames.has(trace.connection_name),
      ),
      preJoint: selectRelevantRoutes(joint.params.newHdRoutes),
    }
    // Emit one route per call: even a multiline board-sized console payload
    // can be truncated before the later stages reach the CI log.
    for (const [stage, routes] of Object.entries(stages)) {
      for (const route of routes) {
        console.error("Bug94 route", JSON.stringify({ stage, route }))
      }
    }
    console.error("Bug94 joint stats", JSON.stringify(joint.stats))
  }
  expect(errors.length, diagnostic).toBeLessThanOrEqual(5)
  const targetOverlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_108") &&
      error.pcb_trace_error_id.includes("source_trace_138"),
  )
  expect(targetOverlap).toBeUndefined()
  const transferredOverlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_108"),
  )
  expect(transferredOverlap).toBeUndefined()

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
})
