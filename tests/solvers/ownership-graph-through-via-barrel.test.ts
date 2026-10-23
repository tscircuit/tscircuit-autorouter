import { expect, test } from "bun:test"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { SharedOwnershipGraphSolver, type OwnershipGraph } from "lib/solvers/HyperHighDensitySolver/SharedOwnershipGraphSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a through-via clause includes intermediate copper layers absent from its endpoints", () => {
  const graph: OwnershipGraph = {
    vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, { x: -1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
    adjacency: [[{ to: 1, primitive: 0, cost: 1 }], [{ to: 0, primitive: 0, cost: 1 }], [{ to: 3, primitive: 1, cost: 1 }], [{ to: 2, primitive: 1, cost: 1 }]],
  }
  const primitives: HighDensityRoute[] = [
    { connectionName: "via", traceThickness: 0.15, viaDiameter: 0.3, route: [graph.vertices[0]!, graph.vertices[1]!], vias: [{ x: 0, y: 0 }] },
    { connectionName: "wire", traceThickness: 0.15, viaDiameter: 0.3, route: [graph.vertices[2]!, graph.vertices[3]!], vias: [] },
  ]
  const solver = new SharedOwnershipGraphSolver({
    graph, tasks: [{ connectionName: "via", owner: "a", start: 0, end: 1 }, { connectionName: "wire", owner: "b", start: 2, end: 3 }],
    primitivesConflict: (left, right): boolean => doPipeline9RoutesHaveCopperConflict({ left: primitives[left]!, right: primitives[right]!, clearance: 0.1, layerCount: 4, allowBlindAndBuriedVias: false }),
    permanentlyBlocked: (): boolean => false, maxIterations: 1000,
  })
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.exhaustedFiniteModel).toBe(true)
  expect(solver.learnedClauses[0]).toEqual({ owners: [{ task: 0, primitive: 0 }], exclusions: [] })
  expect(solver.counters.ownershipGraphBinaryGeometryClauseCount).toBe(1)
})
