import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("repair02 does not construct samples that exceed its existing limit", () => {
  const nodes = [0, 4].map((x, index) => ({
    capacityMeshNodeId: `cell${index}`,
    center: { x, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [],
  }))
  const routes: HighDensityRoute[] = nodes.map((node) => ({
    regionId: node.capacityMeshNodeId,
    connectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: node.center.x - 1, y: 0, z: 0 },
      { x: node.center.x + 1, y: 0, z: 0 },
    ],
  }))
  const obstacles: Obstacle[] = nodes.map((node) => ({
    type: "rect",
    center: { x: node.center.x - 1, y: 0 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["pad"],
  }))
  const connMap = new ConnectivityMap({ net: ["route", "pad"] })
  const connectivityCheck = spyOn(connMap, "areIdsConnected")
  const params = {
    nodeWithPortPoints: nodes,
    hdRoutes: routes,
    obstacles,
    connMap,
  }

  for (const maxSampleEntries of [0, 1]) {
    const solver = new Pipeline4HighDensityRepairSolver({
      ...params,
      maxSampleEntries,
    })
    expect(solver.sampleEntries).toEqual([])
    expect(solver.stats.skippedSampleCount).toBe(2)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.getOutput()).toEqual(routes)
    expect(connectivityCheck).not.toHaveBeenCalled()
  }

  for (const maxSampleEntries of [2, undefined]) {
    const solver = new Pipeline4HighDensityRepairSolver({
      ...params,
      maxSampleEntries,
    })
    expect(solver.sampleEntries).toHaveLength(2)
    expect(solver.stats.skippedSampleCount).toBe(0)
    for (const entry of solver.sampleEntries) {
      const [route] = entry.sample.nodeHdRoutes!
      expect(route!.connectedPadSides).toEqual(["left"])
    }
  }
  connectivityCheck.mockRestore()
})
