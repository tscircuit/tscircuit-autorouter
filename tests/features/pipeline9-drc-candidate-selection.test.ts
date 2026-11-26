import { expect, test } from "bun:test"
import { TraceContactGuard } from "high-density-repair03/lib"
import { Pipeline9DrcCandidateSelectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DrcCandidateSelectionSolver"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("DRC candidate selection keeps the better route with residual errors", (): void => {
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
  const contactRepairSrj = { ...originalSrj, traces: undefined }
  const contactGuard = new TraceContactGuard({
    srj: contactRepairSrj,
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

  for (const [regionalRoutes, preRegionalRoutes] of [
    [partiallyRepairedRoutes, routes],
    [routes, partiallyRepairedRoutes],
  ] as const) {
    const solver = new Pipeline9DrcCandidateSelectionSolver({
      regionalRoutes,
      preRegionalRoutes,
      contactGuard,
      referenceDrcEvaluator: drcEvaluator,
      contactRepairParams: {
        srj: contactRepairSrj,
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
    expect(contactGuard.getNewContactPairs(solver.getOutput())).toEqual([])
  }
})
