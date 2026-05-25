import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"
import { test, expect } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import "graphics-debug/matcher"
const nodeWithPortPoints = {
  capacityMeshNodeId: "node1",
  center: { x: 5, y: 5 },
  width: 2,
  height: 2,
  portPointsInPairs: createPortPointPairsFromPortPoints([
    { connectionName: "A", x: 4, y: 4, z: 1 },
    { connectionName: "A", x: 6, y: 6, z: 0 },
    { connectionName: "B", x: 5, y: 4, z: 0 },
    { connectionName: "B", x: 4, y: 6, z: 1 },
  ]),
}
test("hdpolyline02", () => {
  const solver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
