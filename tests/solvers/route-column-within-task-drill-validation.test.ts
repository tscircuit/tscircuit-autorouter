import { expect, test } from "bun:test"
import { RouteColumnIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/RouteColumnIntraNodeSolver"

test("a within-task close drill pair is rejected by actual hole geometry without learning a cut", () => {
  const candidate = new RouteColumnIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "two-vias", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", x: -0.1, y: 0, z: 0 }, { connectionName: "a", x: 0.1, y: 0, z: 0 },
        { connectionName: "b", x: -1, y: 0.8, z: 0 }, { connectionName: "b", x: 1, y: 0.8, z: 0 },
      ],
    }, traceWidth: 0.1, viaDiameter: 0.3, viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.2, obstacleMargin: 0.1,
  })
  candidate.step()
  const graph = candidate.engine!.graph
  const vertices = [[-0.1, 0, 0], [-0.1, 0, 1], [0.1, 0, 1], [0.1, 0, 0], [-1, 0.8, 0], [1, 0.8, 0]].map(([x, y, z]) =>
    graph.vertices.findIndex((point) => point.x === x && point.y === y && point.z === z))
  expect(vertices.every((vertex) => vertex >= 0)).toBe(true)
  candidate.engine!.paths = [{ vertices: vertices.slice(0, 4), primitives: [] }, { vertices: vertices.slice(4), primitives: [] }]
  const before = structuredClone(candidate.engine!.capacityRows)
  ;(candidate as unknown as { acceptGeometry: () => void }).acceptGeometry()
  expect(candidate.failed).toBe(true)
  expect(candidate.solved).toBe(false)
  expect(candidate.counters.routeColumnFinalDrillIssueCount).toBe(1)
  expect(candidate.engine!.capacityRows).toEqual(before)
  expect(candidate.error).toContain("board copper validation")
})
