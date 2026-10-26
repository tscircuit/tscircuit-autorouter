import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver, type SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { PhysicalPortClearance } from "lib/solvers/AvailableSegmentPointSolver/PhysicalPortClearance"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

const midpoint = { x: 145.87379893, y: 89.63976865 }

function createSrj(overrides: Partial<SimpleRouteJson> = {}): SimpleRouteJson {
  return {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: 140, maxX: 150, minY: 85, maxY: 95 },
    obstacles: [], connections: [],
    ...overrides,
  }
}

function solveEdge(srj?: SimpleRouteJson, overrides: Partial<CapacityMeshNode> = {}, returnCramped = true): SegmentPortPoint[] {
  const nodes: CapacityMeshNode[] = [
    { capacityMeshNodeId: "component-free-pad", center: { x: 145.73849884499998, y: 89.68989936 }, width: 0.27060016999996606, height: 0.4099991799999998, availableZ: [0, 1], _soicRegionType: "pad", _isComponentTopologyNode: true, ...overrides },
    { capacityMeshNodeId: "outside-free", center: { x: 146.38679955499998, y: 89.39463706000001 }, width: 1.0260012500000357, height: 0.8000009400000181, availableZ: [0, 1] },
  ]
  const solver = new AvailableSegmentPointSolver({ nodes, edges: [{ capacityMeshEdgeId: "gate", nodeIds: [nodes[0]!.capacityMeshNodeId, nodes[1]!.capacityMeshNodeId] }], traceWidth: 0.1, obstacleMargin: 0.15, shouldReturnCrampedPortPoints: returnCramped, physicalClearanceSrj: srj })
  solver.solve()
  return solver.getOutput().flatMap((segment) => segment.portPoints)
}

test("sample24's artificial short gate is ordinary only on physically clear layers", (): void => {
  const c149: Obstacle = { type: "rect", layers: ["top"], center: { x: 145.35319926, y: 89.78600026 }, width: 0.49999899999999997, height: 0.39999919999999994, connectedTo: ["goal"] }
  const srj = createSrj({ obstacles: [c149] })
  const inputSnapshot = structuredClone(srj)
  const legacy = solveEdge()
  expect(legacy).toHaveLength(2)
  expect(legacy.every((point) => point.cramped)).toBe(true)
  const clear = solveEdge(srj)
  expect(clear).toHaveLength(2)
  expect(clear.every((point) => !point.cramped)).toBe(true)
  expect(clear[0]!.x).toBeCloseTo(midpoint.x, 8)
  expect(clear[0]!.y).toBeCloseTo(midpoint.y, 8)
  expect(srj).toEqual(inputSnapshot)

  // This keepout has no graph node, electrical identity or connections. Its
  // explicit public zLayers must still block bottom while leaving top clear.
  const unmeshedKeepout: Obstacle = { type: "rect", layers: ["top"], zLayers: [1], center: { x: midpoint.x + 0.15, y: midpoint.y }, width: 0.1, height: 0.6, connectedTo: [] }
  const mixedSrj = createSrj({ obstacles: [c149, unmeshedKeepout] })
  const mixed = solveEdge(mixedSrj)
  expect(mixed.map((point) => [point.availableZ, point.cramped])).toEqual([[[0], false], [[1], true]])
  expect(mixed.map((point) => point.segmentPortPointId)).toEqual(["gate_pp0_z0", "gate_pp0_z1_cramped"])
  expect(solveEdge(mixedSrj, {}, false).map((point) => point.availableZ)).toEqual([[0]])
  const blocked = solveEdge(createSrj({ obstacles: [{ ...unmeshedKeepout, layers: ["top", "bottom"], zLayers: [0, 1] }] }))
  expect(blocked.every((point) => point.cramped)).toBe(true)
  for (const role of [{ _isNarrowQfpPadGap: true }, { _offBoardConnectionId: "outside" }, { _isVirtualOffboard: true }, { _offboardNetName: "outside" }, { _offBoardConnectedCapacityMeshNodeIds: ["outside"] }, { _containsObstacle: true }]) {
    expect(solveEdge(srj, role).every((point) => point.cramped)).toBe(true)
  }
  const largerPadClearance = new PhysicalPortClearance(createSrj({ obstacles: [c149], minTraceToPadEdgeClearance: 0.3 }), 0.1)
  expect(largerPadClearance.isPointClear({ ...midpoint, z: 0 })).toBe(false)
  expect(largerPadClearance.isPointClear({ ...midpoint, z: 1 })).toBe(true)
  expect(solveEdge(createSrj({ bounds: { minX: 140, maxX: midpoint.x + 0.1, minY: 85, maxY: 95 } })).every((point) => point.cramped)).toBe(true)
  expect(solveEdge(createSrj({ outline: [{ x: 140, y: 85 }, { x: 145.95, y: 85 }, { x: 145.95, y: 95 }, { x: 140, y: 95 }] })).every((point) => point.cramped)).toBe(true)

  const rotated = new PhysicalPortClearance(createSrj({ bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [{ type: "rect", layers: ["top"], center: { x: 0, y: 0 }, width: 2, height: 0.2, ccwRotationDegrees: 45, connectedTo: [] }] }), 0.1)
  expect(rotated.isPointClear({ x: 0.75, y: 0.75, z: 0 })).toBe(false)
  expect(rotated.isPointClear({ x: 0.8, y: -0.8, z: 0 })).toBe(true)
  const circleSrj = createSrj({ bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [{ type: "rect", shape: "circle", layers: ["top"], center: { x: 0, y: 0 }, width: 0.2, height: 0.2, isNonPlatedHole: true, connectedTo: [] }] })
  expect(new PhysicalPortClearance(circleSrj, 0.1).isPointClear({ x: 0.23, y: 0.23, z: 0 })).toBe(true)
  expect(new PhysicalPortClearance({ ...circleSrj, minTraceToHoleEdgeClearance: 0.3 }, 0.1).isPointClear({ x: 0.23, y: 0.23, z: 0 })).toBe(false)
  const fixedCopper = createSrj({ traces: [{ type: "pcb_trace", pcb_trace_id: "fixed", connection_name: "fixed", route: [{ route_type: "wire", x: 146, y: 89, layer: "top", width: 0.1 }] }] })
  expect(solveEdge(fixedCopper).every((point) => point.cramped)).toBe(true)
  expect(new PhysicalPortClearance(createSrj({ bounds: { minX: 150, maxX: 140, minY: 85, maxY: 95 } }), 0.1).isPointClear({ ...midpoint, z: 0 })).toBe(false)
})
