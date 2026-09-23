import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("repair preparation preserves first node matches and geometric assignment order", () => {
  const nodes: NodeWithPortPoints[] = [
    { capacityMeshNodeId: "duplicate", center: { x: 0, y: 0 } },
    { capacityMeshNodeId: "duplicate", center: { x: 10, y: 0 } },
    { capacityMeshNodeId: "", center: { x: 20, y: 0 } },
    { capacityMeshNodeId: "overlap", center: { x: 10, y: 0 } },
  ].map((node) => ({ ...node, width: 2, height: 2, portPoints: [] }))
  const routes: HighDensityRoute[] = [
    { regionId: "missing", x: 10 },
    { regionId: "duplicate", x: 10 },
    { regionId: "", x: 10 },
    { regionId: undefined, x: 0 },
    { regionId: "missing", x: 30 },
    { regionId: "overlap", x: 10 },
  ].map(({ regionId, x }, index) => ({
    connectionName: `route-${index}`,
    regionId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x, y: 0, z: 0 },
      { x: x + 0.1, y: 0, z: 0 },
    ],
    vias: [],
  }))
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: nodes,
    hdRoutes: routes,
    obstacles: [],
  })
  expect(solver.sampleEntries.map((entry) => entry.routeIndexes)).toEqual([
    [0, 2],
    [1, 3],
    [5],
  ])
  expect(solver.sampleEntries[0].node).toBe(nodes[1])
  expect(solver.sampleEntries[1].node).toBe(nodes[0])
  expect(solver.sampleEntries[2].node).toBe(nodes[3])
})
