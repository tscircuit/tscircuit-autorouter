import { expect, test } from "bun:test"
import { TraceContactGuard } from "high-density-repair03/lib"
import { Pipeline9RepairResultSelectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RepairResultSelectionSolver"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("repair result selection retains an improvement with residual DRC errors", (): void => {
  const { originalSrj, routes, drcEvaluator } =
    createBoundedRegionalRepairFixture(2)
  const [first, second] = routes
  if (!first || !second) throw new Error("Expected two fixture routes")
  const partiallyRepairedRoutes = [
    {
      ...first,
      route: [
        first.route[0]!,
        { x: -0.5, y: -0.6, z: 0 },
        { x: 0.5, y: -0.6, z: 0 },
        first.route.at(-1)!,
      ],
    },
    second,
  ]
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const traceContactRepairSrj = { ...originalSrj, traces: undefined }
  const traceContactGuard = new TraceContactGuard({
    srj: traceContactRepairSrj,
    inputRoutes: routes,
    connMap,
  })
  const remainingErrors = getPipeline9DrcErrors(
    drcEvaluator,
    partiallyRepairedRoutes,
  )
  expect(remainingErrors.length).toBeGreaterThan(0)
  expect(remainingErrors.length).toBeLessThan(
    getPipeline9DrcErrors(drcEvaluator, routes).length,
  )

  for (const [regionalRepairRoutes, preRegionalRepairRoutes] of [
    [partiallyRepairedRoutes, routes],
    [routes, partiallyRepairedRoutes],
  ] as const) {
    const solver = new Pipeline9RepairResultSelectionSolver({
      regionalRepairRoutes,
      preRegionalRepairRoutes,
      traceContactGuard,
      drcEvaluator,
      traceContactRepairParams: {
        srj: traceContactRepairSrj,
        inputHdRoutes: routes,
        connMap,
        drcEvaluator,
        broadMaxIterations: 12,
        broadPassMultiplier: 3,
      },
    })
    solver.solve()

    expect(solver.solved).toBeTrue()
    expect(solver.getOutput()).toEqual(partiallyRepairedRoutes)
    expect(traceContactGuard.getNewContactPairs(solver.getOutput())).toEqual([])
  }
})
