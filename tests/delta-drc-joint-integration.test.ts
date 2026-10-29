import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "./fixtures/pipeline9-bounded-regional-repair-fixture"

const create = (experimentDeltaDrc?: boolean): Pipeline9JointDrcRepairSolver => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  return new Pipeline9JointDrcRepairSolver({
    srj, srjWithPointPairs: srj, originalSrj: srj,
    newConnections: srj.connections, newHdRoutes: fixture.routes,
    updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj), obstacles: srj.obstacles,
    layerCount: srj.layerCount, defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15,
    effort: 1, colorMap: {}, ...(experimentDeltaDrc === undefined ? {} : { experimentDeltaDrc }),
  })
}

test("enabled delta DRC preserves Joint repair output and default OFF behavior", () => {
  const omitted = create()
  const disabled = create(false)
  const enabled = create(true)
  const scored: unknown[] = []
  for (const solver of [omitted, disabled, enabled]) {
    solver.pipelineDef.find((stage) => stage.solverName === "exactRepairSolver")!.createSolver()
    const evaluate = solver.exactRepairSolver!.params.drcEvaluator!
    const routes = createBoundedRegionalRepairFixture().routes
    scored.push(evaluate({ traces: [], routes }))
    routes[0]!.route[1]!.y = 0.05
    scored.push(evaluate({ traces: [], routes }))
    solver.solve()
  }
  expect(scored[2]).toEqual(scored[0])
  expect(scored[3]).toEqual(scored[1])
  expect(scored[4]).toEqual(scored[0])
  expect(scored[5]).toEqual(scored[1])
  expect(enabled.solved).toBeTrue()
  expect(enabled.failed).toBeFalse()
  expect(enabled.getOutput()).toEqual(omitted.getOutput())
  expect(disabled.getOutput()).toEqual(omitted.getOutput())
  expect(enabled.iterations).toBe(omitted.iterations)
  expect(disabled.iterations).toBe(omitted.iterations)
  expect(omitted.stats.experimentDeltaDrc).toBeUndefined()
  expect(disabled.stats.experimentDeltaDrc).toBeUndefined()
  expect(enabled.stats.experimentDeltaDrc).toBeTrue()
  expect(enabled.stats.deltaDrcActivated).toBeTrue()
  expect(enabled.stats.deltaDrcCalls).toBeGreaterThan(2)
  expect(enabled.stats.deltaDrcTouchedQueries).toBeGreaterThan(0)
  const stableStats = (stats: typeof omitted.stats): Record<string, unknown> => Object.fromEntries(
    Object.entries(stats).filter(([key]) => !key.toLowerCase().includes("timems")),
  )
  expect(stableStats(disabled.stats)).toEqual(stableStats(omitted.stats))
  const fixture = createBoundedRegionalRepairFixture()
  const reference = fixture.drcEvaluator({ traces: [], routes: enabled.getOutput() })
  expect(Array.isArray(reference) ? reference : reference.errors).toHaveLength(0)
})
