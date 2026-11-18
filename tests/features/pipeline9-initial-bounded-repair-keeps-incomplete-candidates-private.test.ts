import { expect, spyOn, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("an incomplete initial bounded result seeds exact repair and can win the final DRC comparison", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  const original = structuredClone(fixture.routes)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: fixture.routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  const initial = solver.initialBoundedRegionalRepairSolver!
  const getResult = initial.getResult.bind(initial)
  const resultSpy = spyOn(initial, "getResult").mockImplementation(() => ({
    ...getResult(),
    publishedDrcIssueCount: 1,
    repaired: false,
  }))
  try {
    while (!solver.exactRepairSolver && !solver.failed) solver.step()
    expect(initial.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeFalse()
    expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeFalse()
    expect(getResult().routes).not.toEqual(original)
    const exact = solver.exactRepairSolver!
    const regionalCandidate = exact.params.hdRoutes
    const before = fixture.drcEvaluator({ traces: [], routes: original })
    const after = fixture.drcEvaluator({
      traces: [],
      routes: regionalCandidate,
    })
    const originalErrors = Array.isArray(before) ? before : before.errors
    expect(Array.isArray(after) ? after : after.errors).toHaveLength(0)
    expect(originalErrors).not.toHaveLength(0)
    expect(fixture.routes).toEqual(original)

    // Exercise publication when later repair produces worse copper than the
    // checked regional seed.
    const exactStep = spyOn(exact, "step").mockImplementation((): void => {
      exact.outputHdRoutes = original
      exact.solved = true
    })
    try {
      while (!solver.boundedRegionalRepairSolver && !solver.failed) {
        expect(solver.solved).toBeFalse()
        solver.step()
      }
      const bounded = solver.boundedRegionalRepairSolver!
      const getFinalResult = bounded.getResult.bind(bounded)
      const finalResult = spyOn(bounded, "getResult")
      finalResult.mockImplementation(() => ({
        ...getFinalResult(),
        routes: original,
        publishedDrcIssueCount: originalErrors.length,
      }))
      try {
        solver.solve()
        expect(solver.failed).toBeFalse()
        expect(solver.solved).toBeTrue()
        expect(solver.getOutput()).toEqual(regionalCandidate)
        expect(solver.stats.finalDrcIssueCount).toBe(0)
        const publishedDrc = fixture.drcEvaluator({
          traces: [],
          routes: solver.getOutput(),
        })
        const publishedErrors = Array.isArray(publishedDrc)
          ? publishedDrc
          : publishedDrc.errors
        expect(publishedErrors).toEqual([])
      } finally {
        finalResult.mockRestore()
      }
    } finally {
      exactStep.mockRestore()
    }
  } finally {
    resultSpy.mockRestore()
  }
})
