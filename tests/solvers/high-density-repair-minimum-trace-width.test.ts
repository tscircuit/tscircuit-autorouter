import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { segmentDistance } from "high-density-repair02/lib/high-density-repair-solver/functions/segmentDistance"

test("node repair checks the board's minimum width instead of an undersized HD trace", () => {
  const route: HighDensityRoute = {
    connectionName: "trace",
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [],
    availableZ: [0, 1],
  }
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [node],
    hdRoutes: [route],
    minimumTraceWidth: 0.4,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0.3 },
        width: 0.1,
        height: 0.1,
        layers: ["top"],
        connectedTo: [],
      },
    ],
  })
  solver.solve()
  const output = solver.getOutput()[0]
  const gap = Math.min(
    ...output.route
      .slice(1)
      .map(
        (point, index) =>
          segmentDistance(
            output.route[index],
            point,
            { x: -0.05, y: 0.25 },
            { x: 0.05, y: 0.25 },
          ) - 0.2,
      ),
  )
  expect(gap).toBeGreaterThanOrEqual(0.1 - 1e-6)
  expect(output.traceThickness).toBe(route.traceThickness)
  expect(output.route[0]).toEqual(route.route[0])
  expect(output.route.at(-1)).toEqual(route.route.at(-1))
})
