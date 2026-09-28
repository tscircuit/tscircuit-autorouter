import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("high density repair preserves a through-hole transition at a rounded pad edge", () => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    regionId: "node",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -8.861, y: 20.81, z: 0 },
      { x: -8.336, y: 20.623, z: 1 },
    ],
    vias: [],
  }
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "node",
        center: { x: -8.861115, y: 20.80968 },
        width: 1.05,
        height: 2.1,
        portPoints: [],
      },
    ],
    hdRoutes: [route],
    obstacles: [
      {
        type: "rect",
        center: { x: -8.861115, y: 20.80968 },
        width: 1.05,
        height: 2.1,
        layers: ["top", "bottom"],
        connectedTo: ["pad"],
      },
    ],
    connMap: new ConnectivityMap({ net: ["signal", "pad"] }),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toEqual([route])
  expect(solver.sampleEntries).toHaveLength(0)
})
