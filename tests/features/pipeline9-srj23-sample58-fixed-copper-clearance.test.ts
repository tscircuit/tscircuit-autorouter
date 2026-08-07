import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves B01 fixed-copper clearance in SRJ23 sample 58", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 58)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solveUntilPhase("highDensityForceImproveSolver")

  expect(solver.highDensityRouteSolver?.solved).toBeTrue()
  expect(solver.highDensityRouteSolver?.failed).toBeFalse()
  expect(
    Number(solver.highDensityRouteSolver?.stats.fixedObstacleUses),
  ).toBeGreaterThan(0)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.netToPointPairsSolver?.newConnections ?? [],
      originalConnections: scenario.connections,
      hdRoutes: solver.highDensityRouteSolver!.routes,
      layerCount: scenario.layerCount,
      obstacles: scenario.obstacles,
      defaultViaHoleDiameter: solver.viaHoleDiameter,
      connMap: solver.connMap,
    }),
  })
  expect(errors).toHaveLength(0)
})
