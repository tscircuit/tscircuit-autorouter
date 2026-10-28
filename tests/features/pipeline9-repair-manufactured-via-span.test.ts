import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("Pipeline9 repair uses the manufactured via span outside its transition layers", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "via-region",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [1, 3],
    portPoints: [],
  }
  const route: HighDensityRoute = {
    connectionName: "signal",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0.2, z: 3 },
      { x: 0, y: 0.2, z: 3 },
      { x: 0, y: 0.2, z: 1 },
      { x: 1, y: 0.2, z: 1 },
    ],
    vias: [{ x: 0, y: 0.2 }],
  }
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    connectedTo: ["ground"],
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["signal"], ["ground"]])
  for (const allowBlindAndBuriedVias of [false, true]) {
    const solver = new Pipeline4HighDensityRepairSolver({
      nodeWithPortPoints: [node],
      hdRoutes: [structuredClone(route)],
      obstacles: [obstacle],
      repairMargin: 0.2,
      minimumTraceWidth: 0.1,
      connMap,
      viaSpanContext: { layerCount: 4, allowBlindAndBuriedVias },
    })
    solver.solve()
    expect(solver.sampleEntries[0]!.sample.layerCount).toBe(4)
    expect(solver.sampleEntries[0]!.sample.allowBlindAndBuriedVias).toBe(allowBlindAndBuriedVias)
    expect(solver.stats.nodeClearanceInitialConflictCount).toBe(allowBlindAndBuriedVias ? 0 : 1)
    expect(solver.stats.nodeClearanceFinalConflictCount).toBe(0)
    const repaired = solver.getOutput()[0]!
    expect(repaired.route[0]).toEqual(route.route[0])
    expect(repaired.route.at(-1)).toEqual(route.route.at(-1))
    if (!allowBlindAndBuriedVias) {
      const via = repaired.vias[0]!
      const dx = Math.max(0, Math.abs(via.x) - obstacle.width / 2)
      const dy = Math.max(0, Math.abs(via.y) - obstacle.height / 2)
      expect(Math.hypot(dx, dy) - route.viaDiameter / 2).toBeGreaterThanOrEqual(0.1)
    }
    const [roundTripParams] = solver.getConstructorParams()
    expect(roundTripParams.viaSpanContext).toEqual({ layerCount: 4, allowBlindAndBuriedVias })
    const roundTrip = new Pipeline4HighDensityRepairSolver(roundTripParams)
    roundTrip.solve()
    expect(roundTrip.stats.nodeClearanceInitialConflictCount).toBe(solver.stats.nodeClearanceInitialConflictCount)
    expect(roundTrip.getOutput()).toEqual(solver.getOutput())
  }
})
