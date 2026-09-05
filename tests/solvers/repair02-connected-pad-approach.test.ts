import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("repair02 adapter preserves the BGA pad approach using connMap", () => {
  const route: HighDensityRoute = {
    connectionName: "source_trace_4", traceThickness: 0.1,
    vias: [], viaDiameter: 0.5,
    route: [
      { x: -0.825, y: -3.175, z: 0 },
      { x: -0.854, y: -3.305, z: 0 },
      { x: -0.839, y: -3.4, z: 0 },
      { x: -0.82, y: -3.484, z: 0 },
      { x: -0.785, y: -3.539, z: 0 },
      { x: -0.767, y: -3.618, z: 0 },
      { x: -0.752, y: -3.725, z: 0 },
      { x: -0.612, y: -3.725, z: 0 },
    ],
  }
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [{
      capacityMeshNodeId: "cmn_1", center: { x: 0.15, y: -2.95 },
      width: 4.65, height: 1.55, availableZ: [0, 1], portPoints: [],
    }],
    hdRoutes: [route], repairMargin: 0.2,
    obstacles: [{
      type: "rect", center: { x: -0.825, y: -4.2 },
      width: 0.8, height: 0.95, layers: ["top"], connectedTo: ["pcb_smtpad_40"],
    }],
    connMap: new ConnectivityMap({ net: ["source_trace_4", "pcb_smtpad_40"] }),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const points = solver.getOutput()[0]!.route
  expect(points).toHaveLength(route.route.length)
  for (let i = 0; i < points.length; i++) {
    expect(points[i]!.x).toBeCloseTo(route.route[i]!.x, 10)
    expect(points[i]!.y).toBeCloseTo(route.route[i]!.y, 10)
    if (i > 0) expect(points[i]!.y).toBeLessThanOrEqual(points[i - 1]!.y)
  }
})
