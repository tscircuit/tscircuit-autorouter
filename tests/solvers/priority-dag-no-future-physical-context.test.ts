import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("no-future DAG preserves ancestor copper, actual own drill rules, and unrelated retained contexts", () => detailedPriority(() => {
  const params = { ...priorityParams(), predictFutureConnections: false }
  const solver = new PriorityDagIntraNodeSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  for (let i = 0; i < solver.solvedRoutes.length; i++) for (let j = i + 1; j < solver.solvedRoutes.length; j++) {
    expect(doPipeline9RoutesHaveCopperConflict({ left: solver.solvedRoutes[i], right: solver.solvedRoutes[j], clearance: 0.1, layerCount: 2 })).toBe(false)
  }
  const guarded = new PriorityDagIntraNodeSolver({ ...params, viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.35 })
  const tasks = Reflect.get(guarded, "tasks")
  const route = { connectionName: "c", rootConnectionName: "root-c", regionId: "region", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 1.5, y: 2.2, z: 0 }, { x: 2.7, y: 2.2, z: 0 }], vias: [{ x: 1.6, y: 2.2 }, { x: 2, y: 2.2 }] }
  const state = { ancestors: tasks.map(() => new Set<number>()), witnesses: tasks.map(() => undefined) }
  Reflect.get(guarded, "storeRoute").call(guarded, route, state, 0)
  expect(Reflect.get(guarded, "validateRoute").call(guarded, 0, state)).toBe(false)
  state.ancestors[1].add(0)
  const opts = Reflect.get(guarded, "getOptions").call(guarded, 1, state)
  expect(opts.futureConnections).toEqual([])
  expect(opts.obstacleRoutes).toHaveLength(1)
  expect(opts.obstacleRoutes[0].connectionName).toBe("c")
  expect(() => Reflect.get(guarded, "acceptState").call(guarded, { ...state, ancestors: [new Set([1]), ...state.ancestors.slice(1)] })).toThrow("Stale retained priority witness")
}))
