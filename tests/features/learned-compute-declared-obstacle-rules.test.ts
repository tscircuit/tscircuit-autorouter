import { expect, test } from "bun:test"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { validateComputeSelectionOutcome } from "lib/solvers/HyperHighDensitySolver/validateComputeSelectionOutcome"

test("physical compute labels honor every declared pad/hole gap, exact shape, ownership and actual via span without tightening local acceptance", (): void => {
  const route: HighDensityRoute = {
    connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
    vias: [{ x: 0, y: 0 }],
    route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 1 }],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "declared-rules", center: { x: 0, y: 0 }, width: 4, height: 4,
    availableZ: [0, 1], portPoints: [route.route[0]!, route.route.at(-1)!]
      .map((point) => ({ ...point, connectionName: "a" })),
  }
  const pad: Obstacle = {
    type: "rect", layers: ["top"], center: { x: 0.6, y: 0 }, width: 0.2, height: 0.2,
    connectedTo: ["pcb_smtpad_0"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_0", pcb_port_id: "other" },
  }
  const params = { routes: [route], node, obstacles: [pad], layerCount: 2,
    traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1,
    copperRules: { minViaEdgeToPadEdgeClearance: 0.5 } }
  expect(validateComputeSelectionOutcome({ ...params, validationScope: "local-structure" })).toBe(true)
  expect(validateComputeSelectionOutcome(params)).toBe(false)
  expect(validateComputeSelectionOutcome({ ...params, copperRules: { minViaEdgeToPadEdgeClearance: 0.2 } })).toBe(true)
  expect(validateComputeSelectionOutcome({ ...params, copperRules: { minTraceToPadEdgeClearance: 0.5 } })).toBe(false)

  const innerOnly = { ...params, layerCount: 4,
    obstacles: [{ ...pad, layers: ["bottom"] }],
    copperRules: { minViaEdgeToPadEdgeClearance: 0.5, allowBlindAndBuriedVias: true } }
  expect(validateComputeSelectionOutcome(innerOnly)).toBe(true)
  expect(validateComputeSelectionOutcome({ ...innerOnly,
    copperRules: { ...innerOnly.copperRules, allowBlindAndBuriedVias: false } })).toBe(false)

  const owned = { ...params, obstacles: [{ ...pad, center: { x: 0, y: 0 }, connectedTo: ["a", "pcb_smtpad_0"] }] }
  expect(validateComputeSelectionOutcome({ ...owned, copperRules: { allowViaInPad: true } })).toBe(true)
  expect(validateComputeSelectionOutcome({ ...owned, copperRules: { allowViaInPad: false } })).toBe(false)

  const wire = { ...route, vias: [], route: [{ x: 0.49, y: 0.49, z: 0 }, { x: 0.49, y: 0.59, z: 0 }] }
  const wireNode = { ...node, portPoints: wire.route.map((point) => ({ ...point, connectionName: "a" })) }
  const circle: Obstacle = { type: "rect", shape: "circle", isNonPlatedHole: true,
    layers: ["top"], center: { x: 0, y: 0 }, width: 1, height: 1, connectedTo: [] }
  const circleParams = { ...params, routes: [wire], node: wireNode, obstacles: [circle], copperRules: { minTraceToHoleEdgeClearance: 0.1 } }
  expect(validateComputeSelectionOutcome(circleParams)).toBe(true)
  expect(validateComputeSelectionOutcome({ ...circleParams, copperRules: { minTraceToHoleEdgeClearance: 0.2 } })).toBe(false)
  const crossing = { ...wire, route: [{ x: 0.3, y: 0.3, z: 0 }, { x: 0.4, y: 0.3, z: 0 }] }
  expect(validateComputeSelectionOutcome({ ...circleParams, routes: [crossing],
    node: { ...node, portPoints: crossing.route.map((point) => ({ ...point, connectionName: "a" })) },
    obstacles: [{ ...pad, center: { x: 0, y: 0 }, width: 2, height: 0.2, ccwRotationDegrees: 45 }],
  })).toBe(false)
  for (const value of [Number.NaN, Infinity, -0.1]) {
    expect(() => validateComputeSelectionOutcome({ ...params, copperRules: { minViaEdgeToPadEdgeClearance: value } })).toThrow("invalid minViaEdgeToPadEdgeClearance")
  }
})
