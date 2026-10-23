import { test, expect } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"

test("group physical proofs run only in the original coordinate frame", () => {
  const grow = new GrowShrinkHighDensityIntraNodeSolver({ nodeWithPortPoints: { capacityMeshNodeId: "scale", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [{ connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 0 }] }, connMap: new ConnectivityMap({}), viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.1, enableInteractionGrouping: true })
  const create = () => (grow as unknown as { createActiveSubSolver: () => void }).createActiveSubSolver()
  create()
  expect(grow.activeSubSolver!.constructorParams.enableInteractionGrouping).toBe(true)
  expect(grow.activeSubSolver!.getCombinationDefs()).toContainEqual(["interactionGrouping"])
  grow.scaleFactor = 2
  create()
  expect(grow.activeSubSolver!.constructorParams.enableInteractionGrouping).toBe(false)
  expect(grow.activeSubSolver!.getCombinationDefs()).not.toContainEqual(["interactionGrouping"])
  expect(grow.activeSubSolver!.getCombinationDefs()).toContainEqual(["highDensityA01"])
})
