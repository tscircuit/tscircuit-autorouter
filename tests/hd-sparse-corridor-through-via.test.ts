import { expect, test } from "bun:test"
import { SparseVisibilityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/SparseVisibilityIntraNodeSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("sparse layered paths retain endpoints and keep through-via barrels away from every layer", () => {
  const solver = new SparseVisibilityIntraNodeSolver({
    layerCount: 4, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1,
    nodeWithPortPoints: {
      capacityMeshNodeId: "layers", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 3],
      portPoints: [
        { x: -2, y: -1, z: 0, connectionName: "a", pcb_port_id: "a-start" },
        { x: 2, y: 1, z: 0, connectionName: "a", pcb_port_id: "a-end" },
        { x: -2, y: 1, z: 0, connectionName: "b" },
        { x: 2, y: -1, z: 3, connectionName: "b" },
      ],
    },
    obstacles: [
      { type: "rect", layers: ["inner1"], connectedTo: [], center: { x: -2, y: 1 }, width: 0.5, height: 0.5 },
      { type: "rect", layers: ["inner2"], connectedTo: [], center: { x: 2, y: -1 }, width: 0.5, height: 0.5 },
    ],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const a = solver.solvedRoutes.find((route) => route.connectionName === "a")!
  const b = solver.solvedRoutes.find((route) => route.connectionName === "b")!
  expect(a.route[0]).toMatchObject({ x: -2, y: -1, z: 0, pcb_port_id: "a-start" })
  expect(a.route.at(-1)).toMatchObject({ x: 2, y: 1, z: 0, pcb_port_id: "a-end" })
  expect(b.vias.length).toBeGreaterThan(0)
  for (const via of b.vias) {
    expect(Math.hypot(via.x + 2, via.y - 1)).toBeGreaterThan(0.5)
    expect(Math.hypot(via.x - 2, via.y + 1)).toBeGreaterThan(0.5)
  }
  expect(doPipeline9RoutesHaveCopperConflict({ left: a, right: b, clearance: 0.1 - 1e-6, layerCount: 4 })).toBe(false)
})
