import { expect, test } from "bun:test"
import { getNewViaPadViolations } from "@tscircuit/repair04"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixture from "../fixtures/pipeline9-coupled-post-exact-contacts.json"

test("clears coupled post-exact contacts with bounded, physically valid sweeps", (): void => {
  const srj = structuredClone(fixture.srj) as SimpleRouteJson
  const routes = structuredClone(fixture.routes) as HighDensityRoute[]
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const evaluate = (
    hdRoutes: HighDensityRoute[],
  ): ReturnType<typeof evaluateRelaxedDrc> =>
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: srj.connections,
        originalConnections: srj.connections,
        hdRoutes,
        layerCount: srj.layerCount,
        obstacles: srj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    })
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  expect(evaluate(routes).errors).toHaveLength(4)
  expect(solver.exactRepairSolver).toBeDefined()
  solver.exactRepairSolver!.getOutput = (): HighDensityRoute[] => routes
  solver.exactRepairSolver!.solved = true
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const output = solver.getOutput()
  expect(evaluate(output).errors).toHaveLength(0)
  expect(
    getNewViaPadViolations({
      srj: { ...srj, traces: undefined },
      previousRoutes: routes,
      routes: output,
    }),
  ).toEqual([])
  expect(Number(solver.stats.coalescedViaSweepCount)).toBe(1)
  expect(Number(solver.stats.postExactRegionalSweepCount)).toBeGreaterThan(0)
  expect(Number(solver.stats.postExactRegionalSweepCount)).toBeLessThanOrEqual(
    2,
  )
  expect(
    Number(solver.stats.regionalB01RepairCandidateSearchCount),
  ).toBeLessThanOrEqual(
    Number(solver.stats.regionalB01RepairCandidateSearchBudget),
  )
  for (const original of routes) {
    const repaired = output.find(
      (route) => route.connectionName === original.connectionName,
    )!
    expect(repaired.route[0]).toMatchObject(original.route[0]!)
    expect(repaired.route.at(-1)).toMatchObject(original.route.at(-1)!)
  }
})
