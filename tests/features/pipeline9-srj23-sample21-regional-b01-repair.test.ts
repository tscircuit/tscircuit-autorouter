import { expect, test } from "bun:test"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"

test("Pipeline9 repairs SRJ23 sample21 trace and via-pad conflicts without new peer shorts", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 21)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .regionalB01RepairPreloadEligibleDrcIssueCount,
  ).toBeLessThanOrEqual(1)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toEqual([])
  const jointRepair = solver.pipeline9JointDrcRepairSolver!
  const signal = solver
    ._getOutputHdRoutes()
    .find((route) => route.connectionName === "source_net_6_mst0")!
  expect(signal).toBeDefined()
  const preloadedRoutes = jointRepair
    .getUpdatedPreloadedTraces()
    .flatMap((trace, index): HighDensityRoute[] =>
      convertPreloadedTraceToHdRoutes(
        trace,
        index,
        scenario.layerCount,
        0.3,
        jointRepair.params.connMap,
      ),
    )
    .filter(
      (route): boolean =>
        !arePipeline9RoutesOnSameNet(
          { left: signal, right: route },
          jointRepair.params.connMap,
        ),
    )
  expect(preloadedRoutes.length).toBeGreaterThan(0)
  expect(
    preloadedRoutes.some((route) =>
      doPipeline9RoutesHaveCopperConflict({
        left: signal,
        right: route,
        clearance: 0,
        layerCount: scenario.layerCount,
        allowBlindAndBuriedVias: scenario.allowBlindAndBuriedVias,
      }),
    ),
  ).toBeFalse()
})
