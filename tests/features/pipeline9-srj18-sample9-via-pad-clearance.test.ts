import { expect, test } from "bun:test"
import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
  getRepairViaGeometry,
} from "@tscircuit/repair04"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 routes SRJ18 sample 9 with full via and pad clearance", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
  const input = structuredClone(scenario)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
  const repairSolver = solver.pipeline9JointDrcRepairSolver!
  const previousRoutes = repairSolver.params.newHdRoutes
  const routes = repairSolver.getOutput()
  const physicalSrj = { ...solver.originalSrj, traces: undefined }
  expect(getFixedObstacleViolations({ srj: physicalSrj, routes })).toEqual([])
  expect(
    getNewViaPadViolations({
      srj: physicalSrj,
      previousRoutes: routes,
      routes,
      includeExistingVias: routes.flatMap((route, routeIndex) =>
        getRepairViaGeometry(route, physicalSrj.layerCount).map(
          (_, viaIndex) => ({ routeIndex, viaIndex }),
        ),
      ),
    }),
  ).toEqual([])
  expect(
    routes.map((route) => [route.traceThickness, route.viaDiameter]),
  ).toEqual(
    previousRoutes.map((route) => [route.traceThickness, route.viaDiameter]),
  )
  expect(solver.originalSrj.allowViaInPad).toBeUndefined()
  expect(solver.viaDiameter).toBe(0.3)
  expect(solver.viaHoleDiameter).toBe(0.15)
  expect(scenario.allowViaInPad).toBeUndefined()
})
