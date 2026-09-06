import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "scripts/benchmark/scenarios"

type ViaTransition = {
  start: HighDensityIntraNodeRoute["route"][number]
  end: HighDensityIntraNodeRoute["route"][number]
}
type RoutedViaSummary = {
  connectionName: SimplifiedPcbTrace["connection_name"]
  vias: SimplifiedPcbTrace["route"]
}
type StitchedViaSummary = {
  connectionName: string
  vias: HighDensityIntraNodeRoute["vias"]
  transitions: ViaTransition[]
}

test("Pipeline7 keeps srj20 sample169 DRC-clean after multi-crossing simplification", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj20", 169)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario)

  solver.solve()

  if (!solver.solved) {
    const stitchSolver = solver.highDensityStitchSolver
    const activeStitch = stitchSolver?.activeSolver
    const mergedPoints = activeStitch?.mergedHdRoute?.route
    console.error(
      JSON.stringify({
        event: "pipeline7-srj20-sample169-routing-failure",
        phase: solver.getCurrentPhase(),
        failed: solver.failed,
        error: solver.error,
        stitchError: stitchSolver?.error,
        activeStitch: activeStitch
          ? {
              error: activeStitch.error,
              connectionName: activeStitch.mergedHdRoute?.connectionName,
              start: activeStitch.start,
              end: activeStitch.end,
              mergedStart: mergedPoints?.[0],
              mergedEnd: mergedPoints?.[mergedPoints.length - 1],
              remainingRouteCount: activeStitch.remainingHdRoutes.length,
              inputHdRoutes: solver.highDensityRepairSolver
                ?.getOutput()
                .filter(
                  (route): boolean =>
                    route.connectionName ===
                    activeStitch.mergedHdRoute?.connectionName,
                ),
            }
          : null,
      }),
    )
  }

  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  const viaCount = routedTraces.reduce(
    (sum, trace) =>
      sum + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )

  if (viaCount !== 33 || errors.length > 0) {
    console.error(
      JSON.stringify({
        event: "pipeline7-srj20-sample169-output-regression",
        viaCount,
        errors,
        routedVias: routedTraces.map(
          (trace): RoutedViaSummary => ({
            connectionName: trace.connection_name,
            vias: trace.route.filter(
              (point): boolean => point.route_type === "via",
            ),
          }),
        ),
        stitchedVias: solver.highDensityStitchSolver?.mergedHdRoutes.map(
          (route): StitchedViaSummary => ({
            connectionName: route.connectionName,
            vias: route.vias,
            transitions: route.route.flatMap(
              (point, index): ViaTransition[] => {
                const next = route.route[index + 1]
                return next && point.z !== next.z
                  ? [{ start: point, end: next }]
                  : []
              },
            ),
          }),
        ),
      }),
    )
  }

  expect(errors).toHaveLength(0)
  expect(viaCount).toBe(33)
})
