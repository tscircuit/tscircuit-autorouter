import { expect, test } from "bun:test"
import { validateComputeSelectionOutcome } from "../../lib/solvers/HyperHighDensitySolver/validateComputeSelectionOutcome"
import type { HighDensityRoute, NodeWithPortPoints } from "../../lib/types/high-density-types"

test("local acceptance checks the actual explicit interface and rejects malformed physical layer witnesses", (): void => {
  const ports = [{ connectionName: "signal", portPointId: "a", x: -1, y: 0, z: 0 }, { connectionName: "signal", portPointId: "b", x: 1, y: 0, z: 0 }]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "explicit", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: ports, portPointsInPairs: [[{ ...ports[0]! }, { ...ports[1]! }]] }
  const routes: HighDensityRoute[] = [{ connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3, vias: [], route: ports }]
  const params = { node, routes, obstacles: [], layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15, validationScope: "local-structure" as const }
  expect(validateComputeSelectionOutcome(params)).toBe(true)
  for (const change of [{ x: Number.NaN }, { x: -0.5 }, { connectionName: "foreign" }, { pcb_port_id: "invented-pad" }, { z: 3 }]) {
    const invalid = structuredClone(node)
    Object.assign(invalid.portPointsInPairs![0]![0], change)
    expect(() => validateComputeSelectionOutcome({ ...params, node: invalid })).toThrow("interface witness")
  }
  expect(() => validateComputeSelectionOutcome({ ...params, obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1, layers: ["top"], __zLayers: [Number.NaN], connectedTo: [] }] })).toThrow("invalid copper layers")
})
