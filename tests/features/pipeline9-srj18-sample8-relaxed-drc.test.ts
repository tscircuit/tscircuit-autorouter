import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 8's crowded trace/via clearances", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 8)
  const originalScenario = structuredClone(scenario)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
  const repairSolver = solver.pipeline9JointDrcRepairSolver!
  const previousRoutes = repairSolver.params.newHdRoutes
  const routes = repairSolver.getOutput()
  const physicalSrj = {
    ...createSrjWithBoardValidObstacleLayers(scenario),
    traces: undefined,
  }
  const originalViolations = new Map(
    getFixedObstacleViolations({
      srj: physicalSrj,
      routes: previousRoutes,
    }).map(({ key, severity }) => [key, severity]),
  )
  for (const { key, severity } of getFixedObstacleViolations({
    srj: physicalSrj,
    routes,
  })) {
    expect(originalViolations.has(key)).toBeTrue()
    expect(severity).toBeLessThanOrEqual(originalViolations.get(key)! + 1e-8)
  }
  expect(
    getNewViaPadViolations({ srj: physicalSrj, previousRoutes, routes }),
  ).toHaveLength(0)
  expect(
    routes.map((route) => [route.traceThickness, route.viaDiameter]),
  ).toEqual(
    previousRoutes.map((route) => [route.traceThickness, route.viaDiameter]),
  )
  expect(scenario).toEqual(originalScenario)
})
